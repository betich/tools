import { describe, expect, test } from "bun:test";
import { fileNameFor, uniqueNames } from "../src/merge";

describe("uniqueNames", () => {
  test("leaves names that are already distinct alone", () => {
    expect(uniqueNames(["a.png", "b.png", "c.png"])).toEqual(["a.png", "b.png", "c.png"]);
  });

  test("numbers a collision from two, keeping the extension", () => {
    expect(uniqueNames(["merge.png", "merge.png", "merge.png"])).toEqual(["merge.png", "merge-2.png", "merge-3.png"]);
  });

  test("steps past a number the set already holds", () => {
    expect(uniqueNames(["m.png", "m-2.png", "m.png"])).toEqual(["m.png", "m-2.png", "m-3.png"]);
  });

  test("handles a name with no extension", () => {
    expect(uniqueNames(["merge", "merge"])).toEqual(["merge", "merge-2"]);
  });

  /**
   * The bug this exists for: the export sheet's default pattern is
   * `merge-<name>`, and a sheet whose column is `ชื่อ` (or `mentor name`)
   * fills no such token — so every one of 36 rows was named `merge.png`, the
   * ZIP held 36 entries under that one name, and unzipping left one file.
   */
  test("36 rows whose pattern names no column still land as 36 files", () => {
    const rows = Array.from({ length: 36 }, (_, i) => ({ ชื่อ: `เมนเทอร์ ${i + 1}` }));
    const names = uniqueNames(rows.map((row, i) => fileNameFor("merge-<name>", row, i, "png")));
    expect(names.length).toBe(36);
    expect(new Set(names).size).toBe(36);
    expect(names[0]).toBe("merge.png");
    expect(names[35]).toBe("merge-36.png");
  });

  test("a sheet whose column the pattern does name keeps its own names", () => {
    const rows = [{ name: "Ada Lovelace" }, { name: "Grace Hopper" }];
    expect(uniqueNames(rows.map((row, i) => fileNameFor("merge-<name>", row, i, "png")))).toEqual([
      "merge-ada-lovelace.png",
      "merge-grace-hopper.png",
    ]);
  });
});
