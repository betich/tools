import { Elysia, t } from "elysia";
import type { MergeData, MergeDoc, Project } from "@tools/shared";
import { db, id, nowIso, slug } from "../lib/db";

type Row = { id: string; name: string; doc: string; data: string; created_at: string; updated_at: string };

const hydrate = (row: Row): Project => ({
  id: row.id,
  name: row.name,
  doc: JSON.parse(row.doc) as MergeDoc,
  data: JSON.parse(row.data) as MergeData,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * A share password locks the project, not just its link: reading, saving,
 * deleting and re-locking all need it. An unlocked project stays open to
 * anyone, as it always was. The password travels in `x-share-password`.
 */
async function access(projectId: string, supplied: string | undefined): Promise<"ok" | "missing" | "denied"> {
  const link = db
    .query<{ password_hash: string | null }, [string]>("SELECT password_hash FROM shares WHERE project_id = ?")
    .get(projectId);
  if (!link?.password_hash) return "ok";
  if (!supplied) return "missing";
  return (await Bun.password.verify(supplied, link.password_hash)) ? "ok" : "denied";
}

type Guard = { projectId: string; headers: Record<string, string | undefined>; set: { status?: number | string } };

/** `null` when the caller may proceed; otherwise the 401 body to send back. */
async function guard({ projectId, headers, set }: Guard) {
  const verdict = await access(projectId, headers["x-share-password"]);
  if (verdict === "ok") return null;
  set.status = 401;
  return { error: verdict === "missing" ? "password required" : "wrong password", protected: true };
}

const shareOf = (projectId: string) => {
  const link = db
    .query<{ slug: string; password_hash: string | null }, [string]>("SELECT slug, password_hash FROM shares WHERE project_id = ?")
    .get(projectId);
  return link ? { slug: link.slug, protected: Boolean(link.password_hash) } : null;
};

const projectBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  doc: t.Any(),
  data: t.Any(),
});

export const projects = new Elysia({ prefix: "/api/projects" })
  /** Every project, locked ones included — the lock guards the contents, not the name. */
  .get("/", () => {
    const rows = db
      .query<Omit<Row, "doc" | "data"> & { slug: string | null; locked: number }, []>(
        `SELECT p.id, p.name, p.created_at, p.updated_at, s.slug, (s.password_hash IS NOT NULL) AS locked
         FROM projects p LEFT JOIN shares s ON s.project_id = p.id
         ORDER BY p.updated_at DESC`,
      )
      .all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      slug: r.slug,
      locked: Boolean(r.locked),
    }));
  })

  .post(
    "/",
    ({ body, set }) => {
      const projectId = id("pr");
      const ts = nowIso();
      db.run("INSERT INTO projects (id, name, doc, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
        projectId,
        body.name,
        JSON.stringify(body.doc),
        JSON.stringify(body.data),
        ts,
        ts,
      ]);
      set.status = 201;
      return { id: projectId, name: body.name, createdAt: ts, updatedAt: ts };
    },
    { body: projectBody },
  )

  .get("/:id", async ({ params, headers, set }) => {
    const row = db.query<Row, [string]>("SELECT * FROM projects WHERE id = ?").get(params.id);
    if (!row) {
      set.status = 404;
      return { error: "not found" };
    }
    const denied = await guard({ projectId: params.id, headers, set });
    if (denied) return denied;
    return { ...hydrate(row), share: shareOf(params.id) };
  })

  .put(
    "/:id",
    async ({ params, body, headers, set }) => {
      const denied = await guard({ projectId: params.id, headers, set });
      if (denied) return denied;
      const ts = nowIso();
      const res = db.run("UPDATE projects SET name = ?, doc = ?, data = ?, updated_at = ? WHERE id = ?", [
        body.name,
        JSON.stringify(body.doc),
        JSON.stringify(body.data),
        ts,
        params.id,
      ]);
      if (res.changes === 0) {
        set.status = 404;
        return { error: "not found" };
      }
      return { id: params.id, name: body.name, updatedAt: ts };
    },
    { body: projectBody },
  )

  .delete("/:id", async ({ params, headers, set }) => {
    const denied = await guard({ projectId: params.id, headers, set });
    if (denied) return denied;
    const res = db.run("DELETE FROM projects WHERE id = ?", [params.id]);
    if (res.changes === 0) {
      set.status = 404;
      return { error: "not found" };
    }
    set.status = 204;
    return null;
  })

  /**
   * Mint (or update) a public read-only link. Passing a password locks the
   * link; passing an empty string unlocks it. The slug is stable either way,
   * so a link already handed out keeps working. Changing the lock on a locked
   * project needs its current password.
   */
  .post(
    "/:id/share",
    async ({ params, body, headers, set }) => {
      const exists = db.query<{ id: string }, [string]>("SELECT id FROM projects WHERE id = ?").get(params.id);
      if (!exists) {
        set.status = 404;
        return { error: "not found" };
      }
      const denied = await guard({ projectId: params.id, headers, set });
      if (denied) return denied;

      const password = body?.password?.trim() ?? "";
      const hash = password ? await Bun.password.hash(password) : null;

      const existing = db.query<{ slug: string }, [string]>("SELECT slug FROM shares WHERE project_id = ?").get(params.id);
      if (existing) {
        if (body && "password" in body) db.run("UPDATE shares SET password_hash = ? WHERE slug = ?", [hash, existing.slug]);
        return { slug: existing.slug, protected: Boolean(hash) };
      }

      const s = slug();
      db.run("INSERT INTO shares (slug, project_id, password_hash, created_at) VALUES (?, ?, ?, ?)", [s, params.id, hash, nowIso()]);
      set.status = 201;
      return { slug: s, protected: Boolean(hash) };
    },
    { body: t.Optional(t.Object({ password: t.Optional(t.String({ maxLength: 200 })) })) },
  )

  .delete("/:id/share", async ({ params, headers, set }) => {
    const denied = await guard({ projectId: params.id, headers, set });
    if (denied) return denied;
    db.run("DELETE FROM shares WHERE project_id = ?", [params.id]);
    set.status = 204;
    return null;
  });

export const shares = new Elysia({ prefix: "/api/share" })
  /** Cheap probe so the client can show a password form before asking for one. */
  .get("/:slug/meta", ({ params, set }) => {
    const link = db
      .query<{ password_hash: string | null }, [string]>("SELECT password_hash FROM shares WHERE slug = ?")
      .get(params.slug);
    if (!link) {
      set.status = 404;
      return { error: "not found" };
    }
    return { protected: Boolean(link.password_hash) };
  })

  .get(
    "/:slug",
    async ({ params, query, headers, set }) => {
      const link = db
        .query<{ project_id: string; password_hash: string | null }, [string]>(
          "SELECT project_id, password_hash FROM shares WHERE slug = ?",
        )
        .get(params.slug);
      if (!link) {
        set.status = 404;
        return { error: "not found" };
      }

      if (link.password_hash) {
        const supplied = headers["x-share-password"] ?? query.password ?? "";
        if (!supplied || !(await Bun.password.verify(supplied, link.password_hash))) {
          set.status = 401;
          return { error: supplied ? "wrong password" : "password required", protected: true };
        }
      }

      const row = db.query<Row, [string]>("SELECT * FROM projects WHERE id = ?").get(link.project_id);
      if (!row) {
        set.status = 404;
        return { error: "not found" };
      }
      // A share link opens the project itself — whoever holds it (and its
      // password) edits the same document everyone else sees.
      return { ...hydrate(row), share: { slug: params.slug, protected: Boolean(link.password_hash) } };
    },
    { query: t.Object({ password: t.Optional(t.String()) }) },
  );
