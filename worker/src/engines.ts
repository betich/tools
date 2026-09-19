import { stat } from "node:fs/promises";
import { join } from "node:path";
import { TaskError, type TaskContext } from "./jobs";
import { registerMergeJoin } from "./mergeEngines";

/**
 * Engine plumbing shared by Compress and Merge (#13): running pdf-lib, and
 * Merge's join for Ghostscript and pdf-lib (MuPDF and qpdf join with qpdf,
 * see ./mergeEngines.ts).
 */

const PDFLIB_SCRIPT = join(import.meta.dir, "..", "scripts", "pdflib.ts");

/**
 * pdf-lib holds the whole file and every parsed object in memory — several
 * times the file's size — so it only takes files up to this. It runs in Bun,
 * whose runtime reserves gigabytes of address space up front and does not
 * start under a `prlimit --as` cap of the usual size; this byte limit is its
 * memory guard instead.
 */
export const PDFLIB_MAX_BYTES = 150 * 1024 * 1024;
const PDFLIB_ADDRESS_SPACE = 64 * 1024 ** 3;

/** Why pdf-lib won't take this many bytes, or null. `size` completes the sentence: "this one is", "these add up to". */
export function tooBigForPdfLib(bytes: number, size = "this one is"): string | null {
  if (bytes <= PDFLIB_MAX_BYTES) return null;
  const mb = (n: number) => `${Math.round(n / 1024 ** 2)} MB`;
  return `pdf-lib reads the whole file into memory, so it takes files up to ${mb(PDFLIB_MAX_BYTES)} — ${size} ${mb(bytes)}.`;
}

export async function runPdfLib(ctx: TaskContext, args: string[], where: string) {
  return ctx.run(process.execPath, [PDFLIB_SCRIPT, ...args], {
    label: "pdf-lib",
    where,
    memoryBytes: PDFLIB_ADDRESS_SPACE,
  });
}

/**
 * Merge's join (#18's `registerMergeJoin`) for the engines that don't join
 * with qpdf. What survives each is the engine's `tools.merge` note in the
 * capability table; outlines are rebuilt afterwards from the sources by
 * scripts/merge-finish.js whatever the engine.
 *
 *   ghostscript   pdfwrite re-distills every page, losslessly here: JPEGs pass
 *                 through, other images are Flate, nothing is downsampled.
 *                 Links survive; form fields and tagged structure do not.
 *   pdf-lib       copyPages into a new document: pages and what they
 *                 reference; form fields (the AcroForm) are dropped.
 */
const where = "while joining the files";
const hint = "Try merging fewer files at once.";

export async function ghostscriptJoin(ctx: TaskContext, parts: string[], out: string): Promise<void> {
  await ctx.run(
    "gs",
    [
      "-q",
      "-dSAFER",
      "-dBATCH",
      "-dNOPAUSE",
      "-sDEVICE=pdfwrite",
      `-sOutputFile=${out}`,
      "-dCompatibilityLevel=1.7",
      "-dAutoRotatePages=/None",
      "-dDetectDuplicateImages=true",
      "-dPassThroughJPEGImages=true",
      "-dPassThroughJPXImages=true",
      ...["Color", "Gray", "Mono"].map((k) => `-dDownsample${k}Images=false`),
      ...["Color", "Gray"].flatMap((k) => [`-dAutoFilter${k}Images=false`, `-d${k}ImageFilter=/FlateEncode`]),
      ...parts,
    ],
    { label: "Ghostscript", where, hint },
  );
}

export async function pdfLibJoin(ctx: TaskContext, parts: string[], out: string): Promise<void> {
  let total = 0;
  for (const p of parts) total += (await stat(p)).size;
  const big = tooBigForPdfLib(total, "these add up to");
  if (big) throw new TaskError(`${big} Pick MuPDF or qpdf for this merge.`);
  await runPdfLib(ctx, ["join", out, ...parts], where);
}

registerMergeJoin("ghostscript", ghostscriptJoin);
registerMergeJoin("pdf-lib", pdfLibJoin);
