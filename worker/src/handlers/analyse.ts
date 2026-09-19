import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PdfAnalysis, PdfFont, PdfImage, SizeCategory } from "@tools/shared";
import { registerHandler, TaskError, type TaskContext } from "../jobs";
import { ANALYSIS_MAX_BYTES_READ, ANALYSIS_MAX_OBJECTS, ANALYSIS_MAX_PAGES, ANALYSIS_TIMEOUT_MS } from "../limits";

/**
 * The compress workbench's first view: where a PDF's bytes go (images, fonts,
 * content, metadata, other) and which images and fonts it carries. The walk is
 * `worker/scripts/analyse.js` under `mutool run` — its header explains how
 * bytes are attributed and how effective DPI is measured. This side runs it,
 * relays its progress file, and hands the result on in the contract's shape.
 */

const SCRIPT = join(import.meta.dir, "../../scripts/analyse.js");
/** The script stops walking at this share of the deadline and reports what it has, marked truncated. */
const SOFT_DEADLINE = 0.75;
const POLL_MS = 250;

const CATEGORIES: SizeCategory[] = ["images", "fonts", "content", "metadata", "other"];

/** What the script writes: the contract's fields plus a couple of its own. */
type ScriptOutput = PdfAnalysis & { error?: string; message?: string; locked?: boolean };

registerHandler("analyse", async (ctx) => {
  const input = ctx.inputs[0];
  if (!input) throw new Error("analyse needs one input");
  return { result: await analyseFile(ctx, input.path, input.size) };
});

let runs = 0;

/**
 * Analyses one PDF on disk. Also measures a compress run's output (#9), where
 * `stage` replaces the script's own stage names so the browser sees one step.
 */
export async function analyseFile(
  { workDir, progress, run }: Pick<TaskContext, "workDir" | "progress" | "run">,
  path: string,
  size: number,
  opts: { stage?: string } = {},
): Promise<PdfAnalysis> {
  const n = ++runs;
  const out = join(workDir, `analysis-${n}.json`);
  const progressFile = join(workDir, `analysis-${n}.progress`);
  const deadline = Date.now() + ANALYSIS_TIMEOUT_MS * SOFT_DEADLINE;

  progress(opts.stage ?? "opening", 0, 0);
  const poll = setInterval(async () => {
    const line = await readFile(progressFile, "utf8").catch(() => "");
    const [stage, done, total] = line.trim().split("\t");
    if (stage && total) progress(opts.stage ?? stage, Number(done), Number(total));
  }, POLL_MS);

  try {
    await run(
      "mutool",
      [
        "run",
        SCRIPT,
        path,
        out,
        progressFile,
        String(size),
        String(ANALYSIS_MAX_PAGES),
        String(ANALYSIS_MAX_BYTES_READ),
        String(ANALYSIS_MAX_OBJECTS),
        String(deadline),
      ],
      { timeoutMs: ANALYSIS_TIMEOUT_MS, label: "The analysis", where: "while reading the file" },
    );
  } finally {
    clearInterval(poll);
  }

  let raw: ScriptOutput;
  try {
    raw = JSON.parse(await readFile(out, "utf8"));
  } catch {
    throw new TaskError("The analysis could not read this file.");
  }
  if (raw.error) throw new TaskError("This file could not be opened as a PDF.");
  return shape(raw, size);
}

/**
 * Only the contract's fields, so the stored result stays the shape the client
 * checks. The attributed bytes are estimates for dictionaries (serialised
 * size), so "other" gives way if the parts ever add up past the file.
 */
function shape(raw: ScriptOutput, size: number): PdfAnalysis {
  const breakdown = Object.fromEntries(CATEGORIES.map((c) => [c, Math.max(0, raw.breakdown?.[c] ?? 0)])) as Record<
    SizeCategory,
    number
  >;
  const over = CATEGORIES.reduce((n, c) => n + breakdown[c], 0) - size;
  if (over > 0) breakdown.other = Math.max(0, breakdown.other - over);

  const images: PdfImage[] = (raw.images ?? []).map((i) => ({
    id: i.id,
    pages: i.pages,
    width: i.width,
    height: i.height,
    dpi: i.dpi,
    colorSpace: i.colorSpace,
    bitsPerComponent: i.bitsPerComponent,
    filter: i.filter,
    alpha: i.alpha,
    bytes: i.bytes,
  }));
  const fonts: PdfFont[] = (raw.fonts ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    embedded: f.embedded,
    subset: f.subset,
    bytes: f.bytes,
  }));
  const flags: Partial<PdfAnalysis["flags"]> = raw.flags ?? {};
  return {
    bytes: size,
    pages: raw.pages ?? 0,
    version: raw.version ?? "",
    breakdown,
    images,
    fonts,
    flags: {
      encrypted: !!flags.encrypted,
      signed: flags.signed ?? null,
      pdfa: flags.pdfa ?? null,
      tagged: !!flags.tagged,
      repaired: flags.repaired ?? 0,
    },
    truncated: !!raw.truncated,
  };
}
