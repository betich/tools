import { Elysia, t } from "elysia";
import { catalogue, normaliseVariant } from "../lib/fonts";

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
      const { fonts: all } = await catalogue();
      const font = all.find((f) => f.family.toLowerCase() === params.family.toLowerCase());
      const url = font?.files[params.variant] ?? font?.files[normaliseVariant(params.variant)];
      if (!url) {
        set.status = 404;
        return { error: "font not available", hint: "set GOOGLE_FONTS_API_KEY to enable font file proxying" };
      }
      const res = await fetch(url);
      if (!res.ok) {
        set.status = 502;
        return { error: "upstream font fetch failed" };
      }
      set.headers["content-type"] = "font/ttf";
      set.headers["cache-control"] = "public, max-age=31536000, immutable";
      return new Uint8Array(await res.arrayBuffer());
    },
    { params: t.Object({ family: t.String(), variant: t.String() }) },
  );
