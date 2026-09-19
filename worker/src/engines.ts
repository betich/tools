import { stat } from "node:fs/promises";
import { join } from "node:path";
import { TaskError, type TaskContext } from "./jobs";
import { qpdfPagesArgs, registerMergeJoin, type MergePart } from "./mergeEngines";

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
 *
 * A part that is a page range (#39) reaches Ghostscript as a qpdf-selected
 * copy of just those pages — pdfwrite's PageList applies to every input at
 * once — and pdf-lib as a range argument it copies pages by.
 */
const where = "while joining the files";
const hint = "Try merging fewer files at once.";

/** Each ranged part as a PDF of only its pages, written by qpdf into the work dir; whole parts as they are. */
async function selectPages(ctx: TaskContext, parts: MergePart[]): Promise<string[]> {
  const paths: string[] = [];
  for (const [n, part] of parts.entries()) {
    if (!part.pages) {
      paths.push(part.path);
      continue;
    }
    const piece = join(ctx.workDir, `pages${n}.pdf`);
    await ctx.run("qpdf", ["--warning-exit-0", "--empty", "--pages", ...qpdfPagesArgs([part]), "--", piece], { label: "qpdf", where, hint });
    paths.push(piece);
  }
  return paths;
}

export async function ghostscriptJoin(ctx: TaskContext, parts: MergePart[], out: string): Promise<void> {
  const paths = await selectPages(ctx, parts);
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
      ...paths,
    ],
    { label: "Ghostscript", where, hint },
  );
}

/** pdflib.ts's `join` argument for a part: its path, or `from-to:path` for a page range. */
export const pdfLibPart = (p: MergePart) => (p.pages ? `${p.pages[0]}-${p.pages[1]}:${p.path}` : p.path);

export async function pdfLibJoin(ctx: TaskContext, parts: MergePart[], out: string): Promise<void> {
  // pdf-lib opens each file once however many ranges come from it, so that is what it holds in memory.
  let total = 0;
  for (const path of new Set(parts.map((p) => p.path))) total += (await stat(path)).size;
  const big = tooBigForPdfLib(total, "these add up to");
  if (big) throw new TaskError(`${big} Pick MuPDF or qpdf for this merge.`);
  await runPdfLib(ctx, ["join", out, ...parts.map(pdfLibPart)], where);
}

registerMergeJoin("ghostscript", ghostscriptJoin);
registerMergeJoin("pdf-lib", pdfLibJoin);
