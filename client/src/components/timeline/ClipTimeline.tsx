import { useMemo, useRef, useState } from "react";
import { TextButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { clamp, formatTime, moveTrimEdge, type Trim } from "./model";
import {
  Playhead,
  Ruler,
  Transport,
  useTimelineKeys,
  useViewport,
  type ChangeKind,
  type TimelineCommon,
} from "./parts";
import { Thumb, ThumbCache } from "./Thumb";

export type ClipTimelineProps = TimelineCommon & {
  mode: "clip";
  /** Length of the source, in ms. */
  duration: number;
  trim: Trim;
  /** `"preview"` while a handle is dragged (snapshot taken at `onGestureStart`); `"commit"` for set in/out from the keys or buttons. */
  onTrimChange: (trim: Trim, kind: ChangeKind) => void;
  /** One frame of the source, for ←/→ and the shortest trim. Default 1/30 s. */
  frameStep?: number;
  /** Thumbnail aspect, width / height — the video's own. */
  aspect?: number;
};

const TRACK_H = 56;
const HANDLE = 10;
/** Thumbnails are asked for at times rounded to this, so a resize mostly hits the cache. */
const THUMB_QUANTUM = 100;

/**
 * Clip mode: the whole source as one continuous strip of thumbnails, fitted
 * to the width, with in and out handles. What falls outside the trim is
 * covered by the ground at 70% — the cut is visible, the picture under it
 * is not a lie about the output. Press anywhere on the track or ruler to
 * scrub; I and O set the trim at the playhead.
 */
export function ClipTimeline(props: ClipTimelineProps) {
  const {
    duration,
    trim,
    onTrimChange,
    time,
    onTimeChange,
    playing,
    onPlayingChange,
    loop,
    onLoopChange,
    thumbnails,
    onGestureStart,
    onUndo,
    onRedo,
    hotkeys = true,
    label = "clip",
    frameStep = 1000 / 30,
    aspect = 16 / 9,
    className,
  } = props;

  const box = useRef<HTMLDivElement>(null);
  const view = useViewport(box);
  const width = Math.max(1, view.width);
  const pxPerMs = duration > 0 ? width / duration : 0;
  const toX = (ms: number) => ms * pxPerMs;
  const toTime = (x: number) => (pxPerMs > 0 ? clamp(x / pxPerMs, 0, duration) : 0);

  const cache = useMemo(() => new ThumbCache(), [thumbnails]);
  const [drag, setDrag] = useState<{ pointerId: number; edge: "in" | "out" | "scrub"; offset: number } | null>(null);

  const tileW = Math.round((TRACK_H - 2) * aspect);
  const count = duration > 0 ? Math.max(1, Math.ceil(width / tileW)) : 0;

  const scrub = (ms: number) => {
    if (playing) onPlayingChange(false);
    onTimeChange(ms);
  };
  const setEdge = (edge: "in" | "out", at: number, kind: ChangeKind) => {
    const next = moveTrimEdge(trim, edge, at, duration, frameStep);
    if (next.in !== trim.in || next.out !== trim.out) onTrimChange(next, kind);
  };
  const localX = (e: React.PointerEvent) => e.clientX - (box.current?.getBoundingClientRect().left ?? 0);

  useTimelineKeys(hotkeys, {
    togglePlay: () => onPlayingChange(!playing),
    step: (dir) => scrub(clamp(time + dir * frameStep, 0, duration)),
    undo: onUndo,
    redo: onRedo,
    extra: (e) => {
      const k = e.key.toLowerCase();
      if (k === "i" || k === "o") {
        setEdge(k === "i" ? "in" : "out", time, "commit");
        return true;
      }
      return false;
    },
  });

  const inX = toX(trim.in);
  const outX = toX(trim.out);

  return (
    <div role="group" aria-label={label} className={cn("min-w-0", className)}>
      <Transport
        time={time}
        total={duration}
        playing={playing}
        onPlayingChange={onPlayingChange}
        loop={loop}
        onLoopChange={onLoopChange}
      >
        <span className="text-meta text-meta font-mono uppercase">
          in <span className="text-ink tabular-nums tracking-normal">{formatTime(trim.in)}</span>
        </span>
        <span className="text-meta text-meta font-mono uppercase">
          out <span className="text-ink tabular-nums tracking-normal">{formatTime(trim.out)}</span>
        </span>
        <span className="text-meta text-meta font-mono uppercase">
          keeps <span className="text-ink tabular-nums tracking-normal">{formatTime(trim.out - trim.in)}</span>
        </span>
        <TextButton onClick={() => setEdge("in", time, "commit")} title="set in at the playhead · I">
          set in
        </TextButton>
        <TextButton onClick={() => setEdge("out", time, "commit")} title="set out at the playhead · O">
          set out
        </TextButton>
      </Transport>

      <div ref={box} className="border-hairline-faint relative border-y">
        <Ruler pxPerMs={pxPerMs || 1} left={0} right={width} toX={toX} toTime={toTime} onScrub={scrub} />
        <div
          className="relative my-1.5 cursor-ew-resize touch-none select-none overflow-hidden"
          style={{ height: TRACK_H }}
          onPointerDown={(e) => {
            if (e.button !== 0 || duration <= 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const edge = (e.target as HTMLElement).closest<HTMLElement>("[data-handle]")?.dataset.handle as
              "in" | "out" | undefined;
            if (edge) {
              // Keep the grab point under the pointer rather than jumping the edge to it.
              onGestureStart();
              setDrag({ pointerId: e.pointerId, edge, offset: localX(e) - (edge === "in" ? inX : outX) });
            } else {
              setDrag({ pointerId: e.pointerId, edge: "scrub", offset: 0 });
              scrub(toTime(localX(e)));
            }
          }}
          onPointerMove={(e) => {
            if (!drag || drag.pointerId !== e.pointerId) return;
            const ms = toTime(localX(e) - drag.offset);
            if (drag.edge === "scrub") scrub(ms);
            else setEdge(drag.edge, ms, "preview");
          }}
          onPointerUp={() => setDrag(null)}
          onPointerCancel={() => setDrag(null)}
        >
          {/* The strip. Fixed tiles across the width; no virtualising needed. */}
          <div className="bg-surface absolute inset-0 flex" aria-hidden>
            {Array.from({ length: count }, (_, i) => {
              const ms = Math.round(((((i + 0.5) * tileW) / width) * duration) / THUMB_QUANTUM) * THUMB_QUANTUM;
              return (
                <div
                  key={i}
                  className="border-paper relative h-full shrink-0 overflow-hidden border-r"
                  style={{ width: tileW }}
                >
                  <Thumb
                    request={{ kind: "time", ms: clamp(ms, 0, duration) }}
                    cache={cache}
                    provider={thumbnails}
                    width={tileW}
                    height={TRACK_H}
                  />
                </div>
              );
            })}
          </div>

          {/* What the trim leaves out. */}
          <div
            className="bg-paper/70 pointer-events-none absolute inset-y-0 left-0"
            style={{ width: inX }}
            aria-hidden
          />
          <div
            className="bg-paper/70 pointer-events-none absolute inset-y-0 right-0"
            style={{ left: outX }}
            aria-hidden
          />
          <div
            className="border-indigo pointer-events-none absolute inset-y-0 border-y"
            style={{ left: inX, width: Math.max(0, outX - inX) }}
            aria-hidden
          />

          <Handle edge="in" x={inX} active={drag?.edge === "in"} value={trim.in} duration={duration} />
          <Handle edge="out" x={outX} active={drag?.edge === "out"} value={trim.out} duration={duration} />
        </div>
        <div className="pointer-events-none absolute inset-0">
          <Playhead x={toX(time)} />
        </div>
      </div>
    </div>
  );
}

/** A trim handle: a bracket on the inside of the kept region, periwinkle when held or pointed at. */
function Handle({
  edge,
  x,
  active,
  value,
  duration,
}: {
  edge: "in" | "out";
  x: number;
  active: boolean;
  value: number;
  duration: number;
}) {
  return (
    <div
      data-handle={edge}
      role="slider"
      aria-label={edge === "in" ? "trim in" : "trim out"}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={formatTime(value)}
      className={cn(
        "group absolute inset-y-0 z-10 flex cursor-ew-resize items-center justify-center",
        edge === "in" ? "rounded-l-xs" : "rounded-r-xs",
        active ? "bg-indigo" : "bg-ink/55 hover:bg-indigo",
        "transition-colors duration-200",
      )}
      style={{ left: edge === "in" ? x : x - HANDLE, width: HANDLE }}
    >
      <span className="bg-paper/70 h-4 w-px" aria-hidden />
    </div>
  );
}
