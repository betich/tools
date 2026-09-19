import { Database } from "bun:sqlite";
import { ensureDirs, paths } from "../env";

ensureDirs();

export const db = new Database(paths.db, { create: true });

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
// The pdf-worker writes to this file from its own container.
db.exec("PRAGMA busy_timeout = 5000;");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    doc        TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shares (
    slug          TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    password_hash TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS shares_project ON shares(project_id);

  CREATE TABLE IF NOT EXISTS assets (
    id           TEXT PRIMARY KEY,
    file_name    TEXT NOT NULL,
    content_type TEXT NOT NULL,
    bytes        INTEGER NOT NULL,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL,
    bytes      INTEGER NOT NULL,
    part_size  INTEGER NOT NULL,
    parts      INTEGER NOT NULL,
    caller     TEXT NOT NULL,
    kind       TEXT,
    touched_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS uploads_touched ON uploads(touched_at);

  CREATE TABLE IF NOT EXISTS upload_parts (
    upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    n         INTEGER NOT NULL,
    sha256    TEXT NOT NULL,
    PRIMARY KEY (upload_id, n)
  );

  CREATE TABLE IF NOT EXISTS cache (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- PDF jobs (#6). The pdf-worker claims and updates tasks from its own
  -- container; worker/src/db.ts repeats these definitions — keep them identical.
  CREATE TABLE IF NOT EXISTS pdf_jobs (
    id         TEXT PRIMARY KEY,
    tool       TEXT NOT NULL,
    caller     TEXT NOT NULL,
    touched_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pdf_jobs_touched ON pdf_jobs(touched_at);

  CREATE TABLE IF NOT EXISTS pdf_job_inputs (
    job_id    TEXT NOT NULL REFERENCES pdf_jobs(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    upload_id TEXT NOT NULL,
    PRIMARY KEY (job_id, position)
  );
  CREATE INDEX IF NOT EXISTS pdf_job_inputs_upload ON pdf_job_inputs(upload_id);

  CREATE TABLE IF NOT EXISTS pdf_tasks (
    id          TEXT PRIMARY KEY,
    job_id      TEXT NOT NULL REFERENCES pdf_jobs(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    params      TEXT NOT NULL,
    state       TEXT NOT NULL,
    priority    INTEGER NOT NULL,
    caller      TEXT NOT NULL,
    progress    TEXT,
    result      TEXT,
    error       TEXT,
    output_file TEXT,
    output_name TEXT,
    created_at  INTEGER NOT NULL,
    started_at  INTEGER,
    finished_at INTEGER,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pdf_tasks_queue ON pdf_tasks(state, priority, created_at);
  CREATE INDEX IF NOT EXISTS pdf_tasks_job ON pdf_tasks(job_id);

  -- First-page thumbnails of PDF uploads (#17), drawn by the worker's priority
  -- lane next to the upload (uploads/<id>/thumbnail.png). No job needed.
  CREATE TABLE IF NOT EXISTS pdf_thumbnails (
    upload_id    TEXT PRIMARY KEY REFERENCES uploads(id) ON DELETE CASCADE,
    state        TEXT NOT NULL,
    requested_at INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );

  -- Written every few seconds by the pdf-worker container (worker/src/heartbeat.ts).
  CREATE TABLE IF NOT EXISTS worker_heartbeat (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    beat_at    INTEGER NOT NULL,
    started_at INTEGER NOT NULL
  );
`);

// Shares predate the password column; add it in place for existing databases.
const shareColumns = db.query<{ name: string }, []>("PRAGMA table_info(shares)").all().map((c) => c.name);
if (!shareColumns.includes("password_hash")) db.exec("ALTER TABLE shares ADD COLUMN password_hash TEXT");

export function cacheGet<T>(key: string): T | null {
  const row = db.query<{ value: string; expires_at: number }, [string]>("SELECT value, expires_at FROM cache WHERE key = ?").get(key);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.run("DELETE FROM cache WHERE key = ?", [key]);
    return null;
  }
  return JSON.parse(row.value) as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  db.run("INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)", [key, JSON.stringify(value), Date.now() + ttlMs]);
}

export const nowIso = () => new Date().toISOString();

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Short, unambiguous slug for share links — no vowels, so no accidental words. */
export function slug(len = 8): string {
  const alphabet = "23456789bcdfghjkmnpqrstvwxz";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
