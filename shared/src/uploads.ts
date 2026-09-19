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

/**
 * Page view (#37): per-page thumbnails of a PDF upload. The worker draws them
 * in batches of PAGE_THUMB_BATCH (page n is in batch ⌊(n−1)/B⌋), each at most
 * PAGE_THUMB_EDGE px on its long side — a grid tile is ~100 CSS px, so this is
 * sharp at 2×. The API, the worker and the client all key on these.
 */
export const PAGE_THUMB_BATCH = 24;
export const PAGE_THUMB_EDGE = 200;
/** 0-based batch holding 1-based `page`. */
export const pageThumbBatch = (page: number) => Math.floor((page - 1) / PAGE_THUMB_BATCH);
/** GET /api/pdf/uploads/:id/pages → 200. The count qpdf gives, the same one Merge uses. */
export type PdfPageCount = { pages: number };
/** The directory, inside an upload's own, that a PDF's page thumbnails land in as `<n>.png` — the worker writes there and the API serves it. */
export const PAGE_THUMB_DIR = "pages";

/**
 * What the thumbnail lane knows of a PDF's page count. `uncounted` is not
 * final: nobody has asked yet, or the count was cut short (a timeout, a
 * worker restart) and asking again may work. `locked` and `unreadable` are
 * final — the file itself is the problem.
 */
export type PageCountState =
  | { state: "uncounted" }
  | { state: "counted"; pages: number }
  | { state: "locked" }
  | { state: "unreadable" };

/*
 * How it is kept in `pdf_thumbnails.pages` (worker and API, db.ts): NULL
 * uncounted, n ≥ 1 counted, -1 locked, 0 unreadable. Only these two functions
 * read or write those numbers.
 */
const LOCKED = -1;
const UNREADABLE = 0;

/** The `pdf_thumbnails.pages` value for a count. */
export function storePageCount(c: PageCountState): number | null {
  switch (c.state) {
    case "counted":
      return c.pages;
    case "locked":
      return LOCKED;
    case "unreadable":
      return UNREADABLE;
    case "uncounted":
      return null;
  }
}

/** A `pdf_thumbnails.pages` value read back. Anything unexpected reads as not counted, so it is asked again. */
export function readPageCount(stored: number | null | undefined): PageCountState {
  if (stored === LOCKED) return { state: "locked" };
  if (stored === UNREADABLE) return { state: "unreadable" };
  if (typeof stored === "number" && Number.isInteger(stored) && stored >= 1) return { state: "counted", pages: stored };
  return { state: "uncounted" };
}
