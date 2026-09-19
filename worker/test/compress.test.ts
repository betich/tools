import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCompressParams, type CompressParams, type PdfAnalysis, type RunResult } from "@tools/shared";

/**
 * Compress runs (#9) end to end through the real handler, against the #8
 * fixtures plus bloated.pdf (test/fixtures/make.sh). The promise under test:
 * a lossless run never grows a file and every page renders pixel-identical
 * (mutool draw before vs after). Needs the worker image's toolchain:
 *
 *   docker run --rm -v "$PWD":/app -w /app --entrypoint bun tools-pdf-worker:latest test worker/test
 */

const hasTools = ["mutool", "qpdf", "jpegtran", "vips", "gs"].every((t) => !!Bun.which(t));
const root = mkdtempSync(join(tmpdir(), "compress-"));
const fixtures = join(root, "fx");
// The worker opens its SQLite on import; give it a throwaway one.
process.env.DATA_DIR = join(root, "data");

type Jobs = typeof import("../src/jobs");
let jobs: Jobs;

async function compress(
  file: string,
  params: Partial<CompressParams> = {},
  name = "input.pdf",
): Promise<{ result: RunResult; out: string; stages: string[] }> {
  const dir = mkdtempSync(join(root, "task-"));
  const input = join(dir, "upload.pdf");
  copyFileSync(file, input);
  const workDir = join(dir, "work");
  const outDir = join(dir, "out");
  for (const d of [workDir, outDir]) Bun.spawnSync(["mkdir", "-p", d]);
  const stages: string[] = [];
  const signal = new AbortController().signal;
  const handler = jobs.handlerFor("compress")!;
  const out = await handler({
    task: { id: "task_test", kind: "compress", params: { ...defaultCompressParams(), ...params } },
    job: { id: "job_test", tool: "compress" },
    inputs: [{ id: "up", name, kind: "pdf", size: statSync(input).size, path: input }],
    analysis: null,
    outDir,
    workDir,
    signal,
    progress: (stage) => void (stages.at(-1) !== stage && stages.push(stage)),
    run: jobs.toolRunner(workDir, signal),
  });
  return { result: out.result as RunResult, out: join(outDir, out.file!.name), stages };
}

/** Every page drawn at 96 dpi as raw RGB, annotations included. */
function render(file: string): Buffer[] {
  const dir = mkdtempSync(join(root, "draw-"));
  const r = Bun.spawnSync(["mutool", "draw", "-q", "-r", "96", "-c", "rgb", "-o", join(dir, "p%04d.pnm"), file]);
  expect(r.exitCode).toBe(0);
  const pages = readdirSync(dir)
    .sort()
    .map((f) => readFileSync(join(dir, f)));
  rmSync(dir, { recursive: true });
  return pages;
}

function expectSameRender(before: string, after: string) {
  const a = render(before);
  const b = render(after);
  expect(b.length).toBe(a.length);
  a.forEach((page, i) => expect(Buffer.compare(page, b[i]!), `page ${i + 1} differs`).toBe(0));
}

/** Share of samples that differ by more than a rounding step, over all pages. */
function renderDifference(before: string, after: string): number {
  const a = render(before);
  const b = render(after);
  let off = 0;
  let total = 0;
  a.forEach((page, i) => {
    const other = b[i]!;
    expect(other.length).toBe(page.length);
    for (let k = 0; k < page.length; k++) if (Math.abs(page[k]! - other[k]!) > 2) off++;
    total += page.length;
  });
  return off / total;
}

const show = (file: string, what: string) =>
  Bun.spawnSync(["mutool", "show", file, what]).stdout.toString();

describe.skipIf(!hasTools)("compress", () => {
  beforeAll(async () => {
    const r = Bun.spawnSync(["sh", join(import.meta.dir, "fixtures/make.sh"), fixtures]);
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    jobs = await import("../src/jobs");
    await import("../src/handlers");
  }, 60_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  for (const name of ["deck.pdf", "deck-gs.pdf", "scan.pdf", "bloated.pdf"]) {
    for (const preset of ["ebook", "print"] as const) {
      test(`${name}, ${preset}: never larger, every page renders identically`, async () => {
        const file = join(fixtures, name);
        const { result, out } = await compress(file, defaultCompressParams(preset));
        expect(result.bytes).toBe(statSync(out).size);
        expect(result.bytes).toBeLessThanOrEqual(result.inputBytes);
        expect(result.inputBytes).toBe(statSync(file).size);
        expectSameRender(file, out);
        expect(result.analysis.bytes).toBe(result.bytes);
        if (result.keptOriginal) expect(Buffer.compare(readFileSync(out), readFileSync(file))).toBe(0);
      });
    }
  }

  test("bloated.pdf, ebook: duplicates merged, JPEG repacked, metadata stripped but the title kept", async () => {
    const file = join(fixtures, "bloated.pdf");
    const { result, out, stages } = await compress(file, defaultCompressParams("ebook"));
    expect(result.keptOriginal).toBe(false);
    expect(result.bytes).toBeLessThan(result.inputBytes * 0.6);
    const analysis: PdfAnalysis = result.analysis;
    // Two identical photos became one; the thumbnail stays (extras are opt-in).
    expect(analysis.images.filter((i) => i.width === 1200)).toHaveLength(1);
    expect(stages).toEqual(["repacking JPEG images", "rewriting the file", "recompressing streams", "measuring the result"]);

    const trailer = show(out, "trailer");
    const info = show(out, "trailer/Info");
    expect(info).toContain("Bloated fixture");
    expect(info).not.toContain("Someone Private");
    expect(show(out, "Root")).not.toContain("/Metadata");
    expect(show(out, "Root")).toContain("/Outlines"); // not an extra unless asked
    expect(trailer).toContain("/Root");

    const passes = result.skipped.map((s) => s.pass).sort();
    expect(passes).toEqual(["downsample", "reencode-images", "subset-fonts"]);
    for (const s of result.skipped) expect(s.reason).toMatch(/\.$/);
  });

  test("the JPEG repack keeps the exact pixels and makes the stream smaller", async () => {
    const file = join(fixtures, "scan.pdf");
    const { result, out } = await compress(file, defaultCompressParams("print"));
    const before = Bun.spawnSync(["mutool", "show", file, "grep"]).stdout.toString();
    expect(before).toContain("DCTDecode");
    expect(result.bytes).toBeLessThan(result.inputBytes);
    expect(result.analysis.images[0]!.bytes).toBeLessThan(result.inputBytes * 0.99);
    expectSameRender(file, out);
  });

  test("remove extras: attachments, scripts, bookmarks, forms and annotations go, links stay", async () => {
    const file = join(fixtures, "bloated.pdf");
    const { result, out } = await compress(file, { ...defaultCompressParams("print"), advanced: ["remove-extras"] });
    expect(result.notes).toContain(
      "Removed 1 attachment, 2 scripts, the bookmarks, 2 annotations, 1 form field, 1 page thumbnail and application data.",
    );
    const catalog = show(out, "Root");
    for (const key of ["/Names", "/OpenAction", "/Outlines", "/AcroForm"]) expect(catalog).not.toContain(key);
    const page = show(out, "pages/1");
    expect(page).not.toContain("/Thumb");
    expect(page).not.toContain("/PieceInfo");
    const annots = show(out, "pages/1/Annots");
    expect(annots.match(/ R/g)).toHaveLength(1);
    expect(show(out, "pages/1/Annots/1/Subtype")).toContain("Link");
  });

  test("flatten: annotation and field appearances move into the page and look the same", async () => {
    const file = join(fixtures, "bloated.pdf");
    const { result, out, stages } = await compress(file, { ...defaultCompressParams("print"), advanced: ["flatten"] });
    expect(stages).toContain("flattening forms and annotations");
    expect(result.skipped.map((s) => s.pass)).not.toContain("flatten");
    expect(show(out, "Root")).not.toContain("/AcroForm");
    expect(show(out, "pages/1/Annots/1/Subtype")).toContain("Link");
    expect(show(out, "pages/1")).toContain("/Annots");
    // Same appearance streams, now drawn as page content: at most anti-aliasing at the edges differs.
    expect(renderDifference(file, out)).toBeLessThan(0.001);
  });

  test("grayscale is skipped with a reason; other engines skip what they can't do", async () => {
    const file = join(fixtures, "deck.pdf");
    const gray = await compress(file, { ...defaultCompressParams("print"), advanced: ["grayscale"] });
    expect(gray.result.skipped.find((s) => s.pass === "grayscale")?.reason).toBe(
      "Converting to grayscale isn't available yet.",
    );

    const q = await compress(file, { ...defaultCompressParams("print"), engine: "qpdf" });
    expect(q.stages).not.toContain("rewriting the file");
    expect(q.stages).toContain("recompressing streams");
    expect(q.result.skipped).toContainEqual({ pass: "dedupe", reason: "qpdf can't deduplicate objects." });
    expect(q.result.skipped.find((s) => s.pass === "garbage-collect")?.reason).toMatch(/qpdf/);
    expect(q.result.bytes).toBeLessThanOrEqual(q.result.inputBytes);
    expectSameRender(file, q.out);
  });

  test("an output that would not be smaller is served as the original", async () => {
    // A one-rectangle page with a classic xref: an xref stream and object stream only add bytes.
    const page = join(root, "tiny.txt");
    const file = join(root, "tiny.pdf");
    await Bun.write(page, "%%MediaBox 0 0 100 100\n0 0 1 rg 10 10 50 50 re f\n");
    expect(Bun.spawnSync(["mutool", "create", "-O", "compress", "-o", file, page]).exitCode).toBe(0);
    const { result, out } = await compress(file, defaultCompressParams("ebook"));
    expect(result.keptOriginal).toBe(true);
    expect(result.bytes).toBe(result.inputBytes);
    expect(Buffer.compare(readFileSync(out), readFileSync(file))).toBe(0);
    expect(result.analysis.pages).toBe(1);
    expect(result.notes).toEqual([]);
  });

  test("the download name keeps Thai", async () => {
    const { result } = await compress(join(fixtures, "deck.pdf"), defaultCompressParams("print"), "รายงาน ประจำปี 2567.pdf");
    expect(result.fileName).toBe("รายงาน-ประจำปี-2567-compressed.pdf");
  });

  test("settings that don't fit the contract are refused with a sentence", async () => {
    const file = join(fixtures, "deck.pdf");
    await expect(compress(file, { quality: 400 })).rejects.toThrow("These compress settings aren't valid");
    await expect(compress(file, { advanced: ["downsample"] })).rejects.toBeInstanceOf(jobs.TaskError);
  });
});
