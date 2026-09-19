import { describe, expect, test } from "bun:test";
import { mergeJoinFor, registerMergeJoin } from "../src/mergeEngines";

describe("merge engines", () => {
  test("MuPDF is the default, and anything that isn't an engine means the default", () => {
    for (const asked of [undefined, null, "bogus", 3]) expect(mergeJoinFor(asked)).toMatchObject({ engine: "mupdf", note: null });
  });

  test("qpdf joins without a note", () => {
    expect(mergeJoinFor("qpdf")).toMatchObject({ engine: "qpdf", note: null });
  });

  test("an engine without a join falls back to MuPDF and says so, until one is registered", () => {
    expect(mergeJoinFor("pdf-lib")).toMatchObject({
      engine: "mupdf",
      note: "pdf-lib can't merge here yet — the files were merged with MuPDF instead.",
    });
    const join = async () => {};
    registerMergeJoin("pdf-lib", join);
    expect(mergeJoinFor("pdf-lib")).toEqual({ engine: "pdf-lib", join, note: null });
  });
});
