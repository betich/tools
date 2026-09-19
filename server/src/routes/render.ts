import { Elysia, t } from "elysia";
import { zipSync } from "fflate";
import { docForRow, fileNameFor, type MergeData, type MergeDoc, type MergeRow } from "@tools/shared";
import { env } from "../env";
import { docProblem, rateLimit, refuse, withRenderSlot } from "../lib/limits";
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

/** Yield to the event loop so health checks and other callers are answered mid-batch. */
const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

export const render = new Elysia({ prefix: "/api/render" })
  .post(
    "/",
    async (ctx) => {
      const { body, set } = ctx;
      const doc = body.doc as MergeDoc;
      const problem = docProblem(doc);
      if (problem) return refuse(set, 413, problem);
      return withRenderSlot(ctx, async () => {
        await prepareFonts(doc);
        const base = doc.base ? await resolveImage(doc.base.src) : null;
        const { buffer } = await renderRow(doc, (body.row as MergeRow | undefined) ?? null, base);
        set.headers["content-type"] = "image/png";
        return new Uint8Array(buffer);
      });
    },
    { body: renderBody, beforeHandle: rateLimit("render", 60) },
  )

  /**
   * Renders every row server-side and returns one ZIP. The base image is
   * decoded once and the fonts registered once, so a 500-row merge costs one
   * setup and 500 draws rather than 500 of each.
   */
  .post(
    "/batch",
    async (ctx) => {
      const { body, set, request } = ctx;
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
      const problem = docProblem(doc);
      if (problem) return refuse(set, 413, problem);
      if (rows.length * doc.canvas.width * doc.canvas.height > env.maxBatchPixels) {
        return refuse(set, 413, "too many pixels for one batch — fewer rows or a smaller canvas");
      }

      return withRenderSlot(ctx, async () => {
        const missingFonts = await prepareFonts(doc);
        const base = doc.base ? await resolveImage(doc.base.src) : null;
        const pattern = body.namePattern?.trim() || "row";

        const files: Record<string, Uint8Array> = {};
        const taken = new Set<string>();
        let bytes = 0;
        for (let i = 0; i < rows.length; i++) {
          // Nobody is waiting for the ZIP any more; stop spending the CPU on it.
          if (request.signal.aborted) return refuse(set, 499, "render cancelled");
          const row = rows[i]!;
          const { buffer } = await renderRow(docForRow(doc, data.keys?.[i]), row, base);
          bytes += buffer.byteLength;
          if (bytes > env.maxBatchBytes) return refuse(set, 413, "the images add up to too much for one ZIP — split the sheet");
          files[unique(fileNameFor(pattern, row, i, "png"), taken)] = new Uint8Array(buffer);
          await breathe();
        }

        const zip = zipSync(files, { level: 0 }); // PNGs are already deflated
        set.headers["content-type"] = "application/zip";
        set.headers["content-disposition"] = `attachment; filename="${safe(doc.name || "merge")}.zip"`;
        if (missingFonts.length) set.headers["x-missing-fonts"] = missingFonts.join(",");
        return zip;
      });
    },
    { body: batchBody, beforeHandle: rateLimit("batch", 10) },
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
