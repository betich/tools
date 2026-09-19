import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Elysia, t } from "elysia";
import { UPLOAD_MAX_BYTES, UPLOAD_PART_BYTES, type UploadedFile, type UploadKind, type UploadSession, type UploadStatus } from "@tools/shared";
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

export const pdfUploads = new Elysia({ prefix: "/api/pdf/uploads" })
  .get(
    "/:id/thumbnail.png",
    async ({ params, set }) => {
      // 200 with the PNG once drawn; 202 while the worker's lane draws it; anything else means "show a tile".
      const upload = completedUpload(params.id);
      if (!upload) return refuse(set, 404, NOT_FOUND);
      if (upload.kind !== "pdf") return refuse(set, 415, "only a PDF has a page to preview");
      const png = Bun.file(thumbnailPath(upload.id));
      if (await png.exists()) {
        return new Response(png, { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } });
      }
      const row = db.query<{ state: string }, [string]>("SELECT state FROM pdf_thumbnails WHERE upload_id = ?").get(upload.id);
      if (row?.state === "failed") return refuse(set, 422, "this PDF's first page could not be drawn");
      if (!workerStatus().up) return refuse(set, 503, "The PDF worker is offline — try again shortly.");
      // No row yet, or one marked done whose file has gone: ask for it.
      if (!row || row.state === "done") {
        const queued = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM pdf_thumbnails WHERE state = 'queued'").get()?.n ?? 0;
        if (queued >= MAX_QUEUED_THUMBNAILS) return refuse(set, 503, "the server is busy drawing previews — try again shortly");
        if (!(await diskHasRoom(paths.jobs, 1024 * 1024))) return refuse(set, 507, DISK_FULL);
        const now = Date.now();
        db.run(
          "INSERT INTO pdf_thumbnails (upload_id, state, requested_at, updated_at) VALUES (?, 'queued', ?, ?) ON CONFLICT (upload_id) DO UPDATE SET state = 'queued', requested_at = excluded.requested_at, updated_at = excluded.updated_at",
          [upload.id, now, now],
        );
      }
      set.status = 202;
      set.headers["retry-after"] = "1";
      return { retryAfter: 1 };
    },
    { beforeHandle: rateLimit("pdf-thumbnail", 240) },
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
