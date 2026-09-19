import type { JobCreate, JobEvent, JobInfo, TaskCreate, TaskInfo } from "@tools/shared";
import { ApiError, request, url } from "./api";

/**
 * The PDF job session (#6): a job holds the uploaded inputs, the analysis and
 * every task run against them, and lives an hour past its last action. These
 * are the typed calls for its routes. Files come back through plain absolute
 * URLs rather than fetches, so a gigabyte result streams to disk instead of
 * sitting in a Blob.
 */

const path = (id: string) => `/api/pdf/jobs/${encodeURIComponent(id)}`;

export const pdfJobs = {
  create: (body: JobCreate) => request<JobInfo>("/api/pdf/jobs", { method: "POST", body: JSON.stringify(body) }),
  get: (id: string) => request<JobInfo>(path(id)),
  /** Deletes the inputs, results and rows now, rather than when the hour runs out. */
  discard: (id: string) => request<null>(path(id), { method: "DELETE" }),
  addTask: (id: string, body: TaskCreate) =>
    request<TaskInfo>(`${path(id)}/tasks`, { method: "POST", body: JSON.stringify(body) }),
  /**
   * Opens an encrypted input (#15). The password stays on the job row, never in
   * task params, and a fresh `analyse` task is queued with it; a wrong one is a
   * 400 whose sentence is shown as-is.
   */
  unlock: (id: string, password: string) =>
    request<JobInfo>(`${path(id)}/unlock`, { method: "POST", body: JSON.stringify({ password }) }),
  /**
   * Opens a compress job on a finished merge's output (#18). The server moves
   * the file across as that job's upload — nothing passes back through the
   * browser — and queues its analysis. The merge job stays until its own hour
   * runs out or it is discarded.
   */
  handoff: (id: string, taskId: string) =>
    request<JobInfo>(`${path(id)}/handoff`, { method: "POST", body: JSON.stringify({ task: taskId }) }),
  /** The output file of a compress/merge task — the latest finished one when `taskId` is left out. */
  resultUrl: (id: string, taskId?: string) =>
    url(`${path(id)}/result${taskId ? `?task=${encodeURIComponent(taskId)}` : ""}`),
  /** A small artefact of a task: a crop PNG, a thumbnail. */
  taskFileUrl: (id: string, taskId: string, name: string) =>
    url(`${path(id)}/tasks/${encodeURIComponent(taskId)}/file/${encodeURIComponent(name)}`),
};

const EVENT_TYPES = ["job", "task", "expired"] as const;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

/**
 * Follows a job over its SSE stream. The server opens with a `job` snapshot
 * and sends deltas after, so a reconnect needs no bookkeeping here: the next
 * snapshot replaces whatever was missed. EventSource gives up by itself on a
 * non-200 answer and hides the status, so every error closes the source and
 * this reopens it with backoff — after first asking the plain GET whether the
 * job still exists, because a 404 there means the hour ran out while we were
 * away and the stream will never come back. Stops for good on `expired`.
 * Returns the function that stops watching.
 */
export function watchJob(id: string, onEvent: (event: JobEvent) => void): () => void {
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let stopped = false;

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    source?.close();
    source = null;
  };

  const deliver = (event: JobEvent) => {
    if (stopped) return;
    failures = 0;
    if (event.type === "expired") stop();
    onEvent(event);
  };

  const connect = () => {
    if (stopped) return;
    const es = new EventSource(url(`${path(id)}/events`));
    source = es;
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (message) => {
        if (type === "expired") return deliver({ type });
        let data: unknown;
        try {
          data = JSON.parse((message as MessageEvent<string>).data);
        } catch {
          return;
        }
        // The server may send the bare object or the whole event; accept either.
        const body = data as Record<string, unknown>;
        if (type === "job") deliver({ type, job: (body.job ?? body) as JobInfo });
        else deliver({ type, task: (body.task ?? body) as TaskInfo });
      });
    }
    es.onerror = () => {
      if (source !== es) return;
      es.close();
      source = null;
      void retry();
    };
  };

  const retry = async () => {
    if (stopped) return;
    try {
      await pdfJobs.get(id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return deliver({ type: "expired" });
      // Unreachable or refused: the stream would fail the same way, so just wait longer.
    }
    if (stopped) return;
    const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
    failures++;
    timer = setTimeout(connect, wait);
  };

  connect();
  return stop;
}
