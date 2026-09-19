/* ───────────────────────────────────────────────────────────────────────────
   Video → GIF tab: which moments of the trimmed clip become frames, at what
   size, how long each is shown, and whether the page can hold them. Pure
   arithmetic, no Mediabunny or DOM, so it lives under `bun test`; the
   decoding is in `sendToGif.ts`.

   The current edit carries over: trim, rotate, crop and speed. The export's
   output height and frame rate don't — a GIF has its own, chosen here.
   ─────────────────────────────────────────────────────────────────────────── */

import { MIN_DELAY, DELAY_STEP } from "@/components/timeline/model";
import { bytes } from "@/lib/format";
import { MAX_EDGE } from "../gif/model";
import { clampSpeed, framedSize, outputDuration, type VideoEdit } from "./settings";

/** Frame rates worth offering. 30 is the fastest that stays above browsers' 20 ms floor with room to spare. */
export const GIF_RATES = [30, 25, 20, 15, 12, 10] as const;
/** Widths worth offering; the clip's own framed width is always offered too. */
export const GIF_WIDTHS = [1080, 800, 640, 480, 320, 240] as const;

export type GifSend = {
  fps: number;
  /** Frame width in pixels; null keeps the framed width. Never scales up. */
  width: number | null;
};

export const defaultGifSend = (): GifSend => ({ fps: 15, width: 480 });

/** The most frames one send makes; past this the GIF tab's timeline is unreadable anyway. */
export const MAX_SEND_FRAMES = 1000;
/** Decoded RGBA the frames may take, the same ceiling the spin generator keeps. */
export const MAX_SEND_BYTES = 1024 ** 3;

type Framing = Pick<VideoEdit, "rotate" | "crop">;
type Dimensions = { width: number; height: number };

/** Frame size: the framed picture (after rotate and crop) at `width`, never larger, within the GIF tab's edge. */
export function gifSize(edit: Framing, source: Dimensions, width: number | null): Dimensions {
  const f = framedSize(edit, source);
  if (f.width <= 0 || f.height <= 0) return { width: 1, height: 1 };
  let w = Math.min(width ?? f.width, f.width);
  // A tall crop at full width could pass the GIF tab's longest edge.
  w = Math.min(w, (MAX_EDGE * f.width) / Math.max(f.width, f.height));
  const scale = w / f.width;
  return { width: Math.max(1, Math.round(f.width * scale)), height: Math.max(1, Math.round(f.height * scale)) };
}

/** Preset widths below the framed width; the tab offers the framed width itself beside them. */
export function gifWidthChoices(framedWidth: number): number[] {
  return [...GIF_WIDTHS.filter((w) => w < framedWidth)];
}

/** Frames the send makes: one per `1/fps` of output (after the speed change), never none. */
export function gifFrameCount(edit: Pick<VideoEdit, "trim" | "speed">, fps: number): number {
  const seconds = outputDuration(edit) / 1000;
  if (!(fps > 0) || !(seconds > 0)) return 1;
  // A hair under a whole frame counts as a whole one, but floating-point dust doesn't add a frame.
  return Math.max(1, Math.ceil(seconds * fps - 1e-6));
}

/**
 * Where each frame is sampled, in the timeline's milliseconds (trim.in is
 * the first). Output frame `i` is at `i / fps` seconds; with a speed change
 * the source moves `speed`× as far in that time.
 */
export function gifSampleTimes(edit: Pick<VideoEdit, "trim" | "speed">, fps: number): number[] {
  const n = gifFrameCount(edit, fps);
  const speed = clampSpeed(edit.speed);
  const last = Math.max(edit.trim.in, edit.trim.out - 1);
  return Array.from({ length: n }, (_, i) => Math.min(last, edit.trim.in + ((i * 1000) / fps) * speed));
}

/**
 * How long each frame shows, ms. GIF counts in centiseconds, so each delay
 * is a whole 10 ms — rounded against a running total, so 15 fps comes out
 * 70 60 70 … and the animation lasts as long as the clip, not a drifting
 * 60 × n. The last frame ends at the clip's end. None goes under the
 * 20 ms browsers honour.
 */
export function gifDelays(count: number, fps: number, totalMs: number): number[] {
  if (count <= 0) return [];
  const snap = (ms: number) => Math.round(ms / DELAY_STEP) * DELAY_STEP;
  const edges = Array.from({ length: count + 1 }, (_, i) =>
    snap(i === count ? Math.max(totalMs, ((count - 1) * 1000) / fps) : (i * 1000) / fps),
  );
  return edges.slice(1).map((end, i) => Math.max(MIN_DELAY, end - edges[i]!));
}

/**
 * A frame the hook dropped gives its time to the one before it, so the
 * animation keeps the clip's timing. Drops at the start go to the first
 * frame kept.
 */
export function foldDropped<T extends { delay: number }>(
  frames: readonly (T | null)[],
  delays: readonly number[],
): T[] {
  const kept: T[] = [];
  let carry = 0;
  frames.forEach((f, i) => {
    const d = delays[i] ?? 0;
    if (f === null) {
      const prev = kept[kept.length - 1];
      if (prev) prev.delay += d;
      else carry += d;
      return;
    }
    f.delay = d + carry;
    carry = 0;
    kept.push(f);
  });
  return kept;
}

/** Decoded RGBA the frames take in memory. */
export function sendBytes(size: Dimensions, count: number): number {
  return size.width * size.height * 4 * count;
}

/** Why the send can't go ahead, as a sentence the tab shows as-is; null when it can. */
export function sendProblem(size: Dimensions, count: number): string | null {
  if (count > MAX_SEND_FRAMES) {
    return `That's ${count} frames; the GIF tab takes up to ${MAX_SEND_FRAMES} at once. Trim the clip or lower the frame rate.`;
  }
  const need = sendBytes(size, count);
  if (need > MAX_SEND_BYTES) {
    return `${count} frames at ${size.width}×${size.height} would need ${bytes(need)} of memory, more than the page can hold. Trim the clip, or lower the frame rate or the width.`;
  }
  return null;
}

/** `clip 07`: the file's name and the frame's place in the clip, for the GIF tab's reader. */
export function gifFrameName(sourceName: string, index: number, count: number): string {
  const dot = sourceName.lastIndexOf(".");
  const stem = (dot > 0 ? sourceName.slice(0, dot) : sourceName).trim() || "video";
  return `${stem} ${String(index + 1).padStart(String(count).length, "0")}`;
}
