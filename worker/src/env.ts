import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const int = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const env = {
  /** Health endpoint, reachable only on the compose network. */
  port: int(process.env.WORKER_PORT, 8788),
  /** The same data dir the API uses — the job table and the heartbeat live in its SQLite. */
  dataDir: resolve(process.env.DATA_DIR ?? "./data"),
  /** Scratch space for a job's intermediate files; on the bulk drives in production. */
  workDir: resolve(process.env.WORK_DIR || resolve(process.env.DATA_DIR ?? "./data", "pdf-work")),
  /** The API's JOBS_DIR: uploads are read from it and results written into it. Must be the same path in both. */
  jobsDir: resolve(process.env.JOBS_DIR || resolve(process.env.DATA_DIR ?? "./data", "jobs")),
  /**
   * What the worker and its children may use between them. The Pi boots with
   * `cgroup_disable=memory`, so compose's `mem_limit` is not enforced and
   * this budget, applied through `prlimit`, is the real cap.
   */
  memoryBudgetBytes: int(process.env.WORKER_MEMORY_BYTES, 3 * 1024 ** 3),
  /** Kept back from the memory headroom for the worker itself and the page cache. */
  memoryReserveBytes: int(process.env.MEMORY_RESERVE_BYTES, 192 * 1024 * 1024),
  /**
   * The smallest address-space cap a child gets. `--as` counts reserved, not
   * resident, memory, and mutool/gs/vips reserve far more than they touch; a
   * cap below this fails them before they do any work.
   */
  childMemoryFloorBytes: int(process.env.CHILD_MEMORY_FLOOR_BYTES, 768 * 1024 * 1024),
  /** How long one child process may run. */
  childTimeoutMs: int(process.env.CHILD_TIMEOUT_MS, 10 * 60_000),
  /** How often an idle worker looks for a queued task. */
  pollMs: int(process.env.WORKER_POLL_MS, 500),
};

export const paths = {
  db: resolve(env.dataDir, "tools.sqlite"),
};

export function ensureDirs(): void {
  for (const dir of [env.dataDir, env.workDir, env.jobsDir]) mkdirSync(dir, { recursive: true });
}
