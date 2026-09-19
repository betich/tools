import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { FiPause, FiPlay } from "react-icons/fi";
import { IconButton, TextButton } from "@/components/ui";
import { formatTick, formatTime, tickStep } from "./model";
import type { ThumbnailProvider } from "./Thumb";

/** What both modes share: the playhead, transport and undo wiring. */
export type TimelineCommon = {
  /** Playhead, in ms. Controlled — `usePlayback` supplies all six of these. */
  time: number;
  onTimeChange: (ms: number) => void;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  /** Lazily asked for each thumbnail on screen; see `ThumbnailProvider`. */
  thumbnails: ThumbnailProvider;
  /**
   * Fires once as a drag begins (reorder, duration edge, trim handle), before
   * the first `"preview"` change. Take the undo snapshot here — `useHistory`'s
   * `snapshot`.
   */
  onGestureStart: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  /**
   * Listen for space, arrows, delete and cmd/ctrl-z on the window (ignoring
   * text fields and focused buttons). Turn off when two timelines share a page.
   */
  hotkeys?: boolean;
  /** Accessible name for the whole timeline. */
  label?: string;
  className?: string;
};

export type ChangeKind = "commit" | "preview";

export const RULER_H = 20;

/** Play/pause, loop and the time readout, then whatever the mode adds on the right. */
export function Transport({
  time,
  total,
  playing,
  onPlayingChange,
  loop,
  onLoopChange,
  children,
}: {
  time: number;
  total: number;
  playing: boolean;
  onPlayingChange: (p: boolean) => void;
  loop: boolean;
  onLoopChange: (l: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pb-3">
      <IconButton
        circle
        label={playing ? "pause · space" : "play · space"}
        onClick={() => onPlayingChange(!playing)}
        disabled={total <= 0}
      >
        {playing ? <FiPause className="size-3.5" /> : <FiPlay className="size-3.5 translate-x-px" />}
      </IconButton>
      <span className="text-ink text-label font-mono tabular-nums tracking-normal">
        {formatTime(time)}
        <span className="text-meta"> / {formatTime(total)}</span>
      </span>
      <TextButton active={loop} aria-pressed={loop} onClick={() => onLoopChange(!loop)}>
        loop
      </TextButton>
      {children ? <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-3">{children}</div> : null}
    </div>
  );
}

/**
 * Time ticks across the top of the track; pressing and dragging here scrubs.
 * `toX`/`toTime` map between content x and ms (frames mode is not linear).
 */
export const Ruler = memo(function Ruler({
  pxPerMs,
  left,
  right,
  toX,
  toTime,
  onScrub,
  onScrubEnd,
}: {
  pxPerMs: number;
  left: number;
  right: number;
  toX: (ms: number) => number;
  toTime: (x: number) => number;
  onScrub: (ms: number) => void;
  onScrubEnd?: () => void;
}) {
  const step = tickStep(pxPerMs);
  const first = Math.max(0, Math.floor(toTime(left) / step) * step);
  const last = toTime(right);
  const ticks: number[] = [];
  for (let t = first; t <= last + step && ticks.length < 400; t += step) ticks.push(t);

  const xFrom = (e: React.PointerEvent<HTMLDivElement>) => e.clientX - e.currentTarget.getBoundingClientRect().left;

  return (
    <div
      className="border-hairline-faint relative cursor-ew-resize touch-none select-none border-b"
      style={{ height: RULER_H }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        onScrub(toTime(xFrom(e)));
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1 && e.currentTarget.hasPointerCapture(e.pointerId)) onScrub(toTime(xFrom(e)));
      }}
      onPointerUp={() => onScrubEnd?.()}
      aria-hidden
    >
      {ticks.map((t) => {
        const x = toX(t);
        return (
          <span key={t} className="absolute bottom-0" style={{ left: x }}>
            <span className="bg-hairline absolute bottom-0 left-0 h-1.5 w-px" />
            <span className="text-meta absolute bottom-2 left-1 whitespace-nowrap font-mono text-[10px] tabular-nums leading-none tracking-normal">
              {formatTick(t)}
            </span>
          </span>
        );
      })}
    </div>
  );
});

/** The playhead: a 1px periwinkle rule through ruler and track, with a north mark on the ruler. */
export function Playhead({ x }: { x: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-20 w-px"
      style={{ transform: `translateX(${x}px)` }}
      aria-hidden
    >
      <div className="bg-indigo absolute inset-y-0 left-0 w-px" />
      <svg viewBox="0 0 9 6" className="text-indigo absolute -left-[4px] top-0 h-1.5 w-[9px]">
        <path d="M0 0h9L4.5 6z" fill="currentColor" />
      </svg>
    </div>
  );
}

type KeyHandlers = {
  togglePlay: () => void;
  step: (dir: -1 | 1) => void;
  remove?: () => void;
  undo?: () => void;
  redo?: () => void;
  extra?: (e: KeyboardEvent) => boolean;
};

/**
 * The timeline's keys, on the window. Handlers are read through a ref, so
 * the listener is attached once and never sees stale props.
 */
export function useTimelineKeys(enabled: boolean, handlers: KeyHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      const h = ref.current;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z") {
        e.preventDefault();
        (e.shiftKey ? h.redo : h.undo)?.();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        h.redo?.();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === " ") {
        // A focused button already answers space; don't press play as well.
        if (tag === "BUTTON" || tag === "A") return;
        e.preventDefault();
        h.togglePlay();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (el?.getAttribute("role") === "slider" || tag === "BUTTON") return;
        e.preventDefault();
        h.step(e.key === "ArrowLeft" ? -1 : 1);
      } else if ((e.key === "Delete" || e.key === "Backspace") && h.remove) {
        e.preventDefault();
        h.remove();
      } else if (h.extra?.(e)) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** Tracks a scroller's scrollLeft and width, throttled to one update per frame. */
export function useViewport(ref: React.RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      setView((v) =>
        v.left === el.scrollLeft && v.width === el.clientWidth ? v : { left: el.scrollLeft, width: el.clientWidth },
      );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    el.addEventListener("scroll", schedule, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, setView]);

  return view;
}
