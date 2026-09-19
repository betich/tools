import type { CodecId, EngineId, PassId, PresetId } from "./pdfcaps";
import { DEFAULT_CODEC, DEFAULT_ENGINE, DEFAULT_PRESET, PRESETS } from "./pdfcaps";
import type { PdfAnalysis } from "./pdfjobs";

/** Per-image override keyed by PdfImage.id (#10). */
export type ImageOverride = { codec?: CodecId; quality?: number; dpiCap?: number | null; skip?: boolean };

/** Target-size search (#12). */
export type TargetSize = { bytes: number; timeBudgetMs: number; qualityFloor: number; dpiFloor: number };

/** TaskCreate.params for kind "compress". */
export type CompressParams = {
  engine: EngineId;                 // #13; DEFAULT_ENGINE until then
  preset: PresetId;
  dpiCap: number | null;            // preset's unless the user edits it
  quality: number;                  // 1–100
  codec: CodecId;                   // mozjpeg default; openjpeg opt-in (#10); libjxl experimental (#14)
  stripMetadata: boolean;
  advanced: PassId[];               // "remove-extras" | "flatten" | "grayscale"
  overrides: Record<string, ImageOverride>;
  target: TargetSize | null;        // #12
  password?: string;                // #15 encrypted input
  reencrypt?: boolean;              // #15
  acceptSignatureLoss?: boolean;    // #15 signed input
};

/** TaskInfo.result for kind "compress" (and "merge", #17, minus `skipped` semantics). */
export type RunResult = {
  inputBytes: number;
  bytes: number;
  /** The output would have grown, so the original is served instead. */
  keptOriginal: boolean;
  /** Analysis of the output, for the before/after breakdown. */
  analysis: PdfAnalysis;
  skipped: { pass: PassId; reason: string }[];
  /** Sentences shown as-is: "Repaired 3 broken objects", "reached 12.4 MB of 10 MB — non-image data is 9.8 MB of that". */
  notes: string[];
  fileName: string;
  /** #12 */
  target?: { reached: boolean; bytes: number };
};

/** TaskCreate.params for kind "crop" (#10): a zoomed before/after of one image under the given settings. */
export type CropParams = { imageId: string; params: CompressParams; /** crop box in image pixels, null = centre */ box: [number, number, number, number] | null };
/** TaskInfo.result for "crop": artefact names for GET /api/pdf/jobs/:id/tasks/:taskId/file/:name. */
export type CropResult = { before: string; after: string; afterBytes: number };

/** A compress run's settings with everything taken from the preset: default engine and codec, no opt-ins. */
export function defaultCompressParams(preset: PresetId = DEFAULT_PRESET): CompressParams {
  const p = PRESETS[preset];
  return {
    engine: DEFAULT_ENGINE,
    preset,
    dpiCap: p.dpiCap,
    quality: p.quality,
    codec: DEFAULT_CODEC,
    stripMetadata: p.stripMetadata,
    advanced: [],
    overrides: {},
    target: null,
  };
}
