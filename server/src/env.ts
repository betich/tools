import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const int = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const env = {
  port: int(process.env.PORT, 8787),
  /** Where SQLite, uploaded assets and cached font files live. */
  dataDir: resolve(process.env.DATA_DIR ?? "./data"),
  /** Optional — without it the fonts route falls back to a curated list. */
  googleFontsKey: process.env.GOOGLE_FONTS_API_KEY ?? "",
  /** Comma-separated origins allowed to call the API. */
  origins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,https://tools.betich.me")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  /** Guard rails so a runaway merge cannot exhaust the box. */
  maxBatchRows: int(process.env.MAX_BATCH_ROWS, 500),
  maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 12 * 1024 * 1024),
  fontCacheTtlMs: int(process.env.FONT_CACHE_TTL_MS, 24 * 60 * 60 * 1000),
};

export const paths = {
  db: resolve(env.dataDir, "tools.sqlite"),
  assets: resolve(env.dataDir, "assets"),
  fonts: resolve(env.dataDir, "fonts"),
};

export function ensureDirs(): void {
  for (const dir of [env.dataDir, paths.assets, paths.fonts]) mkdirSync(dir, { recursive: true });
}
