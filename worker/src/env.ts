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
};

export const paths = {
  db: resolve(env.dataDir, "tools.sqlite"),
};

export function ensureDirs(): void {
  for (const dir of [env.dataDir, env.workDir]) mkdirSync(dir, { recursive: true });
}
