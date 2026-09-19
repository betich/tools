import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MERGE_ITEM,
  DEFAULT_MERGE_OUTPUT,
  defaultRuns,
  expandRuns,
  isDefaultOrder,
  MAX_MERGE_RUNS,
  mergePagesProblem,
  parsePageRange,
  toRuns,
  type MergeItem,
  type MergePageRun,
  type MergeParams,
} from "../src/pageLayout";

const pages = (text: string, count: number) => {
  const r = parsePageRange(text, count);
  if (!r.ok) throw new Error(r.error);
  return r.pages;
};
const error = (text: string, count: number) => {
  const r = parsePageRange(text, count);
  if (r.ok) throw new Error(`parsed: ${r.pages}`);
  return r.error;
};

const pdf = (upload: string): MergeItem => ({ upload, name: `${upload}.pdf`, kind: "pdf", layout: DEFAULT_MERGE_ITEM });
const image = (upload: string): MergeItem => ({ upload, name: `${upload}.jpg`, kind: "jpeg", layout: DEFAULT_MERGE_ITEM });

describe("parsePageRange", () => {
  test("reads the spec's example as 0-based indices", () => {
    expect(pages("1-3, 5, 8-", 10)).toEqual([0, 1, 2, 4, 7, 8, 9]);
  });
  test("single pages, open starts and open ends", () => {
    expect(pages("2", 5)).toEqual([1]);
    expect(pages("-3", 5)).toEqual([0, 1, 2]);
    expect(pages("4-", 5)).toEqual([3, 4]);
    expect(pages("1-", 1)).toEqual([0]);
  });
  test("keeps typed order, so a range can reorder a file", () => {
    expect(pages("5, 1-2", 5)).toEqual([4, 0, 1]);
    expect(pages("5-3", 5)).toEqual([4, 3, 2]);
  });
  test("drops repeats, keeping the first", () => {
    expect(pages("1-3, 2, 3-4", 5)).toEqual([0, 1, 2, 3]);
  });
  test("accepts spaces, en and em dashes, and loose separators", () => {
    expect(pages(" 1 – 2 ,3—4 ; 5 ", 5)).toEqual([0, 1, 2, 3, 4]);
    expect(pages("1 3 5", 5)).toEqual([0, 2, 4]);
    expect(pages("1,,2,", 5)).toEqual([0, 1]);
  });
  test("refuses empty input", () => {
    expect(error("", 5)).toContain("Type");
    expect(error("  , ", 5)).toContain("Type");
  });
  test("refuses what is not a range", () => {
    expect(error("a", 5)).toContain("“a”");
    expect(error("1-2-3", 5)).toContain("“1-2-3”");
    expect(error("-", 5)).toContain("“-”");
    expect(error("1.5", 5)).toContain("“1.5”");
  });
  test("refuses page 0 and pages past the end", () => {
    expect(error("0", 5)).toContain("start at 1");
    expect(error("0-2", 5)).toContain("start at 1");
    expect(error("6", 5)).toBe("This file has 5 pages; there is no page 6.");
    expect(error("3-9", 5)).toContain("no page 9");
    expect(error("2", 1)).toBe("This file has 1 page; there is no page 2.");
  });
  test("an open end past the last page is refused, not emptied", () => {
    expect(error("7-", 5)).toContain("no page 7");
  });
  test("a file with no pages has nothing to pick", () => {
    expect(error("1", 0)).toContain("no pages");
  });
});

describe("toRuns and expandRuns", () => {
  test("merges ascending neighbours from the same item", () => {
    const refs = [0, 1, 2].map((page) => ({ item: 0, page }));
    expect(toRuns(refs)).toEqual([[0, 0, 2]]);
  });
  test("the spec's case: A 1–3, B 2, A 4–", () => {
    const refs = [
      ...[0, 1, 2].map((page) => ({ item: 0, page })),
      { item: 1, page: 1 },
      ...[3, 4, 5].map((page) => ({ item: 0, page })),
    ];
    const runs = toRuns(refs);
    expect(runs).toEqual([[0, 0, 2], [1, 1, 1], [0, 3, 5]]);
    expect(expandRuns(runs)).toEqual(refs);
  });
  test("does not merge across items, gaps or descending pages", () => {
    const refs = [
      { item: 0, page: 0 },
      { item: 1, page: 1 },
      { item: 1, page: 3 },
      { item: 1, page: 2 },
    ];
    expect(toRuns(refs)).toEqual([[0, 0, 0], [1, 1, 1], [1, 3, 3], [1, 2, 2]]);
  });
  test("two items of the same upload stay apart", () => {
    // Items, not uploads, are the unit: the same PDF added twice is two files.
    expect(toRuns([{ item: 0, page: 4 }, { item: 1, page: 5 }])).toEqual([[0, 4, 4], [1, 5, 5]]);
  });
  test("interleaving two 20-page scans makes 40 single-page runs", () => {
    const refs = Array.from({ length: 40 }, (_, i) => ({ item: i % 2, page: Math.floor(i / 2) }));
    const runs = toRuns(refs);
    expect(runs.length).toBe(40);
    expect(expandRuns(runs)).toEqual(refs);
  });
  test("empty in, empty out", () => {
    expect(toRuns([])).toEqual([]);
    expect(expandRuns([])).toEqual([]);
  });
});

describe("defaultRuns and isDefaultOrder", () => {
  const items = [pdf("up_a"), image("up_b"), pdf("up_c")];
  const counts = [3, undefined, 2];
  const count = (i: number) => counts[i];

  test("every item whole, in item order; images are one page", () => {
    expect(defaultRuns(items, count)).toEqual([[0, 0, 2], [1, 0, 0], [2, 0, 1]]);
  });
  test("an untouched list is the default", () => {
    expect(isDefaultOrder(defaultRuns(items, count)!, items, count)).toBe(true);
    // Split runs that expand to the same pages are still the default.
    expect(isDefaultOrder([[0, 0, 0], [0, 1, 2], [1, 0, 0], [2, 0, 1]], items, count)).toBe(true);
  });
  test("a dropped, moved or extra page is not", () => {
    expect(isDefaultOrder([[0, 0, 1], [1, 0, 0], [2, 0, 1]], items, count)).toBe(false);
    expect(isDefaultOrder([[1, 0, 0], [0, 0, 2], [2, 0, 1]], items, count)).toBe(false);
    expect(isDefaultOrder([[0, 0, 2], [1, 0, 0], [2, 0, 1], [2, 1, 1]], items, count)).toBe(false);
    expect(isDefaultOrder([], items, count)).toBe(false);
  });
  test("an unknown PDF page count cannot be proven default", () => {
    const unknown = (i: number) => (i === 2 ? undefined : counts[i]);
    expect(defaultRuns(items, unknown)).toBeNull();
    expect(isDefaultOrder([[0, 0, 2], [1, 0, 0], [2, 0, 1]], items, unknown)).toBe(false);
  });
  test("no items, no pages: nothing to merge is trivially default", () => {
    expect(isDefaultOrder([], [], () => undefined)).toBe(true);
  });
});

describe("mergePagesProblem", () => {
  const items = [pdf("up_a"), image("up_b")];

  test("accepts well-formed runs, with or without counts", () => {
    expect(mergePagesProblem([[0, 0, 2], [1, 0, 0], [0, 5, 5]], items)).toBeNull();
    expect(mergePagesProblem([[0, 0, 2]], items, () => 3)).toBeNull();
  });
  test("refuses shapes that are not runs", () => {
    for (const bad of [null, {}, "0-2", [[0, 0]], [[0, 0, "1"]], [[0, 0.5, 1]], [{ item: 0, from: 0, to: 1 }]]) {
      expect(mergePagesProblem(bad, items)).not.toBeNull();
    }
  });
  test("refuses an empty list", () => {
    expect(mergePagesProblem([], items)).toContain("at least one page");
  });
  test("refuses unknown items and reversed or negative ranges", () => {
    expect(mergePagesProblem([[2, 0, 0]], items)).not.toBeNull();
    expect(mergePagesProblem([[-1, 0, 0]], items)).not.toBeNull();
    expect(mergePagesProblem([[0, 3, 1]], items)).not.toBeNull();
    expect(mergePagesProblem([[0, -1, 1]], items)).not.toBeNull();
  });
  test("an image has one page, 0", () => {
    expect(mergePagesProblem([[1, 0, 1]], items)).not.toBeNull();
    expect(mergePagesProblem([[1, 1, 1]], items)).not.toBeNull();
  });
  test("checks the last page against a known count", () => {
    expect(mergePagesProblem([[0, 0, 3]], items, () => 3)).toContain("page 4");
  });
  test("caps the number of runs", () => {
    const many: MergePageRun[] = Array.from({ length: MAX_MERGE_RUNS + 1 }, (_, i) => [0, i * 2, i * 2]);
    expect(mergePagesProblem(many, items)).toContain("pieces");
    expect(mergePagesProblem(many.slice(0, MAX_MERGE_RUNS), items)).toBeNull();
  });
});

describe("encoding", () => {
  test("the worst-case run list fits the 64 KiB params cap with room for the items", () => {
    const worst: MergePageRun[] = Array.from({ length: MAX_MERGE_RUNS }, (_, i) => [199, 9_000 + i, 9_000 + i]);
    const bytes = new TextEncoder().encode(JSON.stringify(worst)).length;
    expect(bytes).toBeLessThan(24 * 1024);
  });
  test("an untouched merge sends no `pages`, so the request is today's", () => {
    const params: MergeParams = { items: [pdf("up_a")], output: DEFAULT_MERGE_OUTPUT };
    expect("pages" in params).toBe(false);
  });
});
