/**
 * A PDF that embeds whole fonts, the way Thai office documents often do:
 *   bun thai.ts <out.pdf>
 *
 * Sarabun (Thai and Latin, from the client's @fontsource/sarabun) goes in as
 * two Type0/Identity-H fonts, each with its complete font program (FontFile2)
 * and a ToUnicode CMap, plus Sarabun Bold as a simple WinAnsi TrueType font,
 * and the pages use a handful of their glyphs — what the font
 * subsetting pass (#11) is for. Characters map to glyphs one to one (no
 * shaping); extraction only needs ToUnicode (or WinAnsi) to round-trip.
 *
 * Written by hand because MuPDF 1.25's JS can't load a font from a file, and
 * Fontsource ships only WOFF: WOFF 1.0 is the sfnt's tables, each deflated.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const out = process.argv[2]!;
const require = createRequire(join(import.meta.dir, "../../../client/package.json"));
const files = join(dirname(require.resolve("@fontsource/sarabun/package.json")), "files");

/** The sfnt inside a WOFF 1.0 file, and its tables. */
function fromWoff(path: string): { sfnt: Buffer; tables: Map<string, Buffer> } {
  const w = readFileSync(path);
  if (w.toString("latin1", 0, 4) !== "wOFF") throw new Error(`${path} is not WOFF 1.0`);
  const n = w.readUInt16BE(12);
  const tables = new Map<string, Buffer>();
  const entries = Array.from({ length: n }, (_, i) => {
    const at = 44 + i * 20;
    const [offset, compLength, origLength, checksum] = [4, 8, 12, 16].map((d) => w.readUInt32BE(at + d)) as [
      number,
      number,
      number,
      number,
    ];
    const raw = w.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(raw) : raw;
    const tag = w.toString("latin1", at, at + 4);
    tables.set(tag, data);
    return { tag, checksum, data };
  });
  let pow = 1;
  while (pow * 2 <= n) pow *= 2;
  const head = Buffer.alloc(12 + n * 16);
  head.writeUInt32BE(w.readUInt32BE(4), 0);
  head.writeUInt16BE(n, 4);
  head.writeUInt16BE(pow * 16, 6);
  head.writeUInt16BE(Math.log2(pow), 8);
  head.writeUInt16BE(n * 16 - pow * 16, 10);
  const body: Buffer[] = [];
  let offset = head.length;
  entries.forEach((t, i) => {
    head.write(t.tag, 12 + i * 16, "latin1");
    head.writeUInt32BE(t.checksum, 16 + i * 16);
    head.writeUInt32BE(offset, 20 + i * 16);
    head.writeUInt32BE(t.data.length, 24 + i * 16);
    const padded = Buffer.alloc((t.data.length + 3) & ~3);
    t.data.copy(padded);
    body.push(padded);
    offset += padded.length;
  });
  return { sfnt: Buffer.concat([head, ...body]), tables };
}

/** Unicode → glyph id from the format 4 (BMP) cmap subtable. */
function glyphFor(cmap: Buffer): (cp: number) => number {
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i++) {
    const offset = cmap.readUInt32BE(4 + i * 8 + 4);
    if (cmap.readUInt16BE(offset) !== 4) continue;
    const t = cmap.subarray(offset);
    const segs = t.readUInt16BE(6) / 2;
    const ends = 14,
      starts = 16 + segs * 2,
      deltas = starts + segs * 2,
      ranges = deltas + segs * 2;
    return (cp) => {
      for (let s = 0; s < segs; s++) {
        if (cp > t.readUInt16BE(ends + s * 2)) continue;
        const start = t.readUInt16BE(starts + s * 2);
        if (cp < start) return 0;
        const delta = t.readInt16BE(deltas + s * 2);
        const range = t.readUInt16BE(ranges + s * 2);
        if (!range) return (cp + delta) & 0xffff;
        const g = t.readUInt16BE(ranges + s * 2 + range + (cp - start) * 2);
        return g ? (g + delta) & 0xffff : 0;
      }
      return 0;
    };
  }
  throw new Error("no format 4 cmap");
}

type Face = { name: string; sfnt: Buffer; glyph: (cp: number) => number; width: (gid: number) => number };

function face(name: string, file: string): Face {
  const { sfnt, tables } = fromWoff(join(files, file));
  const upm = tables.get("head")!.readUInt16BE(18);
  const metrics = tables.get("hhea")!.readUInt16BE(34);
  const hmtx = tables.get("hmtx")!;
  const width = (gid: number) => Math.round((hmtx.readUInt16BE(Math.min(gid, metrics - 1) * 4) * 1000) / upm);
  return { name, sfnt, glyph: glyphFor(tables.get("cmap")!), width };
}

const faces = {
  TH: face("Sarabun-Thai", "sarabun-thai-400-normal.woff"),
  LA: face("Sarabun", "sarabun-latin-400-normal.woff"),
};

type Key = keyof typeof faces | "LS";
const pages: [Key, number, string][][] = [
  [
    ["LA", 24, "Quarterly report"],
    ["TH", 20, "รายงานประจำไตรมาส"],
    ["TH", 14, "ภาษาไทย สวัสดี"],
  ],
  [
    ["LA", 14, "Second page 2026"],
    ["TH", 14, "ขอบคุณ"],
    ["LS", 12, "Simple TrueType, WinAnsi"],
  ],
];

// Objects, numbered from 1; streams are [dict, bytes].
const objects: (string | [string, Buffer])[] = [];
const add = (o: string | [string, Buffer]) => objects.push(o);
const ref = (n: number) => `${n} 0 R`;
const hex4 = (n: number) => n.toString(16).padStart(4, "0");

add("<< /Type /Catalog /Pages 2 0 R >>"); // 1
add(""); // 2, pages — filled in below

const used = new Map<keyof typeof faces, Map<number, number>>(); // gid → code point
for (const page of pages) {
  for (const [f, , text] of page) {
    if (f === "LS") continue;
    const m = used.get(f) ?? new Map<number, number>();
    for (const ch of text) m.set(faces[f].glyph(ch.codePointAt(0)!), ch.codePointAt(0)!);
    used.set(f, m);
  }
}

const fontRefs: Record<string, string> = {};
for (const [key, f] of Object.entries(faces) as [keyof typeof faces, Face][]) {
  const program = deflateSync(f.sfnt);
  add([`<< /Length ${program.length} /Length1 ${f.sfnt.length} /Filter /FlateDecode >>`, program]);
  const file = objects.length;
  add(
    `<< /Type /FontDescriptor /FontName /${f.name} /Flags 32 /FontBBox [-500 -300 1500 1100] /ItalicAngle 0 ` +
      `/Ascent 1068 /Descent -232 /CapHeight 700 /StemV 80 /FontFile2 ${ref(file)} >>`,
  );
  const desc = objects.length;
  const glyphs = [...used.get(key)!.entries()].sort((a, b) => a[0] - b[0]);
  const widths = glyphs.map(([g]) => `${g} [${f.width(g)}]`).join(" ");
  add(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${f.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
      `/FontDescriptor ${ref(desc)} /CIDToGIDMap /Identity /DW 500 /W [${widths}] >>`,
  );
  const cid = objects.length;
  const cmap = Buffer.from(
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n" +
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
      "/CMapName /Adobe-Identity-UCS def /CMapType 2 def\n" +
      "1 begincodespacerange <0000> <FFFF> endcodespacerange\n" +
      `${glyphs.length} beginbfchar\n${glyphs.map(([g, cp]) => `<${hex4(g)}> <${hex4(cp)}>`).join("\n")}\nendbfchar\n` +
      "endcmap CMapName currentdict /CMap defineresource pop end end\n",
  );
  add([`<< /Length ${cmap.length} >>`, cmap]);
  const toUnicode = objects.length;
  add(
    `<< /Type /Font /Subtype /Type0 /BaseFont /${f.name} /Encoding /Identity-H ` +
      `/DescendantFonts [${ref(cid)}] /ToUnicode ${ref(toUnicode)} >>`,
  );
  fontRefs[key] = ref(objects.length);
}

{
  // A simple TrueType font: codes are WinAnsi (ASCII here), widths per code. A program of its
  // own — MuPDF merges identical programs, and won't subset one used both ways.
  const f = face("Sarabun-Bold", "sarabun-latin-700-normal.woff");
  const program = deflateSync(f.sfnt);
  add([`<< /Length ${program.length} /Length1 ${f.sfnt.length} /Filter /FlateDecode >>`, program]);
  add(
    `<< /Type /FontDescriptor /FontName /Sarabun-Bold /Flags 32 /FontBBox [-500 -300 1500 1100] /ItalicAngle 0 ` +
      `/Ascent 1068 /Descent -232 /CapHeight 700 /StemV 80 /FontFile2 ${ref(objects.length)} >>`,
  );
  const widths = Array.from({ length: 95 }, (_, i) => f.width(f.glyph(32 + i))).join(" ");
  add(
    `<< /Type /Font /Subtype /TrueType /BaseFont /Sarabun-Bold /Encoding /WinAnsiEncoding ` +
      `/FirstChar 32 /LastChar 126 /Widths [${widths}] /FontDescriptor ${ref(objects.length)} >>`,
  );
  fontRefs.LS = ref(objects.length);
}

const kids: number[] = [];
for (const page of pages) {
  let y = 760;
  const content = page
    .map(([f, size, text]) => {
      const codes =
        f === "LS" ? `(${text})` : `<${[...text].map((ch) => hex4(faces[f].glyph(ch.codePointAt(0)!))).join("")}>`;
      const line = `BT /${f} ${size} Tf 72 ${y} Td ${codes} Tj ET`;
      y -= size * 1.8;
      return line;
    })
    .join("\n");
  add([`<< /Length ${Buffer.byteLength(content)} >>`, Buffer.from(content)]);
  add(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${ref(objects.length)} ` +
      `/Resources << /Font << /TH ${fontRefs.TH} /LA ${fontRefs.LA} /LS ${fontRefs.LS} >> >> >>`,
  );
  kids.push(objects.length);
}
objects[1] = `<< /Type /Pages /Kids [${kids.map(ref).join(" ")}] /Count ${kids.length} >>`;

const parts: Buffer[] = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
let at = parts[0]!.length;
const offsets = objects.map((o, i) => {
  const start = at;
  const chunk =
    typeof o === "string"
      ? Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`)
      : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o[0]}\nstream\n`), o[1], Buffer.from("\nendstream\nendobj\n")]);
  parts.push(chunk);
  at += chunk.length;
  return start;
});
parts.push(
  Buffer.from(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}` +
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`,
  ),
);
writeFileSync(out, Buffer.concat(parts));
