/* ───────────────────────────────────────────────────────────────────────────
   Timeline arithmetic, with no React and no DOM, so it can be tested with
   `bun test` and shared by both modes.

   Times are milliseconds throughout. Pixels only appear in the layout
   functions, which turn a list of frame delays into tile positions.
   ─────────────────────────────────────────────────────────────────────────── */

/** One frame in frames mode. `id` must change when the frame's picture does — thumbnails are cached by it. */
export type TimelineFrame = { id: string; delay: number };

/** The kept part of a clip, in milliseconds from its start. */
export type Trim = { in: number; out: number };

/**
 * GIF delays are stored in hundredths of a second, and browsers treat
 * anything under 20ms as "as fast as I like" (usually 100ms). So a delay
 * snaps to 10ms and never goes under 20.
 */
export const DELAY_STEP = 10;
export const MIN_DELAY = 20;
export const MAX_DELAY = 60_000;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function snapDelay(ms: number): number {
  if (!Number.isFinite(ms)) return MIN_DELAY;
  return clamp(Math.round(ms / DELAY_STEP) * DELAY_STEP, MIN_DELAY, MAX_DELAY);
}

/** Start time of every frame, plus the total as the last entry (length n + 1). */
export function frameStarts(frames: readonly { delay: number }[]): number[] {
  const out = new Array<number>(frames.length + 1);
  let t = 0;
  for (let i = 0; i < frames.length; i++) {
    out[i] = t;
    t += frames[i]!.delay;
  }
  out[frames.length] = t;
  return out;
}

export function totalDuration(frames: readonly { delay: number }[]): number {
  let t = 0;
  for (const f of frames) t += f.delay;
  return t;
}

/** Largest index i with sorted[i] <= v, clamped to [0, sorted.length - 1]. */
export function lastAtOrBefore(sorted: readonly number[], v: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sorted[mid]! <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The frame showing at `time`. Past the end it is the last frame. */
export function frameAt(starts: readonly number[], time: number): number {
  const n = starts.length - 1;
  if (n <= 0) return 0;
  return Math.min(n - 1, lastAtOrBefore(starts, time));
}

/* ── Layout ─────────────────────────────────────────────────────────────── */

/**
 * Tile geometry for frames mode. A tile is as wide as its delay at the
 * current zoom, but never narrower than `minWidth`, so a 20ms frame stays
 * grabbable. Because of that floor, x is not simply time × zoom — use
 * `timeToX`/`xToTime`, which walk the tiles.
 */
export type FrameLayout = { starts: number[]; x: number[]; w: number[]; width: number };

export function layoutFrames(
  frames: readonly { delay: number }[],
  pxPerMs: number,
  minWidth: number,
  gap = 0,
): FrameLayout {
  const starts = frameStarts(frames);
  const x = new Array<number>(frames.length + 1);
  const w = new Array<number>(frames.length);
  let cursor = 0;
  for (let i = 0; i < frames.length; i++) {
    x[i] = cursor;
    w[i] = Math.max(minWidth, frames[i]!.delay * pxPerMs);
    cursor += w[i]! + gap;
  }
  x[frames.length] = cursor;
  return { starts, x, w, width: Math.max(0, cursor - gap) };
}

export function timeToX(layout: FrameLayout, time: number): number {
  const n = layout.w.length;
  if (n === 0) return 0;
  const i = frameAt(layout.starts, time);
  const d = layout.starts[i + 1]! - layout.starts[i]!;
  const f = d > 0 ? clamp((time - layout.starts[i]!) / d, 0, 1) : 0;
  return layout.x[i]! + f * layout.w[i]!;
}

export function xToTime(layout: FrameLayout, x: number): number {
  const n = layout.w.length;
  if (n === 0) return 0;
  const i = Math.min(n - 1, lastAtOrBefore(layout.x, x));
  const f = clamp((x - layout.x[i]!) / layout.w[i]!, 0, 1);
  return layout.starts[i]! + f * (layout.starts[i + 1]! - layout.starts[i]!);
}

/** Indices of tiles overlapping [left, right], widened by `overscan` tiles each side. */
export function visibleRange(layout: FrameLayout, left: number, right: number, overscan = 4): [number, number] {
  const n = layout.w.length;
  if (n === 0) return [0, -1];
  const first = lastAtOrBefore(layout.x, left);
  const last = Math.min(n - 1, lastAtOrBefore(layout.x, right));
  return [Math.max(0, first - overscan), Math.min(n - 1, last + overscan)];
}

/** The gap (0…n) a dragged tile would drop into when the pointer is at `x`: before the first tile whose middle is right of it. */
export function gapAt(layout: FrameLayout, x: number): number {
  const n = layout.w.length;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (layout.x[mid]! + layout.w[mid]! / 2 < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/* ── Frame edits ────────────────────────────────────────────────────────── */

/**
 * Move every frame in `ids` so the block lands in gap `to` (a gap index in
 * the original list, 0…n). The moved frames keep their relative order.
 * Returns the same array when nothing would change.
 */
export function moveFrames<F extends { id: string }>(
  frames: readonly F[],
  ids: ReadonlySet<string>,
  to: number,
): readonly F[] {
  const moving: F[] = [];
  const staying: F[] = [];
  let insert = 0;
  frames.forEach((f, i) => {
    if (ids.has(f.id)) moving.push(f);
    else {
      if (i < to) insert++;
      staying.push(f);
    }
  });
  if (moving.length === 0) return frames;
  const next = [...staying.slice(0, insert), ...moving, ...staying.slice(insert)];
  return next.every((f, i) => f === frames[i]) ? frames : next;
}

export function removeFrames<F extends { id: string }>(frames: readonly F[], ids: ReadonlySet<string>): readonly F[] {
  if (ids.size === 0) return frames;
  const next = frames.filter((f) => !ids.has(f.id));
  return next.length === frames.length ? frames : next;
}

/** Give every frame in `ids` the same delay. Untouched frames keep their identity. */
export function setDelays<F extends { id: string; delay: number }>(
  frames: readonly F[],
  ids: ReadonlySet<string>,
  delay: number,
): readonly F[] {
  let changed = false;
  const next = frames.map((f) => {
    if (!ids.has(f.id) || f.delay === delay) return f;
    changed = true;
    return { ...f, delay };
  });
  return changed ? next : frames;
}

/**
 * The selection after a click on frame `index`: plain replaces, `toggle`
 * (cmd/ctrl) adds or removes one, `range` (shift) takes everything from the
 * anchor to here.
 */
export function selectFrames(
  frames: readonly { id: string }[],
  current: ReadonlySet<string>,
  anchor: number | null,
  index: number,
  how: "replace" | "toggle" | "range",
): Set<string> {
  const id = frames[index]?.id;
  if (id === undefined) return new Set(current);
  if (how === "toggle") {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }
  if (how === "range" && anchor !== null) {
    const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
    return new Set(frames.slice(a, b + 1).map((f) => f.id));
  }
  return new Set([id]);
}

/** The one delay every selected frame shares, or null when they differ (or nothing is selected). */
export function sharedDelay(frames: readonly TimelineFrame[], ids: ReadonlySet<string>): number | null {
  let d: number | null = null;
  for (const f of frames) {
    if (!ids.has(f.id)) continue;
    if (d === null) d = f.delay;
    else if (d !== f.delay) return null;
  }
  return d;
}

/* ── Clip ───────────────────────────────────────────────────────────────── */

/**
 * Move one edge of a trim, keeping at least `minLength` between in and out
 * and both inside the clip.
 */
export function moveTrimEdge(trim: Trim, edge: "in" | "out", to: number, duration: number, minLength: number): Trim {
  const min = Math.min(minLength, duration);
  if (edge === "in") return { in: clamp(to, 0, trim.out - min), out: trim.out };
  return { in: trim.in, out: clamp(to, trim.in + min, duration) };
}

/* ── Playback ───────────────────────────────────────────────────────────── */

/**
 * Advance the playhead by `dt` inside [start, end). Looping wraps; not
 * looping stops at the end and reports it.
 */
export function advance(
  time: number,
  dt: number,
  start: number,
  end: number,
  loop: boolean,
): { time: number; ended: boolean } {
  const len = end - start;
  if (len <= 0) return { time: start, ended: true };
  const t = time + dt;
  if (t < end) return { time: Math.max(start, t), ended: false };
  if (!loop) return { time: end, ended: true };
  return { time: start + ((t - start) % len), ended: false };
}

/* ── Ruler & readouts ───────────────────────────────────────────────────── */

const TICK_STEPS = [
  10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
];

/** The smallest tidy tick interval that leaves at least `minPx` between labels. */
export function tickStep(pxPerMs: number, minPx = 64): number {
  for (const s of TICK_STEPS) if (s * pxPerMs >= minPx) return s;
  return TICK_STEPS[TICK_STEPS.length - 1]!;
}

/** `00:01.24` — minutes, seconds, hundredths. Hours appear only when needed. */
export function formatTime(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  const c = cs % 100;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h > 0 ? `${h}:` : ""}${p(m)}:${p(s)}.${p(c)}`;
}

/** A tick label: `0.5s`, `2s`, `1:30`. */
export function formatTick(ms: number): string {
  if (ms >= 60_000) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  const s = ms / 1000;
  return `${Number.isInteger(s) ? s : s.toFixed(ms % 100 === 0 ? 1 : 2)}s`;
}
