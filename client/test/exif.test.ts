import { describe, expect, test } from "bun:test";
import { concat, crc32, embedExif, findExif } from "../src/lib/codecs/containers";
import {
  hasLocation,
  orientationOnlyExif,
  orientTransform,
  readOrientation,
  sanitiseExif,
  TAG,
} from "../src/lib/codecs/exif";

/* A little-endian TIFF block shaped like a phone's: IFD0 (orientation, make,
   Exif and GPS pointers) → IFD1 thumbnail; an Exif IFD with pixel sizes and a
   GPS IFD whose latitude lives out of line. */
function phoneExif(orientation = 6) {
  const b = new Uint8Array(400);
  const v = new DataView(b.buffer);
  b.set([0x49, 0x49]);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);

  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    v.setUint16(at, tag, true);
    v.setUint16(at + 2, type, true);
    v.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) v.setUint16(at + 8, value, true);
    else v.setUint32(at + 8, value, true);
  };

  // IFD0 at 8: 4 entries → table ends at 8 + 2 + 48 = 58, next pointer 58..62.
  v.setUint16(8, 4, true);
  entry(10, TAG.orientation, 3, 1, orientation);
  entry(22, 0x010f, 2, 6, 200); // Make → "Apple\0" at 200
  entry(34, TAG.exifIfd, 4, 1, 100);
  entry(46, TAG.gpsIfd, 4, 1, 150);
  v.setUint32(58, 250, true); // IFD1
  b.set([65, 112, 112, 108, 101, 0], 200);

  // Exif IFD at 100: pixel sizes.
  v.setUint16(100, 2, true);
  entry(102, TAG.pixelX, 4, 1, 4032);
  entry(114, TAG.pixelY, 4, 1, 3024);
  v.setUint32(126, 0, true);

  // GPS IFD at 150: latitude, 3 rationals at 300.
  v.setUint16(150, 1, true);
  entry(152, 0x0002, 5, 3, 300);
  v.setUint32(164, 0, true);
  for (let i = 0; i < 6; i++) v.setUint32(300 + i * 4, 13 + i, true);

  // IFD1 at 250: thumbnail at 340, 40 bytes.
  v.setUint16(250, 2, true);
  entry(252, TAG.thumbOffset, 4, 1, 340);
  entry(264, TAG.thumbLength, 4, 1, 40);
  v.setUint32(276, 0, true);
  b.fill(0xab, 340, 380);
  return b;
}

const u32le = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at, true);
const u16le = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint16(at, true);

describe("tiff block", () => {
  test("reads orientation and location", () => {
    const tiff = phoneExif(6);
    expect(readOrientation(tiff)).toBe(6);
    expect(hasLocation(tiff)).toBe(true);
    expect(readOrientation(orientationOnlyExif(8))).toBe(8);
    expect(readOrientation(new Uint8Array(4))).toBe(1);
  });

  test("sanitising drops GPS, thumbnail, resets orientation, rewrites size", () => {
    const tiff = phoneExif(6);
    const out = sanitiseExif(tiff, { keepLocation: false, width: 1024, height: 1365 })!;
    expect(out).not.toBeNull();
    expect(readOrientation(out)).toBe(1);
    expect(hasLocation(out)).toBe(false);
    expect(u16le(out, 8)).toBe(3); // IFD0 lost one entry
    expect(u32le(out, 8 + 2 + 36)).toBe(0); // next-IFD pointer moved up and cleared
    expect(out.subarray(300, 324).every((x) => x === 0)).toBe(true); // coordinates gone
    expect(out.subarray(340, 380).every((x) => x === 0)).toBe(true); // thumbnail gone
    expect(u32le(out, 102 + 8)).toBe(1024);
    expect(u32le(out, 114 + 8)).toBe(1365);
    expect(String.fromCharCode(...out.subarray(200, 205))).toBe("Apple"); // camera info stays
    expect(readOrientation(tiff)).toBe(6); // the input is untouched
  });

  test("keeping location keeps the GPS directory", () => {
    const out = sanitiseExif(phoneExif(), { keepLocation: true, width: 1, height: 1 })!;
    expect(hasLocation(out)).toBe(true);
    expect(u32le(out, 300)).toBe(13);
  });

  test("an unreadable block is refused, never passed through", () => {
    const broken = phoneExif();
    new DataView(broken.buffer).setUint32(46 + 8, 99999, true); // GPS pointer past the end
    expect(sanitiseExif(broken, { keepLocation: false, width: 1, height: 1 })).toBeNull();
    expect(sanitiseExif(new Uint8Array([1, 2, 3]), { keepLocation: false, width: 1, height: 1 })).toBeNull();
  });
});

describe("orientation transform", () => {
  const apply = (m: number[], x: number, y: number) => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];

  test("orientation 6 turns a landscape store into an upright portrait", () => {
    const t = orientTransform(6, 4, 3);
    expect([t.width, t.height]).toEqual([3, 4]);
    // The stored top-left corner ends up top-right once rotated clockwise.
    expect(apply(t.matrix, 0, 0)).toEqual([3, 0]);
    expect(apply(t.matrix, 4, 3)).toEqual([0, 4]);
  });

  test("every orientation maps the stored rectangle onto the output exactly", () => {
    for (let o = 1; o <= 8; o++) {
      const t = orientTransform(o, 4, 3);
      const corners = [
        [0, 0],
        [4, 0],
        [0, 3],
        [4, 3],
      ].map(([x, y]) => apply(t.matrix, x!, y!));
      const xs = corners.map((c) => c[0]!).sort((a, b) => a - b);
      const ys = corners.map((c) => c[1]!).sort((a, b) => a - b);
      expect([xs[0], xs[3], ys[0], ys[3]]).toEqual([0, t.width, 0, t.height]);
    }
  });
});

/* ── containers ─────────────────────────────────────────────────────────── */

const jpegWith = (...segments: Uint8Array[]) =>
  concat(new Uint8Array([0xff, 0xd8]), ...segments, new Uint8Array([0xff, 0xda, 0, 2, 1, 2, 0xff, 0xd9]));
const app = (marker: number, payload: Uint8Array) =>
  concat(new Uint8Array([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload);
const exifPayload = (tiff: Uint8Array) => concat(new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0]), tiff);
const jfif = app(0xe0, new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));

function png(...chunks: [string, Uint8Array][]) {
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  for (const [type, data] of chunks) {
    const c = new Uint8Array(12 + data.length);
    const v = new DataView(c.buffer);
    v.setUint32(0, data.length);
    c.set(
      [...type].map((ch) => ch.charCodeAt(0)),
      4,
    );
    c.set(data, 8);
    v.setUint32(8 + data.length, crc32(c.subarray(4, 8 + data.length)));
    parts.push(c);
  }
  return concat(...parts);
}

function webp(type: string, data: Uint8Array) {
  const padded = data.length & 1 ? concat(data, new Uint8Array(1)) : data;
  const b = new Uint8Array(20 + padded.length);
  const v = new DataView(b.buffer);
  b.set([0x52, 0x49, 0x46, 0x46]);
  v.setUint32(4, 12 + padded.length, true);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set(
    [...type].map((ch) => ch.charCodeAt(0)),
    12,
  );
  v.setUint32(16, data.length, true);
  b.set(padded, 20);
  return b;
}

describe("jpeg", () => {
  test("finds APP1 Exif after JFIF, and embeds after APP0", () => {
    const tiff = phoneExif();
    const src = jpegWith(jfif, app(0xe1, exifPayload(tiff)));
    expect(findExif(src)).toEqual(tiff);

    const out = embedExif(jpegWith(jfif), orientationOnlyExif(1))!;
    expect(out.subarray(2, 2 + jfif.length)).toEqual(jfif); // JFIF still first
    expect(out[2 + jfif.length + 1]).toBe(0xe1);
    expect(findExif(out)).toEqual(orientationOnlyExif(1));
    expect(out.subarray(-2)).toEqual(new Uint8Array([0xff, 0xd9]));
  });

  test("no exif → null", () => {
    expect(findExif(jpegWith(jfif))).toBeNull();
  });
});

describe("png", () => {
  test("embeds eXIf before IDAT with a valid crc, and reads it back", () => {
    const src = png(["IHDR", new Uint8Array(13)], ["IDAT", new Uint8Array([1, 2, 3])], ["IEND", new Uint8Array()]);
    const tiff = phoneExif();
    const out = embedExif(src, tiff)!;
    expect(findExif(out)).toEqual(tiff);
    const text = new TextDecoder("latin1").decode(out);
    expect(text.indexOf("eXIf")).toBeLessThan(text.indexOf("IDAT"));
    const at = text.indexOf("eXIf") - 4;
    const v = new DataView(out.buffer);
    expect(v.getUint32(at + 8 + tiff.length)).toBe(crc32(out.subarray(at + 4, at + 8 + tiff.length)));
  });
});

describe("webp", () => {
  test("a simple lossy file becomes extended, with canvas size from the VP8 header", () => {
    const vp8 = new Uint8Array(20);
    vp8.set([0, 0, 0, 0x9d, 0x01, 0x2a]);
    new DataView(vp8.buffer).setUint16(6, 640, true);
    new DataView(vp8.buffer).setUint16(8, 480, true);
    const tiff = orientationOnlyExif(1).subarray(0, 25); // odd length exercises padding
    const out = embedExif(webp("VP8 ", vp8), tiff)!;
    const v = new DataView(out.buffer);
    expect(new TextDecoder().decode(out.subarray(12, 16))).toBe("VP8X");
    expect(out[20]! & 0x08).toBe(0x08);
    expect(out[24]! | (out[25]! << 8) | (out[26]! << 16)).toBe(639);
    expect(out[27]! | (out[28]! << 8) | (out[29]! << 16)).toBe(479);
    expect(v.getUint32(4, true)).toBe(out.length - 8);
    expect(out.length % 2).toBe(0);
  });

  test("lossless with alpha sets the alpha flag; round-trips the block", () => {
    const vp8l = new Uint8Array(10);
    vp8l[0] = 0x2f;
    new DataView(vp8l.buffer).setUint32(1, (99 & 0x3fff) | ((49 & 0x3fff) << 14) | (1 << 28), true);
    const tiff = phoneExif();
    const out = embedExif(webp("VP8L", vp8l), tiff)!;
    expect(out[20]! & 0x10).toBe(0x10);
    expect(findExif(out)).toEqual(tiff);
  });
});

describe("heif", () => {
  // ftyp, then meta { hdlr, iinf { infe(v2, id 2, "Exif") }, iloc(v0) } and the item bytes in mdat.
  function heicWith(tiff: Uint8Array) {
    const box = (type: string, ...body: Uint8Array[]) => {
      const inner = concat(...body);
      const b = new Uint8Array(8 + inner.length);
      new DataView(b.buffer).setUint32(0, b.length);
      b.set(
        [...type].map((c) => c.charCodeAt(0)),
        4,
      );
      b.set(inner, 8);
      return b;
    };
    const str = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
    const u16 = (n: number) => new Uint8Array([n >> 8, n & 0xff]);
    const u32 = (n: number) => new Uint8Array([n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
    const item = concat(u32(6), str("Exif\0\0"), tiff);

    const ftyp = box("ftyp", str("heic"), u32(0), str("mif1heic"));
    const infeHvc = box("infe", new Uint8Array([2, 0, 0, 0]), u16(1), u16(0), str("hvc1"), new Uint8Array([0]));
    const infeExif = box("infe", new Uint8Array([2, 0, 0, 0]), u16(2), u16(0), str("Exif"), new Uint8Array([0]));
    const iinf = box("iinf", new Uint8Array(4), u16(2), infeHvc, infeExif);
    const makeMeta = (offset: number) => {
      // iloc v0: offset_size 4, length_size 4, base_offset_size 0; two items, one extent each.
      const iloc = box(
        "iloc",
        new Uint8Array(4),
        new Uint8Array([0x44, 0x00]),
        u16(2),
        u16(1),
        u16(0),
        u16(1),
        u32(0),
        u32(0),
        u16(2),
        u16(0),
        u16(1),
        u32(offset),
        u32(item.length),
      );
      return box("meta", new Uint8Array(4), box("hdlr", new Uint8Array(24)), iinf, iloc);
    };
    const probe = makeMeta(0);
    const mdatAt = ftyp.length + probe.length;
    return concat(ftyp, makeMeta(mdatAt + 8), box("mdat", item));
  }

  test("finds the Exif item through iinf and iloc", () => {
    const tiff = phoneExif(3);
    const found = findExif(heicWith(tiff));
    expect(found).toEqual(tiff);
    expect(readOrientation(found!)).toBe(3);
  });

  test("garbage heif → null, never a throw", () => {
    const b = heicWith(phoneExif());
    expect(findExif(b.subarray(0, 60))).toBeNull();
  });
});
