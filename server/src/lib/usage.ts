import { createHash } from "node:crypto";
import { db } from "./db";

/**
 * Enough to answer "is anyone using this?" and nothing more: a count per route
 * per day, and per day the set of callers as salted hashes. No addresses are
 * stored, and a hash cannot be matched across days because the day is in it.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS usage (
    day   TEXT NOT NULL,
    route TEXT NOT NULL,
    hits  INTEGER NOT NULL,
    PRIMARY KEY (day, route)
  );

  CREATE TABLE IF NOT EXISTS visitors (
    day TEXT NOT NULL,
    who TEXT NOT NULL,
    PRIMARY KEY (day, who)
  );
`);

/**
 * Calls that come in bursts or on their own — the health poll, an upload's
 * 32 MB parts and resume checks, an event stream's reconnects — would drown
 * the calls that stand for something a person did. Their callers still count.
 */
const NOISY = new Set([
  "GET /api/health",
  "GET /api/pdf/uploads/:id",
  "PUT /api/pdf/uploads/:id/parts/:n",
  "GET /api/pdf/jobs/:id",
  "GET /api/pdf/jobs/:id/events",
  "GET /api/pdf/jobs/:id/tasks/:taskId/file/:name",
]);

const today = () => new Date().toISOString().slice(0, 10);
const bump = db.prepare("INSERT INTO usage (day, route, hits) VALUES (?, ?, 1) ON CONFLICT (day, route) DO UPDATE SET hits = hits + 1");
const seen = db.prepare("INSERT OR IGNORE INTO visitors (day, who) VALUES (?, ?)");

/**
 * `route` is the matched pattern (`/api/projects/:id`), so a thousand projects
 * are one row. The noisy calls above count their caller but not as a hit.
 */
export function recordUsage(method: string, route: string, ip: string): void {
  if (!route || route === "/health" || route.startsWith("/api/admin") || method === "OPTIONS") return;
  const day = today();
  try {
    seen.run(day, createHash("sha256").update(`${day}:${ip}`).digest("hex").slice(0, 16));
    if (!NOISY.has(`${method} ${route}`)) bump.run(day, `${method} ${route}`);
  } catch (error) {
    console.error("[usage]", error); // never worth failing a request over
  }
}

/** The last `days` days, oldest first, with the empty ones filled in. */
export function usageReport(days = 30) {
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const hits = new Map(
    db.query<{ day: string; n: number }, [string]>("SELECT day, SUM(hits) AS n FROM usage WHERE day >= ? GROUP BY day").all(since).map((r) => [r.day, r.n]),
  );
  const visitors = new Map(
    db.query<{ day: string; n: number }, [string]>("SELECT day, COUNT(*) AS n FROM visitors WHERE day >= ? GROUP BY day").all(since).map((r) => [r.day, r.n]),
  );
  const series = Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.parse(since) + i * 86_400_000).toISOString().slice(0, 10);
    return { day, hits: hits.get(day) ?? 0, visitors: visitors.get(day) ?? 0 };
  });
  const routes = db
    .query<{ route: string; hits: number }, [string]>("SELECT route, SUM(hits) AS hits FROM usage WHERE day >= ? GROUP BY route ORDER BY hits DESC")
    .all(since);
  return { series, routes };
}

// Visitor hashes are only useful for a daily count; a quarter is plenty of history.
setInterval(() => {
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  db.run("DELETE FROM visitors WHERE day < ?", [cutoff]);
}, 6 * 60 * 60_000).unref();
