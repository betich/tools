import { copyFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PdfAnalysis, RunResult } from "@tools/shared";
import { readParams, runPipeline } from "../compress";
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
  const keptOriginal = produced >= input.size;
  const target = join(ctx.outDir, OUTPUT);
  // The work dir and the results dir can sit on different drives.
  if (keptOriginal) await copyFile(input.path, target);
  else await rename(outcome.file, target).catch(() => copyFile(outcome.file, target));

  const bytes = keptOriginal ? input.size : produced;
  const inputAnalysis = (ctx.analysis as PdfAnalysis | null) ?? null;
  const analysis =
    keptOriginal && inputAnalysis && !inputAnalysis.truncated
      ? inputAnalysis
      : await analyseFile(ctx, target, bytes, { stage: "measuring the result" });

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
  return { result, file: { name: OUTPUT, downloadName: result.fileName } };
});

/** The analysis found a broken xref; the rewrite carries the repair into the output. */
function repairNotes(analysis: PdfAnalysis | null): string[] {
  const n = analysis?.flags.repaired ?? 0;
  return n > 0 ? [`Repaired ${n} broken ${n === 1 ? "object" : "objects"}.`] : [];
}
