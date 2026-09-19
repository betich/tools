import type { PdfTool } from "./pdfcaps";
import type { UploadedFile } from "./uploads";

export type TaskKind = "analyse" | "compress" | "merge" | "crop" | "thumbnail";
export type TaskState = "queued" | "running" | "done" | "failed";

export const JOB_TTL_MS = 60 * 60 * 1000;
export const MAX_QUEUED_TASKS = 3;

/** POST /api/pdf/jobs. Compress: exactly one PDF upload, and an `analyse` task is enqueued at once. */
export type JobCreate = { tool: PdfTool; uploads: string[] };

export type TaskProgress = { stage: string; done: number; total: number; note?: string };

export type TaskInfo = {
  id: string;
  kind: TaskKind;
  state: TaskState;
  /** Tasks ahead of this one in the global queue (0 when running/finished). */
  ahead: number;
  progress: TaskProgress | null;
  /** Kind-specific result JSON (e.g. RunResult for compress/merge). */
  result: unknown;
  /** A sentence shown as-is, e.g. "Ran out of memory on page 214 (image 18000×24000). Try a lower DPI cap." */
  error: string | null;
  createdAt: number;
};

/** GET /api/pdf/jobs/:id and the body of POST /api/pdf/jobs. */
export type JobInfo = {
  id: string;
  tool: PdfTool;
  inputs: UploadedFile[];
  /** The analysis task's result once done (PdfAnalysis, #8). */
  analysis: unknown | null;
  tasks: TaskInfo[];
  expiresAt: number;
};

/** POST /api/pdf/jobs/:id/tasks → TaskInfo. */
export type TaskCreate = { kind: Exclude<TaskKind, "analyse">; params: unknown };

/** GET /api/pdf/jobs/:id/events — SSE, `event: <type>`, `data: <JSON>`. One `job` snapshot on connect, then deltas. */
export type JobEvent =
  | { type: "job"; job: JobInfo }
  | { type: "task"; task: TaskInfo }
  | { type: "expired" };

export type SizeCategory = "images" | "fonts" | "content" | "metadata" | "other";

export type PdfImage = {
  /** Object number as a string — stable key for per-image overrides (#10). */
  id: string;
  pages: number[];            // 1-based
  width: number;
  height: number;
  /** Highest effective DPI over its placements (null if never drawn). */
  dpi: number | null;
  colorSpace: string;         // "DeviceRGB", "DeviceGray", "ICCBased(3)", "Indexed", ...
  bitsPerComponent: number;
  filter: string;             // "DCTDecode", "FlateDecode", "JPXDecode", "JBIG2Decode", "CCITTFaxDecode", "none"
  alpha: boolean;             // has SMask
  bytes: number;
};

export type PdfFont = {
  id: string;
  name: string;               // BaseFont without the subset tag
  type: string;               // "TrueType", "Type0/CIDFontType2", "Type1", ...
  embedded: boolean;
  subset: boolean;
  bytes: number;
};

export type PdfAnalysis = {
  bytes: number;
  pages: number;
  version: string;
  breakdown: Record<SizeCategory, number>;
  images: PdfImage[];
  fonts: PdfFont[];
  /** Filled in by #15; defaults false/null/0 until then. */
  flags: { encrypted: boolean; signed: string[] | null; pdfa: string | null; tagged: boolean; repaired: number };
  /** True when the analysis caps (pages/bytes read) stopped the walk early. */
  truncated: boolean;
  /** Encrypted with a user password we don't have yet: inventories are empty until `unlock` succeeds. */
  locked?: boolean;
};
