import { useCallback, useEffect, useRef, useState } from "react";
import { PageHead, Shell } from "@/components/Shell";
import { Segmented } from "@/components/ui";
import { Timeline, usePlayback, type ThumbnailProvider, type TimelineFrame, type Trim } from "@/components/timeline";
import { useHistory } from "@/hooks/useHistory";
import { formatTime } from "@/components/timeline/model";
import type { FixtureRequest, FixtureResponse } from "./fixtureThumbs.worker";

/**
 * Dev-only bench for the shared timeline (`/dev/timeline`, not on the index
 * and not in production builds). Both modes run on fixture data: 200 frames
 * of mixed delays, and a 2m 14s clip. Thumbnails come from a worker, as they
 * will in the real tabs.
 */
export function TimelineDemo() {
  const [mode, setMode] = useState<"frames" | "clip">("frames");
  const thumbnails = useFixtureThumbnails();

  return (
    <Shell width="wide">
      <PageHead title="timeline" note="A bench for the shared timeline. Fixture data only; nothing here is saved." />
      <Segmented
        className="mb-8"
        value={mode}
        onChange={setMode}
        options={[
          { value: "frames", label: "frames · 200" },
          { value: "clip", label: "clip" },
        ]}
      />
      {mode === "frames" ? <FramesBench thumbnails={thumbnails} /> : <ClipBench thumbnails={thumbnails} />}
    </Shell>
  );
}

const FIXTURE_FRAMES: TimelineFrame[] = Array.from({ length: 200 }, (_, i) => ({
  id: `f${i}`,
  delay: [40, 80, 80, 120, 60, 200][i % 6]!,
}));

function FramesBench({ thumbnails }: { thumbnails: ThumbnailProvider }) {
  const history = useHistory<readonly TimelineFrame[]>(FIXTURE_FRAMES);
  const total = history.value.reduce((t, f) => t + f.delay, 0);
  const playback = usePlayback({ duration: total });
  const [selection, setSelection] = useState<string[]>([]);

  return (
    <>
      <Timeline
        mode="frames"
        frames={history.value}
        onFramesChange={history.change}
        onSelectionChange={setSelection}
        onGestureStart={history.snapshot}
        onUndo={history.undo}
        onRedo={history.redo}
        time={playback.time}
        onTimeChange={playback.setTime}
        playing={playback.playing}
        onPlayingChange={playback.setPlaying}
        loop={playback.loop}
        onLoopChange={playback.setLoop}
        thumbnails={thumbnails}
      />
      <Readout
        lines={[
          `${history.value.length} frames · ${formatTime(total)}`,
          `${selection.length} selected`,
          `undo ${history.canUndo ? "available" : "empty"} · redo ${history.canRedo ? "available" : "empty"}`,
        ]}
      />
    </>
  );
}

const CLIP_MS = 134_000;

function ClipBench({ thumbnails }: { thumbnails: ThumbnailProvider }) {
  const history = useHistory<Trim>({ in: 4_000, out: 96_500 });
  const trim = history.value;
  const playback = usePlayback({ duration: CLIP_MS, range: { start: trim.in, end: trim.out } });

  return (
    <>
      <Timeline
        mode="clip"
        duration={CLIP_MS}
        trim={trim}
        onTrimChange={history.change}
        onGestureStart={history.snapshot}
        onUndo={history.undo}
        onRedo={history.redo}
        time={playback.time}
        onTimeChange={playback.setTime}
        playing={playback.playing}
        onPlayingChange={playback.setPlaying}
        loop={playback.loop}
        onLoopChange={playback.setLoop}
        thumbnails={thumbnails}
      />
      <Readout
        lines={[`undo ${history.canUndo ? "available" : "empty"} · redo ${history.canRedo ? "available" : "empty"}`]}
      />
    </>
  );
}

function Readout({ lines }: { lines: string[] }) {
  return (
    <div className="text-meta text-meta mt-6 flex flex-col gap-1 font-mono uppercase">
      {lines.map((l) => (
        <span key={l} className="tabular-nums">
          {l}
        </span>
      ))}
    </div>
  );
}

/**
 * One worker for the page; each request waits for its own answer by id. The
 * worker is made inside the effect so StrictMode's mount–unmount–mount gets
 * a live one the second time.
 */
function useFixtureThumbnails(): ThumbnailProvider {
  const worker = useRef<Worker | null>(null);
  const waiting = useRef(new Map<number, (b: ImageBitmap | null) => void>());

  useEffect(() => {
    const w = new Worker(new URL("./fixtureThumbs.worker.ts", import.meta.url), { type: "module" });
    const pending = waiting.current;
    w.onmessage = (e: MessageEvent<FixtureResponse>) => {
      const done = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (done) done(e.data.bitmap);
      else e.data.bitmap.close();
    };
    worker.current = w;
    return () => {
      w.terminate();
      worker.current = null;
      for (const done of pending.values()) done(null);
      pending.clear();
    };
  }, []);

  return useCallback<ThumbnailProvider>(
    (req, size, signal) =>
      new Promise((resolve) => {
        const w = worker.current;
        if (!w) return resolve(null);
        const id = nextId++;
        const message: FixtureRequest =
          req.kind === "frame"
            ? { id, label: req.id, tone: (req.index % 24) / 23, width: size.width, height: size.height }
            : {
                id,
                label: formatTime(req.ms),
                tone: (req.ms % 20_000) / 20_000,
                width: size.width,
                height: size.height,
              };
        waiting.current.set(id, resolve);
        signal.addEventListener("abort", () => {
          waiting.current.delete(id);
          resolve(null);
        });
        w.postMessage(message);
      }),
    [],
  );
}

let nextId = 1;
