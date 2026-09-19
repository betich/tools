import { open } from "node:fs/promises";

/**
 * Just enough of JPEG, PNG and TIFF to place an image on a PDF page without
 * decoding it: sizes, channel counts and EXIF orientation from the headers,
 * and a PNG's compressed pixels lifted out as-is. The merge (#17) uses these
 * so a JPEG goes into the PDF byte for byte and a plain PNG's zlib stream
 * becomes the image's FlateDecode stream untouched.
 */

/** EXIF orientation 1–8; 1 (or anything unknown) means stored as displayed. */
export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Orientations 5–8 turn the image a quarter, so displayed width and height swap. */
export const swapsAxes = (o: Orientation) => o >= 5;

const u16 = (b: Uint8Array, i: number, le = false) => (le ? b[i]! | (b[i + 1]! << 8) : (b[i]! << 8) | b[i + 1]!);
const u32 = (b: Uint8Array, i: number, le = false) =>
  le
    ? (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0
    : ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;

const asOrientation = (n: number): Orientation => (n >= 1 && n <= 8 ? (n as Orientation) : 1);

// ── JPEG ───────────────────────────────────────────────────────────────────

/** Stored (not displayed) pixel size, components and EXIF orientation of a JPEG, from its head. */
export type JpegInfo = { width: number; height: number; components: number; orientation: Orientation };

export function jpegInfo(b: Uint8Array): JpegInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let orientation: Orientation = 1;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = u16(b, i + 2);
    const start = i + 4;
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (start + 6 > b.length) return null;
      return { height: u16(b, start + 1), width: u16(b, start + 3), components: b[start + 5]!, orientation };
    }
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0xe1 && start + 14 <= b.length && String.fromCharCode(...b.subarray(start, start + 6)) === "Exif\0\0") {
      orientation = exifOrientation(b, start + 6, Math.min(b.length, i + 2 + len));
    }
    i += 2 + len;
  }
  return null;
}

/** Orientation tag (0x0112) of a TIFF structure's first IFD — the body of a JPEG's EXIF segment. */
function exifOrientation(b: Uint8Array, base: number, end: number): Orientation {
  if (base + 8 > end) return 1;
  const le = b[base] === 0x49;
  const ifd = base + u32(b, base + 4, le);
  if (ifd + 2 > end) return 1;
  const count = u16(b, ifd, le);
  for (let n = 0; n < count; n++) {
    const e = ifd + 2 + n * 12;
    if (e + 12 > end) break;
    if (u16(b, e, le) === 0x0112) return asOrientation(u16(b, e + 8, le));
  }
  return 1;
}

// ── PNG ────────────────────────────────────────────────────────────────────

export type PngInfo = {
  width: number;
  height: number;
  bitDepth: number;
  /** 0 gray, 2 RGB, 3 palette, 4 gray+alpha, 6 RGBA. */
  colorType: number;
  interlaced: boolean;
  /** A tRNS chunk: colour-key or palette transparency. */
  transparency: boolean;
  /** An eXIf chunk, which may carry an orientation. */
  exif: boolean;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(b: Uint8Array): boolean {
  return b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v);
}

/** The PNG's header chunks, read up to the first IDAT. `null` if the head is not a PNG. */
export function pngInfo(b: Uint8Array): PngInfo | null {
  if (!isPng(b) || b.length < 33) return null;
  const info: PngInfo = {
    width: u32(b, 16),
    height: u32(b, 20),
    bitDepth: b[24]!,
    colorType: b[25]!,
    interlaced: b[28] === 1,
    transparency: false,
    exif: false,
  };
  let i = 8;
  while (i + 8 <= b.length) {
    const len = u32(b, i);
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    if (type === "IDAT" || type === "IEND") break;
    if (type === "tRNS") info.transparency = true;
    if (type === "eXIf") info.exif = true;
    i += 12 + len;
  }
  return info;
}

/**
 * Whether a PNG's IDAT stream can be a PDF image stream as it is: 8 or 16
 * bits of gray or RGB, not interlaced, no transparency (which a PDF image
 * would need as a separate mask) and no orientation to apply.
 */
export function pngPassesThrough(p: PngInfo): boolean {
  return (p.colorType === 0 || p.colorType === 2) && (p.bitDepth === 8 || p.bitDepth === 16) && !p.interlaced && !p.transparency && !p.exif;
}

/** Colour channels (without alpha) of a PNG colour type. */
export const pngColors = (colorType: number) => (colorType === 2 || colorType === 6 ? 3 : 1);

/**
 * Copies the concatenated IDAT data of a PNG to `out`. That data is one zlib
 * stream of PNG-filtered rows — exactly what PDF's FlateDecode with
 * `/Predictor 15` reads — so no pixel is decoded. Streams chunk by chunk.
 */
export async function extractIdat(path: string, out: string): Promise<number> {
  const src = await open(path, "r");
  const sink = Bun.file(out).writer();
  let written = 0;
  try {
    const head = Buffer.alloc(8);
    let pos = 8;
    for (;;) {
      const { bytesRead } = await src.read(head, 0, 8, pos);
      if (bytesRead < 8) break;
      const len = head.readUInt32BE(0);
      const type = head.toString("latin1", 4, 8);
      if (type === "IEND") break;
      if (type === "IDAT") {
        let left = len;
        let at = pos + 8;
        while (left > 0) {
          const chunk = Buffer.alloc(Math.min(left, 1 << 20));
          const { bytesRead: n } = await src.read(chunk, 0, chunk.length, at);
          if (n <= 0) throw new Error("PNG ends inside an IDAT chunk");
          sink.write(chunk.subarray(0, n));
          left -= n;
          at += n;
          written += n;
        }
      }
      pos += 12 + len;
    }
  } finally {
    await sink.end();
    await src.close();
  }
  if (!written) throw new Error("PNG has no image data");
  return written;
}

// ── placement ──────────────────────────────────────────────────────────────

/** A PDF rect in user space: bottom-left origin, points. */
export type PdfRect = { x: number; y: number; width: number; height: number };

/**
 * The `cm` matrix that draws a stored image so its *displayed* form (EXIF
 * orientation applied) fills `rect`. A PDF image occupies the unit square with
 * its first stored row at the top; each orientation says where a stored pixel
 * (u right, v down, 0–1) lands in the displayed picture, and the matrix is
 * read off three corners of that mapping. JPEG bytes stay untouched — the
 * page turns the picture, not a re-encode.
 */
export function placementMatrix(rect: PdfRect, orientation: Orientation): [number, number, number, number, number, number] {
  const shown: Record<Orientation, (u: number, v: number) => [number, number]> = {
    1: (u, v) => [u, v],
    2: (u, v) => [1 - u, v],
    3: (u, v) => [1 - u, 1 - v],
    4: (u, v) => [u, 1 - v],
    5: (u, v) => [v, u],
    6: (u, v) => [1 - v, u],
    7: (u, v) => [1 - v, 1 - u],
    8: (u, v) => [v, 1 - u],
  };
  // Image space (s, t) has t growing upward: u = s, v = 1 − t. Displayed (x, y) has y growing downward.
  const at = (s: number, t: number): [number, number] => {
    const [x, y] = shown[orientation](s, 1 - t);
    return [rect.x + x * rect.width, rect.y + (1 - y) * rect.height];
  };
  const [e, f] = at(0, 0);
  const [ax, ay] = at(1, 0);
  const [cx, cy] = at(0, 1);
  return [ax - e, ay - f, cx - e, cy - f, e, f];
}
