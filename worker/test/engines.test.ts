import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultCompressParams,
  ENGINES,
  reasonUnsupported,
  supports,
  type CompressParams,
  type EngineId,
  type PassId,
  type RunResult,
  type TaskKind,
} from "@tools/shared";

/**
 * The engines (#13): each non-default engine produces a valid PDF — `qpdf
 * --check` clean, every page drawn by `mutool draw` — for the passes the
 * capability table says it runs, on the #8/#9 fixtures; the passes it
 * doesn't run come back skipped with the table's reason, never "not available
 * yet". Plus Merge's join per engine. Needs the worker image's toolchain:
 *
 *   docker run --rm -v "$PWD":/app -w /app --entrypoint bun tools-pdf-worker:latest test worker/test
 */

const hasTools = ["mutool", "qpdf", "jpegtran", "vips", "gs"].every((t) => !!Bun.which(t));
const root = mkdtempSync(join(tmpdir(), "engines-"));
const fixtures = join(root, "fx");
process.env.DATA_DIR = join(root, "data");

type Jobs = typeof import("../src/jobs");
let jobs: Jobs;
let wantedPasses: typeof import("../src/compress").wantedPasses;

function taskDirs() {
  const dir = mkdtempSync(join(root, "task-"));
  const workDir = join(dir, "work");
  const outDir = join(dir, "out");
  for (const d of [workDir, outDir]) mkdirSync(d, { recursive: true });
  return { dir, workDir, outDir };
}

function context(dir: { workDir: string; outDir: string }, kind: TaskKind, params: unknown, inputs: { path: string; name: string }[]) {
  const stages: string[] = [];
  const signal = new AbortController().signal;
  const ctx = {
    task: { id: "task_test", kind, params },
    job: { id: "job_test", tool: kind === "merge" ? ("merge" as const) : ("compress" as const), password: null },
    inputs: inputs.map((i, n) => ({ id: `up${n}`, name: i.name, kind: "pdf" as const, size: statSync(i.path).size, path: i.path })),
    analysis: null,
    outDir: dir.outDir,
    workDir: dir.workDir,
    signal,
    progress: (stage: string) => void (stages.at(-1) !== stage && stages.push(stage)),
    run: jobs.toolRunner(dir.workDir, signal),
  };
  return { ctx, stages };
}

async function compress(file: string, params: Partial<CompressParams>) {
  const dirs = taskDirs();
  const input = join(dirs.dir, "upload.pdf");
  copyFileSync(file, input);
  const { ctx, stages } = context(dirs, "compress", { ...defaultCompressParams(), ...params }, [{ path: input, name: "input.pdf" }]);
  const out = await jobs.handlerFor("compress")!(ctx);
  return { result: out.result as RunResult, out: join(dirs.outDir, out.file!.name), stages };
}

/** Structurally clean: exit 0, not even warnings. */
function expectValid(file: string) {
  const r = Bun.spawnSync(["qpdf", "--check", file]);
  expect(r.exitCode, r.stdout.toString() + r.stderr.toString()).toBe(0);
}

function pageCount(file: string): number {
  return Number(Bun.spawnSync(["qpdf", "--show-npages", file]).stdout.toString().trim());
}

/** Every page drawn at 48 dpi as raw RGB; mutool must not complain. */
function render(file: string): Buffer[] {
  const dir = mkdtempSync(join(root, "draw-"));
  const r = Bun.spawnSync(["mutool", "draw", "-r", "48", "-c", "rgb", "-o", join(dir, "p%04d.pnm"), file]);
  expect(r.exitCode).toBe(0);
  expect(r.stderr.toString().replace(/warning: ICC support is not available\n?/g, "")).not.toMatch(/error/i);
  const pages = readdirSync(dir)
    .sort()
    .map((f) => readFileSync(join(dir, f)));
  rmSync(dir, { recursive: true });
  return pages;
}

/** The samples of a binary PNM, past its three header lines. */
function samples(pnm: Buffer): Buffer {
  let at = 0;
  for (let lines = 0; lines < 3; at++) if (pnm[at] === 0x0a) lines++;
  return pnm.subarray(at);
}

/** Mean absolute difference per sample (0–255) between two renders of the same pages. */
function meanDifference(a: Buffer[], b: Buffer[]): number {
  let sum = 0;
  let n = 0;
  a.forEach((page, i) => {
    const other = b[i]!;
    expect(other.length).toBe(page.length);
    for (let k = 0; k < page.length; k++) sum += Math.abs(page[k]! - other[k]!);
    n += page.length;
  });
  return sum / n;
}

const show = (file: string, what: string) => Bun.spawnSync(["mutool", "show", file, what]).stdout.toString();
const ALL_ADVANCED: PassId[] = ["remove-extras", "flatten", "grayscale"];
const FIXTURES = ["deck.pdf", "deck-gs.pdf", "scan.pdf", "bloated.pdf"];
const OTHER_ENGINES: EngineId[] = ["qpdf", "ghostscript", "pdf-lib"];

describe.skipIf(!hasTools)("engines", () => {
  beforeAll(async () => {
    const r = Bun.spawnSync(["sh", join(import.meta.dir, "fixtures/make.sh"), fixtures]);
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    jobs = await import("../src/jobs");
    await import("../src/handlers");
    ({ wantedPasses } = await import("../src/compress"));
  }, 60_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  for (const engine of OTHER_ENGINES) {
    for (const name of FIXTURES) {
      test(`${engine}, ${name}: valid output for every pass it claims, the rest skipped with the table's reason`, async () => {
        const file = join(fixtures, name);
        const advanced = ALL_ADVANCED.filter((p) => supports(engine, p));
        const params = { ...defaultCompressParams("ebook"), engine, advanced };
        const { result, out } = await compress(file, params);
        expectValid(out);
        expect(pageCount(out)).toBe(pageCount(file));
        const before = render(file);
        const after = render(out);
        expect(after.length).toBe(before.length);
        // Same pages, recognisably: lossy engines move samples, they don't change what is drawn.
        expect(meanDifference(before, after)).toBeLessThan(engine === "ghostscript" ? 12 : 4);
        expect(result.bytes).toBeLessThanOrEqual(result.inputBytes);

        for (const s of result.skipped) {
          expect(s.reason, `${s.pass}: ${s.reason}`).not.toMatch(/isn't available yet|can't .* with .* yet/);
          if (!supports(engine, s.pass)) expect(s.reason).toBe(reasonUnsupported(engine, s.pass)!);
        }
        for (const pass of wantedPasses(params)) {
          if (!supports(engine, pass)) expect(result.skipped.map((s) => s.pass)).toContain(pass);
        }
      }, 60_000);
    }
  }

  test("pdf-lib is lossless: every page renders identically", async () => {
    for (const name of FIXTURES) {
      const file = join(fixtures, name);
      const { out } = await compress(file, { ...defaultCompressParams("print"), engine: "pdf-lib" });
      const a = render(file);
      const b = render(out);
      a.forEach((page, i) => expect(Buffer.compare(page, b[i]!), `${name} page ${i + 1}`).toBe(0));
    }
  }, 60_000);

  test("qpdf: remove extras and strip metadata match MuPDF's pass", async () => {
    const file = join(fixtures, "bloated.pdf");
    const { result, out, stages } = await compress(file, {
      ...defaultCompressParams("ebook"),
      engine: "qpdf",
      advanced: ["remove-extras"],
    });
    expect(stages).toContain("rewriting the file");
    expect(stages).not.toContain("recompressing streams");
    expect(result.notes).toContain(
      "Removed 1 attachment, 2 scripts, the bookmarks, 2 annotations, 1 form field, 1 page thumbnail and application data.",
    );
    const catalog = show(out, "Root");
    for (const key of ["/Names", "/OpenAction", "/Outlines", "/AcroForm", "/Metadata"]) expect(catalog).not.toContain(key);
    expect(show(out, "pages/1")).not.toContain("/Thumb");
    expect(show(out, "pages/1")).not.toContain("/Metadata");
    expect(show(out, "pages/1/Annots/1/Subtype")).toContain("Link");
    expect(show(out, "pages/1/Annots").match(/ R/g)).toHaveLength(1);
    const info = show(out, "trailer/Info");
    expect(info).toContain("Bloated fixture");
    expect(info).not.toContain("Someone Private");
    // Unreferenced objects are gone, but qpdf can't merge the duplicate photo.
    expect(Bun.spawnSync(["mutool", "show", out, "grep"]).stdout.toString()).not.toContain("nothing points here");
    expect(result.skipped).toContainEqual({ pass: "dedupe", reason: "qpdf can't deduplicate objects." });
  }, 60_000);

  test("qpdf: the edits hold on a file whose objects sit in object streams", async () => {
    // MuPDF packs bloated.pdf into object streams; extras and metadata stay (print, no opt-ins).
    const packed = await compress(join(fixtures, "bloated.pdf"), defaultCompressParams("print"));
    expect(show(packed.out, "grep")).toContain("/ObjStm");
    const { result, out } = await compress(packed.out, { ...defaultCompressParams("ebook"), engine: "qpdf", advanced: ["remove-extras"] });
    expect(result.notes.some((n) => n.startsWith("Removed 1 attachment"))).toBe(true);
    const catalog = show(out, "Root");
    for (const key of ["/Names", "/Outlines", "/AcroForm", "/Metadata"]) expect(catalog).not.toContain(key);
    expect(show(out, "trailer/Info")).not.toContain("Someone Private");
    expectValid(out);
  }, 60_000);

  test("qpdf: re-encoding is kept only when the file gets smaller", async () => {
    // deck.pdf shares its photo between pages; qpdf writes it once per page.
    const deck = await compress(join(fixtures, "deck.pdf"), { ...defaultCompressParams("print"), engine: "qpdf" });
    const bloated = await compress(join(fixtures, "bloated.pdf"), { ...defaultCompressParams("screen"), engine: "qpdf" });
    for (const r of [deck, bloated]) {
      const skip = r.result.skipped.find((s) => s.pass === "reencode-images");
      if (skip) expect(skip.reason).toBe("Re-encoding with qpdf didn't make the file smaller, so the images were left as they were.");
      expect(r.result.bytes).toBeLessThanOrEqual(r.result.inputBytes);
    }
    // Screen quality on two uncompressed-structure photos does pay.
    expect(bloated.result.skipped.map((s) => s.pass)).not.toContain("reencode-images");
  }, 60_000);

  test("Ghostscript: downsamples to the cap, converts to gray, strips metadata down to the title", async () => {
    const scan = await compress(join(fixtures, "scan.pdf"), { ...defaultCompressParams("ebook"), engine: "ghostscript" });
    // 2480×3508 at 300 dpi → 150 dpi.
    const width = scan.result.analysis.images[0]!.width;
    expect(width).toBeGreaterThan(1200);
    expect(width).toBeLessThan(1260);
    expect(scan.result.bytes).toBeLessThan(scan.result.inputBytes / 2);

    const file = join(fixtures, "bloated.pdf");
    const gray = await compress(file, { ...defaultCompressParams("ebook"), engine: "ghostscript", advanced: ["grayscale", "remove-extras", "flatten"] });
    expect(gray.stages).toEqual([
      "flattening forms and annotations",
      "removing extras",
      "re-distilling with Ghostscript",
      "measuring the result",
    ]);
    for (const page of render(gray.out)) {
      const body = samples(page);
      for (let i = 0; i < body.length; i += 3) {
        expect(Math.abs(body[i]! - body[i + 1]!)).toBeLessThanOrEqual(1);
        expect(Math.abs(body[i + 1]! - body[i + 2]!)).toBeLessThanOrEqual(1);
      }
    }
    const info = show(gray.out, "trailer/Info");
    expect(info).toContain("Bloated fixture");
    expect(info).not.toContain("Ghostscript");
    expect(info).not.toContain("Someone Private");
    expect(Bun.spawnSync(["mutool", "show", gray.out, "grep"]).stdout.toString()).not.toContain("/Metadata");
    const catalog = show(gray.out, "Root");
    for (const key of ["/Names", "/Outlines", "/AcroForm"]) expect(catalog).not.toContain(key);
    expect(show(gray.out, "pages/1/Annots/1/Subtype")).toContain("Link");
  }, 60_000);

  test("Ghostscript: codecs it can't write fall back to JPEG with a note", async () => {
    const { result } = await compress(join(fixtures, "scan.pdf"), {
      ...defaultCompressParams("ebook"),
      engine: "ghostscript",
      codec: "openjpeg",
    });
    expect(result.keptOriginal).toBe(false);
    expect(result.notes).toContain("Ghostscript can't write JPEG 2000 (OpenJPEG). Images were written as JPEG instead.");
  }, 60_000);

  describe("merge join", () => {
    for (const engine of Object.keys(ENGINES) as EngineId[]) {
      test(`${engine}: joins every page in order into a valid PDF`, async () => {
        const { mergeJoinFor } = await import("../src/mergeEngines");
        const parts = ["bloated.pdf", "deck.pdf", "scan.pdf", "tagged.pdf"].map((n) => join(fixtures, n));
        const dirs = taskDirs();
        const { ctx } = context(dirs, "merge", {}, []);
        const out = join(dirs.workDir, "joined.pdf");
        const chosen = mergeJoinFor(engine);
        expect(chosen).toMatchObject({ engine, note: null });
        await chosen.join(ctx, parts.map((path) => ({ path })), out);
        expectValid(out);
        const expected = parts.reduce((n, p) => n + pageCount(p), 0);
        expect(pageCount(out)).toBe(expected);
        const before = parts.flatMap((p) => render(p));
        const after = render(out);
        expect(after.length).toBe(before.length);
        expect(meanDifference(before, after)).toBeLessThan(engine === "ghostscript" ? 6 : 0.5);
        // Links survive every engine; the text field only qpdf's join (and so MuPDF's) keeps.
        expect(show(out, "pages/1/Annots")).toContain(" R");
        const catalog = show(out, "Root");
        if (engine === "mupdf" || engine === "qpdf") expect(catalog).toContain("/AcroForm");
        else expect(catalog).not.toContain("/AcroForm");
      }, 60_000);

      test(`${engine}: joins page ranges in the order given, a file repeating (#39)`, async () => {
        const { mergeJoinFor } = await import("../src/mergeEngines");
        const deck = join(fixtures, "deck.pdf");
        const scan = join(fixtures, "scan.pdf");
        const dirs = taskDirs();
        const { ctx } = context(dirs, "merge", {}, []);
        const out = join(dirs.workDir, "joined.pdf");
        await mergeJoinFor(engine).join(
          ctx,
          [
            { path: deck, pages: [1, 2] },
            { path: scan, pages: [0, 0] },
            { path: deck, pages: [0, 0] },
          ],
          out,
        );
        expectValid(out);
        expect(pageCount(out)).toBe(4);
        const [d, s] = [render(deck), render(scan)];
        const after = render(out);
        expect(meanDifference([d[1]!, d[2]!, s[0]!, d[0]!], after)).toBeLessThan(engine === "ghostscript" ? 6 : 0.5);
      }, 60_000);
    }
  });
});
