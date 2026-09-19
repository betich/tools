/* ───────────────────────────────────────────────────────────────────────────
   The GIF document: what the animation is, independent of where its frames
   came from (a folder, the spin generator, the video tab) and of which
   encoder writes it out (gifski, animated WebP, APNG).

   Pure data and arithmetic — no DOM, no pixels — so it lives under
   `bun test` and in undo history as it is. Pixels are kept beside it, in a
   `FrameStore`, keyed by frame id.
   ─────────────────────────────────────────────────────────────────────────── */

import { frameAt, frameStarts, totalDuration, type TimelineFrame } from "@/components/timeline/model";

/** One frame. `id` names its pixels in the store and changes whenever they do. */
export type GifFrame = TimelineFrame & {
  /** Where it came from, for the reader — a filename, `spin 12°`. */
  name: string;
  /** Natural size of its pixels. */
  width: number;
  height: number;
};

export type Size = { width: number; height: number };

/** How a frame that isn't the canvas's shape sits on it. */
export type Fit = "contain" | "cover";

export type GifDoc = {
  /** In play order, before ping-pong. */
  frames: readonly GifFrame[];
  /** Times the animation plays through: 0 is forever. See `repeatCount` for what each format stores. */
  plays: number;
  /** Play forward, then back again (without repeating either end). */
  pingPong: boolean;
  /** The canvas, or null to follow the first frame's size. */
  size: Size | null;
  fit: Fit;
  /** `#rrggbb` behind every frame, or null for transparent. */
  background: string | null;
};

export const DEFAULT_DELAY = 100;
/** Longest canvas edge. Far past any sensible GIF, and it keeps a frame's pixels in the hundreds of MB, not GB. */
export const MAX_EDGE = 4096;
export const MAX_PLAYS = 999;

export const emptyDoc = (): GifDoc => ({
  frames: [],
  plays: 0,
  pingPong: false,
  size: null,
  fit: "contain",
  background: null,
});

/* ── Order ──────────────────────────────────────────────────────────────── */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Filename order the way a person reads it: `frame-2` before `frame-10`,
 * case and accents aside. Exact ties fall back to code-point order so the
 * sort is stable across browsers.
 */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

export function sortNaturally<T>(items: readonly T[], name: (item: T) => string): T[] {
  return [...items].sort((a, b) => naturalCompare(name(a), name(b)));
}

/**
 * The frames actually shown, as indices into `frames`: straight through, or
 * with ping-pong there and back — 0 1 2 3 2 1 — so the loop joins without
 * showing either end twice.
 */
export function playOrder(count: number, pingPong: boolean): number[] {
  const forward = Array.from({ length: count }, (_, i) => i);
  if (!pingPong || count < 3) return forward;
  for (let i = count - 2; i >= 1; i--) forward.push(i);
  return forward;
}

/** Every frame shown, in order, with its delay: what an encoder writes. */
export function playList(doc: Pick<GifDoc, "frames" | "pingPong">): GifFrame[] {
  return playOrder(doc.frames.length, doc.pingPong).map((i) => doc.frames[i]!);
}

export function playDuration(doc: Pick<GifDoc, "frames" | "pingPong">): number {
  return totalDuration(playList(doc));
}

/**
 * A moment of the played animation (ping-pong included) as a moment of the
 * timeline, which only shows the frames once: same frame, same distance
 * into it. On the way back the playhead runs back over the strip.
 */
export function timelineTime(frames: readonly TimelineFrame[], order: readonly number[], time: number): number {
  if (frames.length === 0 || order.length === 0) return 0;
  const played = order.map((i) => frames[i]!);
  const starts = frameStarts(played);
  const k = frameAt(starts, time);
  const offset = Math.max(0, Math.min(played[k]!.delay, time - starts[k]!));
  return frameStarts(frames)[order[k]!]! + offset;
}

/* ── Size ───────────────────────────────────────────────────────────────── */

export function clampEdge(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_EDGE, Math.max(1, Math.round(n)));
}

/** The canvas: the chosen size, or the first frame's, shrunk to fit `MAX_EDGE` keeping its shape. */
export function canvasSize(doc: Pick<GifDoc, "frames" | "size">): Size {
  if (doc.size) return { width: clampEdge(doc.size.width), height: clampEdge(doc.size.height) };
  const first = doc.frames[0];
  if (!first) return { width: 0, height: 0 };
  const scale = Math.min(1, MAX_EDGE / Math.max(first.width, first.height));
  return { width: clampEdge(first.width * scale), height: clampEdge(first.height * scale) };
}

/**
 * A new canvas size after one edge is typed. With the shape locked the
 * other edge follows `aspect` (width / height), and if that pushes it past
 * `MAX_EDGE` both shrink together.
 */
export function resize(current: Size, edge: "width" | "height", value: number, lockAspect: boolean, aspect: number): Size {
  const v = clampEdge(value);
  if (!lockAspect || !(aspect > 0)) return { ...current, [edge]: v };
  let width = edge === "width" ? v : v * aspect;
  let height = edge === "height" ? v : v / aspect;
  const over = Math.max(width, height) / MAX_EDGE;
  if (over > 1) {
    width /= over;
    height /= over;
  }
  return { width: clampEdge(width), height: clampEdge(height) };
}

export type Rect = { x: number; y: number; width: number; height: number };

/** Where a `source`-sized frame lands on a `canvas`-sized canvas, centred. Cover may spill past the edges. */
export function fitRect(source: Size, canvas: Size, fit: Fit): Rect {
  if (source.width <= 0 || source.height <= 0) return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const sx = canvas.width / source.width;
  const sy = canvas.height / source.height;
  const scale = fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
  const width = source.width * scale;
  const height = source.height * scale;
  return { x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width, height };
}

/* ── Loops ──────────────────────────────────────────────────────────────── */

export function clampPlays(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_PLAYS, Math.max(0, Math.round(n)));
}

/**
 * `plays` as the extra repeats GIF's NETSCAPE block counts: 0 forever,
 * otherwise plays − 1 — and null when it plays once, which means writing no
 * loop block at all. (APNG's `num_plays` and WebP's loop count take `plays`
 * as it is.)
 */
export function repeatCount(plays: number): number | null {
  if (plays === 0) return 0;
  return plays === 1 ? null : plays - 1;
}

/* ── Edits ──────────────────────────────────────────────────────────────── */

/**
 * The doc with frames added: in place of the ones there (a new folder), or
 * after them (more frames from another source). A doc that follows the
 * first frame's size keeps following it; replacing drops a typed size.
 */
export function withFrames(doc: GifDoc, frames: readonly GifFrame[], how: "replace" | "append"): GifDoc {
  if (how === "replace") return { ...doc, frames: [...frames], size: null };
  return { ...doc, frames: [...doc.frames, ...frames] };
}
