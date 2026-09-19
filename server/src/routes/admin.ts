import { createHash, timingSafeEqual } from "node:crypto";
import { statfs } from "node:fs/promises";
import { Elysia } from "elysia";
import { env, paths } from "../env";
import { db } from "../lib/db";
import { guessesLeft, rateLimit, refuse, wrongGuess } from "../lib/limits";
import { usageReport } from "../lib/usage";

type Ctx = Parameters<typeof guessesLeft>[0];

const digest = (s: string) => createHash("sha256").update(s).digest();

/** `null` when the caller holds the admin password; otherwise the refusal to send. */
function denied(ctx: Ctx, supplied: string | undefined) {
  if (!env.adminPassword) return refuse(ctx.set, 503, "admin is not configured on this server");
  const throttled = guessesLeft(ctx, "admin");
  if (throttled) return throttled;
  if (supplied && timingSafeEqual(digest(supplied), digest(env.adminPassword))) return null;
  wrongGuess(ctx, "admin");
  return refuse(ctx.set, 401, supplied ? "wrong password" : "password required");
}

async function free(dir: string): Promise<number | null> {
  try {
    const fs = await statfs(dir);
    return fs.bavail * fs.bsize;
  } catch {
    return null;
  }
}

const count = (sql: string) => db.query<{ n: number | null }, []>(sql).get()?.n ?? 0;

export const admin = new Elysia({ prefix: "/api/admin" }).get(
  "/stats",
  async (ctx) => {
    const no = denied(ctx, ctx.headers["x-admin-password"]);
    if (no) return no;
    return {
      uptimeSeconds: Math.round(process.uptime()),
      projects: count("SELECT COUNT(*) AS n FROM projects"),
      shares: count("SELECT COUNT(*) AS n FROM shares"),
      lockedShares: count("SELECT COUNT(*) AS n FROM shares WHERE password_hash IS NOT NULL"),
      assets: count("SELECT COUNT(*) AS n FROM assets"),
      assetBytes: count("SELECT SUM(bytes) AS n FROM assets"),
      freeBytes: { data: await free(env.dataDir), assets: await free(paths.assets) },
      recentProjects: db
        .query<{ id: string; name: string; updatedAt: string }, []>(
          "SELECT id, name, updated_at AS updatedAt FROM projects ORDER BY updated_at DESC LIMIT 10",
        )
        .all(),
      ...usageReport(30),
    };
  },
  { beforeHandle: rateLimit("admin", 30) },
);
