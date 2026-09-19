import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NumberInput, Slider, TextButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { pad } from "@/lib/format";
import {
  clamp,
  frameAt,
  gapAt,
  layoutFrames,
  moveFrames,
  removeFrames,
  selectFrames,
  setDelays,
  sharedDelay,
  snapDelay,
  timeToX,
  visibleRange,
  xToTime,
  type TimelineFrame,
} from "./model";
import {
  Playhead,
  Ruler,
  RULER_H,
  Transport,
  useTimelineKeys,
  useViewport,
  type ChangeKind,
  type TimelineCommon,
} from "./parts";
import { Thumb, ThumbCache, type ThumbnailProvider } from "./Thumb";

export type FramesTimelineProps<F extends TimelineFrame> = TimelineCommon & {
  mode: "frames";
  /** The frames in play order. Extra fields on `F` ride along untouched. */
  frames: readonly F[];
  /**
   * Every edit. `"preview"` is a drag in progress (the snapshot was taken at
   * `onGestureStart`); `"commit"` is a discrete edit that is its own undo step
   * — delete, a typed delay. `useHistory`'s `change` takes both as they are.
   */
  onFramesChange: (frames: readonly F[], kind: ChangeKind) => void;
  /** Told whenever the selection changes, in play order. */
  onSelectionChange?: (ids: string[]) => void;
  /** Thumbnail aspect, width / height. */
  aspect?: number;
};

const THUMB_H = 48;
const CAPTION_H = 18;
const TILE_H = THUMB_H + CAPTION_H;
const MIN_TILE = 28;
const GAP = 2;
const EDGE = 6;
const DRAG_SLOP = 4;
const ZOOM = { min: 0.05, max: 2, step: 0.01 };

type Drag =
  | { kind: "press"; pointerId: number; startX: number; index: number; mods: "replace" | "toggle" | "range" }
  | { kind: "reorder"; pointerId: number; ids: Set<string>; gap: number }
  | { kind: "edge"; pointerId: number; startX: number; startDelay: number; ids: Set<string> };

/**
 * Frames mode: a strip of thumbnails, each as wide as its delay. Drag a tile
 * to reorder (the selection moves as a block), drag its right edge to change
 * its delay (every selected frame, if it is selected), click / shift-click /
 * cmd-click to select. Only the tiles on screen are rendered, so 200 frames
 * cost what 30 do.
 */
export function FramesTimeline<F extends TimelineFrame>(props: FramesTimelineProps<F>) {
  const {
    frames,
    onFramesChange,
    onSelectionChange,
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
    label = "frames",
    aspect = 16 / 9,
    className,
  } = props;

  const [pxPerMs, setPxPerMs] = useState(0.5);
  const [selected, setSelectedState] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<number | null>(null);
  // The drag lives in a ref for the handlers (two pointer moves can arrive
  // before a render) and in state for drawing.
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  const scroller = useRef<HTMLDivElement>(null);
  const view = useViewport(scroller);
  const layout = useMemo(() => layoutFrames(frames, pxPerMs, MIN_TILE, GAP), [frames, pxPerMs]);
  const total = layout.starts[frames.length] ?? 0;
  const current = frameAt(layout.starts, time);

  // A fresh provider means fresh pictures.
  const cache = useMemo(() => new ThumbCache(), [thumbnails]);

  // Latest props for pointer handlers that outlive a render.
  const live = useRef({ frames, layout, selected, pxPerMs });
  live.current = { frames, layout, selected, pxPerMs };

  const setSelected = useCallback(
    (next: ReadonlySet<string>) => {
      setSelectedState(next);
      onSelectionChange?.(live.current.frames.filter((f) => next.has(f.id)).map((f) => f.id));
    },
    [onSelectionChange],
  );

  /* ── pointer: one set of handlers on the track, tiles are dumb ─────── */

  const contentX = (clientX: number) =>
    clientX - (scroller.current?.getBoundingClientRect().left ?? 0) + (scroller.current?.scrollLeft ?? 0);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const tile = target.closest<HTMLElement>("[data-index]");
    if (!tile) {
      setSelected(new Set());
      anchor.current = null;
      return;
    }
    const index = Number(tile.dataset.index);
    const frame = frames[index];
    if (!frame) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (target.closest("[data-edge]")) {
      const ids = selected.has(frame.id) && selected.size > 1 ? new Set(selected) : new Set([frame.id]);
      onGestureStart();
      setDrag({ kind: "edge", pointerId: e.pointerId, startX: e.clientX, startDelay: frame.delay, ids });
      return;
    }
    const mods = e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "replace";
    setDrag({ kind: "press", pointerId: e.pointerId, startX: e.clientX, index, mods });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const { frames: fs, layout: l, selected: sel, pxPerMs: z } = live.current;

    if (drag.kind === "edge") {
      const delay = snapDelay(drag.startDelay + (e.clientX - drag.startX) / z);
      const next = setDelays(fs, drag.ids, delay);
      if (next !== fs) onFramesChange(next, "preview");
      return;
    }

    autoScroll(scroller.current, e.clientX);
    const x = contentX(e.clientX);
    if (drag.kind === "press") {
      if (Math.abs(e.clientX - drag.startX) < DRAG_SLOP) return;
      const id = fs[drag.index]?.id;
      if (id === undefined) return;
      const ids = sel.has(id) ? new Set(sel) : new Set([id]);
      if (!sel.has(id)) setSelected(ids);
      onGestureStart();
      setDrag({ kind: "reorder", pointerId: drag.pointerId, ids, gap: gapAt(l, x) });
      return;
    }
    const gap = gapAt(l, x);
    if (gap !== drag.gap) setDrag({ ...drag, gap });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setDrag(null);
    if (drag.kind === "reorder") {
      const next = moveFrames(frames, drag.ids, drag.gap);
      if (next !== frames) onFramesChange(next, "preview");
    } else if (drag.kind === "press") {
      const next = selectFrames(frames, selected, anchor.current, drag.index, drag.mods);
      if (drag.mods !== "range") anchor.current = drag.index;
      setSelected(next);
      if (drag.mods === "replace") onTimeChange(layout.starts[drag.index] ?? 0);
    }
  };

  /* ── keys ───────────────────────────────────────────────────────────── */

  const removeSelected = () => {
    const next = removeFrames(frames, selected);
    if (next === frames) return;
    onFramesChange(next, "commit");
    setSelected(new Set());
    anchor.current = null;
  };

  useTimelineKeys(hotkeys, {
    togglePlay: () => onPlayingChange(!playing),
    step: (dir) => {
      if (frames.length === 0) return;
      const start = layout.starts[current] ?? 0;
      const i = dir < 0 && time > start + 0.5 ? current : clamp(current + dir, 0, frames.length - 1);
      onPlayingChange(false);
      onTimeChange(layout.starts[i] ?? 0);
    },
    remove: removeSelected,
    undo: onUndo,
    redo: onRedo,
    extra: (e) => {
      if (e.key === "Escape" && selected.size > 0) {
        setSelected(new Set());
        return true;
      }
      return false;
    },
  });

  /* ── keep the playhead in view while playing ───────────────────────── */

  const headX = timeToX(layout, time);
  useEffect(() => {
    const el = scroller.current;
    if (!playing || !el) return;
    if (headX < el.scrollLeft || headX > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, headX - 24);
  }, [playing, headX]);

  /* ── render ─────────────────────────────────────────────────────────── */

  const [first, last] = visibleRange(layout, view.left, view.left + (view.width || 1200));
  const tiles = [];
  for (let i = first; i <= last; i++) {
    const f = frames[i];
    if (!f) continue;
    tiles.push(
      <Tile
        key={f.id}
        frame={f}
        index={i}
        count={frames.length}
        x={layout.x[i]!}
        w={layout.w[i]!}
        selected={selected.has(f.id)}
        moving={drag?.kind === "reorder" && drag.ids.has(f.id)}
        current={i === current}
        provider={thumbnails}
        cache={cache}
        aspect={aspect}
      />,
    );
  }

  const dropX =
    drag?.kind === "reorder"
      ? drag.gap >= frames.length
        ? layout.width + GAP / 2
        : layout.x[drag.gap]! - GAP / 2
      : null;
  const chosen = frames.filter((f) => selected.has(f.id)).length;
  const digits = Math.max(2, String(frames.length).length);
  const shared = sharedDelay(frames, selected);

  return (
    <div role="group" aria-label={label} className={cn("min-w-0", className)}>
      <Transport
        time={time}
        total={total}
        playing={playing}
        onPlayingChange={onPlayingChange}
        loop={loop}
        onLoopChange={onLoopChange}
      >
        <span className="text-meta text-meta font-mono uppercase tabular-nums">
          frame <span className="text-ink tracking-normal">{frames.length ? pad(current + 1, digits) : "--"}</span> /{" "}
          <span className="tracking-normal">{pad(frames.length, digits)}</span>
        </span>
        {chosen > 0 ? (
          <DelayField
            // Re-seed the draft when the selection or its delay changes underneath it.
            key={`${[...selected].join()}:${shared}`}
            count={chosen}
            value={shared}
            onCommit={(ms) => {
              const next = setDelays(frames, selected, snapDelay(ms));
              if (next !== frames) onFramesChange(next, "commit");
            }}
          />
        ) : null}
        <label className="flex items-center gap-2.5">
          <span className="text-meta text-meta font-mono uppercase">zoom</span>
          <Slider
            className="w-24"
            value={pxPerMs}
            min={ZOOM.min}
            max={ZOOM.max}
            step={ZOOM.step}
            onChange={setPxPerMs}
          />
          <span className="text-label text-meta w-14 font-mono tabular-nums tracking-normal">
            {Math.round(pxPerMs * 1000)} px/s
          </span>
        </label>
        <TextButton
          onClick={() => {
            const w = scroller.current?.clientWidth ?? 0;
            if (w > 0 && total > 0) setPxPerMs(clamp((w - frames.length * GAP) / total, ZOOM.min, ZOOM.max));
          }}
          disabled={total <= 0}
        >
          fit
        </TextButton>
      </Transport>

      <div ref={scroller} className="border-hairline-faint overflow-x-auto overscroll-x-contain border-y">
        <div className="relative" style={{ width: layout.width + 32, height: RULER_H + TILE_H + 12 }}>
          <Ruler
            pxPerMs={pxPerMs}
            left={view.left}
            right={view.left + (view.width || 1200)}
            toX={(ms) => timeToX(layout, ms)}
            toTime={(x) => xToTime(layout, x)}
            onScrub={(ms) => {
              if (playing) onPlayingChange(false);
              onTimeChange(ms);
            }}
          />
          <div
            role="listbox"
            aria-multiselectable
            aria-label={`${label} · drag to reorder, drag an edge to change its delay`}
            className="relative mt-1.5 cursor-default touch-none select-none"
            style={{ height: TILE_H }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
          >
            {tiles}
            {dropX !== null ? (
              <div
                className="bg-indigo pointer-events-none absolute -inset-y-1 z-10 w-px"
                style={{ left: dropX }}
                aria-hidden
              />
            ) : null}
          </div>
          <Playhead x={headX} />
        </div>
      </div>
    </div>
  );
}

/** Near either edge of the scroller, a reorder drag scrolls it. */
function autoScroll(el: HTMLDivElement | null, clientX: number) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const zone = 40;
  if (clientX < r.left + zone) el.scrollLeft -= Math.ceil((r.left + zone - clientX) / 3);
  else if (clientX > r.right - zone) el.scrollLeft += Math.ceil((clientX - (r.right - zone)) / 3);
}

/**
 * One frame. The picture is never dimmed for selection — the frame carries
 * it: a periwinkle border and the index going to full ink. A tile being
 * dragged fades while it is in the air.
 */
const Tile = memo(function Tile({
  frame,
  index,
  count,
  x,
  w,
  selected,
  moving,
  current,
  provider,
  cache,
  aspect,
}: {
  frame: TimelineFrame;
  index: number;
  count: number;
  x: number;
  w: number;
  selected: boolean;
  moving: boolean;
  current: boolean;
  provider: ThumbnailProvider;
  cache: ThumbCache;
  aspect: number;
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={`frame ${index + 1} of ${count}, ${frame.delay} ms`}
      data-index={index}
      className={cn(
        "rounded-hairline group absolute top-0 flex flex-col overflow-hidden border transition-[border-color,opacity] duration-200",
        selected ? "border-indigo" : "border-hairline-faint hover:border-edge",
        moving && "opacity-40",
      )}
      style={{ transform: `translateX(${x}px)`, width: w, height: TILE_H }}
    >
      <div className="bg-surface relative w-full overflow-hidden" style={{ height: THUMB_H }}>
        <Thumb
          request={{ kind: "frame", id: frame.id, index }}
          cache={cache}
          provider={provider}
          width={Math.round(THUMB_H * aspect)}
          height={THUMB_H}
        />
      </div>
      <div
        className={cn(
          "flex items-center justify-between gap-1 overflow-hidden whitespace-nowrap px-1 font-mono text-[10px] tabular-nums leading-none",
          selected || current ? "text-ink" : "text-meta",
        )}
        style={{ height: CAPTION_H }}
      >
        <span className="tracking-[0.1em]">{pad(index + 1)}</span>
        {w >= 58 ? <span className="tracking-normal">{frame.delay}ms</span> : null}
      </div>
      <div data-edge className="absolute inset-y-0 right-0 z-10 cursor-ew-resize" style={{ width: EDGE }} aria-hidden>
        <div className="bg-indigo absolute inset-y-0 right-0 w-px opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
      </div>
    </div>
  );
});

/** The typed delay for the selection. Applies on enter or blur; typed values keep normal tracking. */
function DelayField({
  count,
  value,
  onCommit,
}: {
  count: number;
  value: number | null;
  onCommit: (ms: number) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const apply = () => {
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n)) onCommit(n);
  };
  return (
    <label className="flex items-center gap-2.5">
      <span className="text-meta text-meta font-mono uppercase">
        {count > 1 ? <span className="tabular-nums tracking-normal">{count} · </span> : null}delay
      </span>
      <NumberInput
        className="w-20 py-1"
        value={draft}
        placeholder={value === null ? "mixed" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(value === null ? "" : String(value));
        }}
        min={0}
        step={10}
        aria-label="delay in milliseconds"
      />
      <span className="text-meta text-meta font-mono uppercase">ms</span>
    </label>
  );
}
