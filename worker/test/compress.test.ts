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
  analysis: PdfAnalysis | null = null,
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
    job: { id: "job_test", tool: "compress", password: null },
    inputs: [{ id: "up", name, kind: "pdf", size: statSync(input).size, path: input }],
    analysis,
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

/** Every page's extracted text — what copy and search see. */
function text(file: string): string {
  const r = Bun.spawnSync(["mutool", "draw", "-q", "-F", "txt", file]);
  expect(r.exitCode).toBe(0);
  return r.stdout.toString();
}

/** Every page drawn by Ghostscript — a second renderer, so a font only MuPDF can read would show. */
function renderGs(file: string): Buffer {
  const r = Bun.spawnSync(["gs", "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=ppmraw", "-r96", "-o", "-", file]);
  expect(r.exitCode).toBe(0);
  return r.stdout;
}

/** Share of samples that differ by more than a rounding step. */
function difference(a: Buffer, b: Buffer): number {
  expect(b.length).toBe(a.length);
  let off = 0;
  for (let k = 0; k < a.length; k++) if (Math.abs(a[k]! - b[k]!) > 2) off++;
  return off / a.length;
}

/** The analysis the job would have of this file (#8), for runs that need it. */
async function analyse(file: string): Promise<PdfAnalysis> {
  const dir = mkdtempSync(join(root, "an-"));
  const signal = new AbortController().signal;
  const { analyseFile } = await import("../src/handlers/analyse");
  const ctx = {
    workDir: dir,
    signal,
    progress: () => {},
    run: jobs.toolRunner(dir, signal),
  } as unknown as Parameters<typeof analyseFile>[0];
  return analyseFile(ctx, file, statSync(file).size);
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

/** An override that skips every image in the file (#10), keyed by object number. */
function skipAll(file: string): CompressParams["overrides"] {
  const list = join(root, `images-${Math.random().toString(36).slice(2)}.json`);
  const script = join(import.meta.dir, "../scripts/images.js");
  expect(Bun.spawnSync(["mutool", "run", script, "list", file, list, "all", "all", "5000", "60000"]).exitCode).toBe(0);
  const ids: { id: number }[] = JSON.parse(readFileSync(list, "utf8"));
  return Object.fromEntries(ids.map((i) => [String(i.id), { skip: true }]));
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

  for (const name of ["deck.pdf", "deck-gs.pdf", "scan.pdf", "bloated.pdf", "thai.pdf"]) {
    for (const preset of ["ebook", "print"] as const) {
      // Every image set to "leave it as it is" (#10), so only the lossless passes change the file.
      test(`${name}, ${preset}, images skipped: never larger, every page renders identically`, async () => {
        const file = join(fixtures, name);
        const { result, out } = await compress(file, { ...defaultCompressParams(preset), overrides: skipAll(file) });
        expect(result.bytes).toBe(statSync(out).size);
        expect(result.bytes).toBeLessThanOrEqual(result.inputBytes);
        expect(result.inputBytes).toBe(statSync(file).size);
        expectSameRender(file, out);
        expect(text(out)).toBe(text(file));
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
    expect(stages).toEqual([
      "re-encoding images",
      "repacking JPEG images",
      "subsetting fonts",
      "rewriting the file",
      "recompressing streams",
      "measuring the result",
    ]);

    const trailer = show(out, "trailer");
    const info = show(out, "trailer/Info");
    expect(info).toContain("Bloated fixture");
    expect(info).not.toContain("Someone Private");
    expect(show(out, "Root")).not.toContain("/Metadata");
    expect(show(out, "Root")).toContain("/Outlines"); // not an extra unless asked
    expect(trailer).toContain("/Root");

    const passes = result.skipped.map((s) => s.pass).sort();
    expect(passes).toEqual([]);
    for (const s of result.skipped) expect(s.reason).toMatch(/\.$/);
  });

  test("thai.pdf: whole Thai and Latin fonts are subset; pages, text and ToUnicode stay the same", async () => {
    const file = join(fixtures, "thai.pdf");
    const before = await analyse(file);
    expect(before.fonts.map((f) => [f.name, f.type, f.subset])).toEqual([
      ["Sarabun-Thai", "Type0/CIDFontType2", false],
      ["Sarabun", "Type0/CIDFontType2", false],
      ["Sarabun-Bold", "TrueType", false],
    ]);
    const { result, out, stages } = await compress(file, defaultCompressParams("ebook"), "input.pdf", before);
    expect(stages).toContain("subsetting fonts");
    expect(result.skipped.map((s) => s.pass)).not.toContain("subset-fonts");
    expect(result.notes).toEqual([]);
    expect(result.bytes).toBeLessThan(result.inputBytes * 0.6);

    // Each font program is a fraction of what it was, and says it is a subset.
    for (const font of before.fonts) {
      const after = result.fontBytes?.[font.id];
      expect(after, font.name).toBeGreaterThan(0);
      expect(after!, font.name).toBeLessThan(font.bytes * 0.6);
    }
    expect(result.analysis.fonts.every((f) => f.subset && f.embedded)).toBe(true);

    expectSameRender(file, out);
    // Ghostscript grid-fits TrueType a touch differently once the unused tables (gasp, post, cmap) go.
    expect(difference(renderGs(file), renderGs(out))).toBeLessThan(0.002);
    const words = text(out);
    expect(words).toBe(text(file));
    expect(words).toContain("รายงานประจำไตรมาส");
    expect(words).toContain("ขอบคุณ");
    expect(words).toContain("Simple TrueType, WinAnsi");
    expect(show(out, "grep")).toContain("/ToUnicode");
  });

  test("a font a form field uses is kept whole, with a note; the rest are still subset", async () => {
    // The Thai font becomes the form's default font too: a user typing into a field needs all of it.
    const src = join(fixtures, "thai.pdf");
    const file = join(root, "thai-form.pdf");
    const script = join(root, "form.js");
    await Bun.write(
      script,
      `var pdf = new PDFDocument(scriptArgs[0]);
       var th = pdf.findPage(0).get("Resources").get("Font").get("TH");
       pdf.getTrailer().get("Root").put("AcroForm", pdf.addObject({ Fields: [], DR: { Font: { TH: th } }, DA: pdf.newString("/TH 12 Tf 0 g") }));
       pdf.save(scriptArgs[1], "");`,
    );
    expect(Bun.spawnSync(["mutool", "run", script, src, file]).exitCode).toBe(0);
    const before = await analyse(file);
    const { result, out } = await compress(file, defaultCompressParams("print"), "input.pdf", before);
    expect(result.notes).toContain(
      "Kept 1 font whole: Sarabun-Thai (used by form fields, which need every character a user might type).",
    );
    const thai = before.fonts.find((f) => f.name === "Sarabun-Thai")!;
    const latin = before.fonts.find((f) => f.name === "Sarabun")!;
    expect(result.fontBytes?.[thai.id]).toBeGreaterThan(thai.bytes * 0.9);
    expect(result.fontBytes?.[latin.id]).toBeLessThan(latin.bytes * 0.6);
    expect(result.analysis.fonts.find((f) => f.name === "Sarabun-Thai")?.subset).toBe(false);
    // The hiding is undone: the Thai program is embedded under its own key again.
    expect(show(out, "grep")).not.toContain("HiddenFontFile");
    expectSameRender(file, out);
    expect(text(out)).toBe(text(file));
  });

  test("CFF and already-subset fonts are left to themselves", async () => {
    // deck.pdf embeds Courier whole as CFF; MuPDF's CFF subsetter isn't trusted with it.
    const deck = await compress(join(fixtures, "deck.pdf"), defaultCompressParams("print"));
    expect(deck.result.skipped.find((s) => s.pass === "subset-fonts")?.reason).toMatch(
      /^Kept 1 font whole: .+ \(a CFF font, which MuPDF can't subset reliably\)\.$/,
    );
    // Ghostscript's output is subset already, as CFF — which MuPDF garbles if let at it.
    const file = join(fixtures, "deck-gs.pdf");
    // Images left as they are (#10), so the fonts are all that could change.
    const gs = await compress(file, { ...defaultCompressParams("print"), overrides: skipAll(file) });
    expect(gs.result.skipped.map((s) => s.pass)).not.toContain("subset-fonts");
    expect(gs.result.notes).toEqual([]);
    expectSameRender(file, gs.out);
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

  test("grayscale runs (images, #10)", async () => {
    const file = join(fixtures, "deck.pdf");
    const gray = await compress(file, { ...defaultCompressParams("print"), advanced: ["grayscale"] });
    expect(gray.result.skipped.map((s) => s.pass)).not.toContain("grayscale");
    expect(show(gray.out, "grep")).not.toContain("DeviceRGB");
    // The other engines (#13) are covered in engines.test.ts.
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
