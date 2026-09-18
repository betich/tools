export type OutputFormat = "webp" | "avif" | "jpeg" | "png";

export type EncodeOptions = {
  format: OutputFormat;
  /** 0–100 for lossy formats; ignored by png. */
  quality: number;
  /** oxipng optimisation level, 0–6. */
  effort: number;
  /** Longest-edge cap in pixels, or 0 to keep the original size. */
  maxEdge: number;
};

export const defaultOptions: EncodeOptions = { format: "webp", quality: 75, effort: 2, maxEdge: 0 };

export type FormatMeta = {
  value: OutputFormat;
  label: string;
  lossy: boolean;
  /** Whether the effort dial does anything for this codec. */
  effortful: boolean;
  effortHint: string;
  mime: string;
  ext: string;
};

export const formats: FormatMeta[] = [
  { value: "webp", label: "webp", lossy: true, effortful: true, effortHint: "encoder method — slower, smaller", mime: "image/webp", ext: "webp" },
  { value: "avif", label: "avif", lossy: true, effortful: true, effortHint: "slower encode, smaller file", mime: "image/avif", ext: "avif" },
  { value: "jpeg", label: "jpeg", lossy: true, effortful: false, effortHint: "mozjpeg has no effort dial", mime: "image/jpeg", ext: "jpg" },
  { value: "png", label: "png", lossy: false, effortful: true, effortHint: "oxipng optimisation level", mime: "image/png", ext: "png" },
];

export const formatMeta = (f: OutputFormat) => formats.find((x) => x.value === f)!;

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

export type WorkerRequest = { id: string; buffer: ArrayBuffer; type: string; options: EncodeOptions };

export type WorkerResponse =
  | { id: string; ok: true; buffer: ArrayBuffer; mime: string; width: number; height: number; elapsedMs: number }
  | { id: string; ok: false; error: string };
