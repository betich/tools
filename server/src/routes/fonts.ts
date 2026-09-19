import { Elysia, t } from "elysia";
import { catalogue, faceFile, familyFaces, parseVariant } from "../lib/fonts";
import { rateLimit } from "../lib/limits";

export const fonts = new Elysia({ prefix: "/api/fonts" })
  .get(
    "/",
    async ({ query }) => {
      const { fonts: all, source } = await catalogue();
      const q = (query.q ?? "").trim().toLowerCase();
      const limit = Math.min(Number(query.limit) || 200, 1000);
      const filtered = q ? all.filter((f) => f.family.toLowerCase().includes(q)) : all;
      return {
        source,
        total: filtered.length,
        // `files` holds signed-ish upstream URLs the client never needs.
        fonts: filtered.slice(0, limit).map(({ family, category, variants }) => ({ family, category, variants })),
      };
    },
    { query: t.Object({ q: t.Optional(t.String()), limit: t.Optional(t.String()) }) },
  )
  /**
   * Streams the TTF for a family so an uploaded-font workflow and the server
   * renderer agree on bytes, and so the client can read a face into a canvas
   * without a cross-origin taint.
   */
  .get(
    "/:family/:variant",
    async ({ params, set }) => {
      const want = parseVariant(params.variant);
      const faces = await familyFaces(params.family);
      const face = faces.find((f) => f.weight === want.weight && f.italic === want.italic);
      if (!face) {
        set.status = 404;
        return { error: "font not available" };
      }
      // Served from the same disk cache the renderer uses, so Google is asked once per face.
      const file = await faceFile(params.family, face);
      if (!file) {
        set.status = 502;
        return { error: "upstream font fetch failed" };
      }
      set.headers["content-type"] = "font/ttf";
      set.headers["cache-control"] = "public, max-age=31536000, immutable";
      return Bun.file(file);
    },
    { params: t.Object({ family: t.String({ maxLength: 100 }), variant: t.String({ maxLength: 20 }) }), beforeHandle: rateLimit("font", 120) },
  );
