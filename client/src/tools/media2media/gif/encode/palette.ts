/* ───────────────────────────────────────────────────────────────────────────
   Mapping frames onto a palette, with or without dithering. The palette
   itself comes from the encoder's quantiser; this decides which entry each
   pixel becomes. Pure: straight RGBA in, palette colours written in place.
   ─────────────────────────────────────────────────────────────────────────── */

import type { Dither } from "./types";

/** Straight RGBA, four bytes per entry. */
export type Palette = Uint8Array;

/**
 * Nearest palette entry for a colour, compared premultiplied (so every
 * see-through shade is near every other) and cached on a 5·5·5·4-bit grid.
 * The grid costs at most four levels per channel — below what dithering
 * adds — and makes a 60-frame animation a few thousand searches, not millions.
 */
export function makeNearest(palette: Palette): (r: number, g: number, b: number, a: number) => number {
  const n = palette.length >> 2;
  const pr = new Float32Array(n),
    pg = new Float32Array(n),
    pb = new Float32Array(n),
    pa = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = palette[k * 4 + 3]! / 255;
    pr[k] = palette[k * 4]! * a;
    pg[k] = palette[k * 4 + 1]! * a;
    pb[k] = palette[k * 4 + 2]! * a;
    pa[k] = palette[k * 4 + 3]!;
  }
  const cache = new Int16Array(1 << 19).fill(-1);
  return (r, g, b, a) => {
    const key = ((r >> 3) << 14) | ((g >> 3) << 9) | ((b >> 3) << 4) | (a >> 4);
    const hit = cache[key]!;
    if (hit >= 0) return hit;
    // Search from the centre of the grid cell, so the cache answers the same for every colour in it.
    const cr = (r & ~7) + 4,
      cg = (g & ~7) + 4,
      cb = (b & ~7) + 4,
      ca = a < 16 ? 0 : a >= 240 ? 255 : (a & ~15) + 8;
    const af = ca / 255;
    const qr = cr * af,
      qg = cg * af,
      qb = cb * af;
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < n; k++) {
      const dr = pr[k]! - qr,
        dg = pg[k]! - qg,
        db = pb[k]! - qb,
        da = pa[k]! - ca;
      const d = dr * dr + dg * dg + db * db + da * da;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    cache[key] = best;
    return best;
  };
}

/** 8×8 Bayer matrix, thresholds 0–63. */
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54,
  22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29,
  53, 21,
];

/** How far ordered dithering pushes a channel: wider for a smaller palette, whose colours sit further apart. */
export const orderedSpread = (colours: number) => 128 / Math.cbrt(Math.max(2, colours));

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Rewrites a frame in place with palette colours only. Ordered dithering is
 * a fixed pattern, so a still area stays still from frame to frame;
 * error diffusion (Floyd–Steinberg, serpentine) looks smoother but its
 * pattern can shimmer where something moves nearby.
 */
export function remap(
  rgba: Uint8Array,
  width: number,
  height: number,
  palette: Palette,
  dither: Dither,
  nearest = makeNearest(palette),
): void {
  const put = (i: number, k: number) => {
    rgba[i] = palette[k * 4]!;
    rgba[i + 1] = palette[k * 4 + 1]!;
    rgba[i + 2] = palette[k * 4 + 2]!;
    rgba[i + 3] = palette[k * 4 + 3]!;
  };

  if (dither === "off") {
    for (let i = 0; i < rgba.length; i += 4) put(i, nearest(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, rgba[i + 3]!));
    return;
  }

  if (dither === "ordered") {
    const spread = orderedSpread(palette.length >> 2);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const a = rgba[i + 3]!;
        if (a === 0) {
          put(i, nearest(0, 0, 0, 0));
          continue;
        }
        const off = ((BAYER[((y & 7) << 3) | (x & 7)]! + 0.5) / 64 - 0.5) * spread;
        put(
          i,
          nearest(clamp255(rgba[i]! + off) | 0, clamp255(rgba[i + 1]! + off) | 0, clamp255(rgba[i + 2]! + off) | 0, a),
        );
      }
    }
    return;
  }

  // Floyd–Steinberg on RGB; alpha is snapped, not diffused, and see-through pixels neither give nor take error.
  const DAMP = 0.9;
  let cur = new Float32Array((width + 2) * 3);
  let next = new Float32Array((width + 2) * 3);
  for (let y = 0; y < height; y++) {
    const ltr = (y & 1) === 0;
    for (let s = 0; s < width; s++) {
      const x = ltr ? s : width - 1 - s;
      const i = (y * width + x) * 4;
      const e = (x + 1) * 3;
      const a = rgba[i + 3]!;
      if (a === 0) {
        put(i, nearest(0, 0, 0, 0));
        continue;
      }
      const r = clamp255(rgba[i]! + cur[e]!);
      const g = clamp255(rgba[i + 1]! + cur[e + 1]!);
      const b = clamp255(rgba[i + 2]! + cur[e + 2]!);
      const k = nearest(r | 0, g | 0, b | 0, a);
      put(i, k);
      const er = (r - palette[k * 4]!) * DAMP;
      const eg = (g - palette[k * 4 + 1]!) * DAMP;
      const eb = (b - palette[k * 4 + 2]!) * DAMP;
      const fwd = ltr ? 3 : -3;
      // 7/16 ahead, 3/16 behind-below, 5/16 below, 1/16 ahead-below.
      spread3(cur, e + fwd, er, eg, eb, 7 / 16);
      spread3(next, e - fwd, er, eg, eb, 3 / 16);
      spread3(next, e, er, eg, eb, 5 / 16);
      spread3(next, e + fwd, er, eg, eb, 1 / 16);
    }
    [cur, next] = [next, cur];
    next.fill(0);
  }
}

function spread3(buf: Float32Array, at: number, r: number, g: number, b: number, w: number) {
  buf[at] = buf[at]! + r * w;
  buf[at + 1] = buf[at + 1]! + g * w;
  buf[at + 2] = buf[at + 2]! + b * w;
}
