import type { EncodeOptions } from "@/lib/codecs";

export { formats, formatMeta, type EncodeOptions, type FormatMeta, type OutputFormat } from "@/lib/codecs";

export const defaultOptions: EncodeOptions = { format: "webp", quality: 75, effort: 2, maxEdge: 0 };

export type JobStatus = "queued" | "working" | "done" | "error";

export type Job = {
  id: string;
  file: File;
  status: JobStatus;
  /** Source dimensions, filled in once decoded. */
  width: number;
  height: number;
  outWidth: number;
  outHeight: number;
  outBlob: Blob | null;
  outSize: number;
  elapsedMs: number;
  error: string | null;
};
