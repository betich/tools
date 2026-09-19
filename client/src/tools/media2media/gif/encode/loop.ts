/* ───────────────────────────────────────────────────────────────────────────
   Loop counts, written into finished files by hand. Neither encoder can
   store a finite count: gifski's wasm build writes "forever" for any
   `repeat` but 0 (which drops the loop block, playing once), and UPNG.js
   always writes `num_plays = 0`. Both counts are a fixed-size field, so the
   fix is a patch in place, not a re-encode.
   ─────────────────────────────────────────────────────────────────────────── */

const NETSCAPE = "NETSCAPE2.0";

/** Byte offset of the GIF NETSCAPE2.0 application extension (at its 0x21 introducer), or -1. */
export function findNetscapeBlock(gif: Uint8Array): number {
  // 21 FF 0B "NETSCAPE2.0" 03 01 <lo> <hi> 00 — it sits before the first frame.
  outer: for (let i = 13; i + 19 <= gif.length; i++) {
    if (gif[i] !== 0x21 || gif[i + 1] !== 0xff || gif[i + 2] !== 0x0b) continue;
    for (let k = 0; k < NETSCAPE.length; k++) if (gif[i + 3 + k] !== NETSCAPE.charCodeAt(k)) continue outer;
    if (gif[i + 14] !== 0x03 || gif[i + 15] !== 0x01) continue;
    return i;
  }
  return -1;
}

/**
 * Sets the extra repeats a GIF's loop block stores (0 forever, n plays
 * n + 1 times — see `repeatCount`). The file must already have the block.
 */
export function setGifRepeat(gif: Uint8Array, repeat: number): Uint8Array {
  const at = findNetscapeBlock(gif);
  if (at < 0) throw new Error("This GIF has no loop block to set.");
  const n = Math.max(0, Math.min(0xffff, Math.round(repeat)));
  gif[at + 16] = n & 0xff;
  gif[at + 17] = n >> 8;
  return gif;
}

export function readGifRepeat(gif: Uint8Array): number | null {
  const at = findNetscapeBlock(gif);
  return at < 0 ? null : gif[at + 16]! | (gif[at + 17]! << 8);
}

/* ── APNG ───────────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;

function putU32(b: Uint8Array, i: number, v: number) {
  b[i] = (v >>> 24) & 0xff;
  b[i + 1] = (v >>> 16) & 0xff;
  b[i + 2] = (v >>> 8) & 0xff;
  b[i + 3] = v & 0xff;
}

/**
 * Offset of the acTL chunk (its length field), or -1 for a still PNG. Walks
 * the chunks rather than trusting UPNG's fixed layout (sig + IHDR + sRGB,
 * acTL at 46), so a change upstream can't make this write into the wrong bytes.
 */
export function findActl(png: Uint8Array): number {
  let i = 8;
  while (i + 12 <= png.length) {
    const len = u32(png, i);
    const type = String.fromCharCode(png[i + 4]!, png[i + 5]!, png[i + 6]!, png[i + 7]!);
    if (type === "acTL") return i;
    if (type === "IDAT" || type === "IEND") return -1;
    i += 12 + len;
  }
  return -1;
}

/** Sets an APNG's `num_plays` (0 forever) and the chunk's CRC. A still PNG comes back untouched. */
export function setApngPlays(png: Uint8Array, plays: number): Uint8Array {
  const at = findActl(png);
  if (at < 0) return png;
  putU32(png, at + 12, Math.max(0, Math.round(plays)) >>> 0);
  // CRC covers type + data: 4 + 8 bytes.
  putU32(png, at + 16, crc32(png, at + 4, at + 16));
  return png;
}

export function readApngPlays(png: Uint8Array): number | null {
  const at = findActl(png);
  return at < 0 ? null : u32(png, at + 12);
}

export function apngCrcValid(png: Uint8Array): boolean {
  const at = findActl(png);
  return at >= 0 && u32(png, at + 16) === crc32(png, at + 4, at + 16);
}
