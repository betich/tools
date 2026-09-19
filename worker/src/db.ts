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

// The API creates the same table; whichever starts first wins.
db.exec(`
  CREATE TABLE IF NOT EXISTS worker_heartbeat (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    beat_at    INTEGER NOT NULL,
    started_at INTEGER NOT NULL
  );
`);
