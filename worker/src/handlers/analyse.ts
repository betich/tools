import type { PdfAnalysis } from "@tools/shared";
import { registerHandler } from "../jobs";
import { ANALYSIS_MAX_BYTES_READ, ANALYSIS_MAX_PAGES } from "../limits";

/**
 * Placeholder analysis until #8's `mutool run` walk lands: it only counts
 * page objects and reports the byte size, so the queue, progress and result
 * path can be exercised end to end without the toolchain. Pages in compressed
 * object streams are not seen — #8 replaces this whole file.
 */

const PAGE = /\/Type\s*\/Page(?![A-Za-z])/g;

registerHandler("analyse", async ({ inputs, progress }) => {
  const input = inputs[0];
  if (!input) throw new Error("analyse needs one input");
  const file = Bun.file(input.path);
  const total = Math.min(file.size, ANALYSIS_MAX_BYTES_READ);
  let pages = 0;
  let read = 0;
  let carry = "";
  let version = "";
  const reader = file.slice(0, total).stream().getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    // latin1 keeps one char per byte, so a match can be counted exactly once across chunk edges.
    const text = carry + Buffer.from(next.value).toString("latin1");
    if (!version) version = /%PDF-(\d\.\d)/.exec(text)?.[1] ?? "";
    const tail = Math.max(0, text.length - 16);
    for (const m of text.matchAll(PAGE)) if (m.index < tail) pages++;
    carry = text.slice(tail);
    read += next.value.byteLength;
    progress("reading", read, total);
    if (pages >= ANALYSIS_MAX_PAGES) break;
  }
  // The last carry has not been counted.
  pages += carry.match(PAGE)?.length ?? 0;
  await reader.cancel().catch(() => {});

  const analysis: PdfAnalysis = {
    bytes: file.size,
    pages: Math.min(pages, ANALYSIS_MAX_PAGES),
    version,
    breakdown: { images: 0, fonts: 0, content: 0, metadata: 0, other: file.size },
    images: [],
    fonts: [],
    flags: { encrypted: false, signed: null, pdfa: null, tagged: false, repaired: 0 },
    truncated: total < file.size || pages >= ANALYSIS_MAX_PAGES,
  };
  return { result: analysis };
});
