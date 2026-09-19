import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  PAGE_THUMB_BATCH,
  PAGE_THUMB_DIR,
  PAGE_THUMB_EDGE,
  readPageCount,
  storePageCount,
  type PageCountState,
} from "@tools/shared";
import { db } from "./db";
import { env } from "./env";
import { run } from "./exec";

/**
 * The thumbnail lane (#16/#17). The merge preview shows each PDF's first page;
 * the API queues a row in `pdf_thumbnails` when one is asked for and this
 * loop draws it next to the upload, as `uploads/<id>/thumbnail.png`, which
 * the API then serves. It runs beside the task loop, not in it, so a preview
 * never waits behind someone's 900-page compress — which is why each render
 * gets a small fixed memory cap and a short deadline instead of the task
 * loop's headroom: a first page that needs more than that is not worth a
 * thumbnail, and the tile says what the file is anyway.
 *
 * Merge's page view (#37) adds two things to the same lane: the row that
 * draws page 1 also counts the pages (`pdf_thumbnails.pages`), and
 * `pdf_page_thumbs` rows ask for a batch of small page renders
 * (`uploads/<id>/pages/<n>.png`), drawn after any waiting first pages.
 */

/** Long edge in pixels. The preview tile is ~160 CSS px, so this is sharp at 2×. */
export const THUMBNAIL_EDGE = 320;
/** The name the API serves (server/src/routes/pdf-uploads.ts) — keep them the same. */
export const THUMBNAIL_FILE = "thumbnail.png";
const MEMORY_BYTES = 512 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
/** A batch is up to PAGE_THUMB_BATCH small renders in one run. */
const BATCH_TIMEOUT_MS = 60_000;
/** qpdf reads only the xref and the page tree, but a 1 GB file is still a read. */
const COUNT_TIMEOUT_MS = 30_000;

/** Where the API keeps uploads, one directory each. The lane takes it as a parameter so tests can point it elsewhere. */
const UPLOADS = join(env.jobsDir, "uploads");

/**
 * Draws page 1 of `pdf` into `out`, at most THUMBNAIL_EDGE on its long side.
 * Writes a temporary file first so a reader never sees half a PNG. Returns
 * false when MuPDF could not draw it (a password, a broken file, no memory).
 */
export async function renderThumbnail(pdf: string, out: string, signal?: AbortSignal): Promise<boolean> {
  const tmp = `${out}.part.png`;
  const edge = String(THUMBNAIL_EDGE);
  const r = await run(["mutool", "draw", "-q", "-F", "png", "-c", "rgb", "-w", edge, "-h", edge, "-o", tmp, pdf, "1"], {
    memoryBytes: MEMORY_BYTES,
    timeoutMs: TIMEOUT_MS,
    env: { MALLOC_ARENA_MAX: "2" },
    signal,
  });
  if (r.code !== 0 || r.signal) {
    await rm(tmp, { force: true });
    return false;
  }
  await rename(tmp, out);
  return true;
}

/**
 * How many pages `pdf` has, by the same qpdf count Merge uses (handlers/merge.ts
 * `pdfPages`), so the page view's indices are the merge's. `locked` when it
 * needs a password and `unreadable` when qpdf reads it and gives up — both
 * final. A run that was cut short (the deadline, an abort, a kill) proves
 * nothing about the file, so that is `uncounted`, to be asked again.
 */
export async function countPages(pdf: string, signal?: AbortSignal): Promise<PageCountState> {
  const opts = { memoryBytes: MEMORY_BYTES, timeoutMs: COUNT_TIMEOUT_MS, signal };
  const cut = (r: { signal: string | null; timedOut: boolean; aborted: boolean }) => Boolean(r.signal || r.timedOut || r.aborted);
  // 0: a password is needed; 2: not encrypted; 3: encrypted, opens without one.
  const locked = await run(["qpdf", "--requires-password", pdf], opts);
  if (cut(locked)) return { state: "uncounted" };
  if (locked.code === 0) return { state: "locked" };
  const r = await run(["qpdf", "--warning-exit-0", "--show-npages", pdf], { ...opts, stdout: true });
  if (cut(r)) return { state: "uncounted" };
  const pages = Number(r.stdout.trim());
  return r.code === 0 && Number.isInteger(pages) && pages >= 1 ? { state: "counted", pages } : { state: "unreadable" };
}

/**
 * Draws pages `from`–`to` (1-based, inclusive) of `pdf` into `dir` as
 * `<n>.png`, at most PAGE_THUMB_EDGE on the long side, in one MuPDF run — one
 * spawn and one parse for the batch instead of one per page. Each page is
 * written under a temporary name and renamed once MuPDF is done with it. When
 * MuPDF stops part way, the pages before the last one it wrote are kept (it
 * writes them in order, and that last one may be half-written). Returns
 * whether every page landed.
 */
export async function renderPages(
  pdf: string,
  dir: string,
  from: number,
  to: number,
  signal?: AbortSignal,
): Promise<boolean> {
  await mkdir(dir, { recursive: true });
  const edge = String(PAGE_THUMB_EDGE);
  const part = (n: number) => join(dir, `${n}.part.png`);
  const r = await run(
    [
      "mutool",
      "draw",
      "-q",
      "-F",
      "png",
      "-c",
      "rgb",
      "-w",
      edge,
      "-h",
      edge,
      "-o",
      join(dir, "%d.part.png"),
      pdf,
      `${from}-${to}`,
    ],
    { memoryBytes: MEMORY_BYTES, timeoutMs: BATCH_TIMEOUT_MS, env: { MALLOC_ARENA_MAX: "2" }, signal },
  );
  const finished = r.code === 0 && !r.signal;
  let last = 0;
  for (let n = from; n <= to; n++) if (existsSync(part(n))) last = n;
  let all = finished;
  for (let n = from; n <= to; n++) {
    if (existsSync(part(n)) && (finished || n < last)) await rename(part(n), join(dir, `${n}.png`));
    else {
      await rm(part(n), { force: true });
      all = false;
    }
  }
  return all;
}

/** Takes the oldest queued row of `table` and marks it running, atomically, giving back its key columns. */
function claimer<K extends string>(table: "pdf_thumbnails" | "pdf_page_thumbs", keys: readonly K[]) {
  const pick = `SELECT ${keys.join(", ")} FROM ${table} WHERE state = 'queued' ORDER BY requested_at LIMIT 1`;
  const mark = `UPDATE ${table} SET state = 'running', updated_at = ? WHERE ${keys.map((k) => `${k} = ?`).join(" AND ")}`;
  return db.transaction((): Record<K, string | number> | null => {
    const row = db.query<Record<K, string | number>, []>(pick).get();
    if (!row) return null;
    db.run(mark, [Date.now(), ...keys.map((k) => row[k])]);
    return row;
  }).immediate;
}

/** The oldest queued first page (and count). */
const claimFirst = claimer("pdf_thumbnails", ["upload_id"]);
/** The oldest queued batch of page thumbnails. */
const claimBatch = claimer("pdf_page_thumbs", ["upload_id", "batch"]);

const knownCount = (uploadId: string): PageCountState =>
  readPageCount(
    db.query<{ pages: number | null }, [string]>("SELECT pages FROM pdf_thumbnails WHERE upload_id = ?").get(uploadId)?.pages,
  );

/**
 * Counts the pages unless that is done, then draws page 1 unless it is already
 * there. A count cut short leaves the row failed with no count, which the API
 * reads as worth asking again; page 1 is not drawn until there is a count.
 */
async function drawFirst(uploads: string, uploadId: string): Promise<void> {
  const dir = join(uploads, uploadId);
  const pdf = join(dir, "file");
  const png = join(dir, THUMBNAIL_FILE);
  let ok = false;
  try {
    let count = knownCount(uploadId);
    if (count.state === "uncounted") {
      count = await countPages(pdf);
      db.run("UPDATE pdf_thumbnails SET pages = ? WHERE upload_id = ?", [storePageCount(count), uploadId]);
    }
    ok =
      count.state !== "uncounted" &&
      (existsSync(png) || (count.state !== "locked" && (await renderThumbnail(pdf, png))));
  } catch (err) {
    // The upload was swept while it drew (rename into a deleted directory), or spawning failed.
    console.error(`[thumbnails] ${uploadId}:`, err);
  }
  db.run("UPDATE pdf_thumbnails SET state = ?, updated_at = ? WHERE upload_id = ?", [
    ok ? "done" : "failed",
    Date.now(),
    uploadId,
  ]);
}

/** Draws one batch of page thumbnails. The API queues one only once the count is known. */
async function drawBatch(uploads: string, uploadId: string, batch: number): Promise<void> {
  const dir = join(uploads, uploadId);
  let ok = false;
  try {
    const count = knownCount(uploadId);
    const pages = count.state === "counted" ? count.pages : 0;
    const from = batch * PAGE_THUMB_BATCH + 1;
    if (from <= pages) {
      ok = await renderPages(
        join(dir, "file"),
        join(dir, PAGE_THUMB_DIR),
        from,
        Math.min(from + PAGE_THUMB_BATCH - 1, pages),
      );
    }
  } catch (err) {
    console.error(`[thumbnails] ${uploadId} batch ${batch}:`, err);
  }
  db.run("UPDATE pdf_page_thumbs SET state = ?, updated_at = ? WHERE upload_id = ? AND batch = ?", [
    ok ? "done" : "failed",
    Date.now(),
    uploadId,
    batch,
  ]);
}

/**
 * Does the next piece of queued work: first pages before page batches, since
 * a file's first page and count are what the merge list waits on and each is
 * one cheap render. Returns false when there was nothing to do.
 */
export async function drawNext(uploads: string = UPLOADS): Promise<boolean> {
  const first = claimFirst();
  if (first) {
    await drawFirst(uploads, String(first.upload_id));
    return true;
  }
  const batch = claimBatch();
  if (batch) {
    await drawBatch(uploads, String(batch.upload_id), Number(batch.batch));
    return true;
  }
  return false;
}

/**
 * Settles what a worker that died left running. A row with no count never got
 * as far as drawing, so it goes back in the queue. One with a count may have
 * died drawing, so that page is not tried again, and neither is a batch.
 */
export function recoverThumbnails(): void {
  const now = Date.now();
  db.run("UPDATE pdf_thumbnails SET state = 'queued', updated_at = ? WHERE state = 'running' AND pages IS NULL", [now]);
  db.run("UPDATE pdf_thumbnails SET state = 'failed', updated_at = ? WHERE state = 'running'", [now]);
  db.run("UPDATE pdf_page_thumbs SET state = 'failed', updated_at = ? WHERE state = 'running'", [now]);
}

export function startThumbnails(): void {
  recoverThumbnails();
  const loop = async () => {
    try {
      while (await drawNext());
    } catch (err) {
      console.error("[thumbnails] loop failed:", err);
    }
    setTimeout(loop, env.pollMs);
  };
  void loop();
}
