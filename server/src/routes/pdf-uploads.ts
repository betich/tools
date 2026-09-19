import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, link, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Elysia, t } from "elysia";
import {
  PAGE_THUMB_BATCH,
  PAGE_THUMB_DIR,
  pageThumbBatch,
  readPageCount,
  UPLOAD_MAX_BYTES,
  UPLOAD_PART_BYTES,
  type PageCountState,
  type PdfPageCount,
  type UploadedFile,
  type UploadKind,
  type UploadSession,
  type UploadStatus,
} from "@tools/shared";
import { env, paths } from "../env";
import { db, id, nowIso } from "../lib/db";
import { clientIp, DISK_FULL, diskHasRoom, rateLimit, refuse } from "../lib/limits";
import { workerStatus } from "../lib/worker";

/**
 * Chunked, resumable uploads for the PDF tools. A file of up to 1 GB arrives
 * as 32 MB parts (under Cloudflare's 100 MB request cap), each streamed to
 * disk and hashed on the way — nothing is held in memory. A dropped
 * connection loses at most the part in flight: the client asks which parts
 * landed and sends the rest. `complete` joins the parts into one file and
 * sniffs what it is. The finished upload is the input to a job (#6).
 */

type Row = {
  id: string;
  name: string;
  type: string;
  bytes: number;
  part_size: number;
  parts: number;
  caller: string;
  kind: UploadKind | null;
};

const UPLOADS = join(paths.jobs, "uploads");
const ID = /^up_[0-9a-f]{16}$/;

const NOT_FOUND = "this upload has expired or never existed — start it again";

const dirOf = (uploadId: string) => join(UPLOADS, uploadId);
const partPath = (uploadId: string, n: number) => join(dirOf(uploadId), `part-${n}`);
/** A PDF upload's first page, drawn by the worker's thumbnail lane (worker/src/thumbnails.ts, same name). */
const thumbnailPath = (uploadId: string) => join(dirOf(uploadId), "thumbnail.png");
/** Thumbnails waiting for the worker, across everyone. Each takes well under a second; past this, the tile will do. */
const MAX_QUEUED_THUMBNAILS = 32;
/** A page view's thumbnails (#37), drawn by the same lane in batches: `uploads/<id>/pages/<n>.png`. */
const pagePath = (uploadId: string, n: number) => join(dirOf(uploadId), PAGE_THUMB_DIR, `${n}.png`);
/**
 * Page batches waiting, across everyone and per caller. A batch is up to
 * PAGE_THUMB_BATCH small renders, a few seconds of the lane; the client asks
 * only for pages on screen, so a few batches each is a screenful and more.
 */
const MAX_QUEUED_PAGE_BATCHES = 24;
const MAX_QUEUED_PAGE_BATCHES_PER_CALLER = 6;

/** Where a completed upload's bytes live — what a job reads. */
export const uploadPath = (uploadId: string) => join(dirOf(uploadId), "file");

const rowOf = (uploadId: string) =>
  ID.test(uploadId) ? db.query<Row, [string]>("SELECT * FROM uploads WHERE id = ?").get(uploadId) : null;

const received = (uploadId: string) =>
  db.query<{ n: number }, [string]>("SELECT n FROM upload_parts WHERE upload_id = ? ORDER BY n").all(uploadId).map((r) => r.n);

/** Keeps an upload from being swept — call whenever it is used, e.g. by a job reading it. */
export function touchUpload(uploadId: string): void {
  db.run("UPDATE uploads SET touched_at = ? WHERE id = ?", [Date.now(), uploadId]);
}

/** A completed upload, or `null` when it is unknown, unfinished or swept. */
export function completedUpload(uploadId: string): (UploadedFile & { path: string }) | null {
  const row = rowOf(uploadId);
  if (!row?.kind) return null;
  touchUpload(uploadId);
  return { id: row.id, name: row.name, size: row.bytes, kind: row.kind, path: uploadPath(row.id) };
}

const session = (row: Row): UploadSession => ({ id: row.id, partSize: row.part_size, parts: row.parts });
const finished = (row: Row & { kind: UploadKind }): UploadedFile => ({ id: row.id, name: row.name, size: row.bytes, kind: row.kind });

/** Bytes part `n` must be: every part is full-size but the last. */
const partBytes = (row: Row, n: number) => (n < row.parts - 1 ? row.part_size : row.bytes - row.part_size * (row.parts - 1));

/** Deletes an upload's row and files now — a discarded job's inputs go this way. */
export async function dropUpload(uploadId: string): Promise<void> {
  db.run("DELETE FROM uploads WHERE id = ?", [uploadId]);
  await rm(dirOf(uploadId), { recursive: true, force: true });
}

/**
 * Registers a file already on the server — a finished merge handed to
 * Compress (#18) — as a completed upload, without sending it through the
 * client. It is hard-linked in, so the source stays where it is (the merge's
 * download keeps working) and no bytes are copied; a copy only when the two
 * are on different file systems. `null` when the file is not a kind we take.
 */
export async function adoptUpload(source: string, name: string, caller: string): Promise<(UploadedFile & { path: string }) | null> {
  const uploadId = id("up");
  const bytes = (await stat(source)).size;
  // The row goes in first, so a sweep running meanwhile does not take the directory for a leftover.
  db.run(
    "INSERT INTO uploads (id, name, type, bytes, part_size, parts, caller, kind, touched_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
    [uploadId, name, "application/pdf", bytes, UPLOAD_PART_BYTES, Math.max(1, Math.ceil(bytes / UPLOAD_PART_BYTES)), caller, Date.now(), nowIso()],
  );
  try {
    await mkdir(dirOf(uploadId), { recursive: true });
    const out = uploadPath(uploadId);
    await link(source, out).catch(async (err: NodeJS.ErrnoException) => {
      if (err.code !== "EXDEV" && err.code !== "EPERM" && err.code !== "EMLINK") throw err;
      await copyFile(source, out);
    });
    const kind = sniff(await head(out));
    if (!kind) {
      await dropUpload(uploadId);
      return null;
    }
    db.run("UPDATE uploads SET kind = ?, touched_at = ? WHERE id = ?", [kind, Date.now(), uploadId]);
    return { id: uploadId, name, size: bytes, kind, path: out };
  } catch (err) {
    await dropUpload(uploadId);
    throw err;
  }
}

// ── sniffing ───────────────────────────────────────────────────────────────

const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

/** What the file really is, from its first bytes — the name and declared type are only hints. */
export function sniff(b: Uint8Array): UploadKind | null {
  // Readers accept the PDF header anywhere in the first 1 KB.
  if (ascii(b, 0, Math.min(b.length, 1024)).includes("%PDF-")) return "pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (ascii(b, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (ascii(b, 0, 4) === "II*\0" || ascii(b, 0, 4) === "MM\0*") return "tiff";
  if (ascii(b, 4, 4) === "ftyp") {
    // ISO-BMFF: the major brand, then the compatible ones, up to the box's end.
    const end = Math.min(b.length, ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0);
    const brands = [ascii(b, 8, 4)];
    for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(b, at, 4));
    if (brands.some((x) => x === "avif" || x === "avis")) return "avif";
    if (brands.some((x) => HEIF_BRANDS.has(x))) return "heic";
  }
  return null;
}

async function head(file: string, bytes = 1024): Promise<Uint8Array> {
  const fh = await open(file, "r");
  try {
    const buf = new Uint8Array(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

// ── parts ──────────────────────────────────────────────────────────────────

type PartResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Streams one part's body to a temporary file, hashing as it goes, and only
 * renames it into place when the length and hash both match — a torn or
 * corrupted part never counts as received.
 */
async function writePart(row: Row, n: number, body: ReadableStream<Uint8Array>, sha256: string): Promise<PartResult> {
  const expected = partBytes(row, n);
  const tmp = `${partPath(row.id, n)}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  const hasher = new Bun.CryptoHasher("sha256");
  let length = 0;
  let whole = false;
  const fh = await open(tmp, "w");
  // An explicit reader, never released: on a finished request body Bun's
  // `releaseLock` throws, and so does the async iterator that calls it.
  const reader = body.getReader();
  try {
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      const chunk = next.value;
      length += chunk.byteLength;
      if (length > expected) return { ok: false, status: 400, error: `part ${n} should be ${expected} bytes — it was longer` };
      hasher.update(chunk);
      let written = 0;
      while (written < chunk.byteLength) written += (await fh.write(chunk, written)).bytesWritten;
    }
    whole = length === expected;
  } catch {
    return { ok: false, status: 400, error: `part ${n} was cut off — send it again` };
  } finally {
    if (!whole) await reader.cancel().catch(() => {});
    await fh.close();
    // Anything short of a whole part leaves nothing behind.
    if (!whole) await rm(tmp, { force: true });
  }
  if (!whole) return { ok: false, status: 400, error: `part ${n} should be ${expected} bytes — it was ${length}` };
  if (hasher.digest("hex") !== sha256) {
    await rm(tmp, { force: true });
    return { ok: false, status: 400, error: `part ${n} arrived damaged — send it again` };
  }
  try {
    await rename(tmp, partPath(row.id, n));
  } catch {
    return { ok: false, status: 404, error: NOT_FOUND }; // swept while it streamed in
  }
  return { ok: true };
}

// ── assembly ───────────────────────────────────────────────────────────────

/** One assembly per upload; a second `complete` while it runs waits for the same one. */
const assembling = new Map<string, Promise<UploadKind | null>>();

async function assemble(row: Row): Promise<UploadKind | null> {
  const out = uploadPath(row.id);
  const tmp = `${out}.tmp`;
  const sink = createWriteStream(tmp);
  try {
    for (let n = 0; n < row.parts; n++) await pipeline(createReadStream(partPath(row.id, n)), sink, { end: false });
  } finally {
    await new Promise<void>((resolve, reject) => sink.end((err?: Error | null) => (err ? reject(err) : resolve())));
  }
  if ((await stat(tmp)).size !== row.bytes) throw new Error(`assembled ${row.id} has the wrong length`);
  const kind = sniff(await head(tmp));
  if (!kind) return null;
  await rename(tmp, out);
  for (let n = 0; n < row.parts; n++) await rm(partPath(row.id, n), { force: true });
  db.run("UPDATE uploads SET kind = ?, touched_at = ? WHERE id = ?", [kind, Date.now(), row.id]);
  return kind;
}

// ── sweeping ───────────────────────────────────────────────────────────────

/** Uploads untouched for the job TTL go, finished or not, along with any directory SQLite has forgotten. */
export async function sweepUploads(): Promise<void> {
  const stale = db
    .query<{ id: string }, [number]>("SELECT id FROM uploads WHERE touched_at < ?")
    .all(Date.now() - env.jobTtlMs)
    .filter((r) => !assembling.has(r.id));
  for (const { id: uploadId } of stale) await dropUpload(uploadId);
  const known = new Set(db.query<{ id: string }, []>("SELECT id FROM uploads").all().map((r) => r.id));
  for (const name of await readdir(UPLOADS).catch(() => [] as string[])) {
    if (!known.has(name)) await rm(join(UPLOADS, name), { recursive: true, force: true });
  }
}

await mkdir(UPLOADS, { recursive: true });
await sweepUploads();
setInterval(() => void sweepUploads().catch((err) => console.error("[uploads] sweep failed", err)), 5 * 60_000).unref();

// ── routes ─────────────────────────────────────────────────────────────────

// ── thumbnails and page counts (#17, #37) ─────────────────────────────────
//
// All three routes answer the same way: 200 once the worker's lane has done
// the work, 202 `{ retryAfter }` while it does, anything else means "show a
// tile". The row in pdf_thumbnails draws page 1 and counts the pages; a page
// thumbnail needs the count first (to know the page exists), then a row in
// pdf_page_thumbs draws its whole batch.

type Reply = { status?: number | string; headers: Record<string, string | number> };
/** A row of pdf_thumbnails: its state, and the page count it holds. */
type FirstRow = { state: string; count: PageCountState };

const WORKER_OFFLINE = "The PDF worker is offline — try again shortly.";
const BUSY = "the server is busy drawing previews — try again shortly";
const PNG_HEADERS = { "content-type": "image/png", "cache-control": "private, max-age=3600" };

function firstRow(uploadId: string): FirstRow | null {
  const row = db
    .query<{ state: string; pages: number | null }, [string]>("SELECT state, pages FROM pdf_thumbnails WHERE upload_id = ?")
    .get(uploadId);
  return row ? { state: row.state, count: readPageCount(row.pages) } : null;
}

function pending(set: Reply) {
  set.status = 202;
  set.headers["retry-after"] = "1";
  return { retryAfter: 1 };
}

/**
 * Busy is worth asking again about, unlike an offline worker, so it says when
 * — in the body too, since a cross-origin client cannot read `retry-after`.
 */
function busy(set: Reply) {
  set.headers["retry-after"] = "2";
  return { ...refuse(set, 503, BUSY), retryAfter: 2 };
}

/** One of the lane's two queues: its table, how many may wait in it, and the disk a piece of its work may need. */
type Lane = {
  table: "pdf_thumbnails" | "pdf_page_thumbs";
  max: number;
  maxPerCaller: number;
  room: number;
};
/** Page 1 and the count. Each is well under a second; past this, the tile will do. */
const FIRST: Lane = { table: "pdf_thumbnails", max: MAX_QUEUED_THUMBNAILS, maxPerCaller: MAX_QUEUED_THUMBNAILS, room: 1024 * 1024 };
const BATCHES: Lane = {
  table: "pdf_page_thumbs",
  max: MAX_QUEUED_PAGE_BATCHES,
  maxPerCaller: MAX_QUEUED_PAGE_BATCHES_PER_CALLER,
  room: PAGE_THUMB_BATCH * 256 * 1024,
};

/**
 * Asks the lane for a piece of work, keyed by `key` (the row's primary key),
 * unless it is already on it (`row` queued or running). The caller decides
 * that a row in any other state is worth asking again. Returns a refusal, or
 * null when the caller should 202.
 */
async function enqueue(set: Reply, lane: Lane, key: Record<string, string | number>, row: { state: string } | null, caller: string) {
  if (!workerStatus().up) return refuse(set, 503, WORKER_OFFLINE);
  if (row?.state === "queued" || row?.state === "running") return null;
  const count = (sql: string, ...args: string[]) => db.query<{ n: number }, string[]>(sql).get(...args)?.n ?? 0;
  const queued = count(`SELECT COUNT(*) AS n FROM ${lane.table} WHERE state = 'queued'`);
  const mine = count(
    `SELECT COUNT(*) AS n FROM ${lane.table} q JOIN uploads u ON u.id = q.upload_id WHERE q.state = 'queued' AND u.caller = ?`,
    caller,
  );
  if (queued >= lane.max || mine >= lane.maxPerCaller) return busy(set);
  if (!(await diskHasRoom(paths.jobs, lane.room))) return refuse(set, 507, DISK_FULL);
  const cols = Object.keys(key);
  const now = Date.now();
  db.run(
    `INSERT INTO ${lane.table} (${cols.join(", ")}, state, requested_at, updated_at) VALUES (${cols.map(() => "?").join(", ")}, 'queued', ?, ?)
     ON CONFLICT (${cols.join(", ")}) DO UPDATE SET state = 'queued', requested_at = excluded.requested_at, updated_at = excluded.updated_at`,
    [...Object.values(key), now, now],
  );
  return null;
}

/**
 * Asks for page 1 and the count. A row marked done whose work has gone
 * missing (the PNG, or a count from before #37) is asked again, and so is one
 * whose count was cut short — a timeout or a worker restart says nothing
 * about the file.
 */
const queueFirst = (set: Reply, uploadId: string, row: FirstRow | null, caller: string) =>
  enqueue(set, FIRST, { upload_id: uploadId }, row, caller);

/** The refusal for a count the lane found it can't make — the file is the problem; null otherwise. */
function uncountable(set: Reply, count: PageCountState | undefined) {
  if (count?.state === "locked") return refuse(set, 422, "this PDF is password-protected");
  if (count?.state === "unreadable") return refuse(set, 422, "this PDF's pages could not be counted");
  return null;
}

export const pdfUploads = new Elysia({ prefix: "/api/pdf/uploads" })
  .get(
    "/:id/thumbnail.png",
    async (ctx) => {
      const { params, set } = ctx;
      const upload = completedUpload(params.id);
      if (!upload) return refuse(set, 404, NOT_FOUND);
      if (upload.kind !== "pdf") return refuse(set, 415, "only a PDF has a page to preview");
      const png = Bun.file(thumbnailPath(upload.id));
      if (await png.exists()) return new Response(png, { headers: PNG_HEADERS });
      const row = firstRow(upload.id);
      // Page 1 is only drawn once there is a count, so a failure with none was the count's, cut short.
      if (row?.state === "failed" && row.count.state !== "uncounted") {
        return uncountable(set, row.count) ?? refuse(set, 422, "this PDF's first page could not be drawn");
      }
      return (await queueFirst(set, upload.id, row, clientIp(ctx))) ?? pending(set);
    },
    { beforeHandle: rateLimit("pdf-thumbnail", 240) },
  )
  .get(
    "/:id/pages",
    async (ctx) => {
      // 200 `{ pages }` — qpdf's count, the one Merge will use.
      const { params, set } = ctx;
      const upload = completedUpload(params.id);
      if (!upload) return refuse(set, 404, NOT_FOUND);
      if (upload.kind !== "pdf") return refuse(set, 415, "only a PDF has pages to count");
      const row = firstRow(upload.id);
      if (row?.count.state === "counted") return { pages: row.count.pages } satisfies PdfPageCount;
      return uncountable(set, row?.count) ?? (await queueFirst(set, upload.id, row, clientIp(ctx))) ?? pending(set);
    },
    { beforeHandle: rateLimit("pdf-thumbnail", 240) },
  )
  .get(
    "/:id/pages/:file",
    async (ctx) => {
      // `:file` is `<n>.png`, n 1-based. Elysia has no `:n.png`, so it is parsed here.
      const { params, set } = ctx;
      const upload = completedUpload(params.id);
      if (!upload) return refuse(set, 404, NOT_FOUND);
      if (upload.kind !== "pdf") return refuse(set, 415, "only a PDF has a page to preview");
      const n = Number(/^([1-9][0-9]{0,5})\.png$/.exec(params.file)?.[1] ?? NaN);
      if (!Number.isInteger(n)) return refuse(set, 404, "there is no such page");

      const caller = clientIp(ctx);
      const row = firstRow(upload.id);
      if (row?.count.state !== "counted") {
        return uncountable(set, row?.count) ?? (await queueFirst(set, upload.id, row, caller)) ?? pending(set);
      }
      const { pages } = row.count;
      if (n > pages) return refuse(set, 404, `this PDF has ${pages} page${pages === 1 ? "" : "s"}`);

      const png = Bun.file(pagePath(upload.id, n));
      if (await png.exists()) return new Response(png, { headers: PNG_HEADERS });
      const batch = pageThumbBatch(n);
      const job = db
        .query<{ state: string }, [string, number]>("SELECT state FROM pdf_page_thumbs WHERE upload_id = ? AND batch = ?")
        .get(upload.id, batch);
      if (job?.state === "failed") return refuse(set, 422, `page ${n} could not be drawn`);
      // No row yet, or one marked done whose file has gone: ask for the batch.
      return (await enqueue(set, BATCHES, { upload_id: upload.id, batch }, job ?? null, caller)) ?? pending(set);
    },
    { beforeHandle: rateLimit("pdf-page-thumb", 600) },
  )
  .post(
    "/",
    async (ctx) => {
      const { body, set } = ctx;
      if (body.size > UPLOAD_MAX_BYTES) return refuse(set, 413, `files are limited to ${UPLOAD_MAX_BYTES / 1024 ** 3} GB each`);
      const caller = clientIp(ctx);
      const mine = db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM uploads WHERE kind IS NULL AND caller = ?")
        .get(caller);
      if ((mine?.n ?? 0) >= env.maxOpenUploads) {
        return refuse(set, 429, `at most ${env.maxOpenUploads} uploads at once — finish one or wait for it to expire`);
      }
      // Parts, the assembled file and a job's output can all exist at once.
      const pending = db.query<{ bytes: number | null }, []>("SELECT SUM(bytes) AS bytes FROM uploads WHERE kind IS NULL").get()?.bytes ?? 0;
      if (!(await diskHasRoom(paths.jobs, body.size * 3 + pending))) return refuse(set, 507, DISK_FULL);

      const uploadId = id("up");
      const parts = Math.max(1, Math.ceil(body.size / UPLOAD_PART_BYTES));
      await mkdir(dirOf(uploadId), { recursive: true });
      db.run(
        "INSERT INTO uploads (id, name, type, bytes, part_size, parts, caller, kind, touched_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
        [uploadId, body.name, body.type, body.size, UPLOAD_PART_BYTES, parts, caller, Date.now(), nowIso()],
      );
      return { id: uploadId, partSize: UPLOAD_PART_BYTES, parts } satisfies UploadSession;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 255 }),
        size: t.Integer({ minimum: 1 }),
        type: t.String({ maxLength: 255 }),
      }),
      beforeHandle: rateLimit("upload-start", 30),
    },
  )
  .get(
    "/:id",
    ({ params, set }) => {
      const row = rowOf(params.id);
      if (!row) return refuse(set, 404, NOT_FOUND);
      touchUpload(row.id);
      const status: UploadStatus = { ...session(row), received: received(row.id), complete: Boolean(row.kind) };
      return row.kind ? { ...status, ...finished({ ...row, kind: row.kind }) } : status;
    },
    { beforeHandle: rateLimit("upload-status", 120) },
  )
  .put(
    "/:id/parts/:n",
    async ({ params, headers, request, set }) => {
      const row = rowOf(params.id);
      if (!row) return refuse(set, 404, NOT_FOUND);
      if (row.kind) return refuse(set, 400, "this upload is already complete");
      const n = Number(params.n);
      if (!Number.isInteger(n) || n < 0 || n >= row.parts) return refuse(set, 400, `parts run from 0 to ${row.parts - 1}`);
      const sha256 = headers["x-sha256"]?.toLowerCase() ?? "";
      if (!/^[0-9a-f]{64}$/.test(sha256)) return refuse(set, 400, "each part needs its SHA-256 in x-sha256");
      const declared = Number(request.headers.get("content-length") ?? NaN);
      if (Number.isFinite(declared) && declared !== partBytes(row, n)) {
        return refuse(set, 400, `part ${n} should be ${partBytes(row, n)} bytes — it was ${declared}`);
      }
      if (!request.body) return refuse(set, 400, `part ${n} arrived empty`);
      if (!(await diskHasRoom(paths.jobs, partBytes(row, n)))) return refuse(set, 507, DISK_FULL);

      touchUpload(row.id);
      const result = await writePart(row, n, request.body, sha256);
      if (!result.ok) return refuse(set, result.status, result.error);
      // The session may have been swept while the part streamed in.
      if (!rowOf(row.id)) {
        await rm(dirOf(row.id), { recursive: true, force: true });
        return refuse(set, 404, NOT_FOUND);
      }
      db.run("INSERT OR REPLACE INTO upload_parts (upload_id, n, sha256) VALUES (?, ?, ?)", [row.id, n, sha256]);
      touchUpload(row.id);
      return { n, received: received(row.id).length };
    },
    // The body is a raw stream; leave it unread for writePart.
    { parse: "none", beforeHandle: rateLimit("upload-part", 120) },
  )
  .post(
    "/:id/complete",
    async ({ params, set }) => {
      const row = rowOf(params.id);
      if (!row) return refuse(set, 404, NOT_FOUND);
      if (row.kind) return finished({ ...row, kind: row.kind });
      const have = new Set(received(row.id));
      const missing = Array.from({ length: row.parts }, (_, n) => n).filter((n) => !have.has(n));
      if (missing.length) {
        const list = missing.length > 8 ? `${missing.slice(0, 8).join(", ")} and ${missing.length - 8} more` : missing.join(", ");
        return refuse(set, 400, `still missing part${missing.length === 1 ? "" : "s"} ${list}`);
      }
      if (!(await diskHasRoom(paths.jobs, row.bytes))) return refuse(set, 507, DISK_FULL);

      let job = assembling.get(row.id);
      if (!job) {
        job = assemble(row).finally(() => assembling.delete(row.id));
        assembling.set(row.id, job);
      }
      const kind = await job;
      if (!kind) {
        await dropUpload(row.id);
        return refuse(set, 415, "that is not a PDF or an image we can read — PDF, JPEG, PNG, WebP, AVIF, GIF, HEIC and TIFF are");
      }
      return finished({ ...row, kind });
    },
    { beforeHandle: rateLimit("upload-complete", 30) },
  );
