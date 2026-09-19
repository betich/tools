/**
 * EXIF, at the level of the TIFF block every container wraps it in.
 *
 * The encoders write no metadata at all, so an output is stripped unless we
 * put something back. When we do, it is the source's own block, copied and
 * then made true for the new file: orientation reset to 1 (the pixels were
 * already turned upright), the IFD1 thumbnail dropped (it can show a crop or
 * an edit the output no longer has), the pixel dimensions rewritten, and the
 * GPS directory removed unless the person asked to keep their location.
 *
 * Everything here is pure and bounds-checked. A block that doesn't parse is
 * never passed through: sanitising returns null and the output leaves bare.
 */

export const TAG = {
  orientation: 0x0112,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  thumbOffset: 0x0201,
  thumbLength: 0x0202,
  pixelX: 0xa002,
  pixelY: 0xa003,
} as const;

/** Byte width of one value of each TIFF field type (1–13). */
const TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
};

type Entry = { at: number; tag: number; type: number; count: number; valueAt: number; byteLength: number };

class Tiff {
  readonly view: DataView;
  readonly le: boolean;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const order = bytes.length >= 8 ? String.fromCharCode(bytes[0]!, bytes[1]!) : "";
    if (order !== "II" && order !== "MM") throw new Error("not a TIFF block");
    this.le = order === "II";
    if (this.u16(2) !== 42) throw new Error("not a TIFF block");
  }
  get length() {
    return this.bytes.length;
  }
  u16(at: number) {
    this.check(at, 2);
    return this.view.getUint16(at, this.le);
  }
  u32(at: number) {
    this.check(at, 4);
    return this.view.getUint32(at, this.le);
  }
  set16(at: number, v: number) {
    this.check(at, 2);
    this.view.setUint16(at, v, this.le);
  }
  set32(at: number, v: number) {
    this.check(at, 4);
    this.view.setUint32(at, v, this.le);
  }
  zero(at: number, length: number) {
    const from = Math.max(0, at);
    const to = Math.min(this.length, at + length);
    if (to > from) this.bytes.fill(0, from, to);
  }
  check(at: number, n: number) {
    if (at < 0 || at + n > this.length) throw new Error("EXIF offset out of range");
  }

  /** The entries of the IFD at `at`, plus where its next-IFD pointer sits. */
  ifd(at: number): { entries: Entry[]; nextAt: number } {
    const count = this.u16(at);
    const entries: Entry[] = [];
    for (let i = 0; i < count; i++) {
      const e = at + 2 + i * 12;
      const type = this.u16(e + 2);
      const n = this.u32(e + 4);
      const byteLength = (TYPE_SIZE[type] ?? 1) * n;
      const valueAt = byteLength <= 4 ? e + 8 : this.u32(e + 8);
      entries.push({ at: e, tag: this.u16(e), type, count: n, valueAt, byteLength });
    }
    const nextAt = at + 2 + count * 12;
    this.check(nextAt, 4);
    return { entries, nextAt };
  }

  /** Zeroes a whole IFD — its table and every value stored outside it. */
  wipeIfd(at: number) {
    const { entries, nextAt } = this.ifd(at);
    for (const e of entries) if (e.byteLength > 4) this.zero(e.valueAt, e.byteLength);
    this.zero(at, nextAt + 4 - at);
  }

  /** Rewrites a SHORT or LONG value in place. */
  setNumber(e: Entry, v: number) {
    if (e.type === 3) this.set16(e.valueAt, Math.min(0xffff, v));
    else if (e.type === 4) this.set32(e.valueAt, v);
  }
}

/** The orientation tag (1–8) of a TIFF block; 1 when absent or unreadable. */
export function readOrientation(tiff: Uint8Array): number {
  try {
    const t = new Tiff(tiff);
    const entry = t.ifd(t.u32(4)).entries.find((e) => e.tag === TAG.orientation);
    const value = entry && entry.type === 3 ? t.u16(entry.valueAt) : 1;
    return value >= 1 && value <= 8 ? value : 1;
  } catch {
    return 1;
  }
}

/** True when IFD0 points at a GPS directory. */
export function hasLocation(tiff: Uint8Array): boolean {
  try {
    const t = new Tiff(tiff);
    return t.ifd(t.u32(4)).entries.some((e) => e.tag === TAG.gpsIfd);
  } catch {
    return false;
  }
}

export type SanitiseOptions = {
  /** Keep the GPS directory. Off by default everywhere this is called from. */
  keepLocation: boolean;
  /** The output's pixel size, written over PixelXDimension / PixelYDimension. */
  width: number;
  height: number;
};

/**
 * A copy of `tiff` that is honest about the output. Offsets inside the block
 * stay valid because nothing moves except IFD0's own table, which only
 * shrinks. Returns null when the block can't be parsed, so a failure to strip
 * GPS can never leak it.
 */
export function sanitiseExif(tiff: Uint8Array, opts: SanitiseOptions): Uint8Array | null {
  try {
    const t = new Tiff(tiff.slice());
    const ifd0 = t.u32(4);
    const { entries, nextAt } = t.ifd(ifd0);

    for (const e of entries) {
      if (e.tag === TAG.orientation && e.type === 3) t.set16(e.valueAt, 1);
      if (e.tag === TAG.exifIfd) {
        for (const x of t.ifd(t.u32(e.valueAt)).entries) {
          if (x.tag === TAG.pixelX) t.setNumber(x, opts.width);
          if (x.tag === TAG.pixelY) t.setNumber(x, opts.height);
        }
      }
    }

    // IFD1 is the embedded thumbnail: drop its pixels, its table, and the link to it.
    const ifd1 = t.u32(nextAt);
    if (ifd1 !== 0) {
      const thumb = t.ifd(ifd1).entries;
      const offset = thumb.find((e) => e.tag === TAG.thumbOffset);
      const length = thumb.find((e) => e.tag === TAG.thumbLength);
      if (offset && length) t.zero(t.u32(offset.valueAt), t.u32(length.valueAt));
      t.wipeIfd(ifd1);
      t.set32(nextAt, 0);
    }

    if (!opts.keepLocation) {
      const gps = entries.findIndex((e) => e.tag === TAG.gpsIfd);
      if (gps >= 0) {
        t.wipeIfd(t.u32(entries[gps]!.valueAt));
        // Close the gap in IFD0's table: later entries shift up one slot.
        const from = entries[gps]!.at;
        t.bytes.copyWithin(from, from + 12, nextAt + 4);
        t.zero(nextAt - 8, 12);
        t.set16(ifd0, entries.length - 1);
      }
    }
    return t.bytes;
  } catch {
    return null;
  }
}

/**
 * The smallest valid TIFF block carrying just an orientation — the worker
 * uses it to ask the browser whether `createImageBitmap` honours EXIF.
 */
export function orientationOnlyExif(orientation: number): Uint8Array {
  const b = new Uint8Array(26);
  const v = new DataView(b.buffer);
  b.set([0x4d, 0x4d]); // "MM"
  v.setUint16(2, 42);
  v.setUint32(4, 8); // IFD0 right after the header
  v.setUint16(8, 1); // one entry
  v.setUint16(10, TAG.orientation);
  v.setUint16(12, 3); // SHORT
  v.setUint32(14, 1);
  v.setUint16(18, orientation);
  v.setUint32(22, 0); // no IFD1
  return b;
}

/**
 * The canvas transform that draws a stored (unrotated) image of `width` ×
 * `height` upright, for EXIF orientation 1–8. Used only when the browser
 * turned out not to apply orientation itself.
 */
export function orientTransform(
  orientation: number,
  width: number,
  height: number,
): { width: number; height: number; matrix: [number, number, number, number, number, number] } {
  const w = width;
  const h = height;
  switch (orientation) {
    case 2:
      return { width: w, height: h, matrix: [-1, 0, 0, 1, w, 0] };
    case 3:
      return { width: w, height: h, matrix: [-1, 0, 0, -1, w, h] };
    case 4:
      return { width: w, height: h, matrix: [1, 0, 0, -1, 0, h] };
    case 5:
      return { width: h, height: w, matrix: [0, 1, 1, 0, 0, 0] };
    case 6:
      return { width: h, height: w, matrix: [0, 1, -1, 0, h, 0] };
    case 7:
      return { width: h, height: w, matrix: [0, -1, -1, 0, h, w] };
    case 8:
      return { width: h, height: w, matrix: [0, -1, 1, 0, 0, w] };
    default:
      return { width: w, height: h, matrix: [1, 0, 0, 1, 0, 0] };
  }
}
