import { stat } from "node:fs/promises";
import { join } from "node:path";
import { ENGINES, type EngineId } from "@tools/shared";
import { TaskError, type TaskContext } from "./jobs";

/**
 * Engine plumbing shared by Compress and Merge (#13): running pdf-lib, and
 * joining PDFs with the engine the user picked.
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
 * Joins whole PDFs, in order, into `out` with the given engine — Merge's join
 * step (#18 wires `MergeParams.engine` to it). Page order and count are kept;
 * what else survives is the engine's `tools.merge` note in the capability
 * table:
 *
 *   mupdf, qpdf   qpdf `--empty --pages`: reads each source lazily and writes as
 *                 it goes, keeping annotations and form fields. MuPDF's own graft
 *                 would hold every stream of every input in memory until the
 *                 save, so the MuPDF engine joins with qpdf too (#17's pipeline:
 *                 MuPDF places images and writes bookmarks around this join).
 *   ghostscript   pdfwrite re-distills every page, losslessly here (JPEGs pass
 *                 through, other images Flate, no downsampling). Links survive;
 *                 form fields and tagged structure do not.
 *   pdf-lib       copyPages into a new document: pages and what they reference;
 *                 form fields (the AcroForm) are dropped.
 *
 * Outlines are dropped by every engine — Merge rebuilds them afterwards from
 * the sources (scripts/merge-finish.js).
 */
export async function joinPdfs(ctx: TaskContext, engine: EngineId, parts: string[], out: string): Promise<void> {
  const where = "while joining the files";
  const hint = "Try merging fewer files at once.";
  switch (engine) {
    case "mupdf":
    case "qpdf":
      await ctx.run("qpdf", ["--warning-exit-0", "--empty", "--pages", ...parts, "--", out], { label: "qpdf", where, hint });
      return;
    case "ghostscript":
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
          ...["Color", "Gray", "Mono"].flatMap((k) => [`-dDownsample${k}Images=false`]),
          ...["Color", "Gray"].flatMap((k) => [`-dAutoFilter${k}Images=false`, `-d${k}ImageFilter=/FlateEncode`]),
          ...parts,
        ],
        { label: "Ghostscript", where, hint },
      );
      return;
    case "pdf-lib": {
      let total = 0;
      for (const p of parts) total += (await stat(p)).size;
      const big = tooBigForPdfLib(total, "these add up to");
      if (big) throw new TaskError(`${big} Pick MuPDF or qpdf for this merge.`);
      await runPdfLib(ctx, ["join", out, ...parts], where);
      return;
    }
    default:
      throw new TaskError(`${ENGINES[engine as EngineId]?.label ?? "That engine"} can't merge files.`);
  }
}
