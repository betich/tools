/* ───────────────────────────────────────────────────────────────────────────
   Frame diff. Both encoders already write only the part of a frame that
   changed; what they can't see is that a pixel which moved by two levels of
   noise hasn't really changed. `stabilise` settles those pixels onto what is
   already on screen, so each frame carries only its real changes.
   Pure: straight RGBA buffers in, stats out.
   ─────────────────────────────────────────────────────────────────────────── */

export type Rect = { x: number; y: number; width: number; height: number };

/** The smallest rectangle holding every pixel that differs between two frames, or null when none do. */
export function changedRect(a: Uint8Array, b: Uint8Array, width: number, height: number): Rect | null {
  const a32 = new Uint32Array(a.buffer, a.byteOffset, width * height);
  const b32 = new Uint32Array(b.buffer, b.byteOffset, width * height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (a32[row + x] === b32[row + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export type DiffStats = {
  /** Pixels written per frame after the first, as a share of the canvas: 0–1. */
  changedShare: number;
  /** Pixels per frame (after the first) that were settled onto the previous frame's value. */
  settled: number;
};

/**
 * Settles near-unchanged pixels in place. A pixel within `tolerance` of the
 * one on screen — every channel, alpha included; two fully transparent
 * pixels always match — takes the on-screen value. Comparing against what is
 * on screen (not the previous source frame) keeps drift bounded: a slow fade
 * still lands once it has moved more than `tolerance`.
 */
export function stabilise(frames: Uint8Array[], tolerance: number): DiffStats {
  const first = frames[0];
  if (!first || frames.length < 2) return { changedShare: 0, settled: 0 };
  const shown = first.slice();
  const t = Math.max(0, tolerance);
  const pixels = first.length >> 2;
  let changed = 0;
  let settled = 0;
  for (let f = 1; f < frames.length; f++) {
    const cur = frames[f]!;
    for (let i = 0; i < cur.length; i += 4) {
      const r = cur[i]!,
        g = cur[i + 1]!,
        b = cur[i + 2]!,
        a = cur[i + 3]!;
      const sr = shown[i]!,
        sg = shown[i + 1]!,
        sb = shown[i + 2]!,
        sa = shown[i + 3]!;
      if (r === sr && g === sg && b === sb && a === sa) continue;
      const same =
        (a === 0 && sa === 0) ||
        (t > 0 && Math.abs(r - sr) <= t && Math.abs(g - sg) <= t && Math.abs(b - sb) <= t && Math.abs(a - sa) <= t);
      if (same) {
        cur[i] = sr;
        cur[i + 1] = sg;
        cur[i + 2] = sb;
        cur[i + 3] = sa;
        settled++;
      } else {
        shown[i] = r;
        shown[i + 1] = g;
        shown[i + 2] = b;
        shown[i + 3] = a;
        changed++;
      }
    }
  }
  const later = frames.length - 1;
  return { changedShare: changed / (pixels * later), settled: Math.round(settled / later) };
}
