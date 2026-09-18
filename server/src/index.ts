import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";
import { env, ensureDirs } from "./env";
import { assets } from "./routes/assets";
import { fonts } from "./routes/fonts";
import { health } from "./routes/health";
import { projects, shares } from "./routes/projects";
import { render } from "./routes/render";
import { tools } from "./routes/tools";

ensureDirs();

export const app = new Elysia()
  .use(cors({ origin: env.origins, credentials: true }))
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
  .listen(env.port);

console.log(`  tools api  ->  http://localhost:${env.port}`);
console.log(`  docs       ->  http://localhost:${env.port}/api/docs`);
console.log(`  data       ->  ${env.dataDir}`);
console.log(`  fonts      ->  ${env.googleFontsKey ? "google webfonts api" : "fallback catalogue (no GOOGLE_FONTS_API_KEY)"}`);

export type App = typeof app;
