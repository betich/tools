import UPNG from "upng-js";
import { makeNearest, remap, type Palette } from "./palette";
import { setApngPlays } from "./loop";
import type { Encoder } from "./types";

/** UPNG.js 2.1's real quantiser (its published types describe an older one). */
type Quantize = (bufs: ArrayBuffer[], ps: number) => { plte: { est: { rgba: number } }[] };

/** The quantiser sees at most this many pixels, sampled a whole frame at a time across the animation. */
const SAMPLE_PIXELS = 1 << 22;

/**
 * A palette for the whole animation — one palette, so a still area never
 * changes colour between frames — from UPNG's quantiser. Entry 0 is always
 * transparent black: UPNG reserves it, and a see-through pixel maps to it.
 */
export function buildPalette(frames: readonly Uint8Array[], colours: number): Palette {
  const perFrame = (frames[0]?.length ?? 0) >> 2;
  const step = Math.max(1, Math.ceil((frames.length * perFrame) / SAMPLE_PIXELS));
  const sample: ArrayBuffer[] = [];
  for (let i = 0; i < frames.length; i += step) sample.push(frames[i]!.slice().buffer);
  const { plte } = (UPNG.quantize as unknown as Quantize)(sample, Math.max(1, colours - 1));
  const seen = new Set<number>([0]);
  const out: number[] = [0, 0, 0, 0];
  for (const leaf of plte) {
    const c = leaf.est.rgba >>> 0;
    if (seen.has(c) || out.length >= colours * 4) continue;
    seen.add(c);
    out.push(c & 0xff, (c >>> 8) & 0xff, (c >>> 16) & 0xff, c >>> 24);
  }
  return Uint8Array.from(out);
}

/**
 * APNG through UPNG.js (MIT): full alpha, delays in milliseconds. With a
 * palette the frames are mapped (and dithered) here, then written as-is —
 * UPNG sees 256 colours or fewer and stores them indexed, transparency
 * included. UPNG always writes "loop forever"; the count is patched after.
 */
export const apng: Encoder = async (anim, options) => {
  const { width, height, frames } = anim;
  if (options.colours > 0) {
    const palette = buildPalette(frames, options.colours);
    const nearest = makeNearest(palette);
    for (const f of frames) remap(f, width, height, palette, options.dither, nearest);
  }
  const png = UPNG.encode(
    frames.map(
      (f) => (f.byteOffset === 0 && f.byteLength === f.buffer.byteLength ? f.buffer : f.slice().buffer) as ArrayBuffer,
    ),
    width,
    height,
    0,
    anim.delays.map((d) => Math.min(0xffff, Math.max(1, Math.round(d)))),
  );
  return setApngPlays(new Uint8Array(png), anim.plays);
};
