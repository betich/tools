import { env } from "./env";
import { lastBeat, startHeartbeat, startedAt } from "./heartbeat";
import { startJobs } from "./jobs";

startHeartbeat();
startJobs();

// For the container probe only; the API learns about the worker from the heartbeat row.
Bun.serve({
  port: env.port,
  fetch(req) {
    if (new URL(req.url).pathname !== "/health") return new Response("not found", { status: 404 });
    return Response.json({
      ok: true,
      service: "pdf-worker",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      lastBeat: new Date(lastBeat).toISOString(),
    });
  },
});

console.log(`  pdf worker  ->  http://localhost:${env.port}/health`);
