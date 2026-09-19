import { describe, expect, test } from "bun:test";
import { DEFAULT_MERGE_ITEM, parsePageRange, type MergeItem } from "@tools/shared";
import {
  filePages,
  layout,
  moveFile,
  NO_SELECTION,
  orderRequest,
  pagesOf,
  pick,
  prune,
  refId,
  removePages,
  resetFile,
  setFilePages,
  type OrderFile,
  type PageOrder,
} from "../src/tools/pdfmerge/pageOrder";

const A: OrderFile = { key: "a", pages: 5 };
const B: OrderFile = { key: "b", pages: 3 };
const IMG: OrderFile = { key: "i", pages: 1 };

const show = (order: PageOrder, files: OrderFile[]) =>
  layout(order, files)
    .map((s) => (s.kind === "page" ? `${s.ref.key}${s.ref.page + 1}` : `${s.key}:${s.state}`))
    .join(" ");

const item = (name: string, kind: MergeItem["kind"] = "pdf"): MergeItem => ({ upload: `up_${name}`, name, kind, layout: DEFAULT_MERGE_ITEM });
const range = (text: string, count: number) => {
  const r = parsePageRange(text, count);
  if (!r.ok) throw new Error(r.error);
  return r.pages;
};

describe("layout", () => {
  test("untouched: every file whole, in file order", () => {
    expect(show(null, [A, IMG, B])).toBe("a1 a2 a3 a4 a5 i1 b1 b2 b3");
  });

  test("a file not counted yet holds its place", () => {
    expect(show(null, [A, { key: "c", pages: undefined }, { key: "d", pages: null }])).toBe("a1 a2 a3 a4 a5 c:counting d:uncounted");
  });

  test("an edited order drops removed files and pages past the end, and adds new files whole", () => {
    const order: PageOrder = { refs: [{ key: "b", page: 1 }, { key: "a", page: 0 }, { key: "gone", page: 0 }, { key: "a", page: 9 }], taken: ["a", "b", "gone"] };
    expect(show(order, [A, B, IMG])).toBe("b2 a1 i1");
  });
});

describe("edits", () => {
  const files = [A, B];

  test("removing pages", () => {
    const next = removePages(null, files, new Set(["a#1", "b#0"]));
    expect(show(next, files)).toBe("a1 a3 a4 a5 b2 b3");
  });

  test("a file added after an edit goes on the end, whole", () => {
    const next = removePages(null, files, new Set(["a#1"]));
    expect(show(next, [A, B, IMG])).toBe("a1 a3 a4 a5 b1 b2 b3 i1");
  });

  test("a file still counting when the order was edited stays whole once counted", () => {
    const counting = { key: "c", pages: undefined };
    const next = removePages(null, [A, counting], new Set(["a#0"]));
    expect(show(next, [A, { key: "c", pages: 2 }])).toBe("a2 a3 a4 a5 c1 c2");
  });

  test("a range takes the file's place, in the order typed", () => {
    const next = setFilePages(null, files, "a", range("5-4, 1", 5));
    expect(show(next, files)).toBe("a5 a4 a1 b1 b2 b3");
  });

  test("a range for a file with nothing left goes after the files above it", () => {
    const empty = removePages(null, [A, B, IMG], new Set(["b#0", "b#1", "b#2"]));
    expect(show(empty, [A, B, IMG])).toBe("a1 a2 a3 a4 a5 i1");
    expect(show(setFilePages(empty, [A, B, IMG], "b", [2]), [A, B, IMG])).toBe("a1 a2 a3 a4 a5 b3 i1");
  });

  test("the spec's A 1–3, B 2, A 4– can be typed", () => {
    // B down to its page 2, and A's last pages taken out.
    let order = setFilePages(null, files, "b", [1]);
    order = removePages(order, files, new Set(["a#3", "a#4"]));
    expect(show(order, files)).toBe("a1 a2 a3 b2");
    // Putting A 4– after B is #42's drag; here the order is written out as it would leave it.
    order = { refs: [...pagesOf(layout(order, files)), { key: "a", page: 3 }, { key: "a", page: 4 }], taken: ["a", "b"] };
    expect(show(order, files)).toBe("a1 a2 a3 b2 a4 a5");
    expect(orderRequest(order, files, [item("A"), item("B")])).toEqual({ state: "pages", pages: [[0, 0, 2], [1, 1, 1], [0, 3, 4]] });
  });

  test("reset puts a file back whole, and an order that is whole again is untouched", () => {
    const edited = setFilePages(null, files, "a", [2, 0]);
    expect(show(resetFile(edited, files, "a"), files)).toBe("a1 a2 a3 a4 a5 b1 b2 b3");
    expect(resetFile(edited, files, "a")).toBeNull();
    const both = removePages(edited, files, new Set(["b#0"]));
    expect(show(resetFile(both, files, "a"), files)).toBe("a1 a2 a3 a4 a5 b2 b3");
  });

  test("an edit needs the file's count", () => {
    const counting = [A, { key: "c", pages: undefined }];
    expect(setFilePages(null, counting, "c", [0])).toBeNull();
    expect(resetFile(null, counting, "c")).toBeNull();
  });

  test("moving a file moves its pages as one block", () => {
    const edited = setFilePages(null, [A, B], "a", [0, 2]);
    expect(show(moveFile(edited, [B, A], "b"), [B, A])).toBe("b1 b2 b3 a1 a3");
    expect(show(moveFile(edited, [B, A], "a"), [B, A])).toBe("b1 b2 b3 a1 a3");
    expect(moveFile(null, [B, A], "a")).toBeNull();
  });
});

describe("filePages", () => {
  test("one file's pages, in output order", () => {
    const order = setFilePages(null, [A, B], "a", [3, 1]);
    expect(filePages(layout(order, [A, B]), "a")).toEqual([3, 1]);
    expect(filePages(layout(order, [A, B]), "b")).toEqual([0, 1, 2]);
  });
});

describe("selection", () => {
  const ids = ["a#0", "a#1", "a#2", "b#0", "b#1"];

  test("a click picks one page", () => {
    const s = pick(pick(NO_SELECTION, ids, "a#1"), ids, "b#0");
    expect([...s.ids]).toEqual(["b#0"]);
    expect(s.anchor).toBe("b#0");
  });

  test("shift picks from the anchor, either way, across files", () => {
    const s = pick(pick(NO_SELECTION, ids, "b#1"), ids, "a#1", { shift: true });
    expect([...s.ids].sort()).toEqual(["a#1", "a#2", "b#0", "b#1"]);
    expect(s.anchor).toBe("b#1");
  });

  test("mod toggles, and mod+shift adds a span", () => {
    let s = pick(NO_SELECTION, ids, "a#0");
    s = pick(s, ids, "a#2", { mod: true });
    expect([...s.ids].sort()).toEqual(["a#0", "a#2"]);
    s = pick(s, ids, "a#0", { mod: true });
    expect([...s.ids]).toEqual(["a#2"]);
    // The anchor is the last page clicked, even one toggled off.
    s = pick(s, ids, "a#2", { mod: true });
    s = pick(s, ids, "a#0", { mod: true });
    s = pick(s, ids, "b#0", { mod: true });
    s = pick(s, ids, "b#1", { shift: true, mod: true });
    expect([...s.ids].sort()).toEqual(["a#0", "b#0", "b#1"]);
  });

  test("shift with no anchor picks one", () => {
    expect([...pick(NO_SELECTION, ids, "a#2", { shift: true }).ids]).toEqual(["a#2"]);
  });

  test("prune drops what is no longer shown", () => {
    const s = pick(pick(NO_SELECTION, ids, "a#0"), ids, "a#2", { shift: true });
    expect(prune(s, new Set(ids))).toBe(s);
    const p = prune(s, new Set(["a#2", "b#0"]));
    expect([...p.ids]).toEqual(["a#2"]);
    expect(p.anchor).toBeNull();
  });
});

describe("orderRequest", () => {
  const items = [item("A"), item("B")];

  test("untouched sends no page list", () => {
    expect(orderRequest(null, [A, B], items)).toEqual({ state: "whole" });
  });

  test("untouched needs no counts at all", () => {
    expect(orderRequest(null, [{ key: "a", pages: undefined }, { key: "b", pages: null }], items)).toEqual({ state: "whole" });
  });

  test("an edit sends runs keyed by item index", () => {
    const order = removePages(null, [A, B], new Set(["a#1"]));
    expect(orderRequest(order, [A, B], items)).toEqual({ state: "pages", pages: [[0, 0, 0], [0, 2, 4], [1, 0, 2]] });
  });

  test("an edited order that ends up whole sends none", () => {
    const order: PageOrder = { refs: pagesOf(layout(null, [A, B])), taken: ["a", "b"] };
    expect(orderRequest(order, [A, B], items)).toEqual({ state: "whole" });
  });

  test("an image is one page, index 0", () => {
    const order = removePages(null, [A, IMG], new Set(["a#0"]));
    expect(orderRequest(order, [A, IMG], [item("A"), item("I", "jpeg")])).toEqual({ state: "pages", pages: [[0, 1, 4], [1, 0, 0]] });
  });

  test("waits on a file being counted", () => {
    const order = removePages(null, [A, B], new Set(["a#0"]));
    expect(orderRequest(order, [A, B, { key: "c", pages: undefined }], [...items, item("C")])).toEqual({ state: "counting" });
  });

  test("names a file that can't be counted", () => {
    const order = removePages(null, [A, B], new Set(["a#0"]));
    const r = orderRequest(order, [A, B, { key: "c", pages: null }], [...items, item("scan.pdf")]);
    expect(r.state).toBe("problem");
    expect(r.state === "problem" && r.message).toContain("“scan.pdf”");
  });

  test("an empty output is a problem, said as-is", () => {
    const order = removePages(null, [B], new Set(["b#0", "b#1", "b#2"]));
    expect(orderRequest(order, [B], [item("B")])).toEqual({ state: "problem", message: "Keep at least one page to merge." });
  });

  test("refId is key#page", () => {
    expect(refId({ key: "m3", page: 4 })).toBe("m3#4");
  });
});
