import type { EncodeOptions, OutputFormat } from "@/lib/codecs/formats";

/**
 * One settings panel for the whole batch, and a per-file override on top.
 *
 * An override holds only the fields a person changed on that file; every
 * other field follows the batch, so moving the batch quality still moves every
 * file that never set its own. Resetting a field puts it back on the batch.
 */

export type BatchSettings = {
  format: OutputFormat;
  /** 1–100; lossless formats ignore it. */
  quality: number;
  /** Longest-edge cap in pixels, 0 to keep the original size. */
  maxEdge: number;
  /** Copy the source's EXIF (camera, lens, date) into formats that can carry it. */
  keepExif: boolean;
  /** Also keep the GPS directory. Off unless asked for. */
  keepLocation: boolean;
};

export type OverrideField = "format" | "quality" | "maxEdge";
export type FileOverride = Partial<Pick<BatchSettings, OverrideField>>;

export const defaultBatch: BatchSettings = {
  format: "webp",
  quality: 80,
  maxEdge: 0,
  keepExif: true,
  keepLocation: false,
};

/**
 * A fixed middle effort. A batch of forty phone photos wants throughput more
 * than the last few percent, so effort isn't a dial here the way it is in
 * squoosh: webp method 3, avif speed 7, oxipng level 3, jxl effort 5.
 */
export const BATCH_EFFORT = 3;

/** Everything the codec needs for one file: the batch, with that file's own changes on top. */
export function resolveOptions(batch: BatchSettings, override: FileOverride | undefined): EncodeOptions {
  const merged = { ...batch, ...override };
  return {
    format: merged.format,
    quality: clampInt(merged.quality, 1, 100),
    effort: BATCH_EFFORT,
    maxEdge: Math.max(0, Math.round(merged.maxEdge)),
    metadata: !batch.keepExif ? "none" : batch.keepLocation ? "all" : "no-location",
  };
}

/** A stable identity for a resolved set of options — a result is fresh when its key matches. */
export function optionsKey(o: EncodeOptions): string {
  return [o.format, o.quality, o.effort, o.maxEdge, o.metadata ?? "none"].join("|");
}

/** Sets one field of an override. `undefined` clears it; an empty override becomes `undefined`. */
export function setOverride<K extends OverrideField>(
  override: FileOverride | undefined,
  field: K,
  value: BatchSettings[K] | undefined,
): FileOverride | undefined {
  const next: FileOverride = { ...override };
  if (value === undefined) delete next[field];
  else next[field] = value;
  return Object.keys(next).length > 0 ? next : undefined;
}

export function overriddenFields(override: FileOverride | undefined): OverrideField[] {
  return override ? (Object.keys(override) as OverrideField[]).filter((k) => override[k] !== undefined) : [];
}

function clampInt(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
