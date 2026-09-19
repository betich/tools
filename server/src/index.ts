import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";
import { env, ensureDirs } from "./env";
import { clientIp, rateLimit } from "./lib/limits";
import { recordUsage } from "./lib/usage";
import { admin } from "./routes/admin";
import { assets } from "./routes/assets";
import { fonts } from "./routes/fonts";
import { health } from "./routes/health";
import { pdfUploads } from "./routes/pdf-uploads";
import { projects, shares } from "./routes/projects";
import { render } from "./routes/render";
import { tools } from "./routes/tools";
import { worker } from "./routes/worker";

ensureDirs();

const everyCall = rateLimit("all", 300);

/** Only upload parts stream to disk; every other body is read into memory and keeps the smaller cap. */
const STREAMED = /^\/api\/pdf\/uploads\/[^/]+\/parts\/[^/]+$/;

export const app = new Elysia({ serve: { maxRequestBodySize: Math.max(env.maxBodyBytes, env.maxPartBodyBytes) } })
  .use(cors({ origin: env.origins, credentials: true }))
  .onRequest(({ request, set }) => {
    if (Number(request.headers.get("content-length") ?? 0) <= env.maxBodyBytes) return;
    if (STREAMED.test(new URL(request.url).pathname)) return;
    set.status = 413;
    return { error: "that request is too large" };
  })
  // A ceiling on everything but the container's own probe; the costly routes add tighter ones.
  .onBeforeHandle({ as: "global" }, (ctx) => (new URL(ctx.request.url).pathname === "/health" ? undefined : everyCall(ctx)))
  .onAfterResponse({ as: "global" }, (ctx) => recordUsage(ctx.request.method, ctx.route, clientIp(ctx)))
  .use(swagger({ path: "/api/docs", documentation: { info: { title: "betich's tools", version: "0.1.0" } } }))
  .onError(({ code, error, set }) => {
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "not found" };
    }
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: "invalid request", detail: String(error) };
    }
    console.error(`[${code}]`, error);
    set.status = 500;
    return { error: "internal error" };
  })
  .use(health)
  .use(tools)
  .use(fonts)
  .use(assets)
  .use(projects)
  .use(shares)
  .use(render)
  .use(admin)
  .use(worker)
  .use(pdfUploads)
  .listen(env.port);

console.log(`  tools api  ->  http://localhost:${env.port}`);
console.log(`  docs       ->  http://localhost:${env.port}/api/docs`);
console.log(`  data       ->  ${env.dataDir}`);
console.log(`  fonts      ->  ${env.googleFontsKey ? "google webfonts api" : "fallback catalogue (no GOOGLE_FONTS_API_KEY)"}`);

export type App = typeof app;
