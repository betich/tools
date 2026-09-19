import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropzone } from "@/components/Dropzone";
import { Timeline, usePlayback, formatTime } from "@/components/timeline";
import { TextButton } from "@/components/ui";
import { useCodecPool } from "@/hooks/useCodecPool";
import { useToast } from "@/hooks/useToast";
import { IMAGE_ACCEPT } from "@/lib/codecs";
import { cn } from "@/lib/cn";
import { ExportPanel } from "./gif/ExportPanel";
import { canvasSize, playDuration, playOrder, timelineTime } from "./gif/model";
import { Preview } from "./gif/Preview";
import { gifSession, useGifSession } from "./gif/session";
import { Settings } from "./gif/Settings";
import { SpinSource } from "./gif/SpinSource";
import { framesFromFiles } from "./gif/sources/files";

type How = "replace" | "append";

/**
 * The GIF tab: frames in from a source, arranged on the shared timeline,
 * played live on a canvas at their real delays. Nothing is encoded until
 * export; the work survives switching tabs (it lives in `gifSession`).
 */
export function GifTab() {
  const session = gifSession;
  const { doc, canUndo } = useGifSession(session);
  const { load, loading, cancel } = useFrameLoader();
  const [spinning, setSpinning] = useState(false);

  const order = useMemo(() => playOrder(doc.frames.length, doc.pingPong), [doc.frames.length, doc.pingPong]);
  const duration = useMemo(() => playDuration(doc), [doc]);
  const playback = usePlayback({ duration });
  const size = canvasSize(doc);

  const onFramesChange = useCallback(
    (frames: typeof doc.frames, kind: "commit" | "preview") =>
      (kind === "commit" ? session.set : session.preview)({ ...session.doc, frames }),
    [session],
  );

  if (spinning) return <SpinSource onClose={() => setSpinning(false)} />;

  if (doc.frames.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Dropzone
          folders
          accept={IMAGE_ACCEPT}
          onFiles={(files) => load(files, "replace")}
          cta="choose images"
          label="or drop images or a folder here"
          hint="one frame per image, in filename order"
        >
          <FolderPicker onFiles={(files) => load(files, "replace")} className="mt-1">
            choose a folder
          </FolderPicker>
        </Dropzone>
        {loading ? <LoadProgress {...loading} onCancel={cancel} /> : null}
        {!loading ? (
          <TextButton className="self-start" onClick={() => setSpinning(true)}>
            or spin one image
          </TextButton>
        ) : null}
        {canUndo && !loading ? (
          <TextButton className="self-start" onClick={session.undo}>
            undo · bring the frames back
          </TextButton>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-3">
          <Preview doc={doc} store={session.store} time={playback.time} />
          <p className="text-meta font-mono text-meta uppercase">
            <span className="tabular-nums">{doc.frames.length}</span> frames
            {order.length !== doc.frames.length ? (
              <>
                {" · "}
                <span className="tabular-nums">{order.length}</span> played
              </>
            ) : null}
            {" · "}
            <span className="tabular-nums">{formatTime(duration)}</span>
            {" · "}
            <span className="tabular-nums tracking-normal">
              {size.width} × {size.height}
            </span>
          </p>
        </div>
        <div className="flex flex-col gap-7">
          <Settings doc={doc} session={session} />
          <div className="border-hairline-faint border-t pt-7">
            <ExportPanel doc={doc} session={session} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2">
          {loading ? <LoadProgress {...loading} onCancel={cancel} className="mr-auto w-full max-w-sm" /> : null}
          <FilePicker onFiles={(files) => load(files, "append")} disabled={!!loading}>
            add images
          </FilePicker>
          <FolderPicker onFiles={(files) => load(files, "append")} disabled={!!loading}>
            add a folder
          </FolderPicker>
          <TextButton onClick={() => setSpinning(true)} disabled={!!loading}>
            spin an image
          </TextButton>
          <TextButton onClick={() => session.clear()} disabled={!!loading}>
            start over
          </TextButton>
        </div>
        <Timeline
          mode="frames"
          frames={doc.frames}
          onFramesChange={onFramesChange}
          onGestureStart={session.snapshot}
          onUndo={session.undo}
          onRedo={session.redo}
          time={timelineTime(doc.frames, order, playback.time)}
          // The strip shows each frame once; a scrub lands on the forward pass.
          onTimeChange={playback.setTime}
          playing={playback.playing}
          onPlayingChange={playback.setPlaying}
          loop={playback.loop}
          onLoopChange={playback.setLoop}
          thumbnails={session.store.thumbnails}
          aspect={size.height > 0 ? size.width / size.height : 1}
        />
      </div>
    </div>
  );
}

/* ── Loading ────────────────────────────────────────────────────────────── */

type Loading = { done: number; total: number };

/** Decodes picked files into frames on the codec pool and hands them to the session. One load at a time. */
function useFrameLoader() {
  const toast = useToast();
  const running = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState<Loading | null>(null);

  useEffect(() => () => running.current?.abort(), []);
  // After the effect above, so the load is aborted before the pool goes.
  const pool = useCodecPool();

  const load = useCallback(
    async (files: File[], how: How) => {
      running.current?.abort();
      const ctrl = new AbortController();
      running.current = ctrl;
      setLoading({ done: 0, total: files.length });
      try {
        const result = await framesFromFiles(files, pool(), {
          signal: ctrl.signal,
          onProgress: (done, total) => {
            if (!ctrl.signal.aborted) setLoading({ done, total });
          },
        });
        gifSession.addFrames(result.frames, how);
        if (result.frames.length === 0) {
          toast(result.failed.length > 0 ? "none of those images would open" : "no images in that selection");
        } else if (result.failed.length > 0) {
          toast(
            result.failed.length === 1
              ? `${result.failed[0]} would not open — skipped`
              : `${result.failed.length} images would not open — skipped`,
          );
        }
      } catch (error) {
        if (!ctrl.signal.aborted) toast(error instanceof Error ? error.message : "could not load those images");
      } finally {
        if (running.current === ctrl) {
          running.current = null;
          setLoading(null);
        }
      }
    },
    [toast, pool],
  );

  const cancel = useCallback(() => {
    running.current?.abort();
    running.current = null;
    setLoading(null);
  }, []);

  return { load, loading, cancel };
}

function LoadProgress({ done, total, onCancel, className }: Loading & { onCancel: () => void; className?: string }) {
  const fraction = total > 0 ? done / total : 0;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-label font-mono text-meta uppercase">
          decoding <span className="tabular-nums tracking-normal">{done} / {total}</span>
        </span>
        <TextButton onClick={onCancel}>stop</TextButton>
      </div>
      <div
        role="progressbar"
        aria-label="decoding frames"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="bg-wash relative h-0.5 w-full overflow-hidden rounded-full"
      >
        <div className="bg-indigo absolute inset-y-0 left-0 transition-[width] duration-200" style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}

/* ── Pickers ────────────────────────────────────────────────────────────── */

function FilePicker(props: PickerProps) {
  return <Picker {...props} />;
}

/** A folder picker: every file inside, each with its path, sorted later by the source. */
function FolderPicker(props: PickerProps) {
  return <Picker {...props} folder />;
}

type PickerProps = { onFiles: (files: File[]) => void; disabled?: boolean; className?: string; children: React.ReactNode };

function Picker({ onFiles, disabled, className, children, folder = false }: PickerProps & { folder?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Not in React's types; every current browser supports it.
    if (folder) input.current?.setAttribute("webkitdirectory", "");
  }, [folder]);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={folder ? undefined : IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
      <TextButton className={className} disabled={disabled} onClick={() => input.current?.click()}>
        {children}
      </TextButton>
    </>
  );
}
