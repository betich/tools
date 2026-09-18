import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Elysia, t } from "elysia";
import { env, paths } from "../env";
import { db, id, nowIso } from "../lib/db";

const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
  "application/octet-stream",
  "application/font-sfnt",
  "application/x-font-ttf",
]);

export const assets = new Elysia({ prefix: "/api/assets" })
  .post(
    "/",
    async ({ body, set }) => {
      const file = body.file;
      if (file.size > env.maxUploadBytes) {
        set.status = 413;
        return { error: `file exceeds ${env.maxUploadBytes} bytes` };
      }
      const type = file.type || "application/octet-stream";
      if (!ALLOWED.has(type)) {
        set.status = 415;
        return { error: `unsupported content type: ${type}` };
      }

      const assetId = id("as");
      await writeFile(join(paths.assets, assetId), Buffer.from(await file.arrayBuffer()));
      db.run("INSERT INTO assets (id, file_name, content_type, bytes, created_at) VALUES (?, ?, ?, ?, ?)", [
        assetId,
        file.name || assetId,
        type,
        file.size,
        nowIso(),
      ]);
      set.status = 201;
      return { id: assetId, ref: `asset:${assetId}`, contentType: type, bytes: file.size };
    },
    { body: t.Object({ file: t.File() }) },
  )
  .get("/:id", async ({ params, set }) => {
    const row = db
      .query<{ content_type: string; file_name: string }, [string]>("SELECT content_type, file_name FROM assets WHERE id = ?")
      .get(params.id);
    if (!row) {
      set.status = 404;
      return { error: "not found" };
    }
    try {
      const buf = await readFile(join(paths.assets, params.id));
      set.headers["content-type"] = row.content_type;
      set.headers["cache-control"] = "public, max-age=31536000, immutable";
      return new Uint8Array(buf);
    } catch {
      set.status = 410;
      return { error: "asset bytes missing" };
    }
  });
