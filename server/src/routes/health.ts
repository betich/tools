import { Elysia } from "elysia";
import { db } from "../lib/db";

const startedAt = Date.now();

function report() {
  const projects = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM projects").get()?.n ?? 0;
  return {
    ok: true,
    service: "betich-tools",
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    projects,
  };
}

/**
 * `/api/health` is what the client polls — it is the only prefix the dev proxy
 * and the Pages redirect forward. `/health` stays for the container probe.
 */
export const health = new Elysia().get("/api/health", report).get("/health", report);
