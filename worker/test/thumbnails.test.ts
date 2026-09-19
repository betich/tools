import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAGE_THUMB_EDGE } from "@tools/shared";

/**
 * The thumbnail lane (#17, #37): page counts, batched page renders, and the
 * rows the API queues being worked off. Needs qpdf and mutool, so it runs in
 * the worker image:
 *
 *   docker run --rm -v "$PWD":/app -w /app --entrypoint bun tools-pdf-worker:latest test worker/test/thumbnails.test.ts
 */

const hasTools = !!Bun.which("qpdf") && !!Bun.which("mutool");
const root = mkdtempSync(join(tmpdir(), "thumbs-"));
process.env.DATA_DIR = join(root, "data");
process.env.JOBS_DIR = join(root, "jobs");
const fx = join(root, "fx");

let lane: typeof import("../src/thumbnails");
let db: typeof import("../src/db").db;

function sh(cmd: string[]) {
  const r = Bun.spawnSync(cmd, { cwd: fx });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString()}`);
}

/** Width and height from a PNG's IHDR. */
function pngSize(file: string) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function upload(id: string, pdf: string) {
  const dir = join(root, "jobs", "uploads", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "file"), readFileSync(join(fx, pdf)));
  return dir;
}

const row = (id: string) =>
  db
    .query<{ state: string; pages: number | null }, [string]>(
      "SELECT state, pages FROM pdf_thumbnails WHERE upload_id = ?",
    )
    .get(id);

describe.skipIf(!hasTools)("thumbnail lane", () => {
  beforeAll(async () => {
    mkdirSync(fx, { recursive: true });
    // 30 portrait pages, each with its number on it, and a landscape one to check the long edge.
    writeFileSync(
      join(fx, "make.js"),
      `var pdf = new PDFDocument(); var res = pdf.addObject({Font:{F1:pdf.addSimpleFont(new Font("Helvetica"))}});
       for (var i = 1; i <= 30; i++) { var b = new Buffer(); b.write("BT /F1 48 Tf 72 600 Td (" + i + ") Tj ET");
         pdf.insertPage(-1, pdf.addPage(i === 30 ? [0,0,792,612] : [0,0,612,792], 0, res, b)); }
       pdf.save(scriptArgs[0]);`,
    );
    sh(["mutool", "run", "make.js", "thirty.pdf"]);
    sh([
      "qpdf",
      "--encrypt",
      "--user-password=abc",
      "--owner-password=boss",
      "--bits=256",
      "--",
      "thirty.pdf",
      "locked.pdf",
    ]);
    writeFileSync(join(fx, "junk.pdf"), "%PDF-1.7\nthis is not a pdf\n");
    lane = await import("../src/thumbnails");
    db = (await import("../src/db")).db;
  }, 60_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("countPages: qpdf's count, -1 for a password, 0 for junk", async () => {
    expect(await lane.countPages(join(fx, "thirty.pdf"))).toBe(30);
    expect(await lane.countPages(join(fx, "locked.pdf"))).toBe(-1);
    expect(await lane.countPages(join(fx, "junk.pdf"))).toBe(0);
  });

  test("renderPages draws a batch in one run, each page within the edge", async () => {
    const out = join(root, "batch");
    expect(await lane.renderPages(join(fx, "thirty.pdf"), out, 25, 30)).toBe(true);
    expect(readdirSync(out).sort()).toEqual(["25.png", "26.png", "27.png", "28.png", "29.png", "30.png"]);
    const portrait = pngSize(join(out, "25.png"));
    expect(Math.max(portrait.w, portrait.h)).toBe(PAGE_THUMB_EDGE);
    expect(portrait.h).toBeGreaterThan(portrait.w);
    const landscape = pngSize(join(out, "30.png"));
    expect(landscape.w).toBe(PAGE_THUMB_EDGE);
    expect(landscape.w).toBeGreaterThan(landscape.h);
  });

  test("renderPages leaves nothing behind for a file it cannot draw", async () => {
    const out = join(root, "locked-batch");
    expect(await lane.renderPages(join(fx, "locked.pdf"), out, 1, 3)).toBe(false);
    expect(readdirSync(out)).toEqual([]);
  });

  test("the lane counts and draws page 1, then draws a queued batch", async () => {
    const id = "up_00000000000000a1";
    const dir = upload(id, "thirty.pdf");
    db.run("INSERT INTO pdf_thumbnails (upload_id, state, requested_at, updated_at) VALUES (?, 'queued', 1, 1)", [id]);
    db.run(
      "INSERT INTO pdf_page_thumbs (upload_id, batch, state, requested_at, updated_at) VALUES (?, 1, 'queued', 0, 0)",
      [id],
    );

    // First pages go before batches, even ones asked for later.
    expect(await lane.drawNext()).toBe(true);
    expect(row(id)).toEqual({ state: "done", pages: 30 });
    expect(existsSync(join(dir, lane.THUMBNAIL_FILE))).toBe(true);

    expect(await lane.drawNext()).toBe(true);
    expect(db.query("SELECT state FROM pdf_page_thumbs WHERE upload_id = ?").get(id)).toEqual({ state: "done" });
    expect(readdirSync(join(dir, lane.PAGES_DIR)).sort((a, b) => parseInt(a) - parseInt(b))).toEqual(
      ["25", "26", "27", "28", "29", "30"].map((n) => `${n}.png`),
    );
    expect(await lane.drawNext()).toBe(false);
  });

  test("an old first page with no count is counted without drawing it again", async () => {
    const id = "up_00000000000000a2";
    const dir = upload(id, "thirty.pdf");
    writeFileSync(join(dir, lane.THUMBNAIL_FILE), "old");
    db.run("INSERT INTO pdf_thumbnails (upload_id, state, requested_at, updated_at) VALUES (?, 'queued', 1, 1)", [id]);
    await lane.drawNext();
    expect(row(id)).toEqual({ state: "done", pages: 30 });
    expect(readFileSync(join(dir, lane.THUMBNAIL_FILE), "utf8")).toBe("old");
  });

  test("a locked PDF fails with its count marked, and its batches fail", async () => {
    const id = "up_00000000000000a3";
    upload(id, "locked.pdf");
    db.run("INSERT INTO pdf_thumbnails (upload_id, state, requested_at, updated_at) VALUES (?, 'queued', 1, 1)", [id]);
    db.run(
      "INSERT INTO pdf_page_thumbs (upload_id, batch, state, requested_at, updated_at) VALUES (?, 0, 'queued', 2, 2)",
      [id],
    );
    await lane.drawNext();
    expect(row(id)).toEqual({ state: "failed", pages: -1 });
    await lane.drawNext();
    expect(db.query("SELECT state FROM pdf_page_thumbs WHERE upload_id = ?").get(id)).toEqual({ state: "failed" });
  });
});
