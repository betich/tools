import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The page-count and page-thumbnail routes (#37): what they answer for each
 * state of the worker's lane, and what they queue for it. The lane itself is
 * tested in worker/test/thumbnails.test.ts; here its work is faked by writing
 * rows and files the way it would.
 */

const root = mkdtempSync(join(tmpdir(), "pagethumbs-"));
process.env.DATA_DIR = root;
process.env.MIN_FREE_BYTES = "1";

let db: typeof import("../src/lib/db").db;
let app: typeof import("../src/routes/pdf-uploads").pdfUploads;
const IP = "203.0.113.7";
let n = 0;

beforeAll(async () => {
  db = (await import("../src/lib/db")).db;
  app = (await import("../src/routes/pdf-uploads")).pdfUploads;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  db.run("DELETE FROM pdf_page_thumbs");
  db.run("DELETE FROM pdf_thumbnails");
  workerUp(true);
});

function workerUp(up: boolean) {
  db.run("DELETE FROM worker_heartbeat");
  if (up) db.run("INSERT INTO worker_heartbeat (id, beat_at, started_at) VALUES (1, ?, ?)", [Date.now(), Date.now()]);
}

function upload(kind = "pdf", caller = IP): string {
  const id = `up_${(++n).toString(16).padStart(16, "0")}`;
  db.run(
    "INSERT INTO uploads (id, name, type, bytes, part_size, parts, caller, kind, touched_at, created_at) VALUES (?, 'a.pdf', 'application/pdf', 10, 10, 1, ?, ?, ?, ?)",
    [id, caller, kind, Date.now(), new Date().toISOString()],
  );
  mkdirSync(join(root, "jobs", "uploads", id, "pages"), { recursive: true });
  return id;
}

const counted = (id: string, pages: number | null, state = "done") =>
  db.run(
    "INSERT OR REPLACE INTO pdf_thumbnails (upload_id, state, requested_at, updated_at, pages) VALUES (?, ?, 0, 0, ?)",
    [id, state, pages],
  );
const drawn = (id: string, page: number) =>
  writeFileSync(join(root, "jobs", "uploads", id, "pages", `${page}.png`), "png");
const firstRow = (id: string) =>
  db
    .query<{ state: string; pages: number | null }, [string]>(
      "SELECT state, pages FROM pdf_thumbnails WHERE upload_id = ?",
    )
    .get(id);
const batches = (id: string) =>
  db
    .query<{ batch: number; state: string }, [string]>(
      "SELECT batch, state FROM pdf_page_thumbs WHERE upload_id = ? ORDER BY batch",
    )
    .all(id);

async function get(path: string, ip = IP) {
  const res = await app.handle(
    new Request(`http://localhost/api/pdf/uploads/${path}`, { headers: { "cf-connecting-ip": ip } }),
  );
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("json") ? await res.json() : await res.text();
  return { status: res.status, body: body as any, type };
}

describe("GET /:id/pages", () => {
  test("queues the count, answers 202, then 200 with it", async () => {
    const id = upload();
    const first = await get(`${id}/pages`);
    expect(first.status).toBe(202);
    expect(first.body.retryAfter).toBe(1);
    expect(firstRow(id)?.state).toBe("queued");
    // Asking again while it is queued does not queue it twice or change it.
    expect((await get(`${id}/pages`)).status).toBe(202);

    counted(id, 7);
    expect(await get(`${id}/pages`)).toMatchObject({ status: 200, body: { pages: 7 } });
  });

  test("a count survives a first page that failed to draw", async () => {
    const id = upload();
    counted(id, 3, "failed");
    expect(await get(`${id}/pages`)).toMatchObject({ status: 200, body: { pages: 3 } });
  });

  test("locked and unreadable are refusals the tile shows", async () => {
    const locked = upload();
    counted(locked, -1, "failed");
    expect(await get(`${locked}/pages`)).toMatchObject({
      status: 422,
      body: { error: "this PDF is password-protected" },
    });
    const broken = upload();
    counted(broken, 0, "failed");
    expect((await get(`${broken}/pages`)).status).toBe(422);
  });

  test("a count that was cut short (a timeout, a worker restart) is asked again", async () => {
    const died = upload();
    counted(died, null, "failed");
    expect((await get(`${died}/pages`)).status).toBe(202);
    expect(firstRow(died)).toEqual({ state: "queued", pages: null });
    // And the first page, which was never tried without a count, with it.
    const thumb = upload();
    counted(thumb, null, "failed");
    expect((await get(`${thumb}/thumbnail.png`)).status).toBe(202);
    expect(firstRow(thumb)?.state).toBe("queued");
  });

  test("a first page drawn before counts existed is asked again, for the count", async () => {
    const id = upload();
    counted(id, null, "done");
    expect((await get(`${id}/pages`)).status).toBe(202);
    expect(firstRow(id)?.state).toBe("queued");
  });

  test("worker offline is a 503 with no wait; images and unknowns are refused", async () => {
    workerUp(false);
    const offline = await get(`${upload()}/pages`);
    expect(offline.status).toBe(503);
    expect(offline.body.retryAfter).toBeUndefined();
    workerUp(true);
    expect((await get(`${upload("png")}/pages`)).status).toBe(415);
    expect((await get(`up_ffffffffffffffff/pages`)).status).toBe(404);
  });
});

describe("GET /:id/pages/:n.png", () => {
  test("before the count, asks for the count", async () => {
    const id = upload();
    expect((await get(`${id}/pages/2.png`)).status).toBe(202);
    expect(firstRow(id)?.state).toBe("queued");
    expect(batches(id)).toEqual([]);
  });

  test("queues the page's batch once, answers 202, then serves the PNG", async () => {
    const id = upload();
    counted(id, 60);
    expect((await get(`${id}/pages/30.png`)).status).toBe(202);
    expect((await get(`${id}/pages/26.png`)).status).toBe(202);
    expect(batches(id)).toEqual([{ batch: 1, state: "queued" }]);
    drawn(id, 30);
    const ok = await get(`${id}/pages/30.png`);
    expect(ok.status).toBe(200);
    expect(ok.type).toBe("image/png");
  });

  test("a batch marked done whose file is gone is asked again; a failed one is a 422", async () => {
    const id = upload();
    counted(id, 30);
    db.run(
      "INSERT INTO pdf_page_thumbs (upload_id, batch, state, requested_at, updated_at) VALUES (?, 0, 'done', 0, 0)",
      [id],
    );
    expect((await get(`${id}/pages/3.png`)).status).toBe(202);
    expect(batches(id)).toEqual([{ batch: 0, state: "queued" }]);
    db.run("UPDATE pdf_page_thumbs SET state = 'failed'");
    expect((await get(`${id}/pages/3.png`)).status).toBe(422);
  });

  test("pages that don't exist are 404s", async () => {
    const id = upload();
    counted(id, 5);
    expect(await get(`${id}/pages/6.png`)).toMatchObject({ status: 404, body: { error: "this PDF has 5 pages" } });
    for (const bad of ["0.png", "x.png", "3", "-1.png", "1.5.png"])
      expect((await get(`${id}/pages/${bad}`)).status).toBe(404);
  });

  test("a locked PDF has no pages to draw", async () => {
    const id = upload();
    counted(id, -1, "failed");
    expect((await get(`${id}/pages/1.png`)).status).toBe(422);
  });

  test("the queue is capped per caller, with a wait the client can read", async () => {
    const mine = upload();
    counted(mine, 500);
    for (let p = 1; p <= 6 * 24; p += 24) expect((await get(`${mine}/pages/${p}.png`)).status).toBe(202);
    const busy = await get(`${mine}/pages/${6 * 24 + 1}.png`);
    expect(busy.status).toBe(503);
    expect(busy.body.retryAfter).toBe(2);
    // Someone else's file is not held up by it.
    const theirs = upload("pdf", "198.51.100.1");
    counted(theirs, 10);
    expect((await get(`${theirs}/pages/1.png`, "198.51.100.1")).status).toBe(202);
  });

  test("worker offline is a 503 with no wait", async () => {
    const id = upload();
    counted(id, 5);
    workerUp(false);
    const r = await get(`${id}/pages/1.png`);
    expect(r.status).toBe(503);
    expect(r.body.retryAfter).toBeUndefined();
  });
});

describe("GET /:id/thumbnail.png", () => {
  test("a first page that failed to draw once there was a count stays a refusal", async () => {
    const id = upload();
    counted(id, 3, "failed");
    expect((await get(`${id}/thumbnail.png`)).status).toBe(422);
    expect(firstRow(id)?.state).toBe("failed");
  });

  test("still queues page 1 and serves it once drawn", async () => {
    const id = upload();
    expect((await get(`${id}/thumbnail.png`)).status).toBe(202);
    expect(firstRow(id)?.state).toBe("queued");
    writeFileSync(join(root, "jobs", "uploads", id, "thumbnail.png"), "png");
    expect((await get(`${id}/thumbnail.png`)).status).toBe(200);
  });
});
