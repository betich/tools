import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PdfFont } from "@tools/shared";
import { TaskError } from "../jobs";
import { registerStep } from "./pipeline";

/**
 * Font subsetting (#11): every embedded TrueType font program is cut
 * down to the glyphs the pages actually use, by MuPDF (`mutool clean -S`, the
 * only way in 1.25). Lossless: the glyphs that are drawn are the same bytes,
 * and the ToUnicode CMaps — what copy, search and screen readers use — are
 * left as they are. Biggest on Thai and CJK documents that embed whole fonts.
 *
 * TrueType programs only (simple and CIDFontType2 — what Thai and most office
 * documents embed); MuPDF 1.25's CFF subsetter garbles CID-keyed CFF that was
 * already subset. scripts/fonts.js hides from MuPDF every other program, and
 * the ones also used where its glyph count doesn't look (form fields,
 * patterns, soft masks, Type 3 glyphs), and puts them back after.
 * Fonts kept whole that way are named in a note. A failure here never fails
 * the run: the file goes on as it was.
 */

const SCRIPT = join(import.meta.dir, "../../scripts/fonts.js");

type Reason = "form" | "annotation" | "pattern" | "mask" | "type3" | "gstate" | "type1" | "cff" | "other";
type Plan = { candidates: number; hidden: unknown[]; kept: { name: string; reason: Reason }[] };
type Report = { subset: number; before: number; after: number };

const WHY: Record<Reason, string> = {
  form: "used by form fields, which need every character a user might type",
  annotation: "used by an annotation's other appearances",
  pattern: "used inside a pattern",
  mask: "used inside a soft mask",
  type3: "used inside a Type 3 font",
  gstate: "set by a graphics state",
  type1: "a Type 1 font, which MuPDF can't subset",
  cff: "a CFF font, which MuPDF can't subset reliably",
  other: "an unusual font MuPDF can't subset",
};

registerStep({
  id: "mupdf-subset-fonts",
  phase: "fonts",
  stage: "subsetting fonts",
  engines: ["mupdf"],
  passes: ["subset-fonts"],
  async run(run) {
    const { ctx } = run;
    const plan = run.scratch("fonts-plan.json");
    const hidden = run.scratch("fonts-hidden.pdf");
    const subset = run.scratch("fonts-subset.pdf");
    const out = run.scratch("fonts.pdf");
    const report = run.scratch("fonts-report.json");
    const mupdf = (args: string[]) => ctx.run("mutool", args, { label: "MuPDF", where: "while subsetting the fonts" });

    try {
      await mupdf(["run", SCRIPT, "prepare", run.current, hidden, plan]);
      const p: Plan = JSON.parse(await readFile(plan, "utf8"));
      const kept = keptSentence(p.kept);
      if (p.candidates === 0) {
        // Every whole font is one we can't subset: say why in place of doing it.
        if (kept) run.skip("subset-fonts", kept);
        return;
      }
      if (kept) run.note(kept);
      // The output name must contain ".pdf", or clean takes it for a page range.
      await mupdf(["clean", "-S", p.hidden.length ? hidden : run.current, subset]);
      await mupdf(["run", SCRIPT, "finish", subset, out, plan, report]);
    } catch (err) {
      // A font MuPDF chokes on, or a file it can't rewrite: go on without subsetting. A discard still ends the run.
      if (ctx.signal.aborted || !(err instanceof TaskError)) throw err;
      run.skip("subset-fonts", "MuPDF couldn't subset the fonts in this file — they were left as they are.");
      return;
    }
    const r: Report = JSON.parse(await readFile(report, "utf8"));
    if (r.subset > 0) await run.adopt(out, { ifSmaller: true });
  },
});

/** "Kept 2 fonts whole: Arial (used inside a pattern) and Sarabun (used by form fields, …)." */
export function keptSentence(kept: { name: string; reason: Reason }[]): string | null {
  if (!kept.length) return null;
  const parts = kept.map((k) => `${k.name} (${WHY[k.reason] ?? "not safe to subset"})`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Kept ${kept.length === 1 ? "1 font" : `${kept.length} fonts`} whole: ${list}.`;
}

/**
 * Each input font's bytes in the output, keyed by the input's font id, for the
 * before → after column. Output fonts are renumbered by the structure pass, so
 * they are matched by name, type and whether they are embedded. A font that
 * shares all three with another gets a size only when every output font like
 * it weighs the same — otherwise which is which can't be told, and the column
 * shows nothing rather than a guess.
 */
export function fontBytesAfter(before: PdfFont[], after: PdfFont[]): Record<string, number> {
  const key = (f: PdfFont) => `${f.name}\u0000${f.type}\u0000${f.embedded}`;
  const groups = new Map<string, PdfFont[]>();
  for (const f of after) groups.set(key(f), [...(groups.get(key(f)) ?? []), f]);
  const seen = new Map<string, PdfFont[]>();
  for (const f of before) seen.set(key(f), [...(seen.get(key(f)) ?? []), f]);

  const out: Record<string, number> = {};
  for (const [k, inputs] of seen) {
    if (!inputs[0]!.embedded) continue; // weighs nothing before or after
    const outputs = groups.get(k);
    if (!outputs) continue;
    if (outputs.every((o) => o.bytes === outputs[0]!.bytes)) for (const f of inputs) out[f.id] = outputs[0]!.bytes;
  }
  return out;
}
