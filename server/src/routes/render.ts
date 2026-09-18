import { Elysia, t } from "elysia";
import { zipSync } from "fflate";
import { fileNameFor, type MergeData, type MergeDoc, type MergeRow } from "@tools/shared";
import { env } from "../env";
import { prepareFonts, renderRow, resolveImage } from "../lib/render";

const renderBody = t.Object({
  doc: t.Any(),
  row: t.Optional(t.Any()),
});

const batchBody = t.Object({
  doc: t.Any(),
  data: t.Any(),
  /** Template for each file name, e.g. `card-<name>`. */
  namePattern: t.Optional(t.String()),
});

export const render = new Elysia({ prefix: "/api/render" })
  .post(
    "/",
    async ({ body, set }) => {
      const doc = body.doc as MergeDoc;
      await prepareFonts(doc);
      const base = doc.base ? await resolveImage(doc.base.src) : null;
      const { buffer } = await renderRow(doc, (body.row as MergeRow | undefined) ?? null, base);
      set.headers["content-type"] = "image/png";
      return new Uint8Array(buffer);
    },
    { body: renderBody },
  )

  /**
   * Renders every row server-side and returns one ZIP. The base image is
   * decoded once and the fonts registered once, so a 500-row merge costs one
   * setup and 500 draws rather than 500 of each.
   */
  .post(
    "/batch",
    async ({ body, set }) => {
      const doc = body.doc as MergeDoc;
      const data = body.data as MergeData;
      const rows = Array.isArray(data?.rows) ? data.rows : [];

      if (rows.length === 0) {
        set.status = 400;
        return { error: "no rows to render" };
      }
      if (rows.length > env.maxBatchRows) {
        set.status = 413;
        return { error: `batch capped at ${env.maxBatchRows} rows`, received: rows.length };
      }

      const missingFonts = await prepareFonts(doc);
      const base = doc.base ? await resolveImage(doc.base.src) : null;
      const pattern = body.namePattern?.trim() || "row";

      const files: Record<string, Uint8Array> = {};
      const taken = new Set<string>();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const { buffer } = await renderRow(doc, row, base);
        files[unique(fileNameFor(pattern, row, i, "png"), taken)] = new Uint8Array(buffer);
      }

      const zip = zipSync(files, { level: 0 }); // PNGs are already deflated
      set.headers["content-type"] = "application/zip";
      set.headers["content-disposition"] = `attachment; filename="${safe(doc.name || "merge")}.zip"`;
      if (missingFonts.length) set.headers["x-missing-fonts"] = missingFonts.join(",");
      return zip;
    },
    { body: batchBody },
  );

function unique(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);
  let n = 2;
  while (taken.has(`${stem}-${n}${ext}`)) n++;
  const out = `${stem}-${n}${ext}`;
  taken.add(out);
  return out;
}

function safe(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "merge";
}
