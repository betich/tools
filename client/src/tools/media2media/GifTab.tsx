import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropzone } from "@/components/Dropzone";
import { Timeline, usePlayback, formatTime } from "@/components/timeline";
import { FiFolderPlus, FiPause, FiPlay, FiPlus, FiRefreshCw } from "react-icons/fi";
import { Button, TextButton } from "@/components/ui";
import { useCodecPool } from "@/hooks/useCodecPool";
import { useToast } from "@/hooks/useToast";
import { IMAGE_ACCEPT } from "@/lib/codecs";
import { cn } from "@/lib/cn";
import { filesFromDrop } from "@/lib/droppedFiles";
import { ExportPanel } from "./gif/ExportPanel";
import { canvasSize, playDuration, playOrder, timelineTime, type GifDoc } from "./gif/model";
import { Preview } from "./gif/Preview";
import { gifSession, useGifSession } from "./gif/session";
import { Settings } from "./gif/Settings";
import { SpinSource } from "./gif/SpinSource";
import { framesFromFiles } from "./gif/sources/files";

type How = "replace" | "append";

const STAGE_TILE = 88;

/** Autoplay is a courtesy; under reduced motion the play button stays one press away instead. */
const calm = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The GIF composer is a room. From a laptop up it fills the viewport: the
 * animation plays on the stage, the timeline runs the full width under it,
 * timing and canvas sit to the left and export to the right, and nothing
 * but the side panes ever scrolls. Below that it is a column in the order
 * the work happens — look, arrange, tune, export.
 *
 * Frames play on a loop the moment they arrive, from a folder, a spin or
 * the video tab. Nothing is encoded until export; the work survives
 * switching tabs (it lives in `gifSession`).
 */
export function GifTab() {
  const session = gifSession;
  const { doc, canUndo } = useGifSession(session);
  const [spinning, setSpinning] = useState(false);
  const beforeSpin = useRef(doc.frames);

  const order = useMemo(() => playOrder(doc.frames.length, doc.pingPong), [doc.frames.length, doc.pingPong]);
  const duration = useMemo(() => playDuration(doc), [doc]);
  const playback = usePlayback({ duration });
  const size = canvasSize(doc);
  const empty = doc.frames.length === 0;

  // Asked for when frames land; honoured once the playback knows the new length.
  const [wantPlay, setWantPlay] = useState(() => doc.frames.length > 0);
  const { setPlaying, setTime } = playback;
  useEffect(() => {
    if (!wantPlay || duration <= 0) return;
    setWantPlay(false);
    if (calm()) return;
    setTime(0);
    setPlaying(true);
  }, [wantPlay, duration, setPlaying, setTime]);
  const autoplay = useCallback(() => setWantPlay(true), []);

  const { load, loading, cancel } = useFrameLoader(autoplay);

  const onFramesChange = useCallback(
    (frames: typeof doc.frames, kind: "commit" | "preview") =>
      (kind === "commit" ? session.set : session.preview)({ ...session.doc, frames }),
    [session],
  );

  const spin = () => {
    beforeSpin.current = session.doc.frames;
    setSpinning(true);
  };
  const closeSpin = () => {
    setSpinning(false);
    if (session.doc.frames !== beforeSpin.current && session.doc.frames.length > 0) autoplay();
  };

  if (spinning) {
    return (
      <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:px-6 lg:py-6 xl:px-7">
        <SpinSource onClose={closeSpin} />
      </div>
    );
  }

  const pane =
    "flex flex-col lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-hairline-faint lg:px-6 lg:pt-6 xl:px-7";

  return (
    <div
      className={cn(
        "flex flex-col gap-8",
        "lg:grid lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)_auto] lg:gap-0",
        "lg:grid-cols-[264px_minmax(0,1fr)_304px] xl:grid-cols-[288px_minmax(0,1fr)_336px]",
      )}
    >
      {/* the stage */}
      <section aria-label="preview" className="flex min-h-0 flex-col lg:col-start-2 lg:row-start-1">
        {empty ? (
          <div className="flex flex-1 flex-col gap-4 lg:p-6">
            <Dropzone
              folders
              accept={IMAGE_ACCEPT}
              onFiles={(files) => load(files, "replace")}
              cta="choose images"
              label="or drop images or a folder anywhere here"
              hint="one frame per image, in filename order · it plays as soon as they land"
              className="min-h-72 flex-1 gap-4"
            >
              <div className="mt-2 flex items-center gap-5">
                <FolderPicker onFiles={(files) => load(files, "replace")}>choose a folder</FolderPicker>
                <span className="text-meta text-micro font-mono" aria-hidden>
                  ·
                </span>
                <TextButton onClick={spin}>spin one image</TextButton>
              </div>
            </Dropzone>
            {loading ? <LoadProgress {...loading} onCancel={cancel} /> : null}
            {canUndo && !loading ? (
              <TextButton className="self-start" onClick={session.undo}>
                undo · bring the frames back
              </TextButton>
            ) : null}
          </div>
        ) : (
          <Stage
            doc={doc}
            time={playback.time}
            playing={playback.playing}
            onPlayingChange={playback.setPlaying}
            played={order.length}
            duration={duration}
            size={size}
          />
        )}
      </section>

      {/* the timeline, the width of the room */}
      <TimelineDock
        empty={empty}
        loading={loading}
        onCancel={cancel}
        onFiles={(files) => load(files, empty ? "replace" : "append")}
        onSpin={spin}
        onClear={() => session.clear()}
        count={doc.frames.length}
        duration={duration}
      >
        {empty ? null : (
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
            thumbHeight={STAGE_TILE}
            initialZoom={1}
          />
        )}
      </TimelineDock>

      {/* left: timing and canvas */}
      <aside
        aria-label="timing and canvas"
        className={cn(pane, "lg:col-start-1 lg:row-start-1 lg:border-r lg:pb-6", empty && "opacity-40")}
        inert={empty}
      >
        <Settings doc={doc} session={session} />
      </aside>

      {/* right: export */}
      <aside aria-label="export" className={cn(pane, "lg:col-start-3 lg:row-start-1 lg:border-l")}>
        <ExportPanel doc={doc} session={session} />
      </aside>
    </div>
  );
}

/**
 * The animation at its real timing, as large as the room allows, with a
 * caption line that says what it is and a play control you can't miss.
 */
function Stage({
  doc,
  time,
  playing,
  onPlayingChange,
  played,
  duration,
  size,
}: {
  doc: GifDoc;
  time: number;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  played: number;
  duration: number;
  size: { width: number; height: number };
}) {
  return (
    <div className="flex min-h-[44vh] flex-1 flex-col lg:min-h-0">
      <div className="flex min-h-0 flex-1 items-center justify-center py-2 lg:p-8">
        <Preview doc={doc} store={gifSession.store} time={time} fill className="max-h-[56vh] lg:max-h-none" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-3 lg:px-8 lg:pb-4">
        <p className="text-meta text-micro font-mono uppercase">
          <span className="tabular-nums tracking-normal">{doc.frames.length}</span> frames
          {played !== doc.frames.length ? (
            <>
              {" · "}
              <span className="tabular-nums tracking-normal">{played}</span> played
            </>
          ) : null}
          {" · "}
          <span className="tabular-nums tracking-normal">{formatTime(duration)}</span>
          {" · "}
          <span className="tabular-nums tracking-normal">
            {size.width} × {size.height}
          </span>
        </p>
        <button
          type="button"
          onClick={() => onPlayingChange(!playing)}
          aria-pressed={playing}
          className={cn(
            "text-micro flex cursor-pointer items-center gap-2 font-mono uppercase transition-colors duration-200",
            "focus-visible:outline-indigo focus-visible:outline-1 focus-visible:outline-offset-4",
            playing ? "text-ink hover:text-indigo" : "text-meta hover:text-indigo",
          )}
        >
          {playing ? (
            <>
              <span className="bg-signal size-1.5 rounded-full" aria-hidden />
              playing · on a loop
              <FiPause className="size-3.5" aria-hidden />
            </>
          ) : (
            <>
              <FiPlay className="size-3.5" aria-hidden />
              play
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * The timeline's dock: its name and length, the ways to bring in more frames,
 * and the strip itself. Drop images or a folder anywhere on it and they join
 * the end; an empty dock is a dashed lane waiting for them.
 */
function TimelineDock({
  empty,
  loading,
  onCancel,
  onFiles,
  onSpin,
  onClear,
  count,
  duration,
  children,
}: {
  empty: boolean;
  loading: Loading | null;
  onCancel: () => void;
  onFiles: (files: File[]) => void;
  onSpin: () => void;
  onClear: () => void;
  count: number;
  duration: number;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const busy = !!loading;
  return (
    <section
      aria-label="timeline"
      className="border-hairline-faint relative flex flex-col gap-3 border-t pt-5 lg:col-span-3 lg:row-start-2 lg:px-6 lg:pb-4 lg:pt-3 xl:px-7"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setOver(false);
        void filesFromDrop(e.dataTransfer).then((files) => files.length > 0 && onFiles(files));
      }}
    >
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <h2 className="text-ink text-title font-mono font-bold uppercase">timeline</h2>
        <span className="text-meta text-micro font-mono uppercase">
          {empty ? (
            "no frames yet"
          ) : (
            <>
              <span className="tabular-nums tracking-normal">{count}</span> frames ·{" "}
              <span className="tabular-nums tracking-normal">{formatTime(duration)}</span>
            </>
          )}
        </span>
        {loading ? <LoadProgress {...loading} onCancel={onCancel} className="w-full max-w-64" /> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilePicker onFiles={onFiles} disabled={busy} look="outline">
            <FiPlus className="size-3" aria-hidden /> images
          </FilePicker>
          <FolderPicker onFiles={onFiles} disabled={busy} look="ghost">
            <FiFolderPlus className="size-3" aria-hidden /> folder
          </FolderPicker>
          <Button size="sm" variant="ghost" onClick={onSpin} disabled={busy}>
            <FiRefreshCw className="size-3" aria-hidden /> spin
          </Button>
          {empty ? null : (
            <TextButton onClick={onClear} disabled={busy} className="ml-3">
              start over
            </TextButton>
          )}
        </div>
      </header>

      {empty ? (
        <div className="border-hairline text-label text-micro rounded-xs flex h-32 items-center justify-center border border-dashed px-4 text-center font-mono uppercase">
          frames line up here — one per image, each as wide as it is long
        </div>
      ) : (
        children
      )}

      {over ? (
        <div
          className="border-indigo text-indigo text-micro rounded-card pointer-events-none absolute inset-1 z-20 flex items-center justify-center border border-dashed bg-[rgba(90,87,240,0.14)] font-mono uppercase"
          aria-hidden
        >
          {empty ? "let go to start the animation" : "let go to add them at the end"}
        </div>
      ) : null}
    </section>
  );
}

/* ── Loading ────────────────────────────────────────────────────────────── */

type Loading = { done: number; total: number };

/**
 * Decodes picked files into frames on the codec pool and hands them to the
 * session. One load at a time; `onLoaded` fires when frames have landed.
 */
function useFrameLoader(onLoaded: () => void) {
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
        if (result.frames.length > 0) onLoaded();
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
    [toast, pool, onLoaded],
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
        <span className="text-label text-micro font-mono uppercase">
          decoding{" "}
          <span className="tabular-nums tracking-normal">
            {done} / {total}
          </span>
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
        <div
          className="bg-indigo absolute inset-y-0 left-0 transition-[width] duration-200"
          style={{ width: `${fraction * 100}%` }}
        />
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

type PickerProps = {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  /** A text button by default; a small real button where the picker is a section's own action. */
  look?: "text" | "outline" | "ghost";
  children: React.ReactNode;
};

function Picker({
  onFiles,
  disabled,
  className,
  look = "text",
  children,
  folder = false,
}: PickerProps & { folder?: boolean }) {
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
      {look === "text" ? (
        <TextButton className={className} disabled={disabled} onClick={() => input.current?.click()}>
          {children}
        </TextButton>
      ) : (
        <Button
          size="sm"
          variant={look}
          className={className}
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {children}
        </Button>
      )}
    </>
  );
}
