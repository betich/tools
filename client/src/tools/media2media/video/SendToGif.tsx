import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatTime } from "@/components/timeline";
import { Button, Field, Prose, Segmented, TextButton } from "@/components/ui";
import { useToast } from "@/hooks/useToast";
import { bytes } from "@/lib/format";
import { gifSession, useGifSession } from "../gif/session";
import type { FrameHook } from "./frameHook";
import { framedSize, outputDuration, type SourceInfo, type VideoEdit } from "./settings";
import {
  defaultGifSend,
  GIF_RATES,
  gifFrameCount,
  gifSize,
  gifWidthChoices,
  sendBytes,
  sendProblem,
  type GifSend,
} from "./toGif";

type Props = {
  file: File;
  source: SourceInfo;
  edit: VideoEdit;
  /** Whatever hook the tab has on (the chroma keyer); keyed frames arrive with their alpha. */
  frameHook: FrameHook | null;
  /** The export is running. */
  disabled: boolean;
  /** Called as the send starts, so the tab can stop playback. */
  onStart?: () => void;
};

/**
 * The trimmed clip as GIF frames: rotate, crop and speed carry over; the
 * frame rate and width are the GIF's own. One click sends and opens the GIF
 * tab. Frames go across in memory — nothing is encoded twice.
 */
export function SendToGif({ file, source, edit, frameHook, disabled, onStart }: Props) {
  const [settings, setSettings] = useState<GifSend>(defaultGifSend);
  const [making, setMaking] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const running = useRef<AbortController | null>(null);
  const { doc } = useGifSession();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => () => running.current?.abort(), []);

  if (!source.hasVideo || edit.output !== "video") return null;

  const framedWidth = framedSize(edit, source).width;
  const widths = gifWidthChoices(framedWidth);
  const width = settings.width !== null && settings.width < framedWidth ? settings.width : null;
  const size = gifSize(edit, source, width);
  const count = gifFrameCount(edit, settings.fps);
  const problem = sendProblem(size, count);
  const blocked = disabled || !!problem || !source.videoDecodable;
  const hasFrames = doc.frames.length > 0;

  const send = async (how: "replace" | "append") => {
    if (blocked || making) return;
    onStart?.();
    const ctrl = new AbortController();
    running.current = ctrl;
    setFailed(null);
    setMaking({ done: 0, total: count });
    try {
      // Mediabunny loads with the first send, not with the tab.
      const { framesForGif, SendCanceled } = await import("./sendToGif");
      try {
        const frames = await framesForGif({
          file,
          name: file.name,
          edit,
          source,
          settings: { ...settings, width },
          frameHook,
          signal: ctrl.signal,
          onProgress: (done, total) => {
            if (!ctrl.signal.aborted) setMaking({ done, total });
          },
        });
        if (frameHook) {
          // Keyed frames carry alpha: a transparent background keeps it, and
          // APNG keeps the soft edges a GIF's 1-bit transparency would cut.
          gifSession.addFrames(frames, how, { background: null });
          gifSession.exportFormat = "apng";
        } else {
          gifSession.addFrames(frames, how);
        }
        toast(`${frames.length} frames sent to the gif tab`);
        navigate("/media2media/gif");
      } catch (e) {
        if (!(e instanceof SendCanceled) && !ctrl.signal.aborted)
          setFailed(
            e instanceof Error ? e.message : "Making the frames stopped for a reason this browser didn't give.",
          );
      }
    } finally {
      if (running.current === ctrl) {
        running.current = null;
        setMaking(null);
      }
    }
  };

  const stop = () => {
    running.current?.abort();
    running.current = null;
    setMaking(null);
  };

  return (
    <section className="border-hairline-faint flex flex-col gap-5 border-t pt-6" aria-label="send to the gif tab">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-meta text-micro font-mono uppercase">to the gif tab</span>
          <span className="text-meta text-micro font-mono tabular-nums tracking-normal">
            {[
              `${count} frames`,
              formatTime(outputDuration(edit)),
              `${size.width}×${size.height}`,
              bytes(sendBytes(size, count)),
              frameHook ? "keyed" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {making ? null : hasFrames ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button onClick={() => void send("replace")} disabled={blocked}>
              replace its frames
            </Button>
            <Button variant="outline" onClick={() => void send("append")} disabled={blocked}>
              add after them
            </Button>
          </div>
        ) : (
          <Button onClick={() => void send("replace")} disabled={blocked}>
            send {count} frames
          </Button>
        )}
      </div>

      <fieldset disabled={disabled || !!making} className="flex flex-wrap gap-x-10 gap-y-4 disabled:opacity-35">
        <Field label="frame rate">
          <Segmented
            value={String(settings.fps)}
            onChange={(v) => setSettings((s) => ({ ...s, fps: Number(v) }))}
            options={GIF_RATES.map((r) => ({ value: String(r), label: `${r}` }))}
          />
        </Field>
        <Field label="width">
          <Segmented
            value={width === null ? "full" : String(width)}
            onChange={(v) => setSettings((s) => ({ ...s, width: v === "full" ? null : Number(v) }))}
            options={[
              { value: "full", label: `${framedWidth}` },
              ...widths.map((w) => ({ value: String(w), label: `${w}` })),
            ]}
          />
        </Field>
      </fieldset>

      {making ? <Progress {...making} onStop={stop} /> : null}
      {failed ? <Prose>{failed}</Prose> : null}
      {!making && problem ? <Prose>{problem}</Prose> : null}
      {!making && !problem && hasFrames ? (
        <Prose>The GIF tab already holds {doc.frames.length} frames. These can replace them or follow them.</Prose>
      ) : null}
    </section>
  );
}

function Progress({ done, total, onStop }: { done: number; total: number; onStop: () => void }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-meta text-micro font-mono uppercase">
          making frames{" "}
          <span className="text-ink tabular-nums tracking-normal">
            {done} / {total}
          </span>
        </span>
        <TextButton onClick={onStop}>stop</TextButton>
      </div>
      <div
        role="progressbar"
        aria-label="making frames for the gif tab"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="bg-wash relative h-0.5 w-full overflow-hidden rounded-full"
      >
        <div
          className="bg-indigo absolute inset-y-0 left-0 transition-[width] duration-200"
          style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}
