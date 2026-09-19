import { WORKER_STALE_MS, type PdfWorkerStatus } from "@tools/shared";
import { db } from "./db";

/** Whether the pdf-worker container is alive, judged by the age of its last heartbeat. */
export function workerStatus(): PdfWorkerStatus {
  const row = db
    .query<{ beat_at: number; started_at: number }, []>("SELECT beat_at, started_at FROM worker_heartbeat WHERE id = 1")
    .get();
  if (!row) return { up: false, lastBeat: null, startedAt: null };
  return {
    up: Date.now() - row.beat_at < WORKER_STALE_MS,
    lastBeat: new Date(row.beat_at).toISOString(),
    startedAt: new Date(row.started_at).toISOString(),
  };
}
