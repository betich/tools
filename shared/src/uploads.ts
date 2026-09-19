/** Chunked, resumable uploads for the PDF tools (see #5). Parts fit under Cloudflare's 100 MB request cap. */
export const UPLOAD_PART_BYTES = 32 * 1024 * 1024;
export const UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;

export type UploadKind = "pdf" | "jpeg" | "png" | "webp" | "avif" | "gif" | "heic" | "tiff";

/** POST /api/pdf/uploads body. */
export type UploadStart = { name: string; size: number; type: string };
/** POST /api/pdf/uploads → 200. `parts` = ceil(size / partSize). */
export type UploadSession = { id: string; partSize: number; parts: number };
/** GET /api/pdf/uploads/:id → 200. `received` = 0-based part indexes already on disk. */
export type UploadStatus = UploadSession & { received: number[]; complete: boolean };
/** POST /api/pdf/uploads/:id/complete → 200. Also returned by GET once complete. */
export type UploadedFile = { id: string; name: string; size: number; kind: UploadKind };
