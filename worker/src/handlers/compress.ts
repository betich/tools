import { copyFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { repairNote, type PdfAnalysis, type RunResult } from "@tools/shared";
import { fontBytesAfter, readParams, runPipeline } from "../compress";
import { outputName, registerHandler } from "../jobs";
import { analyseFile } from "./analyse";

/**
 * A compress run (#9): the pipeline's steps (worker/src/compress) take the
 * upload through lossless passes and whatever the preset and Advanced rows
 * ask for; this measures the result, serves it — or the original, when the
 * result is no smaller — and analyses what is served, so the browser can show
 * the before/after breakdown.
 */

const OUTPUT = "compressed.pdf";

registerHandler("compress", async (ctx) => {
  const input = ctx.inputs[0];
  if (!input) throw new Error("compress needs one input");
  const params = readParams(ctx.task.params);
  const outcome = await runPipeline(ctx, input, params);

  const produced = outcome.file === input.path ? input.size : (await stat(outcome.file)).size;
  const inputAnalysis = (ctx.analysis as PdfAnalysis | null) ?? null;
  // An encrypted input the user wants saved without its password is never served as it came (#15).
  const mustRewrite = !!inputAnalysis?.flags.encrypted && !params.reencrypt && outcome.file !== input.path;
  const keptOriginal = produced >= input.size && !mustRewrite;
  const target = join(ctx.outDir, OUTPUT);
  // The work dir and the results dir can sit on different drives.
  if (keptOriginal) await copyFile(input.path, target);
  else await rename(outcome.file, target).catch(() => copyFile(outcome.file, target));

  const bytes = keptOriginal ? input.size : produced;
  const analysis =
    keptOriginal && inputAnalysis && !inputAnalysis.truncated
      ? inputAnalysis
      : await analyseFile(ctx, target, bytes, { stage: "measuring the result", password: ctx.job.password });

  const result: RunResult = {
    inputBytes: input.size,
    bytes,
    keptOriginal,
    analysis,
    skipped: outcome.skipped,
    // Served the original: nothing was repaired or removed in what the user downloads.
    notes: keptOriginal ? [] : [...repairNotes(inputAnalysis), ...outcome.notes],
    fileName: outputName(input.name, "compressed", "pdf"),
  };
  if (inputAnalysis && !inputAnalysis.truncated && !analysis.truncated) {
    result.fontBytes = keptOriginal
      ? Object.fromEntries(inputAnalysis.fonts.filter((f) => f.embedded).map((f) => [f.id, f.bytes]))
      : fontBytesAfter(inputAnalysis.fonts, analysis.fonts);
  }
  return { result, file: { name: OUTPUT, downloadName: result.fileName } };
});

/** The analysis found broken objects; the rewrite carries the repair into the output. The only repair note a run gets. */
function repairNotes(analysis: PdfAnalysis | null): string[] {
  const note = repairNote(analysis?.flags.repaired ?? 0);
  return note ? [note] : [];
}
