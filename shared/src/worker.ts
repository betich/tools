/**
 * The PDF worker runs in its own container (see #4) and shares only the SQLite
 * volume with the API. It stamps a heartbeat row every few seconds; the API
 * reads that row to tell whether anyone is there to pick up a job.
 */
export const WORKER_BEAT_MS = 5_000;
/** Three missed beats and the API reports the worker as down. */
export const WORKER_STALE_MS = 3 * WORKER_BEAT_MS;

/** GET /api/pdf/worker → 200. `lastBeat`/`startedAt` are ISO strings, null if it has never run. */
export type PdfWorkerStatus = { up: boolean; lastBeat: string | null; startedAt: string | null };
