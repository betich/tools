import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { PdfTool, TaskKind, TaskProgress, UploadKind } from "@tools/shared";
import { db } from "./db";
import { env } from "./env";
import { run as exec, type RunResult } from "./exec";
import { childMemoryLimit, outOfMemorySentence, ranOutOfMemory } from "./limits";

/**
 * The job loop. The API queues tasks in SQLite (server/src/routes/pdf-jobs.ts);
 * this worker claims the oldest one, runs it through the handler registered
 * for its kind, and writes progress, the result or an error sentence back to
 * the row, which the API relays to the browser over SSE. One task runs at a
 * time — the box has room for one big PDF, not two.
 *
 * Files: inputs are the API's uploads (`JOBS_DIR/uploads/<id>/file`); a task
 * writes into `JOBS_DIR/results/<job>/<task>.part/` and only when it succeeds
 * is that renamed to `<task>/`, which is all the API will ever serve. A task
 * that fails or is discarded leaves nothing behind.
 */

export type TaskInput = { id: string; name: string; kind: UploadKind; size: number; path: string };

export type RunOptions = {
  /** Defaults to the current headroom (`childMemoryLimit()`). */
  memoryBytes?: number;
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  stdout?: boolean;
  /** Placed in the out-of-memory sentence: "on page 214 (image 18000×24000)". */
  where?: string;
  /** What to change after running out of memory; defaults to a lower DPI cap or a smaller file. */
  hint?: string;
  /** Names the tool in failure sentences; defaults to the command's basename. */
  label?: string;
  /** Throw on a non-zero exit (default). Pass false to inspect the result yourself. */
  check?: boolean;
};

export type TaskContext = {
  task: { id: string; kind: TaskKind; params: unknown };
  /** `password` is an encrypted input's, set by `POST /jobs/:id/unlock` (#15); null until then. */
  job: { id: string; tool: PdfTool; password: string | null };
  /** The job's uploads, in order. */
  inputs: TaskInput[];
  /** The job's latest finished analysis (`PdfAnalysis`, #8), if any. */
  analysis: unknown | null;
  /** Write outputs here. Published when the handler returns; deleted if it throws. */
  outDir: string;
  /** Scratch space, deleted when the task ends either way. */
  workDir: string;
  /** Aborted when the user discards the job; `run()` kills its child when it fires. */
  signal: AbortSignal;
  /** Reports progress to the browser. Cheap to call often — writes are throttled. */
  progress(stage: string, done: number, total: number, note?: string): void;
  /**
   * Runs a native tool under `prlimit --as=<headroom>` and a deadline. Throws a
   * `TaskError` whose message is shown as-is when the child runs out of memory,
   * times out or (unless `check: false`) exits non-zero.
   */
  run(cmd: string, args: string[], opts?: RunOptions): Promise<RunResult>;
};

export type HandlerResult = {
  /** Stored as TaskInfo.result — e.g. PdfAnalysis for analyse, RunResult for compress/merge. */
  result: unknown;
  /** The downloadable output, a file the handler wrote in `outDir`, and the name the browser saves it as. */
  file?: { name: string; downloadName: string };
};

export type Handler = (ctx: TaskContext) => Promise<HandlerResult>;

/** A failure whose message is a sentence for the user, shown as-is. */
export class TaskError extends Error {}

/** The user discarded the job while the task ran; nothing is written back. */
class Discarded extends Error {}

const handlers = new Map<TaskKind, Handler>();

/** Plugs in the code for one kind of task (#8 analyse, #9 compress, #10 crop, #17 merge/thumbnail). */
export function registerHandler(kind: TaskKind, handler: Handler): void {
  handlers.set(kind, handler);
}

/** The handler registered for a kind — for tests that drive one without the queue. */
export const handlerFor = (kind: TaskKind): Handler | undefined => handlers.get(kind);

/**
 * A download name built like `fileNameFor`: letters, digits and marks of any
 * script survive, so a Thai file name stays Thai.
 */
export function outputName(inputName: string, suffix: string, ext: string): string {
  const stem = inputName
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `${[stem || "file", suffix].filter(Boolean).join("-")}.${ext}`;
}

// ── rows ───────────────────────────────────────────────────────────────────

type TaskRow = { id: string; job_id: string; kind: TaskKind; params: string };

const RESULTS = join(env.jobsDir, "results");
const UPLOADS = join(env.jobsDir, "uploads");

const exists = db.prepare<{ n: number }, [string]>("SELECT 1 AS n FROM pdf_tasks WHERE id = ?");
const setProgress = db.prepare<unknown, [string, number, string]>(
  "UPDATE pdf_tasks SET progress = ?, updated_at = ? WHERE id = ? AND state = 'running'",
);

/** A task counts as activity on its job, and keeps the job's uploads from being swept under it. */
function touchJob(jobId: string): void {
  const now = Date.now();
  db.run("UPDATE pdf_jobs SET touched_at = ? WHERE id = ?", [now, jobId]);
  db.run("UPDATE uploads SET touched_at = ? WHERE id IN (SELECT upload_id FROM pdf_job_inputs WHERE job_id = ?)", [
    now,
    jobId,
  ]);
}

/** Takes the next queued task — shortest lane first, then oldest — and marks it running, atomically. */
const claim = db
  .transaction((): TaskRow | null => {
    const row = db
      .query<TaskRow, []>(
        "SELECT id, job_id, kind, params FROM pdf_tasks WHERE state = 'queued' ORDER BY priority, created_at, rowid LIMIT 1",
      )
      .get();
    if (!row) return null;
    const now = Date.now();
    db.run("UPDATE pdf_tasks SET state = 'running', started_at = ?, updated_at = ? WHERE id = ?", [now, now, row.id]);
    return row;
  })
  .immediate;

function finish(id: string, fields: { state: "done" | "failed"; result?: unknown; error?: string; file?: HandlerResult["file"] }) {
  const now = Date.now();
  return db.run(
    "UPDATE pdf_tasks SET state = ?, result = ?, error = ?, output_file = ?, output_name = ?, finished_at = ?, updated_at = ? WHERE id = ?",
    [
      fields.state,
      fields.result === undefined ? null : JSON.stringify(fields.result),
      fields.error ?? null,
      fields.file?.name ?? null,
      fields.file?.downloadName ?? null,
      now,
      now,
      id,
    ],
  ).changes;
}

function inputsOf(jobId: string): TaskInput[] | null {
  const want = db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM pdf_job_inputs WHERE job_id = ?").get(jobId)?.n ?? 0;
  const rows = db
    .query<{ id: string; name: string; kind: UploadKind | null; bytes: number }, [string]>(
      `SELECT u.id, u.name, u.kind, u.bytes FROM pdf_job_inputs i JOIN uploads u ON u.id = i.upload_id
       WHERE i.job_id = ? ORDER BY i.position`,
    )
    .all(jobId);
  const inputs = rows.flatMap((r) =>
    r.kind ? [{ id: r.id, name: r.name, kind: r.kind, size: r.bytes, path: join(UPLOADS, r.id, "file") }] : [],
  );
  return inputs.length === want && inputs.every((i) => existsSync(i.path)) ? inputs : null;
}

function analysisOf(jobId: string): unknown | null {
  const row = db
    .query<{ result: string | null }, [string]>(
      "SELECT result FROM pdf_tasks WHERE job_id = ? AND kind = 'analyse' AND state = 'done' ORDER BY finished_at DESC LIMIT 1",
    )
    .get(jobId);
  return row?.result ? JSON.parse(row.result) : null;
}

/** Progress writes, at most a few a second — but a new stage is always written at once. */
function progressWriter(taskId: string) {
  let last: TaskProgress | null = null;
  let lastAt = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const write = () => {
    pending = null;
    lastAt = Date.now();
    try {
      setProgress.run(JSON.stringify(last), lastAt, taskId);
    } catch (err) {
      console.error("progress write failed:", err); // a busy database drops one update, nothing more
    }
  };
  return {
    report(stage: string, done: number, total: number, note?: string) {
      const stageChanged = last?.stage !== stage;
      last = { stage, done, total, ...(note ? { note } : {}) };
      if (stageChanged || Date.now() - lastAt >= 250) {
        if (pending) clearTimeout(pending);
        write();
      } else pending ??= setTimeout(write, 250 - (Date.now() - lastAt));
    },
    stop() {
      if (pending) clearTimeout(pending);
    },
  };
}

/** Rename, or copy then rename when the pooled drives put the two paths on different disks. */
async function publish(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    const tmp = `${to}.copy`;
    await cp(from, tmp, { recursive: true });
    await rename(tmp, to);
    await rm(from, { recursive: true, force: true });
  }
}

const lastLine = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()
    ?.slice(0, 200) ?? "";

// ── running ────────────────────────────────────────────────────────────────

/**
 * `TaskContext.run` for a task: the child gets the current memory headroom,
 * the work dir as its cwd, and is killed when `signal` fires. Exported so
 * tests can drive a handler's code without the queue.
 */
export function toolRunner(workDir: string, signal: AbortSignal): TaskContext["run"] {
  return async (cmd, args, opts = {}) => {
    const label = opts.label ?? basename(cmd);
    const timeoutMs = opts.timeoutMs ?? env.childTimeoutMs;
    const r = await exec([cmd, ...args], {
      memoryBytes: opts.memoryBytes ?? childMemoryLimit(),
      timeoutMs,
      cwd: opts.cwd ?? workDir,
      // glibc reserves 64 MB of address space per thread arena; under `--as` that is memory lost to nothing.
      env: { MALLOC_ARENA_MAX: "2", ...opts.env },
      signal,
      stdout: opts.stdout,
    });
    if (r.aborted) throw new Discarded();
    if (ranOutOfMemory(r)) throw new TaskError(outOfMemorySentence(opts.where, opts.hint));
    if (r.timedOut) {
      throw new TaskError(`${label} took longer than ${Math.round(timeoutMs / 60_000)} minutes and was stopped.`);
    }
    if (opts.check !== false && (r.code !== 0 || r.signal)) {
      const why = lastLine(r.stderr);
      throw new TaskError(`${label} could not process this file${why ? `: ${why}` : "."}`);
    }
    return r;
  };
}

async function runTask(row: TaskRow): Promise<void> {
  const jobDir = join(RESULTS, row.job_id);
  const partDir = join(jobDir, `${row.id}.part`);
  const finalDir = join(jobDir, row.id);
  const workDir = join(env.workDir, row.id);
  const controller = new AbortController();
  const progress = progressWriter(row.id);
  const started = Date.now();

  // Discarding the job deletes the task row; notice within a second and kill the child.
  let ticks = 0;
  const watch = setInterval(() => {
    if (!exists.get(row.id)) controller.abort();
    else if (++ticks % 60 === 0) touchJob(row.job_id);
  }, 1000);

  try {
    const handler = handlers.get(row.kind);
    if (!handler) throw new TaskError("This step is not available on the server yet.");
    const inputs = inputsOf(row.job_id);
    if (!inputs) throw new TaskError("The uploaded file has expired — upload it again.");
    const job = db
      .query<{ tool: PdfTool; password: string | null }, [string]>("SELECT tool, password FROM pdf_jobs WHERE id = ?")
      .get(row.job_id);
    if (!job) throw new Discarded();
    await mkdir(partDir, { recursive: true });
    await mkdir(workDir, { recursive: true });

    const ctx: TaskContext = {
      task: { id: row.id, kind: row.kind, params: JSON.parse(row.params) },
      job: { id: row.job_id, tool: job.tool, password: job.password },
      inputs,
      analysis: analysisOf(row.job_id),
      outDir: partDir,
      workDir,
      signal: controller.signal,
      progress: progress.report,
      run: toolRunner(workDir, controller.signal),
    };

    const out = await handler(ctx);
    if (controller.signal.aborted) throw new Discarded();
    if (out.file) {
      if (basename(out.file.name) !== out.file.name) throw new Error(`output ${out.file.name} is not a plain file name`);
      await stat(join(partDir, out.file.name)); // the handler promised a file; it must be there
    }
    await rm(finalDir, { recursive: true, force: true });
    await publish(partDir, finalDir);
    progress.stop();
    // Discarded between the last check and now: take the output back out.
    if (!finish(row.id, { state: "done", result: out.result ?? null, file: out.file })) throw new Discarded();
    touchJob(row.job_id);
    console.log(`[jobs] ${row.kind} ${row.id} done in ${Date.now() - started} ms`);
  } catch (err) {
    progress.stop();
    await rm(partDir, { recursive: true, force: true });
    if (err instanceof Discarded || controller.signal.aborted) {
      await rm(finalDir, { recursive: true, force: true });
      console.log(`[jobs] ${row.kind} ${row.id} discarded`);
      return;
    }
    const sentence = err instanceof TaskError ? err.message : "Something went wrong while processing this file — try again.";
    if (!(err instanceof TaskError)) console.error(`[jobs] ${row.kind} ${row.id} crashed:`, err);
    else console.log(`[jobs] ${row.kind} ${row.id} failed: ${sentence}`);
    finish(row.id, { state: "failed", error: sentence });
    touchJob(row.job_id);
  } finally {
    clearInterval(watch);
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * A task still marked running at startup belonged to a worker that died with
 * it — most likely the OOM killer taking the whole container. It cannot be
 * resumed; fail it with a sentence and clear the scratch it left.
 */
async function recover(): Promise<void> {
  const now = Date.now();
  const stuck = db.run(
    "UPDATE pdf_tasks SET state = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE state = 'running'",
    ["The PDF worker restarted while this was running — probably out of memory. Try again, or with a lower DPI cap.", now, now],
  ).changes;
  if (stuck) console.log(`[jobs] failed ${stuck} task(s) left running by the last worker`);
  for (const name of await readdir(env.workDir).catch(() => [] as string[])) {
    await rm(join(env.workDir, name), { recursive: true, force: true });
  }
  for (const jobId of await readdir(RESULTS).catch(() => [] as string[])) {
    for (const name of await readdir(join(RESULTS, jobId)).catch(() => [] as string[])) {
      if (name.endsWith(".part")) await rm(join(RESULTS, jobId, name), { recursive: true, force: true });
    }
  }
}

export async function startJobs(): Promise<void> {
  await mkdir(RESULTS, { recursive: true });
  await recover();
  const loop = async () => {
    try {
      for (let row = claim(); row; row = claim()) await runTask(row);
    } catch (err) {
      console.error("[jobs] loop failed:", err); // e.g. the database was locked past its timeout; try again next tick
    }
    setTimeout(loop, env.pollMs);
  };
  void loop();
  console.log(`  pdf jobs    ->  ${handlers.size} handler(s): ${[...handlers.keys()].join(", ") || "none"}`);
}
