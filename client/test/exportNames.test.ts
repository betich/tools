import { describe, expect, test } from "bun:test";
import { downloadZip } from "client-zip";
import { fileNameFor, uniqueNames } from "@tools/shared";

/**
 * The export sheet's own naming, through the archive the browser builds.
 *
 * A ZIP holds same-named entries happily, so a set of rows that all earn one
 * name unzips to a single file. This asserts what lands on disk, not what the
 * sheet intended: 36 rows, the default `merge-<name>` pattern, and a sheet
 * whose only column is Thai — the case that shipped one file out of 36.
 */
const ROWS = Array.from({ length: 36 }, (_, i) => ({ ชื่อ: `เมนเทอร์ ${i + 1}`, บทบาท: "mentor" }));

/** Entry names read back out of a zip's central directory. */
async function entryNames(blob: Blob): Promise<string[]> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  const names: string[] = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (dv.getUint32(i, true) !== 0x02014b50) continue;
    const len = dv.getUint16(i + 28, true);
    names.push(new TextDecoder().decode(buf.subarray(i + 46, i + 46 + len)));
  }
  return names;
}

describe("mail merge export", () => {
  test("36 rows survive the archive as 36 files", async () => {
    const names = uniqueNames(ROWS.map((row, i) => fileNameFor("merge-<name>", row, i, "png")));
    const files = names.map((name, i) => ({ name, input: new Blob([new Uint8Array([i])]) }));

    const entries = await entryNames(await downloadZip(files).blob());
    expect(entries.length).toBe(36);
    expect(new Set(entries).size).toBe(36);
  });

  test("a pattern that names a real column keeps those names", async () => {
    const rows = [{ name: "Ada Lovelace" }, { name: "Grace Hopper" }];
    const names = uniqueNames(rows.map((row, i) => fileNameFor("cert-<name>", row, i, "png")));
    const entries = await entryNames(await downloadZip(names.map((name) => ({ name, input: new Blob(["x"]) }))).blob());
    expect(entries).toEqual(["cert-ada-lovelace.png", "cert-grace-hopper.png"]);
  });
});
