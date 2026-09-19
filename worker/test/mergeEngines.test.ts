import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { mergeJoinFor, registerMergeJoin } from "../src/mergeEngines";

describe("merge engines", () => {
  test("MuPDF is the default, and anything that isn't an engine means the default", () => {
    for (const asked of [undefined, null, "bogus", 3]) expect(mergeJoinFor(asked)).toMatchObject({ engine: "mupdf", note: null });
  });

  test("qpdf joins without a note", () => {
    expect(mergeJoinFor("qpdf")).toMatchObject({ engine: "qpdf", note: null });
  });

  test("Ghostscript and pdf-lib join with their own engine once #13's joins are loaded", async () => {
    // engines.ts pulls in jobs.ts, which opens the worker's SQLite on import.
    process.env.DATA_DIR ??= mkdtempSync(joinPath(tmpdir(), "merge-engines-"));
    const { ghostscriptJoin, pdfLibJoin } = await import("../src/engines");
    expect(mergeJoinFor("ghostscript")).toEqual({ engine: "ghostscript", join: ghostscriptJoin, note: null });
    expect(mergeJoinFor("pdf-lib")).toEqual({ engine: "pdf-lib", join: pdfLibJoin, note: null });
    const join = async () => {};
    registerMergeJoin("pdf-lib", join);
    expect(mergeJoinFor("pdf-lib")).toEqual({ engine: "pdf-lib", join, note: null });
    registerMergeJoin("pdf-lib", pdfLibJoin);
  });
});
