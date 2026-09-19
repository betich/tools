import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  CODEC_IDS,
  DEFAULT_PRESET,
  defaultCompressParams,
  ENGINE_IDS,
  ENGINES,
  PASSES,
  PRESET_IDS,
  passInfo,
  planPasses,
  requestedPasses,
  type CompressParams,
  type EngineId,
  type PassId,
  type PdfAnalysis,
} from "@tools/shared";
import { TaskError, type TaskContext, type TaskInput } from "../jobs";

/**
 * A compress run is a list of steps over one file. Each step reads
 * `run.current`, writes a new file in the work dir and adopts it; the handler
 * (handlers/compress.ts) measures what is left at the end and serves it, or the
 * original if nothing got smaller.
 *
 * Steps plug in with `registerStep` and run in phase order, then in the order
 * they were registered:
 *
 *   prepare    #15 refuse signed files, decrypt (keep object numbers — no garbage
 *              collection); every later step reads an unencrypted `current`
 *   images     #9 lossless JPEG repack · #10 downsample / re-encode · #12 target search
 *   fonts      #11 subsetting
 *   edit       #9 flatten (qpdf) · grayscale
 *   structure  the engine's own pass: #9 MuPDF · #13 qpdf / Ghostscript / pdf-lib
 *   finish     #9 the final qpdf pass
 *   seal       #15 re-encrypt, restore required XMP
 *
 * `images` and `fonts` come first because they address objects by the input's
 * object numbers (PdfImage.id, PdfFont.id); anything that renumbers (qpdf,
 * MuPDF garbage collection) comes after.
 *
 * Which passes run comes from the shared capability table: `planPasses(engine,
 * requestedPasses(preset, advanced))`, with the user's own metadata and DPI
 * choices applied. A step names the passes it performs and runs when any of
 * them is wanted (a step with no passes — a hook — always runs); afterwards
 * those passes count as done unless the step called `run.skip`. A wanted pass
 * no step performed is reported as skipped, with a reason, at the end.
 */

export type Phase = "prepare" | "images" | "fonts" | "edit" | "structure" | "finish" | "seal";
export const PHASES: readonly Phase[] = ["prepare", "images", "fonts", "edit", "structure", "finish", "seal"];

export type CompressRun = {
  ctx: TaskContext;
  params: CompressParams;
  input: TaskInput;
  /** The job's analysis of the input (#8), when it finished. */
  analysis: PdfAnalysis | null;
  /** The file the next step reads. Starts as the upload itself — never write to it. */
  current: string;
  /** Keep the catalog's XMP even when stripping metadata — PDF/A requires it (#15 sets it). */
  keepXmp: boolean;
  /** Whether this run still performs the pass. */
  wants(pass: PassId): boolean;
  /** Drops a pass from this run and reports why, as a sentence. */
  skip(pass: PassId, reason: string): void;
  /** A sentence for RunResult.notes. */
  note(sentence: string): void;
  /** A fresh path in the work dir: `<n>-<name>`. */
  scratch(name: string): string;
  /**
   * Makes `file` the current file. With `ifSmaller`, only when it is smaller
   * than the current one — for lossless steps, which must never make a file
   * bigger. Returns whether it was adopted.
   */
  adopt(file: string, opts?: { ifSmaller?: boolean }): Promise<boolean>;
};

export type Step = {
  id: string;
  phase: Phase;
  /** The progress stage shown while it runs, e.g. "repacking JPEG images". */
  stage: string;
  /** Engines it runs for; omitted = every engine. */
  engines?: readonly EngineId[];
  /** Passes it performs; it runs when any is wanted. Empty = a hook that always runs. */
  passes: readonly PassId[];
  /** A further condition, e.g. a hook that only concerns some inputs (#15); checked with the passes. */
  when?(run: CompressRun): boolean;
  run(run: CompressRun): Promise<void>;
};

const steps: Step[] = [];

export function registerStep(step: Step): void {
  if (steps.some((s) => s.id === step.id)) throw new Error(`compress step ${step.id} registered twice`);
  steps.push(step);
}

/** Registered steps in the order a run takes them. */
export function registeredSteps(): Step[] {
  return [...steps].sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));
}

/** Why a wanted pass was not done, when no step performed it. */
const NOT_YET: Partial<Record<PassId, string>> = {
  downsample: "Downsampling isn't available yet — images keep their resolution.",
  "reencode-images": "Re-encoding isn't available yet — images keep their encoding.",
  "subset-fonts": "Font subsetting isn't available yet.",
  grayscale: "Converting to grayscale isn't available yet.",
};

function notYet(engine: EngineId, pass: PassId): string {
  return NOT_YET[pass] ?? `This server can't ${passInfo(pass).verb} with ${ENGINES[engine].label} yet.`;
}

/** The passes a run asks for: the preset's, adjusted by the user's own choices. */
export function wantedPasses(params: CompressParams): PassId[] {
  const passes: PassId[] = requestedPasses(params.preset, params.advanced).filter((p) => p !== "strip-metadata");
  if (params.stripMetadata) passes.push("strip-metadata");
  // No DPI cap means nothing to downsample.
  return params.dpiCap === null ? passes.filter((p) => p !== "downsample") : passes;
}

/**
 * The task's params, checked. The client sends the whole CompressParams; a
 * missing field takes the preset's default and a wrong one is refused.
 */
export function readParams(raw: unknown): CompressParams {
  const bad = () => new TaskError("These compress settings aren't valid — reload the page and try again.");
  if (!raw || typeof raw !== "object") throw bad();
  const p = raw as Partial<CompressParams>;
  const preset = p.preset ?? DEFAULT_PRESET;
  if (!PRESET_IDS.includes(preset)) throw bad();
  const out: CompressParams = { ...defaultCompressParams(preset), ...p };
  const advanced = new Set(PASSES.filter((x) => x.group === "advanced").map((x) => x.id));
  if (
    !ENGINE_IDS.includes(out.engine) ||
    !CODEC_IDS.includes(out.codec) ||
    !(out.dpiCap === null || (typeof out.dpiCap === "number" && out.dpiCap > 0)) ||
    !(typeof out.quality === "number" && out.quality >= 1 && out.quality <= 100) ||
    typeof out.stripMetadata !== "boolean" ||
    !Array.isArray(out.advanced) ||
    !out.advanced.every((a) => advanced.has(a)) ||
    typeof out.overrides !== "object" ||
    out.overrides === null
  ) {
    throw bad();
  }
  return out;
}

export type PipelineOutcome = {
  /** The last adopted file — possibly still the upload, when no step changed anything. */
  file: string;
  skipped: { pass: PassId; reason: string }[];
  notes: string[];
};

/** Runs every registered step that applies to these params, in order. */
export async function runPipeline(
  ctx: TaskContext,
  input: TaskInput,
  params: CompressParams,
  /** Replaces the registered steps — for tests, and for #12 re-running a subset. */
  opts: { steps?: Step[] } = {},
): Promise<PipelineOutcome> {
  const plan = planPasses(params.engine, wantedPasses(params));
  const wanted = new Set(plan.run);
  const skipped = [...plan.skipped];
  const done = new Set<PassId>();
  const notes: string[] = [];
  let n = 0;

  const run: CompressRun = {
    ctx,
    params,
    input,
    analysis: (ctx.analysis as PdfAnalysis | null) ?? null,
    current: input.path,
    keepXmp: false,
    wants: (pass) => wanted.has(pass),
    skip(pass, reason) {
      if (!wanted.delete(pass)) return;
      done.delete(pass);
      skipped.push({ pass, reason });
    },
    note: (sentence) => void notes.push(sentence),
    scratch: (name) => join(ctx.workDir, `${++n}-${name}`),
    async adopt(file, opts = {}) {
      if (opts.ifSmaller && (await stat(file)).size >= (await stat(run.current)).size) return false;
      run.current = file;
      return true;
    },
  };

  const applies = (s: Step) =>
    (!s.engines || s.engines.includes(params.engine)) &&
    (s.passes.length === 0 || s.passes.some(run.wants)) &&
    (!s.when || s.when(run));
  const list = (opts.steps ?? registeredSteps()).filter(applies);

  for (const [i, step] of list.entries()) {
    if (ctx.signal.aborted) break;
    if (!applies(step)) continue; // an earlier step skipped everything this one does
    ctx.progress(step.stage, i, list.length);
    await step.run(run);
    for (const pass of step.passes) if (run.wants(pass)) done.add(pass);
  }

  for (const pass of plan.run) {
    if (run.wants(pass) && !done.has(pass)) skipped.push({ pass, reason: notYet(params.engine, pass) });
  }
  return { file: run.current, skipped, notes };
}
