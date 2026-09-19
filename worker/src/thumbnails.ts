import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
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
 */

/** Long edge in pixels. The preview tile is ~160 CSS px, so this is sharp at 2×. */
export const THUMBNAIL_EDGE = 320;
/** The name the API serves (server/src/routes/pdf-uploads.ts) — keep them the same. */
export const THUMBNAIL_FILE = "thumbnail.png";
const MEMORY_BYTES = 512 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

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

/** Takes the oldest queued thumbnail and marks it running, atomically. */
const claim = db
  .transaction((): string | null => {
    const row = db
      .query<{ upload_id: string }, []>("SELECT upload_id FROM pdf_thumbnails WHERE state = 'queued' ORDER BY requested_at LIMIT 1")
      .get();
    if (!row) return null;
    db.run("UPDATE pdf_thumbnails SET state = 'running', updated_at = ? WHERE upload_id = ?", [Date.now(), row.upload_id]);
    return row.upload_id;
  })
  .immediate;

async function draw(uploadId: string): Promise<void> {
  const dir = join(UPLOADS, uploadId);
  let ok = false;
  try {
    ok = await renderThumbnail(join(dir, "file"), join(dir, THUMBNAIL_FILE));
  } catch (err) {
    // The upload was swept while it drew (rename into a deleted directory), or spawning failed.
    console.error(`[thumbnails] ${uploadId}:`, err);
  }
  db.run("UPDATE pdf_thumbnails SET state = ?, updated_at = ? WHERE upload_id = ?", [ok ? "done" : "failed", Date.now(), uploadId]);
}

export function startThumbnails(): void {
  // A render still marked running belonged to a worker that died, maybe drawing it; don't try that page again.
  db.run("UPDATE pdf_thumbnails SET state = 'failed', updated_at = ? WHERE state = 'running'", [Date.now()]);
  const loop = async () => {
    try {
      for (let id = claim(); id; id = claim()) await draw(id);
    } catch (err) {
      console.error("[thumbnails] loop failed:", err);
    }
    setTimeout(loop, env.pollMs);
  };
  void loop();
}
