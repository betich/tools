import { readdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { Elysia, t } from "elysia";
import {
  MAX_QUEUED_TASKS,
  type JobEvent,
  type JobInfo,
  type PdfTool,
  type TaskInfo,
  type TaskKind,
  type TaskProgress,
  type TaskState,
  type UploadedFile,
  type UploadKind,
} from "@tools/shared";
import { env, paths } from "../env";
import { db, id } from "../lib/db";
import { clientIp, DISK_FULL, diskHasRoom, rateLimit, refuse } from "../lib/limits";
import { workerStatus } from "../lib/worker";
import { completedUpload, dropUpload } from "./pdf-uploads";

/**
 * PDF job sessions (#6). A job holds a caller's uploads, the analysis and
 * every task run against them; the pdf-worker container claims queued tasks
 * from the same SQLite file, runs them one at a time and writes progress and
 * results back (worker/src/jobs.ts). This side admits tasks to the queue,
 * relays the worker's progress over SSE, serves finished files, and deletes
 * everything an hour after the job was last touched — or at once on Discard.
 *
 * Results live in `JOBS_DIR/results/<job>/<task>/`. The worker writes into
 * `<task>.part/` and renames it only on success, and only a `done` task's
 * files are served, so a partial output can never be downloaded.
 */

type JobRow = { id: string; tool: PdfTool; caller: string; touched_at: number; created_at: number };
type TaskRow = {
  id: string;
  job_id: string;
  kind: TaskKind;
  state: TaskState;
  progress: string | null;
  result: string | null;
  error: string | null;
  output_file: string | null;
  output_name: string | null;
  created_at: number;
};

const RESULTS = join(paths.jobs, "results");
const JOB_ID = /^job_[0-9a-f]{16}$/;
const TASK_ID = /^task_[0-9a-f]{16}$/;
/** Artefact names a handler may write: one plain file name, nothing that climbs out of the task's directory. */
const FILE_NAME = /^[\w-][\w.-]{0,127}$/;

const EXPIRED = "This job has expired or was discarded — upload the file again.";
const YOURS_RUNNING = "You already have a job running — wait for it or discard it.";
const QUEUE_FULL = "The PDF queue is full — try again in a minute.";
const WORKER_OFFLINE = "The PDF worker is offline — try again shortly.";
const INPUT_GONE = "One of the uploaded files has expired — upload it again.";

/** Short tasks jump the long ones, so a crop preview does not wait behind someone's 900-page compress. */
const PRIORITY: Record<TaskKind, number> = { analyse: 0, crop: 0, thumbnail: 0, compress: 1, merge: 1 };
/** Which tasks each tool's job may run. `analyse` is only ever queued by the API itself. */
const KINDS: Record<PdfTool, TaskKind[]> = { compress: ["compress", "crop", "thumbnail"], merge: ["merge", "thumbnail"] };
const MAX_INPUTS = 200;
/** Task params are settings, not data; anything bigger is a mistake or an attack. */
const MAX_PARAMS_BYTES = 64 * 1024;

const jobDir = (jobId: string) => join(RESULTS, jobId);
const taskDir = (jobId: string, taskId: string) => join(RESULTS, jobId, taskId);

// ── rows → shapes ──────────────────────────────────────────────────────────

const jobRow = (jobId: string) =>
  JOB_ID.test(jobId) ? db.query<JobRow, [string]>("SELECT * FROM pdf_jobs WHERE id = ?").get(jobId) : null;

const taskRows = db.prepare<TaskRow, [string]>("SELECT * FROM pdf_tasks WHERE job_id = ? ORDER BY created_at, rowid");

/**
 * Where every unfinished task stands: running ones first (they are ahead of
 * everybody), then queued ones in the order the worker claims them.
 */
function queueOrder(): Map<string, number> {
  const rows = db
    .query<{ id: string }, []>(
      `SELECT id FROM pdf_tasks WHERE state IN ('queued', 'running')
       ORDER BY state = 'queued', priority, created_at, rowid`,
    )
    .all();
  return new Map(rows.map((r, i) => [r.id, i]));
}

const parse = <T>(json: string | null): T | null => (json ? (JSON.parse(json) as T) : null);

function taskInfo(row: TaskRow, order: Map<string, number>): TaskInfo {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    ahead: row.state === "queued" ? (order.get(row.id) ?? 0) : 0,
    progress: parse<TaskProgress>(row.progress),
    result: parse(row.result),
    error: row.error,
    createdAt: row.created_at,
  };
}

function inputsOf(jobId: string): UploadedFile[] {
  return db
    .query<{ id: string; name: string; bytes: number; kind: UploadKind | null }, [string]>(
      `SELECT u.id, u.name, u.bytes, u.kind FROM pdf_job_inputs i JOIN uploads u ON u.id = i.upload_id
       WHERE i.job_id = ? ORDER BY i.position`,
    )
    .all(jobId)
    .flatMap((u) => (u.kind ? [{ id: u.id, name: u.name, size: u.bytes, kind: u.kind }] : []));
}

function jobInfo(job: JobRow, order = queueOrder()): JobInfo {
  const tasks = taskRows.all(job.id);
  const analysed = tasks.filter((r) => r.kind === "analyse" && r.state === "done").pop();
  return {
    id: job.id,
    tool: job.tool,
    inputs: inputsOf(job.id),
    analysis: parse(analysed?.result ?? null),
    tasks: tasks.map((r) => taskInfo(r, order)),
    expiresAt: job.touched_at + env.jobTtlMs,
  };
}

/** Any call on a job is activity: the hour starts again, for the job and its uploads. */
function touch(jobId: string): void {
  const now = Date.now();
  db.run("UPDATE pdf_jobs SET touched_at = ? WHERE id = ?", [now, jobId]);
  db.run("UPDATE uploads SET touched_at = ? WHERE id IN (SELECT upload_id FROM pdf_job_inputs WHERE job_id = ?)", [
    now,
    jobId,
  ]);
}

// ── admission ──────────────────────────────────────────────────────────────

type Refusal = { status: number; error: string };

/**
 * Whether `caller` may put another task in the queue: the worker must be
 * there to run it, each caller gets one task at a time, and only a few may
 * wait. Synchronous, so the check and the insert that follows cannot
 * interleave with another request's.
 */
function admission(caller: string): Refusal | null {
  if (!workerStatus().up) return { status: 503, error: WORKER_OFFLINE };
  const mine = db
    .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM pdf_tasks WHERE caller = ? AND state IN ('queued', 'running')")
    .get(caller)?.n;
  if (mine) return { status: 429, error: YOURS_RUNNING };
  const queued = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM pdf_tasks WHERE state = 'queued'").get()?.n ?? 0;
  if (queued >= MAX_QUEUED_TASKS) return { status: 503, error: QUEUE_FULL };
  return null;
}

function enqueue(jobId: string, kind: TaskKind, params: unknown, caller: string): TaskRow {
  const taskId = id("task");
  const now = Date.now();
  db.run(
    `INSERT INTO pdf_tasks (id, job_id, kind, params, state, priority, caller, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
    [taskId, jobId, kind, JSON.stringify(params ?? null), PRIORITY[kind], caller, now, now],
  );
  return db.query<TaskRow, [string]>("SELECT * FROM pdf_tasks WHERE id = ?").get(taskId)!;
}

// ── discarding and sweeping ────────────────────────────────────────────────

/**
 * Deletes a job's rows, results and uploads now. A task the worker is running
 * notices its row is gone within a second, kills its child and cleans up its
 * own partial output. Uploads another job still uses are kept.
 */
async function discard(jobId: string): Promise<void> {
  const uploads = db
    .query<{ upload_id: string }, [string]>("SELECT upload_id FROM pdf_job_inputs WHERE job_id = ?")
    .all(jobId)
    .map((r) => r.upload_id);
  db.run("DELETE FROM pdf_jobs WHERE id = ?", [jobId]); // tasks and inputs cascade
  await rm(jobDir(jobId), { recursive: true, force: true });
  for (const uploadId of uploads) {
    const shared = db.query<{ n: number }, [string]>("SELECT 1 AS n FROM pdf_job_inputs WHERE upload_id = ?").get(uploadId);
    if (!shared) await dropUpload(uploadId);
  }
}

/**
 * Jobs untouched for the TTL go, with everything they hold — unless a task is
 * running for them right now (the worker touches its job while it works).
 * Result directories SQLite has no job for are leftovers and go too.
 */
export async function sweepJobs(): Promise<void> {
  const stale = db
    .query<{ id: string }, [number]>(
      `SELECT id FROM pdf_jobs j WHERE touched_at < ?
       AND NOT EXISTS (SELECT 1 FROM pdf_tasks t WHERE t.job_id = j.id AND t.state = 'running')`,
    )
    .all(Date.now() - env.jobTtlMs);
  for (const { id: jobId } of stale) await discard(jobId);
  const known = new Set(db.query<{ id: string }, []>("SELECT id FROM pdf_jobs").all().map((r) => r.id));
  for (const name of await readdir(RESULTS).catch(() => [] as string[])) {
    if (!known.has(name)) await rm(join(RESULTS, name), { recursive: true, force: true });
  }
}

await sweepJobs();
setInterval(() => void sweepJobs().catch((err) => console.error("[jobs] sweep failed", err)), env.jobSweepMs).unref();

// ── events ─────────────────────────────────────────────────────────────────

/**
 * Open event streams. One shared poller reads the task table every 500 ms
 * while any stream is open, and writes each watcher only what changed since
 * its last event — a single query for the queue order, one per watched job.
 */
type Watcher = {
  jobId: string;
  caller: string;
  /** The last TaskInfo JSON sent per task, to send only changes. */
  sent: Map<string, string>;
  analysed: boolean;
  lastWrite: number;
  write(chunk: string): void;
  close(): void;
};

const watchers = new Set<Watcher>();
let poller: ReturnType<typeof setInterval> | null = null;
const POLL_MS = 500;
/** A comment line this often keeps Cloudflare (100 s idle cutoff) and proxies from closing a quiet stream. */
const KEEPALIVE_MS = 20_000;

const frame = (event: JobEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

function sendSnapshot(w: Watcher, job: JobInfo): void {
  w.write(frame({ type: "job", job }));
  w.sent = new Map(job.tasks.map((task) => [task.id, JSON.stringify(task)]));
  w.analysed = job.analysis !== null;
}

function poll(): void {
  if (!watchers.size) {
    if (poller) clearInterval(poller);
    poller = null;
    return;
  }
  const order = queueOrder();
  const now = Date.now();
  const byJob = new Map<string, Watcher[]>();
  for (const w of watchers) byJob.set(w.jobId, [...(byJob.get(w.jobId) ?? []), w]);
  for (const [jobId, list] of byJob) {
    const job = jobRow(jobId);
    if (!job) {
      for (const w of list) {
        w.write(frame({ type: "expired" }));
        w.close();
      }
      continue;
    }
    const rows = taskRows.all(jobId);
    const analysed = rows.some((r) => r.kind === "analyse" && r.state === "done");
    for (const w of list) {
      // The analysis lands on the job itself, so it goes out as a fresh snapshot.
      if (analysed && !w.analysed) {
        sendSnapshot(w, jobInfo(job, order));
        continue;
      }
      for (const row of rows) {
        const task = taskInfo(row, order);
        const json = JSON.stringify(task);
        if (w.sent.get(task.id) === json) continue;
        w.sent.set(task.id, json);
        w.write(frame({ type: "task", task }));
      }
      if (now - w.lastWrite > KEEPALIVE_MS) w.write(": keepalive\n\n");
    }
  }
}

function openStream(job: JobRow, caller: string, abort: AbortSignal): Response {
  const encoder = new TextEncoder();
  let watcher: Watcher | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const w: Watcher = {
        jobId: job.id,
        caller,
        sent: new Map(),
        analysed: false,
        lastWrite: Date.now(),
        write(chunk) {
          try {
            controller.enqueue(encoder.encode(chunk));
            w.lastWrite = Date.now();
          } catch {
            w.close(); // the client went away between polls
          }
        },
        close() {
          if (!watchers.delete(w)) return;
          try {
            controller.close();
          } catch {
            // already closed
          }
        },
      };
      watcher = w;
      watchers.add(w);
      // Every connection opens with the whole job, so a reconnect needs no bookkeeping on the client.
      w.write("retry: 3000\n\n");
      sendSnapshot(w, jobInfo(job));
      abort.addEventListener("abort", () => w.close(), { once: true });
      poller ??= setInterval(poll, POLL_MS);
    },
    cancel() {
      if (watcher) watchers.delete(watcher);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

// ── files ──────────────────────────────────────────────────────────────────

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
};

/**
 * RFC 5987 `filename*` keeps a Thai or Japanese name intact; the plain
 * `filename` is an ASCII stand-in for the rare client that ignores it.
 */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

async function sendFile(path: string, headers: Record<string, string>): Promise<Response | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return new Response(file, {
    headers: {
      "content-type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
      "content-length": String(file.size),
      "cache-control": "private, no-store",
      ...headers,
    },
  });
}

// ── routes ─────────────────────────────────────────────────────────────────

export const pdfJobs = new Elysia({ prefix: "/api/pdf/jobs" })
  .post(
    "/",
    async (ctx) => {
      const { body, set } = ctx;
      const caller = clientIp(ctx);
      const uploads = body.uploads.map((uploadId) => completedUpload(uploadId));
      if (uploads.some((u) => !u)) return refuse(set, 404, INPUT_GONE);
      const inputs = uploads as NonNullable<(typeof uploads)[number]>[];
      if (body.tool === "compress" && (inputs.length !== 1 || inputs[0]!.kind !== "pdf")) {
        return refuse(set, 400, "Compressing takes exactly one PDF.");
      }
      // The output of a run can be as big as its inputs, and a compress may hold an intermediate copy.
      const bytes = inputs.reduce((sum, u) => sum + u.size, 0);
      if (!(await diskHasRoom(paths.jobs, bytes * 2))) return refuse(set, 507, DISK_FULL);

      const created = db.transaction((): JobRow | Refusal => {
        // Creating a job queues work (an analysis) or is about to, so the queue rules apply here too.
        const refusal = admission(caller);
        if (refusal) return refusal;
        const jobId = id("job");
        const now = Date.now();
        db.run("INSERT INTO pdf_jobs (id, tool, caller, touched_at, created_at) VALUES (?, ?, ?, ?, ?)", [
          jobId,
          body.tool,
          caller,
          now,
          now,
        ]);
        inputs.forEach((u, position) =>
          db.run("INSERT INTO pdf_job_inputs (job_id, position, upload_id) VALUES (?, ?, ?)", [jobId, position, u.id]),
        );
        if (body.tool === "compress") enqueue(jobId, "analyse", null, caller);
        return db.query<JobRow, [string]>("SELECT * FROM pdf_jobs WHERE id = ?").get(jobId)!;
      })();
      if ("status" in created) return refuse(set, created.status, created.error);
      return jobInfo(created);
    },
    {
      body: t.Object({
        tool: t.Union([t.Literal("compress"), t.Literal("merge")]),
        uploads: t.Array(t.String({ maxLength: 64 }), { minItems: 1, maxItems: MAX_INPUTS }),
      }),
      beforeHandle: rateLimit("pdf-job", 20),
    },
  )
  .get(
    "/:id",
    ({ params, set }) => {
      const job = jobRow(params.id);
      if (!job) return refuse(set, 404, EXPIRED);
      touch(job.id);
      return jobInfo({ ...job, touched_at: Date.now() });
    },
    { beforeHandle: rateLimit("pdf-job-get", 120) },
  )
  .delete(
    "/:id",
    async ({ params, set }) => {
      if (jobRow(params.id)) await discard(params.id);
      set.status = 204;
      return null;
    },
    { beforeHandle: rateLimit("pdf-job-delete", 30) },
  )
  .post(
    "/:id/tasks",
    async (ctx) => {
      const { body, params, set } = ctx;
      const job = jobRow(params.id);
      if (!job) return refuse(set, 404, EXPIRED);
      if (!KINDS[job.tool].includes(body.kind)) return refuse(set, 400, `A ${job.tool} job cannot run ${body.kind}.`);
      const json = JSON.stringify(body.params ?? null);
      if (json.length > MAX_PARAMS_BYTES) return refuse(set, 413, "Those settings are too large to send.");
      const inputs = inputsOf(job.id);
      const want = db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM pdf_job_inputs WHERE job_id = ?").get(job.id)?.n;
      if (inputs.length !== want) return refuse(set, 410, INPUT_GONE);
      const bytes = inputs.reduce((sum, u) => sum + u.size, 0);
      if (!(await diskHasRoom(paths.jobs, bytes * 2))) return refuse(set, 507, DISK_FULL);

      const caller = clientIp(ctx);
      const created = db.transaction((): TaskRow | Refusal => {
        const refusal = admission(caller);
        return refusal ?? enqueue(job.id, body.kind, body.params, caller);
      })();
      if ("status" in created) return refuse(set, created.status, created.error);
      touch(job.id);
      return taskInfo(created, queueOrder());
    },
    {
      body: t.Object({
        kind: t.Union([t.Literal("compress"), t.Literal("merge"), t.Literal("crop"), t.Literal("thumbnail")]),
        params: t.Unknown(),
      }),
      beforeHandle: rateLimit("pdf-task", 30),
    },
  )
  .get(
    "/:id/events",
    (ctx) => {
      const { params, request, set } = ctx;
      const job = jobRow(params.id);
      if (!job) return refuse(set, 404, EXPIRED);
      const caller = clientIp(ctx);
      if (watchers.size >= env.maxStreams) return refuse(set, 503, "The server is watching too many jobs — try again shortly.");
      if ([...watchers].filter((w) => w.caller === caller).length >= env.maxStreamsPerCaller) {
        return refuse(set, 429, "Too many open job pages — close one and try again.");
      }
      touch(job.id);
      return openStream({ ...job, touched_at: Date.now() }, caller, request.signal);
    },
    { beforeHandle: rateLimit("pdf-job-events", 30) },
  )
  .get(
    "/:id/result",
    async ({ params, query, set }) => {
      const job = jobRow(params.id);
      if (!job) return refuse(set, 404, EXPIRED);
      const done = taskRows
        .all(job.id)
        .filter((r) => r.state === "done" && r.output_file && (query.task ? r.id === query.task : r.kind === "compress" || r.kind === "merge"));
      const task = done.pop();
      if (!task) return refuse(set, 404, query.task ? "That run has no file to download." : "Nothing has finished yet.");
      touch(job.id);
      const res = await sendFile(join(taskDir(job.id, task.id), task.output_file!), {
        "content-disposition": disposition(task.output_name ?? task.output_file!),
      });
      return res ?? refuse(set, 404, EXPIRED);
    },
    { query: t.Object({ task: t.Optional(t.String({ maxLength: 64 })) }), beforeHandle: rateLimit("pdf-job-result", 30) },
  )
  .get(
    "/:id/tasks/:taskId/file/:name",
    async ({ params, set }) => {
      const job = jobRow(params.id);
      if (!job) return refuse(set, 404, EXPIRED);
      const task = TASK_ID.test(params.taskId)
        ? db.query<TaskRow, [string, string]>("SELECT * FROM pdf_tasks WHERE id = ? AND job_id = ?").get(params.taskId, job.id)
        : null;
      if (!task || task.state !== "done" || !FILE_NAME.test(params.name)) return refuse(set, 404, "not found");
      touch(job.id);
      const res = await sendFile(join(taskDir(job.id, task.id), params.name), { "cache-control": "private, max-age=3600" });
      return res ?? refuse(set, 404, "not found");
    },
    { beforeHandle: rateLimit("pdf-task-file", 240) },
  );
