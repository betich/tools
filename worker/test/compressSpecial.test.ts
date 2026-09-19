import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultCompressParams,
  NEEDS_PASSWORD,
  SIGNATURE_REFUSAL,
  type CompressParams,
  type PdfAnalysis,
  type RunResult,
} from "@tools/shared";

/**
 * Special inputs (#15) through the real compress handler: the `prepare` and
 * `seal` steps (src/compress/special.ts) against the generated fixtures. Needs
 * the worker image's toolchain:
 *
 *   docker run --rm -v "$PWD":/app -w /app --entrypoint bun tools-pdf-worker:latest test worker/test
 */

const hasTools = ["mutool", "qpdf", "jpegtran", "vips", "gs", "openssl"].every((t) => !!Bun.which(t));
const root = mkdtempSync(join(tmpdir(), "compress-special-"));
const fixtures = join(root, "fx");
process.env.DATA_DIR = join(root, "data");

let jobs: typeof import("../src/jobs");
let special: typeof import("../src/special");

function task() {
  const dir = mkdtempSync(join(root, "task-"));
  const workDir = join(dir, "work");
  const outDir = join(dir, "out");
  for (const d of [workDir, outDir]) Bun.spawnSync(["mkdir", "-p", d]);
  const signal = new AbortController().signal;
  return { dir, workDir, outDir, signal, run: jobs.toolRunner(workDir, signal) };
}

async function handle(kind: "analyse" | "compress", file: string, password: string | null, extra: { params?: unknown; analysis?: unknown } = {}) {
  const t = task();
  const input = join(t.dir, "upload.pdf");
  copyFileSync(file, input);
  const out = await jobs.handlerFor(kind)!({
    task: { id: "task_test", kind, params: extra.params ?? null },
    job: { id: "job_test", tool: "compress", password },
    inputs: [{ id: "up", name: "input.pdf", kind: "pdf", size: statSync(input).size, path: input }],
    analysis: extra.analysis ?? null,
    outDir: t.outDir,
    workDir: t.workDir,
    signal: t.signal,
    progress: () => {},
    run: t.run,
  });
  return { result: out.result, out: out.file ? join(t.outDir, out.file.name) : "" };
}

const analyse = async (file: string, password: string | null = null) => (await handle("analyse", file, password)).result as PdfAnalysis;

async function compress(file: string, password: string | null, params: Partial<CompressParams> = {}) {
  const analysis = await analyse(file, password);
  const { result, out } = await handle("compress", file, password, { params: { ...defaultCompressParams(), ...params }, analysis });
  return { result: result as RunResult, out, analysis };
}

/** Every page drawn at 72 dpi, with the password when there is one. */
function render(file: string, password?: string): Buffer[] {
  const dir = mkdtempSync(join(root, "draw-"));
  const r = Bun.spawnSync(["mutool", "draw", "-q", ...(password ? ["-p", password] : []), "-r", "72", "-c", "rgb", "-o", join(dir, "p%04d.pnm"), file]);
  expect(r.exitCode).toBe(0);
  const pages = readdirSync(dir).sort().map((f) => readFileSync(join(dir, f)));
  rmSync(dir, { recursive: true });
  return pages;
}

const encryption = (file: string) => Bun.spawnSync(["qpdf", "--show-encryption", "--password=secret", file]).stdout.toString();
const catalogXmp = (file: string) => Bun.spawnSync(["mutool", "show", "-b", file, "trailer/Root/Metadata"]).stdout.toString();

describe.skipIf(!hasTools)("compress: special inputs", () => {
  beforeAll(async () => {
    const r = Bun.spawnSync(["sh", join(import.meta.dir, "fixtures/make.sh"), fixtures]);
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    jobs = await import("../src/jobs");
    special = await import("../src/special");
    await import("../src/handlers");
  }, 90_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("locked: refused until unlocked", async () => {
    const analysis = await analyse(join(fixtures, "locked.pdf"));
    expect(analysis.locked).toBe(true);
    const params = { ...defaultCompressParams(), acceptSignatureLoss: true };
    expect(handle("compress", join(fixtures, "locked.pdf"), null, { params, analysis })).rejects.toThrow(NEEDS_PASSWORD);
  });

  test("encrypted and signed: refused until the signature's loss is accepted", async () => {
    const file = join(fixtures, "locked.pdf");
    const analysis = await analyse(file, "secret");
    expect(analysis.flags.signed).toEqual(["Test Signer"]);
    expect(handle("compress", file, "secret", { params: defaultCompressParams(), analysis })).rejects.toThrow(SIGNATURE_REFUSAL);
  });

  test("encrypted: decrypted by default, pages unchanged", async () => {
    const file = join(fixtures, "locked.pdf");
    // Images left as they are (#10), so decryption alone must leave the pixels exact.
    const images = (await analyse(file, "secret")).images;
    const overrides = Object.fromEntries(images.map((i) => [i.id, { skip: true }]));
    const { result, out } = await compress(file, "secret", { acceptSignatureLoss: true, overrides });
    expect(result.keptOriginal).toBe(false);
    expect(encryption(out)).toContain("File is not encrypted");
    expect(result.analysis.pages).toBe(3);
    expect(result.analysis.locked).toBeUndefined();
    expect(result.analysis.flags.encrypted).toBe(false);
    expect(result.notes).toContain("Saved without a password.");
    expect(result.notes).toContain("The signature by Test Signer is no longer valid.");
    const before = render(file, "secret");
    const after = render(out);
    expect(after.length).toBe(before.length);
    after.forEach((page, i) => expect(Buffer.compare(page, before[i]!), `page ${i + 1}`).toBe(0));
  });

  test("encrypted, reencrypt: AES-256 under the same password", async () => {
    const file = join(fixtures, "locked.pdf");
    const { result, out } = await compress(file, "secret", { acceptSignatureLoss: true, reencrypt: true });
    expect(encryption(out)).toContain("AESv3");
    expect(result.notes).toContain("Encrypted with the same password (AES-256).");
    // The result analysis was read with the password, not reported locked.
    expect(result.analysis).toMatchObject({ pages: 3 });
    expect(result.analysis.locked).toBeUndefined();
    expect(render(out, "secret")).toHaveLength(3);
    expect(Bun.spawnSync(["mutool", "draw", "-q", "-o", "/dev/null", out]).exitCode).not.toBe(0);
  });

  test("decrypting keeps object numbers, so image ids still hold", async () => {
    const file = join(fixtures, "locked.pdf");
    const t = task();
    const plain = await special.decryptInput(t.run, file, "secret", t.workDir);
    const ids = (a: PdfAnalysis) => a.images.map((i) => i.id).sort();
    expect(ids(await analyse(plain))).toEqual(ids(await analyse(file, "secret")));
    expect(special.decryptInput(t.run, file, "nope", t.workDir)).rejects.toThrow("That password didn't open the file.");
  });

  test("PDF/A-2b, metadata stripped: the pdfaid identification stays, the rest goes", async () => {
    const file = join(fixtures, "pdfa.pdf");
    expect(catalogXmp(file)).toContain("Producer");
    const { result, out } = await compress(file, null, defaultCompressParams("ebook"));
    expect(result.keptOriginal).toBe(false);
    const xmp = catalogXmp(out);
    expect(xmp).toContain("<pdfaid:part>2</pdfaid:part>");
    expect(xmp).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
    expect(xmp).not.toContain("Producer");
    expect(result.analysis.flags.pdfa).toBe("PDF/A-2b");
    expect(result.notes).toContain("Kept the PDF/A-2b identification in the metadata.");
  });

  test("PDF/A-2b, metadata kept: the XMP is untouched", async () => {
    const file = join(fixtures, "pdfa.pdf");
    const { out, result } = await compress(file, null, defaultCompressParams("print"));
    if (!result.keptOriginal) expect(catalogXmp(out)).toContain("Producer");
    expect(result.notes.some((n) => n.startsWith("Kept the PDF/A"))).toBe(false);
  });

  test("damaged: exactly one repair note", async () => {
    const { result } = await compress(join(fixtures, "truncated.pdf"), null, defaultCompressParams("ebook"));
    // Served as it came (a tiny file rarely shrinks): no notes at all.
    expect(result.notes.filter((n) => n.startsWith("Repaired"))).toEqual(result.keptOriginal ? [] : ["Repaired 2 broken objects"]);
  });

  test("an ordinary file skips both steps", async () => {
    const file = join(fixtures, "tagged.pdf");
    const analysis = await analyse(file);
    const stages: string[] = [];
    const t = task();
    const input = join(t.dir, "upload.pdf");
    copyFileSync(file, input);
    await jobs.handlerFor("compress")!({
      task: { id: "task_test", kind: "compress", params: defaultCompressParams() },
      job: { id: "job_test", tool: "compress", password: null },
      inputs: [{ id: "up", name: "t.pdf", kind: "pdf", size: statSync(input).size, path: input }],
      analysis,
      outDir: t.outDir,
      workDir: t.workDir,
      signal: t.signal,
      progress: (stage) => void (stages.at(-1) !== stage && stages.push(stage)),
      run: t.run,
    });
    expect(stages).not.toContain("preparing the file");
    expect(stages).not.toContain("sealing the file");
  });
});
