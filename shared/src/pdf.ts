/**
 * A PDF writer just big enough for a merge: one page per image, each page the
 * image's own size, the image stored as the JPEG it already is (DCTDecode), so
 * nothing is re-encoded. No dependencies and no Node or DOM APIs, so the
 * browser export and the server batch write byte-identical files.
 */

export type PdfPage = {
  /** Baseline JPEG bytes — what `canvas.toBlob("image/jpeg")` and napi's `encode("jpeg")` give. */
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
};

/**
 * Pages are sized at CSS pixels (96 per inch), the same convention a browser
 * prints with, so a 1080×1350 card is a 11.25×14.06in page.
 */
const POINTS_PER_PIXEL = 72 / 96;

export function pdfFromJpegs(pages: PdfPage[], title = ""): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;

  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? latin1(part) : part;
    chunks.push(bytes);
    length += bytes.byteLength;
  };
  /** Object `n` starts here; `n` is 1-based and objects are written in order. */
  const open = (n: number) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
  };

  // 1 catalog, 2 page tree, 3 info, then three objects per page: page, content, image.
  const pageObj = (i: number) => 4 + i * 3;
  const count = 3 + pages.length * 3;

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  open(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  open(2);
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>\nendobj\n`);
  open(3);
  push(`<< /Title ${pdfString(title)} /Producer (betich's tools) >>\nendobj\n`);

  pages.forEach((page, i) => {
    const w = round(page.width * POINTS_PER_PIXEL);
    const h = round(page.height * POINTS_PER_PIXEL);
    const n = pageObj(i);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;

    open(n);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>\nendobj\n`,
    );
    open(n + 1);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    open(n + 2);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.byteLength} >>\nstream\n`,
    );
    push(page.jpeg);
    push("\nendstream\nendobj\n");
  });

  const xref = length;
  push(`xref\n0 ${count + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Everything written as text is ASCII, bar the header's four marker bytes. */
function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * A title as a PDF text string. UTF-16BE with a BOM, hex-encoded, so a Thai
 * project name survives and nothing needs escaping.
 */
function pdfString(s: string): string {
  if (!s) return "()";
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
}
