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
  /** Anything bigger is refused by Bun before it is buffered. */
  maxBodyBytes: int(process.env.MAX_BODY_BYTES, 16 * 1024 * 1024),
  /** A saved project's doc + data, serialized. */
  maxProjectBytes: int(process.env.MAX_PROJECT_BYTES, 8 * 1024 * 1024),
  maxProjects: int(process.env.MAX_PROJECTS, 5000),
  /** Total bytes of uploaded assets across everyone. */
  maxAssetBytes: int(process.env.MAX_ASSET_BYTES, 2 * 1024 * 1024 * 1024),
  /** Writes to a volume stop while it has less than this free — each is shared with the rest of the box. */
  minFreeBytes: int(process.env.MIN_FREE_BYTES, 2 * 1024 * 1024 * 1024),
  /** Matches the editor's own ceiling on a side. */
  maxCanvasSide: int(process.env.MAX_CANVAS_SIDE, 8000),
  maxLayers: int(process.env.MAX_LAYERS, 100),
  /** Distinct font families a doc may pull in; each one is a whole family of TTFs. */
  maxFamilies: int(process.env.MAX_FAMILIES, 12),
  /** rows × width × height across one batch. */
  maxBatchPixels: int(process.env.MAX_BATCH_PIXELS, 2_000_000_000),
  /** The ZIP is held in memory until it is sent. */
  maxBatchBytes: int(process.env.MAX_BATCH_BYTES, 512 * 1024 * 1024),
  /** Renders running at once, and how many may wait behind them before the rest are turned away. */
  renderConcurrency: int(process.env.RENDER_CONCURRENCY, 1),
  renderQueue: int(process.env.RENDER_QUEUE, 3),
  fontCacheTtlMs: int(process.env.FONT_CACHE_TTL_MS, 24 * 60 * 60 * 1000),
};

/**
 * SQLite stays in the data dir — its WAL wants a real local filesystem. The
 * bulky, write-once files (uploads, cached font faces) can live elsewhere, e.g.
 * a pooled set of drives, via ASSETS_DIR and FONTS_DIR.
 */
export const paths = {
  db: resolve(env.dataDir, "tools.sqlite"),
  assets: resolve(process.env.ASSETS_DIR || resolve(env.dataDir, "assets")),
  fonts: resolve(process.env.FONTS_DIR || resolve(env.dataDir, "fonts")),
};

export function ensureDirs(): void {
  for (const dir of [env.dataDir, paths.assets, paths.fonts]) mkdirSync(dir, { recursive: true });
}
