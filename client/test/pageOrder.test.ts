import { describe, expect, test } from "bun:test";
import { DEFAULT_MERGE_ITEM, parsePageRange, type MergeItem } from "@tools/shared";
import {
  canInterleave,
  filePages,
  interleavePages,
  layout,
  moveFile,
  moveFileTo,
  movePages,
  NO_SELECTION,
  orderRequest,
  pagesOf,
  pick,
  prune,
  refId,
  removePages,
  resetFile,
  setFilePages,
  shiftPages,
  type OrderFile,
  type PageOrder,
  type Uncounted,
} from "../src/tools/pdfmerge/pageOrder";

const A: OrderFile = { key: "a", pages: 5 };
const B: OrderFile = { key: "b", pages: 3 };
const IMG: OrderFile = { key: "i", pages: 1 };
const LOCKED: Uncounted = { reason: "this PDF is password-protected", retry: false };
const OFFLINE: Uncounted = { reason: null, retry: true };

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
    expect(show(null, [A, { key: "c", pages: undefined }, { key: "d", pages: LOCKED }])).toBe("a1 a2 a3 a4 a5 c:counting d:uncounted");
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

  test("a file still counting when the order was edited keeps its place in the file order", () => {
    const counting = { key: "c", pages: undefined };
    const next = removePages(null, [A, counting, B], new Set(["a#0"]));
    expect(show(next, [A, counting, B])).toBe("a2 a3 a4 a5 c:counting b1 b2 b3");
    const counted = [A, { key: "c", pages: 2 }, B];
    expect(show(next, counted)).toBe("a2 a3 a4 a5 c1 c2 b1 b2 b3");
    expect(orderRequest(next, counted, [item("A"), item("C"), item("B")])).toEqual({
      state: "pages",
      pages: [[0, 1, 4], [1, 0, 1], [2, 0, 2]],
    });
    // One that can't be counted holds its place too, until it is removed or the order reset.
    expect(show(next, [A, { key: "c", pages: LOCKED }, B])).toBe("a2 a3 a4 a5 c:uncounted b1 b2 b3");
  });

  test("a later edit keeps a file that is still counting where it is", () => {
    const counting = { key: "c", pages: undefined };
    let order = removePages(null, [A, counting, B], new Set(["a#0"]));
    order = removePages(order, [A, counting, B], new Set(["b#0"]));
    order = movePages(order, [A, counting, B], new Set(["a#1"]), null);
    expect(show(order, [A, counting, B])).toBe("a3 a4 a5 c:counting b2 b3 a2");
    expect(show(order, [A, { key: "c", pages: 1 }, B])).toBe("a3 a4 a5 c1 b2 b3 a2");
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

  test("moveFileTo takes the list as it was and where the file went", () => {
    const edited = setFilePages(null, [A, B, IMG], "a", [0, 2]);
    expect(show(moveFileTo(edited, [A, B, IMG], "a", 2), [B, IMG, A])).toBe("b1 b2 b3 i1 a1 a3");
    expect(show(moveFileTo(edited, [A, B, IMG], "i", 0), [IMG, A, B])).toBe("i1 a1 a3 b1 b2 b3");
    expect(moveFileTo(edited, [A, B], "gone", 0)).toBe(edited);
    expect(moveFileTo(null, [A, B], "a", 1)).toBeNull();
  });

  test("a file still counting moves with the list", () => {
    const counting = { key: "c", pages: undefined };
    const edited = removePages(null, [A, counting, B], new Set(["a#0"]));
    expect(show(moveFileTo(edited, [A, counting, B], "c", 0), [counting, A, B])).toBe("c:counting a2 a3 a4 a5 b1 b2 b3");
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

  test("names a file that can't be counted, with the server's reason as it was sent", () => {
    const order = removePages(null, [A, B], new Set(["a#0"]));
    const r = orderRequest(order, [A, B, { key: "c", pages: LOCKED }], [...items, item("scan.pdf")]);
    expect(r.state).toBe("problem");
    expect(r.state === "problem" && r.message).toContain("“scan.pdf”");
    expect(r.state === "problem" && r.message).toContain("this PDF is password-protected");
  });

  test("a count that failed for now says it can be tried again", () => {
    const order = removePages(null, [A, B], new Set(["a#0"]));
    const r = orderRequest(order, [A, B, { key: "c", pages: OFFLINE }], [...items, item("scan.pdf")]);
    expect(r.state === "problem" && r.message).toMatch(/try again/i);
  });

  test("an empty output is a problem, said as-is", () => {
    const order = removePages(null, [B], new Set(["b#0", "b#1", "b#2"]));
    expect(orderRequest(order, [B], [item("B")])).toEqual({ state: "problem", message: "Keep at least one page to merge." });
  });

  test("refId is key#page", () => {
    expect(refId({ key: "m3", page: 4 })).toBe("m3#4");
  });
});

describe("moving pages", () => {
  const files = [A, B];

  test("a drop before a page, across files", () => {
    expect(show(movePages(null, files, new Set(["b#1"]), "a#1"), files)).toBe("a1 b2 a2 a3 a4 a5 b1 b3");
  });

  test("a drop at the end", () => {
    expect(show(movePages(null, files, new Set(["a#0"]), null), files)).toBe("a2 a3 a4 a5 b1 b2 b3 a1");
  });

  test("several pages move as one block, in the order shown", () => {
    const next = movePages(null, files, new Set(["b#2", "a#0", "a#3"]), "b#1");
    expect(show(next, files)).toBe("a2 a3 a5 b1 a1 a4 b3 b2");
  });

  test("a drop on one of the pages moving lands before the next page that stays", () => {
    expect(show(movePages(null, files, new Set(["a#0", "a#2"]), "a#2"), files)).toBe("a2 a1 a3 a4 a5 b1 b2 b3");
  });

  test("a drop where the pages already are is no change at all", () => {
    const edited = removePages(null, files, new Set(["b#0"]));
    expect(movePages(edited, files, new Set(["a#1"]), "a#2")).toBe(edited);
    expect(movePages(edited, files, new Set(["a#1"]), "a#1")).toBe(edited);
    expect(movePages(null, files, new Set(["b#2"]), null)).toBeNull();
  });

  test("moving back where they were is untouched again", () => {
    const moved = movePages(null, files, new Set(["a#0"]), null);
    expect(movePages(moved, files, new Set(["a#0"]), "a#1")).toBeNull();
  });

  test("the spec's A 1–3, B 2, A 4– is a range and one drag", () => {
    // B's range box: "2". Then drag B's page 2 in before A's page 4.
    let order = setFilePages(null, files, "b", range("2", 3));
    order = movePages(order, files, new Set(["b#1"]), "a#3");
    expect(show(order, files)).toBe("a1 a2 a3 b2 a4 a5");
    expect(orderRequest(order, files, [item("A"), item("B")])).toEqual({ state: "pages", pages: [[0, 0, 2], [1, 1, 1], [0, 3, 4]] });
  });

  test("a file still counting stays whole, where it was", () => {
    const counting = { key: "c", pages: undefined };
    const next = movePages(null, [A, counting, B], new Set(["b#0"]), "a#0");
    expect(show(next, [A, counting, B])).toBe("b1 a1 a2 a3 a4 a5 c:counting b2 b3");
  });
});

describe("shifting pages (the keyboard's move)", () => {
  const files = [A, B];

  test("one step either way, across a file boundary", () => {
    expect(show(shiftPages(null, files, new Set(["b#0"]), -1), files)).toBe("a1 a2 a3 a4 b1 a5 b2 b3");
    expect(show(shiftPages(null, files, new Set(["a#4"]), 1), files)).toBe("a1 a2 a3 a4 b1 a5 b2 b3");
  });

  test("a scattered pick gathers where its first page is, then steps", () => {
    expect(show(shiftPages(null, files, new Set(["a#1", "a#3"]), 1), files)).toBe("a1 a3 a2 a4 a5 b1 b2 b3");
  });

  test("stops at the ends", () => {
    expect(shiftPages(null, files, new Set(["a#0"]), -1)).toBeNull();
    expect(shiftPages(null, files, new Set(["b#2"]), 1)).toBeNull();
    expect(shiftPages(null, files, new Set(), 1)).toBeNull();
  });
});

describe("interleaving", () => {
  const scan = (key: string, pages = 20): OrderFile => ({ key, pages });
  const all = (files: OrderFile[]) => new Set(layout(null, files).flatMap((s) => (s.kind === "page" ? [s.id] : [])));

  test("two 20-page scans, fronts and backs: pick all, interleave", () => {
    const files = [scan("f"), scan("b")];
    const order = interleavePages(null, files, all(files));
    const shown = show(order, files).split(" ");
    expect(shown.slice(0, 6)).toEqual(["f1", "b1", "f2", "b2", "f3", "b3"]);
    expect(shown).toHaveLength(40);
    expect(shown.at(-1)).toBe("b20");
    const r = orderRequest(order, files, [item("fronts"), item("backs")]);
    expect(r.state === "pages" && r.pages).toHaveLength(40);
  });

  test("backs scanned last page first: \"20-1\" in their range box, then interleave", () => {
    const files = [scan("f"), scan("b")];
    const order = interleavePages(setFilePages(null, files, "b", range("20-1", 20)), files, all(files));
    expect(show(order, files).split(" ").slice(0, 4)).toEqual(["f1", "b20", "f2", "b19"]);
  });

  test("only the picked pages are dealt, where the first of them is; a shorter file drops out", () => {
    const files = [A, B];
    const order = interleavePages(null, files, new Set(["a#1", "a#2", "a#3", "b#0", "b#1"]));
    expect(show(order, files)).toBe("a1 a2 b1 a3 b2 a4 a5 b3");
  });

  test("files take turns in the order their pages first appear", () => {
    const files = [A, B];
    const moved = movePages(null, files, new Set(["b#0", "b#1", "b#2"]), "a#0");
    expect(show(interleavePages(moved, files, all(files)), files)).toBe("b1 a1 b2 a2 b3 a3 a4 a5");
  });

  test("needs pages from two files", () => {
    const files = [A, B];
    expect(interleavePages(null, files, new Set(["a#0", "a#1"]))).toBeNull();
    expect(canInterleave(layout(null, files), new Set(["a#0", "a#1"]))).toBe(false);
    expect(canInterleave(layout(null, files), new Set(["a#0", "b#1"]))).toBe(true);
  });
});
