/**
 * Where each container keeps its EXIF, and how to put a block back.
 *
 * Read from: JPEG (APP1), HEIF/HEIC (the `Exif` item in `meta`), PNG (`eXIf`)
 * and WebP (`EXIF`). Written to: JPEG, PNG and WebP only. AVIF and JPEG XL
 * outputs leave with no metadata — writing into their boxes is a job for the
 * encoder, and ours don't offer it.
 *
 * Every function here takes and returns plain bytes, and never throws on
 * malformed input: a reader returns null, a writer returns null.
 */

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

const ascii = (b: Uint8Array, at: number, n = 4) => {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[at + i] ?? 0);
  return s;
};

const isTiffStart = (b: Uint8Array, at = 0) => {
  const o = ascii(b, at, 2);
  return o === "II" || o === "MM";
};

/** Strips an optional `Exif\0\0` prefix some writers leave in front of the TIFF header. */
function tiffFrom(b: Uint8Array): Uint8Array | null {
  const start = EXIF_HEADER.every((c, i) => b[i] === c) ? 6 : 0;
  return b.length > start + 8 && isTiffStart(b, start) ? b.slice(start) : null;
}

export type Container = "jpeg" | "heif" | "png" | "webp" | "other";

export function containerOf(b: Uint8Array): Container {
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "png";
  if (ascii(b, 0) === "RIFF" && ascii(b, 8) === "WEBP") return "webp";
  if (ascii(b, 4) === "ftyp") return "heif";
  return "other";
}

/** The source's TIFF block, or null when it has none we can find. */
export function findExif(b: Uint8Array): Uint8Array | null {
  try {
    switch (containerOf(b)) {
      case "jpeg":
        return jpegExif(b);
      case "png":
        return pngExif(b);
      case "webp":
        return webpExif(b);
      case "heif":
        return heifExif(b);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** `out` with `tiff` embedded, or null when the format can't carry it. */
export function embedExif(out: Uint8Array, tiff: Uint8Array): Uint8Array<ArrayBuffer> | null {
  try {
    switch (containerOf(out)) {
      case "jpeg":
        return jpegEmbed(out, tiff);
      case "png":
        return pngEmbed(out, tiff);
      case "webp":
        return webpEmbed(out, tiff);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/* ── JPEG ─────────────────────────────────────────────────────────────── */

/** Walks marker segments from SOI up to SOS. */
function* jpegSegments(b: Uint8Array) {
  let at = 2;
  while (at + 4 <= b.length && b[at] === 0xff) {
    const marker = b[at + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return;
    const length = (b[at + 2]! << 8) | b[at + 3]!;
    yield { marker, at, dataAt: at + 4, end: at + 2 + length };
    at += 2 + length;
  }
}

function jpegExif(b: Uint8Array): Uint8Array | null {
  for (const s of jpegSegments(b)) {
    if (s.marker === 0xe1 && EXIF_HEADER.every((c, i) => b[s.dataAt + i] === c)) {
      return tiffFrom(b.subarray(s.dataAt, Math.min(s.end, b.length)));
    }
  }
  return null;
}

function jpegEmbed(out: Uint8Array, tiff: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const length = 2 + EXIF_HEADER.length + tiff.length;
  if (length > 0xffff) return null;
  // After JFIF's APP0 when the encoder wrote one, otherwise straight after SOI.
  let at = 2;
  for (const s of jpegSegments(out)) {
    if (s.marker === 0xe0) at = s.end;
    break;
  }
  const segment = new Uint8Array(2 + length);
  segment.set([0xff, 0xe1, length >> 8, length & 0xff]);
  segment.set(EXIF_HEADER, 4);
  segment.set(tiff, 4 + EXIF_HEADER.length);
  return concat(out.subarray(0, at), segment, out.subarray(at));
}

/* ── PNG ──────────────────────────────────────────────────────────────── */

function* pngChunks(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 8;
  while (at + 12 <= b.length) {
    const length = v.getUint32(at);
    const type = ascii(b, at + 4);
    yield { type, at, dataAt: at + 8, length, end: at + 12 + length };
    if (type === "IEND") return;
    at += 12 + length;
  }
}

function pngExif(b: Uint8Array): Uint8Array | null {
  for (const c of pngChunks(b)) {
    if (c.type === "eXIf") return tiffFrom(b.slice(c.dataAt, c.dataAt + c.length));
  }
  return null;
}

function pngEmbed(out: Uint8Array, tiff: Uint8Array): Uint8Array<ArrayBuffer> | null {
  let at = -1;
  for (const c of pngChunks(out)) {
    if (c.type === "IDAT") {
      at = c.at;
      break;
    }
  }
  if (at < 0) return null;
  const chunk = new Uint8Array(12 + tiff.length);
  const v = new DataView(chunk.buffer);
  v.setUint32(0, tiff.length);
  chunk.set([0x65, 0x58, 0x49, 0x66], 4); // "eXIf"
  chunk.set(tiff, 8);
  v.setUint32(8 + tiff.length, crc32(chunk.subarray(4, 8 + tiff.length)));
  return concat(out.subarray(0, at), chunk, out.subarray(at));
}

let crcTable: Uint32Array | null = null;
export function crc32(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ── WebP ─────────────────────────────────────────────────────────────── */

function* webpChunks(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 12;
  while (at + 8 <= b.length) {
    const length = v.getUint32(at + 4, true);
    yield { type: ascii(b, at), at, dataAt: at + 8, length, end: at + 8 + length + (length & 1) };
    at += 8 + length + (length & 1);
  }
}

function webpExif(b: Uint8Array): Uint8Array | null {
  for (const c of webpChunks(b)) {
    if (c.type === "EXIF") return tiffFrom(b.slice(c.dataAt, c.dataAt + c.length));
  }
  return null;
}

const VP8X_EXIF = 0x08;
const VP8X_ALPHA = 0x10;

/** Canvas size and alpha for a simple-format WebP, read from its one image chunk. */
function webpCanvas(
  b: Uint8Array,
  c: { type: string; dataAt: number },
): { width: number; height: number; alpha: boolean } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (c.type === "VP8 ") {
    // Key frame header: 3-byte tag, start code 9d 01 2a, then 14-bit width and height.
    if (b[c.dataAt + 3] !== 0x9d || b[c.dataAt + 4] !== 0x01 || b[c.dataAt + 5] !== 0x2a) return null;
    return {
      width: v.getUint16(c.dataAt + 6, true) & 0x3fff,
      height: v.getUint16(c.dataAt + 8, true) & 0x3fff,
      alpha: false,
    };
  }
  if (c.type === "VP8L") {
    if (b[c.dataAt] !== 0x2f) return null;
    const bits = v.getUint32(c.dataAt + 1, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: ((bits >>> 28) & 1) === 1 };
  }
  return null;
}

function webpEmbed(out: Uint8Array, tiff: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const chunks = [...webpChunks(out)];
  const first = chunks[0];
  if (!first) return null;

  const exif = new Uint8Array(8 + tiff.length + (tiff.length & 1));
  exif.set([0x45, 0x58, 0x49, 0x46]); // "EXIF"
  new DataView(exif.buffer).setUint32(4, tiff.length, true);
  exif.set(tiff, 8);

  let body: Uint8Array;
  if (first.type === "VP8X") {
    // Already extended: raise the flag, drop any old EXIF, append ours at the end (spec order).
    const kept = chunks.filter((c) => c.type !== "EXIF").map((c) => out.slice(c.at, Math.min(c.end, out.length)));
    const head = kept[0]!;
    head[8] = head[8]! | VP8X_EXIF;
    body = concat(...kept, exif);
  } else {
    const canvas = webpCanvas(out, first);
    if (!canvas) return null;
    const vp8x = new Uint8Array(18);
    vp8x.set([0x56, 0x50, 0x38, 0x58]); // "VP8X"
    new DataView(vp8x.buffer).setUint32(4, 10, true);
    vp8x[8] = VP8X_EXIF | (canvas.alpha ? VP8X_ALPHA : 0);
    put24(vp8x, 12, canvas.width - 1);
    put24(vp8x, 15, canvas.height - 1);
    body = concat(vp8x, out.slice(first.at, Math.min(first.end, out.length)), exif);
  }

  const riff = new Uint8Array(12);
  riff.set([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  new DataView(riff.buffer).setUint32(4, 4 + body.length, true);
  riff.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  return concat(riff, body);
}

function put24(b: Uint8Array, at: number, v: number) {
  b[at] = v & 0xff;
  b[at + 1] = (v >> 8) & 0xff;
  b[at + 2] = (v >> 16) & 0xff;
}

/* ── HEIF ─────────────────────────────────────────────────────────────── */

type Box = { type: string; start: number; body: number; end: number };

/** ISO-BMFF boxes between `from` and `to`. */
function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = from;
  while (at + 8 <= to) {
    let size = v.getUint32(at);
    const type = ascii(b, at + 4);
    let body = at + 8;
    if (size === 1) {
      size = Number(v.getBigUint64(at + 8));
      body = at + 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < body - at || at + size > to) return;
    yield { type, start: at, body, end: at + size };
    at += size;
  }
}

function heifExif(b: Uint8Array): Uint8Array | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const meta = [...boxes(b, 0, b.length)].find((x) => x.type === "meta");
  if (!meta) return null;
  const inside = [...boxes(b, meta.body + 4, meta.end)]; // meta is a full box

  // iinf → which item id is the Exif item.
  const iinf = inside.find((x) => x.type === "iinf");
  if (!iinf) return null;
  const iinfVersion = b[iinf.body]!;
  const infeFrom = iinf.body + 4 + (iinfVersion === 0 ? 2 : 4);
  let exifId = -1;
  for (const infe of boxes(b, infeFrom, iinf.end)) {
    if (infe.type !== "infe") continue;
    const version = b[infe.body]!;
    if (version < 2) continue;
    const idWide = version >= 3;
    const id = idWide ? v.getUint32(infe.body + 4) : v.getUint16(infe.body + 4);
    const typeAt = infe.body + 4 + (idWide ? 4 : 2) + 2;
    if (ascii(b, typeAt) === "Exif") {
      exifId = id;
      break;
    }
  }
  if (exifId < 0) return null;

  // iloc → where that item's bytes are.
  const iloc = inside.find((x) => x.type === "iloc");
  if (!iloc) return null;
  const version = b[iloc.body]!;
  let at = iloc.body + 4;
  const offsetSize = b[at]! >> 4;
  const lengthSize = b[at]! & 0x0f;
  const baseOffsetSize = b[at + 1]! >> 4;
  const indexSize = version === 1 || version === 2 ? b[at + 1]! & 0x0f : 0;
  at += 2;
  const readN = (n: number) => {
    let value = 0;
    for (let i = 0; i < n; i++) value = value * 256 + b[at + i]!;
    at += n;
    return value;
  };
  const itemCount = readN(version < 2 ? 2 : 4);
  for (let i = 0; i < itemCount; i++) {
    const id = readN(version < 2 ? 2 : 4);
    const method = version === 1 || version === 2 ? readN(2) & 0x0f : 0;
    readN(2); // data_reference_index
    const base = readN(baseOffsetSize);
    const extents = readN(2);
    const parts: Uint8Array[] = [];
    for (let e = 0; e < extents; e++) {
      readN(indexSize);
      const offset = readN(offsetSize);
      const length = readN(lengthSize);
      parts.push(b.subarray(base + offset, base + offset + length));
    }
    if (id !== exifId) continue;
    if (method !== 0) return null; // idat-stored Exif: rare, not worth the code
    const item = concat(...parts);
    // The item opens with a 4-byte offset to the TIFF header (usually past "Exif\0\0").
    if (item.length < 4) return null;
    const skip = new DataView(item.buffer, item.byteOffset).getUint32(0);
    return tiffFrom(item.slice(4 + skip));
  }
  return null;
}

/* ── util ─────────────────────────────────────────────────────────────── */

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
