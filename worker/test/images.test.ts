import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCompressParams, type CompressParams, type CropResult, type PdfAnalysis, type RunResult } from "@tools/shared";

/**
 * Downsample / re-encode (#10) through the real compress and crop handlers,
 * on test/fixtures/photos.sh's photo-heavy PDF. Needs the worker image:
 *
 *   docker run --rm -v "$PWD":/app -w /app --entrypoint bun tools-pdf-worker:latest test worker/test
 *
 * photos.pdf object numbers: 3 photo.jpg (400 dpi at its largest), 4 flat.png
 * (Flate, 300 dpi), 5 alpha.png (+ SMask 6, 300 dpi), 7 gray.jpg (267 dpi),
 * 8 cmyk.jpg.
 */

const hasTools = ["mutool", "qpdf", "vips", "cjpeg", "opj_compress", "opj_decompress"].every((t) => !!Bun.which(t));
const root = mkdtempSync(join(tmpdir(), "images-"));
const fixtures = join(root, "fx");
process.env.DATA_DIR = join(root, "data");

type Jobs = typeof import("../src/jobs");
let jobs: Jobs;
let photos: string;
let analysis: PdfAnalysis;

function context(kind: "compress" | "crop" | "analyse", params: unknown, file: string, withAnalysis: PdfAnalysis | null) {
  const dir = mkdtempSync(join(root, "task-"));
  const input = join(dir, "upload.pdf");
  copyFileSync(file, input);
  const workDir = join(dir, "work");
  const outDir = join(dir, "out");
  for (const d of [workDir, outDir]) Bun.spawnSync(["mkdir", "-p", d]);
  const signal = new AbortController().signal;
  const notes: string[] = [];
  return {
    outDir,
    notes,
    ctx: {
      task: { id: "task_test", kind, params },
      job: { id: "job_test", tool: "compress" as const, password: null },
      inputs: [{ id: "up", name: "photos.pdf", kind: "pdf" as const, size: statSync(input).size, path: input }],
      analysis: withAnalysis,
      outDir,
      workDir,
      signal,
      progress: (_stage: string, _d: number, _t: number, note?: string) => void (note && notes.push(note)),
      run: jobs.toolRunner(workDir, signal),
    },
  };
}

async function compress(params: Partial<CompressParams> = {}): Promise<{ result: RunResult; out: string; notes: string[] }> {
  const c = context("compress", { ...defaultCompressParams(), ...params }, photos, analysis);
  const out = await jobs.handlerFor("compress")!(c.ctx);
  return { result: out.result as RunResult, out: join(c.outDir, out.file!.name), notes: c.notes };
}

async function crop(imageId: string, params: Partial<CompressParams>, box: [number, number, number, number] | null) {
  const c = context("crop", { imageId, params: { ...defaultCompressParams(), ...params }, box }, photos, analysis);
  const out = await jobs.handlerFor("crop")!(c.ctx);
  const result = out.result as CropResult;
  return { result, before: join(c.outDir, result.before), after: join(c.outDir, result.after) };
}

/** Each page's image XObjects, by page and resource name: raw stored bytes and dictionary. */
function streams(file: string): Map<string, { raw: Buffer; dict: string }> {
  const dir = mkdtempSync(join(root, "streams-"));
  const script = join(dir, "dump.js");
  writeFileSync(
    script,
    `"use strict";
var pdf = new PDFDocument(scriptArgs[0]), dir = scriptArgs[1], out = [];
for (var p = 0; p < pdf.countPages(); p++) {
  var xs = pdf.findPage(p).get("Resources").get("XObject");
  xs.forEach(function (x, name) {
    var key = "p" + (p + 1) + "-" + name;
    x.readRawStream().save(dir + "/" + key + ".bin");
    var d = x.resolve(); var s = {};
    ["Filter", "Width", "Height", "ColorSpace", "SMask", "DecodeParms"].forEach(function (k) { var v = d.get(k); if (v && !v.isNull()) s[k] = k === "SMask" ? [v.get("Width").asNumber(), v.get("Height").asNumber(), v.get("Filter").toString()] : v.toString(); });
    out.push({ key: key, dict: JSON.stringify(s) });
  });
}
var b = new Buffer(); b.write(JSON.stringify(out)); b.save(dir + "/list.json");`,
  );
  const r = Bun.spawnSync(["mutool", "run", script, file, dir]);
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const list: { key: string; dict: string }[] = JSON.parse(readFileSync(join(dir, "list.json"), "utf8"));
  const map = new Map(list.map((e) => [e.key, { raw: readFileSync(join(dir, `${e.key}.bin`)), dict: e.dict }]));
  rmSync(dir, { recursive: true });
  return map;
}

/** Mean absolute difference per sample, 0–255, over every page drawn at 72 dpi. */
function meanDifference(before: string, after: string): number {
  const draw = (file: string) => {
    const dir = mkdtempSync(join(root, "draw-"));
    expect(Bun.spawnSync(["mutool", "draw", "-q", "-r", "72", "-c", "rgb", "-o", join(dir, "p%04d.pnm"), file]).exitCode).toBe(0);
    const pages = readdirSync(dir).sort().map((f) => readFileSync(join(dir, f)));
    rmSync(dir, { recursive: true });
    return pages;
  };
  const a = draw(before);
  const b = draw(after);
  expect(b.length).toBe(a.length);
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

const pngSize = (file: string) => {
  const b = readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

describe.skipIf(!hasTools)("images (#10)", () => {
  beforeAll(async () => {
    const r = Bun.spawnSync(["sh", join(import.meta.dir, "fixtures/photos.sh"), fixtures]);
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    photos = join(fixtures, "photos.pdf");
    jobs = await import("../src/jobs");
    await import("../src/handlers");
    const c = context("analyse", {}, photos, null);
    analysis = (await jobs.handlerFor("analyse")!(c.ctx)).result as PdfAnalysis;
  }, 120_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("ebook: photos downsampled to 150 dpi and re-encoded — the file shrinks substantially and still looks the same", async () => {
    const { result, out, notes } = await compress(defaultCompressParams("ebook"));
    expect(result.keptOriginal).toBe(false);
    expect(result.bytes).toBeLessThan(result.inputBytes * 0.25);
    const after = streams(out);
    // 2400×1600 at 400 dpi (its larger placement; the 2400 dpi thumbnail doesn't count) → 900×600.
    expect(after.get("p1-Im1")!.dict).toContain('"Width":"900"');
    expect(after.get("p1-Im1")!.dict).toContain("DCTDecode");
    // Flate PNG → JPEG at 150 dpi.
    expect(after.get("p2-Im1")!.dict).toContain('"Width":"900"');
    expect(after.get("p2-Im1")!.dict).toContain("DCTDecode");
    // Alpha: colour downsampled, the soft mask resampled with it and kept lossless.
    expect(after.get("p3-Im1")!.dict).toContain('"SMask":[600,600,"/FlateDecode"]');
    // Gray stays gray.
    expect(after.get("p4-Im1")!.dict).toContain("DeviceGray");
    // CMYK is kept byte for byte, with a note saying why.
    const before = streams(photos);
    expect(Buffer.compare(after.get("p4-Im3")!.raw, before.get("p4-Im3")!.raw)).toBe(0);
    expect(result.notes.some((n) => n.startsWith("1 CMYK image kept as it was"))).toBe(true);
    expect(result.notes).toContain("Re-encoded 4 images, all of them downsampled.");
    expect(result.skipped.map((s) => s.pass)).not.toContain("downsample");
    expect(result.skipped.map((s) => s.pass)).not.toContain("reencode-images");
    expect(notes.some((n) => /^image \d of 5 · 2400×1600$/.test(n))).toBe(true);
    expect(meanDifference(photos, out)).toBeLessThan(4);
  }, 120_000);

  test("an override changes only its own image: every other image stream is byte-identical", async () => {
    const base = await compress(defaultCompressParams("ebook"));
    const over = await compress({ ...defaultCompressParams("ebook"), overrides: { "4": { codec: "flate", dpiCap: 100 } } });
    const a = streams(base.out);
    const b = streams(over.out);
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [key, s] of a) {
      if (key === "p2-Im1") continue;
      expect(Buffer.compare(b.get(key)!.raw, s.raw), key).toBe(0);
      expect(b.get(key)!.dict, key).toBe(s.dict);
    }
    // The override: 1800×1200 at 300 dpi → 100 dpi, lossless.
    expect(b.get("p2-Im1")!.dict).toContain('"Width":"600"');
    expect(b.get("p2-Im1")!.dict).toContain("FlateDecode");
    expect(b.get("p2-Im1")!.dict).toContain("/Predictor 15");
  }, 180_000);

  test("skip keeps the image exactly; openjpeg writes JPX; print keeps full resolution under its cap", async () => {
    const before = streams(photos);
    const skip = await compress({ ...defaultCompressParams("ebook"), codec: "openjpeg", overrides: { "3": { skip: true } } });
    const s = streams(skip.out);
    expect(Buffer.compare(s.get("p1-Im1")!.raw, before.get("p1-Im1")!.raw)).toBe(0);
    expect(s.get("p2-Im1")!.dict).toContain("JPXDecode");
    expect(s.get("p3-Im1")!.dict).toContain("JPXDecode");
    expect(meanDifference(photos, skip.out)).toBeLessThan(4);

    // Print caps at 300 dpi: only the 400 dpi photo goes down (to 1800×1200).
    const print = await compress(defaultCompressParams("print"));
    const p = streams(print.out);
    expect(p.get("p1-Im1")!.dict).toContain('"Width":"1800"');
    expect(p.get("p4-Im1")!.dict).toContain('"Width":"1600"');
  }, 180_000);

  test("grayscale converts the colour images; libjxl is skipped with a reason for now", async () => {
    const gray = await compress({ ...defaultCompressParams("ebook"), advanced: ["grayscale"] });
    const g = streams(gray.out);
    for (const key of ["p1-Im1", "p2-Im1", "p3-Im1"]) expect(g.get(key)!.dict, key).toContain("DeviceGray");
    expect(g.get("p4-Im3")!.dict).toContain("DeviceCMYK");
    expect(gray.result.skipped.map((s) => s.pass)).not.toContain("grayscale");

    const jxl = await compress({ ...defaultCompressParams("ebook"), codec: "libjxl" });
    expect(jxl.result.skipped.find((s) => s.pass === "reencode-images")?.reason).toBe(
      "JPEG XL isn't available yet — images set to it keep their encoding.",
    );
  }, 180_000);

  test("memory guard: a JPEG too big to decode whole is shrunk on load; anything else is kept", async () => {
    const codec = await import("../src/compress/imagecodec");
    const { estimateImagePeak } = await import("../src/limits");
    const c = context("compress", {}, photos, null);
    const images = await codec.listImages(c.ctx, photos);
    const photo = images.find((i) => i.id === 3)!;
    // Room for 1200×800 but not 2400×1600: libjpeg decodes at half size, still above the 900×600 target.
    const room = estimateImagePeak(1300, 900, 3) / 0.8;
    const px = await codec.decodeImage(c.ctx, photos, photo, c.ctx.workDir, { room, atLeast: { width: 900, height: 600 } });
    expect([px.width, px.height, px.channels]).toEqual([1200, 800, 3]);
    // Wanting the full size, nothing fits.
    await expect(codec.decodeImage(c.ctx, photos, photo, c.ctx.workDir, { room })).rejects.toBeInstanceOf(codec.Kept);
    // A Flate image can't be shrunk while decoding.
    const flat = images.find((i) => i.id === 4)!;
    await expect(codec.decodeImage(c.ctx, photos, flat, c.ctx.workDir, { room, atLeast: { width: 10, height: 10 } })).rejects.toBeInstanceOf(codec.Kept);
  });

  test("crop: before and after of the same region; after is the downsampled re-encode, its bytes the whole image's", async () => {
    const photo = analysis.images.find((i) => i.id === "3")!;
    const box: [number, number, number, number] = [1000, 600, 1400, 1000];
    const c = await crop("3", defaultCompressParams("ebook"), box);
    expect(pngSize(c.before)).toEqual({ width: 400, height: 400 });
    // 2400 → 900 wide: the same region is 150 px.
    expect(pngSize(c.after)).toEqual({ width: 150, height: 150 });
    expect(c.result.afterBytes).toBeLessThan(photo.bytes / 3);

    // The centre when no box is given; with an override that keeps full resolution, same size before and after.
    const full = await crop("3", { ...defaultCompressParams("ebook"), overrides: { "3": { dpiCap: null, quality: 40 } } }, null);
    expect(pngSize(full.after)).toEqual({ width: 400, height: 400 });
    expect(Buffer.compare(readFileSync(full.after), readFileSync(full.before))).not.toBe(0);

    // Skipped: the after is the before, at the original's bytes.
    const skip = await crop("3", { ...defaultCompressParams("ebook"), overrides: { "3": { skip: true } } }, box);
    expect(Buffer.compare(readFileSync(skip.after), readFileSync(skip.before))).toBe(0);
    expect(skip.result.afterBytes).toBe(photo.bytes);

    // CMYK: shown converted to RGB, kept as it is.
    const cmyk = await crop("8", defaultCompressParams("ebook"), null);
    expect(cmyk.result.afterBytes).toBe(analysis.images.find((i) => i.id === "8")!.bytes);
    expect(pngSize(cmyk.before)).toEqual({ width: 400, height: 400 });

    await expect(crop("999", defaultCompressParams("ebook"), null)).rejects.toThrow("That image isn't in this file.");
  }, 180_000);
});
