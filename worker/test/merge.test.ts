import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MERGE_ITEM, DEFAULT_MERGE_OUTPUT, type MergePageRun, type MergeResult, type UploadKind } from "@tools/shared";

/**
 * Merge by page (#39): the merge handler run for real on numbered fixtures
 * (fixtures/outlined.js), checking page order by rendering, and bookmarks and
 * page labels by reading them back (fixtures/inspect.js). Needs the worker
 * image's toolchain:
 *
 *   docker run --rm -v "$PWD":/app -w /app --entrypoint bun tools-pdf-worker:latest test worker/test/merge.test.ts
 */

const hasTools = ["mutool", "qpdf", "vips"].every((t) => !!Bun.which(t));
const root = mkdtempSync(join(tmpdir(), "merge-"));
const fx = join(root, "fx");
const FIXTURES = join(import.meta.dir, "fixtures");
process.env.DATA_DIR = join(root, "data");

let jobs: typeof import("../src/jobs");

type Outline = { title: string; page: number | null; down?: Outline }[];
type Input = { path: string; name: string; kind: UploadKind };

function make(name: string, tag: string, pages: number, outline: unknown[] = [], labels: unknown[] = []): Input {
  const path = join(fx, name);
  const r = Bun.spawnSync(["mutool", "run", join(FIXTURES, "outlined.js"), path, tag, String(pages), JSON.stringify(outline), JSON.stringify(labels)]);
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return { path, name, kind: "pdf" };
}

const A_OUTLINE = [
  { title: "Intro", page: 1, down: [{ title: "Detail", page: 2 }] },
  { title: "Part two", page: 4, down: [{ title: "Five", page: 5 }] },
  { title: "End", page: 6 },
  { title: "Web", uri: "https://example.com/" },
];
let A: Input;
let B: Input;
let ODD: Input;
let EVEN: Input;
let DOT: Input;
let LOCKED: Input;

async function merge(inputs: Input[], extra: { pages?: MergePageRun[]; engine?: string } = {}) {
  const dir = mkdtempSync(join(root, "task-"));
  const workDir = join(dir, "work");
  const outDir = join(dir, "out");
  for (const d of [workDir, outDir]) mkdirSync(d, { recursive: true });
  const params = {
    items: inputs.map((i, n) => ({ upload: `up${n}`, name: i.name, kind: i.kind, layout: DEFAULT_MERGE_ITEM })),
    output: DEFAULT_MERGE_OUTPUT,
    ...extra,
  };
  const signal = new AbortController().signal;
  const ctx = {
    task: { id: "task_test", kind: "merge" as const, params },
    job: { id: "job_test", tool: "merge" as const, password: null },
    inputs: inputs.map((i, n) => ({ id: `up${n}`, name: i.name, kind: i.kind, size: statSync(i.path).size, path: i.path })),
    analysis: null,
    outDir,
    workDir,
    signal,
    progress: () => {},
    run: jobs.toolRunner(workDir, signal),
  };
  const out = await jobs.handlerFor("merge")!(ctx);
  return { result: out.result as MergeResult, out: join(outDir, out.file!.name) };
}

function inspect(file: string): { outline: Outline; labels: string[] } {
  const r = Bun.spawnSync(["mutool", "run", join(FIXTURES, "inspect.js"), file]);
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  return JSON.parse(r.stdout.toString());
}

/** Every page drawn at 36 dpi as raw RGB. */
function render(file: string): Buffer[] {
  const dir = mkdtempSync(join(root, "draw-"));
  expect(Bun.spawnSync(["mutool", "draw", "-r", "36", "-c", "rgb", "-o", join(dir, "p%04d.pnm"), file]).exitCode).toBe(0);
  const pages = readdirSync(dir)
    .sort()
    .map((f) => readFileSync(join(dir, f)));
  rmSync(dir, { recursive: true });
  return pages;
}

/** The output's pages are exactly these source pages (1-based), in this order. */
function expectPages(out: string, want: [Input, number][]) {
  const cache = new Map<string, Buffer[]>();
  const src = (i: Input) => cache.get(i.path) ?? (cache.set(i.path, render(i.path)), cache.get(i.path)!);
  const got = render(out);
  expect(got.length).toBe(want.length);
  want.forEach(([input, page], k) => expect(Buffer.compare(got[k]!, src(input)[page - 1]!), `output page ${k + 1} is ${input.name} ${page}`).toBe(0));
}

function expectValid(file: string) {
  const r = Bun.spawnSync(["qpdf", "--check", file]);
  expect(r.exitCode, r.stdout.toString() + r.stderr.toString()).toBe(0);
}

/** The file with its trailer /ID blanked: qpdf and MuPDF derive it from the time. */
const withoutId = (file: string) => readFileSync(file).toString("latin1").replace(/\/ID\s*\[[^\]]*\]/g, "/ID[]");

describe.skipIf(!hasTools)("merge by page", () => {
  beforeAll(async () => {
    mkdirSync(fx, { recursive: true });
    A = make("A.pdf", "A", 6, A_OUTLINE, [
      [0, "r", "", 1],
      [2, "D", "", 1],
    ]);
    B = make("B.pdf", "B", 3, [
      { title: "B one", page: 1 },
      { title: "B two", page: 2 },
      { title: "B three", page: 3 },
    ]);
    ODD = make("odd.pdf", "odd", 10);
    EVEN = make("even.pdf", "even", 10);
    DOT = { path: join(fx, "dot.png"), name: "dot.png", kind: "png" };
    expect(Bun.spawnSync(["vips", "black", DOT.path, "40", "30"]).exitCode).toBe(0);
    LOCKED = { path: join(fx, "locked.pdf"), name: "locked.pdf", kind: "pdf" };
    const lock = ["qpdf", "--encrypt", "--user-password=secret", "--owner-password=owner", "--bits=256", "--", B.path, LOCKED.path];
    expect(Bun.spawnSync(lock).exitCode).toBe(0);
    jobs = await import("../src/jobs");
    await import("../src/handlers");
  }, 60_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("A 1–3, B 2, A 4–: that order, a bookmark per run, the sources' bookmarks under the run holding their page", async () => {
    const { out, result } = await merge([A, B], { pages: [[0, 0, 2], [1, 1, 1], [0, 3, 5]] });
    expectValid(out);
    expect(result.pages).toBe(7);
    expectPages(out, [[A, 1], [A, 2], [A, 3], [B, 2], [A, 4], [A, 5], [A, 6]]);
    const { outline, labels } = inspect(out);
    expect(outline).toEqual([
      {
        title: "A.pdf (pages 1–3)",
        page: 1,
        down: [
          { title: "Intro", page: 1, down: [{ title: "Detail", page: 2 }] },
          { title: "Web", page: null },
        ],
      },
      { title: "B.pdf (page 2)", page: 4, down: [{ title: "B two", page: 4 }] },
      {
        title: "A.pdf (pages 4–6)",
        page: 5,
        down: [
          { title: "Part two", page: 5, down: [{ title: "Five", page: 6 }] },
          { title: "End", page: 7 },
        ],
      },
    ]);
    // Pages keep the labels they had: A's roman front matter, then its own numbering carried on.
    expect(labels).toEqual(["A i", "A ii", "A 1", "B 2", "A 2", "A 3", "A 4"]);
  }, 60_000);

  test("a bookmark whose page is left out goes, and its children that stay move up", async () => {
    const { out } = await merge([A], { pages: [[0, 1, 2]] });
    expectPages(out, [[A, 2], [A, 3]]);
    expect(inspect(out)).toEqual({
      outline: [
        {
          title: "A.pdf (pages 2–3)",
          page: 1,
          down: [
            { title: "Detail", page: 1 },
            { title: "Web", page: null },
          ],
        },
      ],
      labels: ["A ii", "A 1"],
    });
  }, 60_000);

  test("interleaving two 10-page scans page by page", async () => {
    const pages: MergePageRun[] = [];
    for (let p = 0; p < 10; p++) pages.push([0, p, p], [1, p, p]);
    const { out, result } = await merge([ODD, EVEN], { pages });
    expect(result.pages).toBe(20);
    expectPages(out, pages.map(([i, p]) => [i ? EVEN : ODD, p + 1] as [Input, number]));
    const { outline, labels } = inspect(out);
    expect(outline.map((o) => [o.title, o.page])).toEqual(
      pages.map(([i, p], k) => [`${i ? "even" : "odd"}.pdf (page ${p + 1})`, k + 1]),
    );
    expect(labels.slice(0, 4)).toEqual(["odd 1", "even 1", "odd 2", "even 2"]);
  }, 60_000);

  for (const engine of ["qpdf", "ghostscript", "pdf-lib"]) {
    test(`${engine}: merges by page too`, async () => {
      const { out } = await merge([A, B], { engine, pages: [[1, 2, 2], [0, 0, 0], [1, 0, 0]] });
      expectValid(out);
      expect(inspect(out).outline.map((o) => o.title)).toEqual(["B.pdf (page 3)", "A.pdf (page 1)", "B.pdf (page 1)"]);
      if (engine !== "ghostscript") expectPages(out, [[B, 3], [A, 1], [B, 1]]);
      else expect(render(out).length).toBe(3);
    }, 60_000);
  }

  test("an image is one page; files the page list leaves out are not read", async () => {
    const { out } = await merge([A, DOT, LOCKED], { pages: [[1, 0, 0], [0, 0, 0]] });
    expect(render(out).length).toBe(2);
    expect(inspect(out)).toEqual({
      outline: [
        { title: "dot.png", page: 1 },
        {
          title: "A.pdf (page 1)",
          page: 2,
          down: [
            { title: "Intro", page: 2 },
            { title: "Web", page: null },
          ],
        },
      ],
      labels: ["dot", "A i"],
    });
  }, 60_000);

  test("without pages, and with pages that keep every file whole, the output is the by-file one", async () => {
    const byFile = await merge([A, DOT, B]);
    const whole = await merge([A, DOT, B], { pages: [[0, 0, 5], [1, 0, 0], [2, 0, 2]] });
    const pieces = await merge([A, DOT, B], { pages: [[0, 0, 2], [0, 3, 5], [1, 0, 0], [2, 0, 0], [2, 1, 2]] });
    expect(withoutId(whole.out)).toBe(withoutId(byFile.out));
    expect(withoutId(pieces.out)).toBe(withoutId(byFile.out));
    const { outline, labels } = inspect(byFile.out);
    expect(outline).toEqual([
      {
        title: "A.pdf",
        page: 1,
        down: [
          { title: "Intro", page: 1, down: [{ title: "Detail", page: 2 }] },
          { title: "Part two", page: 4, down: [{ title: "Five", page: 5 }] },
          { title: "End", page: 6 },
          { title: "Web", page: null },
        ],
      },
      { title: "dot.png", page: 7 },
      { title: "B.pdf", page: 8, down: ["B one", "B two", "B three"].map((title, k) => ({ title, page: 8 + k })) },
    ]);
    expect(labels).toEqual(["A i", "A ii", "A 1", "A 2", "A 3", "A 4", "dot", "B 1", "B 2", "B 3"]);
  }, 60_000);

  test("a page list that doesn't fit the files is refused with a sentence", async () => {
    await expect(merge([A, B], { pages: [[1, 0, 3]] })).rejects.toThrow("“B.pdf” has 3 pages; there is no page 4.");
    await expect(merge([A, B], { pages: [[0, 2, 1]] })).rejects.toThrow("The page list is not readable — pick the pages again.");
    await expect(merge([A, B], { pages: [] })).rejects.toThrow("Keep at least one page to merge.");
    await expect(merge([A, DOT], { pages: [[1, 0, 1]] })).rejects.toThrow("“dot.png” has 1 page; there is no page 2.");
  }, 60_000);
});
