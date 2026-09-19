import { Database } from "bun:sqlite";
import { ensureDirs, paths } from "./env";

ensureDirs();

/**
 * The API's database, opened from a second container. WAL lets both read
 * while one writes; the busy timeout covers the moments both want to write.
 */
export const db = new Database(paths.db, { create: true });

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");

// The API creates the same tables; whichever starts first wins.
db.exec(`
  CREATE TABLE IF NOT EXISTS worker_heartbeat (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    beat_at    INTEGER NOT NULL,
    started_at INTEGER NOT NULL
  );

  -- PDF jobs (#6), copied from server/src/lib/db.ts — keep them identical.
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
`);
