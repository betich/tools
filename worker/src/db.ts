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
    created_at INTEGER NOT NULL,
    -- An encrypted input's password (#15): the worker needs it in the clear, so
    -- it lives only here and goes when the job does.
    password   TEXT
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
  -- The same row also counts the pages (#37): pages is NULL until counted,
  -- then the count, 0 when qpdf cannot read the file, -1 when it needs a
  -- password. Added in place below for databases that predate it.
  CREATE TABLE IF NOT EXISTS pdf_thumbnails (
    upload_id    TEXT PRIMARY KEY REFERENCES uploads(id) ON DELETE CASCADE,
    state        TEXT NOT NULL,
    requested_at INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    pages        INTEGER
  );

  -- Per-page thumbnails for Merge's page view (#37), drawn by the same lane in
  -- batches of PAGE_THUMB_BATCH pages (uploads/<id>/pages/<n>.png).
  CREATE TABLE IF NOT EXISTS pdf_page_thumbs (
    upload_id    TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    batch        INTEGER NOT NULL,
    state        TEXT NOT NULL,
    requested_at INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (upload_id, batch)
  );
  CREATE INDEX IF NOT EXISTS pdf_page_thumbs_queue ON pdf_page_thumbs(state, requested_at);
`);

// Jobs predate the password column (#15); add it in place. The API and the
// worker both try, so the loser of that race sees "duplicate column".
const jobColumns = db.query<{ name: string }, []>("PRAGMA table_info(pdf_jobs)").all().map((c) => c.name);
if (!jobColumns.includes("password")) {
  try {
    db.exec("ALTER TABLE pdf_jobs ADD COLUMN password TEXT");
  } catch (err) {
    if (!String(err).includes("duplicate column")) throw err;
  }
}

// Thumbnails predate the page count (#37); add it in place, racing like the password column.
const thumbnailColumns = db.query<{ name: string }, []>("PRAGMA table_info(pdf_thumbnails)").all().map((c) => c.name);
if (!thumbnailColumns.includes("pages")) {
  try {
    db.exec("ALTER TABLE pdf_thumbnails ADD COLUMN pages INTEGER");
  } catch (err) {
    if (!String(err).includes("duplicate column")) throw err;
  }
}
