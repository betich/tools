import { isDefaultOrder, mergePagesProblem, toRuns, type MergeItem, type MergePageRun } from "@tools/shared";

/**
 * The page view's model (#37): which pages of which files go out, in what
 * order. Pure, so it can be tested and so every change is one function from
 * the old order to the new — the seam #42's undo history wraps.
 *
 * Pages are keyed by the file's entry key, not its index or upload: a file can
 * move in the list, or be removed, and the pages that are left still name the
 * right file. A removed file's pages drop out when the order is laid out, so
 * an order that outlives a file (an undo step, say) never brings it back.
 */

/** One output page: page `page` (0-based) of the file whose entry key is `key`. */
export type PageRef = { key: string; page: number };

/**
 * What the order needs to know of a file: its key and its page count —
 * `undefined` while it is being counted, `null` when it can't be (a locked or
 * broken PDF, or no worker). An image is always one page.
 */
export type OrderFile = { key: string; pages: number | null | undefined };

/**
 * `null` is untouched: every file whole, in file order, and the merge request
 * carries no page list at all — so it is byte for byte the file-level merge.
 * Once edited, `refs` is the output in order for the files in `taken`; a file
 * that isn't taken (added since, or not counted yet then) goes in whole after
 * them, as a new file goes on the end of the file list.
 */
export type PageOrder = null | { refs: PageRef[]; taken: string[] };

/** One place in the output as the page view draws it: a page, or a file whose pages aren't known yet. */
export type Slot =
  | { kind: "page"; id: string; ref: PageRef }
  | { kind: "file"; id: string; key: string; state: "counting" | "uncounted" };

export const refId = (r: PageRef) => `${r.key}#${r.page}`;

const known = (f: OrderFile | undefined): f is OrderFile & { pages: number } => typeof f?.pages === "number";

/** The output, in order: every page that goes out, and a placeholder for each file still to be counted. */
export function layout(order: PageOrder, files: readonly OrderFile[]): Slot[] {
  const slots: Slot[] = [];
  const whole = (f: OrderFile) => {
    if (known(f)) for (let page = 0; page < f.pages; page++) slots.push(pageSlot({ key: f.key, page }));
    else slots.push({ kind: "file", id: `${f.key}#file`, key: f.key, state: f.pages === null ? "uncounted" : "counting" });
  };
  if (!order) {
    files.forEach(whole);
    return slots;
  }
  const byKey = new Map(files.map((f) => [f.key, f]));
  for (const ref of order.refs) {
    const f = byKey.get(ref.key);
    if (!f || (known(f) && ref.page >= f.pages)) continue;
    slots.push(pageSlot(ref));
  }
  const taken = new Set(order.taken);
  for (const f of files) if (!taken.has(f.key)) whole(f);
  return slots;
}

const pageSlot = (ref: PageRef): Slot => ({ kind: "page", id: refId(ref), ref });

export const pagesOf = (slots: readonly Slot[]): PageRef[] =>
  slots.flatMap((s) => (s.kind === "page" ? [s.ref] : []));

/** The pages of one file that go out, 0-based, in output order. */
export const filePages = (slots: readonly Slot[], key: string): number[] =>
  slots.flatMap((s) => (s.kind === "page" && s.ref.key === key ? [s.ref.page] : []));

/** The order written out in full: every counted file taken, so a change to one page can't move another file. */
function materialize(order: PageOrder, files: readonly OrderFile[]): { refs: PageRef[]; taken: string[] } {
  const keys = new Set(files.map((f) => f.key));
  const taken = new Set((order?.taken ?? []).filter((k) => keys.has(k)));
  for (const f of files) if (known(f)) taken.add(f.key);
  return { refs: pagesOf(layout(order, files)), taken: [...taken] };
}

/** True when `slots` are exactly what an untouched order shows: every file whole, in file order. */
export function isWhole(slots: readonly Slot[], files: readonly OrderFile[]): boolean {
  const whole = layout(null, files);
  return slots.length === whole.length && slots.every((s, i) => s.id === whole[i]!.id);
}

/** Back to `null` when the edit lands on every file whole, so Reset really is untouched. */
function settle(order: PageOrder, files: readonly OrderFile[]): PageOrder {
  return order && isWhole(layout(order, files), files) ? null : order;
}

/** Takes the pages in `ids` (see `refId`) out of the output. */
export function removePages(order: PageOrder, files: readonly OrderFile[], ids: ReadonlySet<string>): PageOrder {
  const m = materialize(order, files);
  return settle({ ...m, refs: m.refs.filter((r) => !ids.has(refId(r))) }, files);
}

/**
 * Sets which of a file's pages go out, and in what order (0-based, as
 * `parsePageRange` gives them). They take the place of the file's first page
 * already in the output; a file with none there goes after the pages of the
 * files above it in the list.
 */
export function setFilePages(order: PageOrder, files: readonly OrderFile[], key: string, pages: readonly number[]): PageOrder {
  const at = files.findIndex((f) => f.key === key);
  if (at < 0 || !known(files[at])) return order;
  const m = materialize(order, files);
  const first = m.refs.findIndex((r) => r.key === key);
  let place = first;
  if (place < 0) {
    const above = new Set(files.slice(0, at).map((f) => f.key));
    place = 0;
    m.refs.forEach((r, i) => above.has(r.key) && (place = i + 1));
  }
  const rest = m.refs.filter((r) => r.key !== key);
  const before = m.refs.slice(0, place).filter((r) => r.key !== key).length;
  rest.splice(before, 0, ...pages.map((page) => ({ key, page })));
  return settle({ refs: rest, taken: m.taken }, files);
}

/** Every page of the file back, in its own order, where its first page is now. */
export function resetFile(order: PageOrder, files: readonly OrderFile[], key: string): PageOrder {
  const f = files.find((x) => x.key === key);
  if (!known(f)) return order;
  return setFilePages(order, files, key, Array.from({ length: f.pages }, (_, i) => i));
}

/**
 * After `key` moved in the file list (`files` is the list as it now stands):
 * its pages move with it, as one block, to sit before the pages of the files
 * now below it. An untouched order simply follows the list.
 */
export function moveFile(order: PageOrder, files: readonly OrderFile[], key: string): PageOrder {
  if (!order) return null;
  const at = files.findIndex((f) => f.key === key);
  if (at < 0) return order;
  const m = materialize(order, files);
  const mine = m.refs.filter((r) => r.key === key);
  const rest = m.refs.filter((r) => r.key !== key);
  const below = new Set(files.slice(at + 1).map((f) => f.key));
  const place = rest.findIndex((r) => below.has(r.key));
  rest.splice(place < 0 ? rest.length : place, 0, ...mine);
  return settle({ refs: rest, taken: m.taken }, files);
}

/* ── selection ───────────────────────────────────────────────────────────── */

/** Picked pages by `refId`, and the one a shift-click extends from. Not part of the order, so never undone. */
export type Selection = { ids: ReadonlySet<string>; anchor: string | null };
export const NO_SELECTION: Selection = { ids: new Set(), anchor: null };

/**
 * A click on page `id` among `order` (the ids as shown): alone it picks just
 * that page; with mod it toggles it; with shift it picks everything from the
 * anchor to it (added to what is picked when mod is held too).
 */
export function pick(sel: Selection, order: readonly string[], id: string, how: { shift?: boolean; mod?: boolean } = {}): Selection {
  if (how.shift) {
    const a = sel.anchor ? order.indexOf(sel.anchor) : -1;
    const b = order.indexOf(id);
    if (a < 0 || b < 0) return { ids: new Set([id]), anchor: id };
    const span = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    return { ids: new Set([...(how.mod ? sel.ids : []), ...span]), anchor: sel.anchor };
  }
  if (how.mod) {
    const ids = new Set(sel.ids);
    if (!ids.delete(id)) ids.add(id);
    return { ids, anchor: id };
  }
  return { ids: new Set([id]), anchor: id };
}

/** The selection with anything no longer shown dropped. Same object when nothing went. */
export function prune(sel: Selection, shown: ReadonlySet<string>): Selection {
  const gone = [...sel.ids].some((id) => !shown.has(id)) || (sel.anchor !== null && !shown.has(sel.anchor));
  if (!gone) return sel;
  return { ids: new Set([...sel.ids].filter((id) => shown.has(id))), anchor: sel.anchor && shown.has(sel.anchor) ? sel.anchor : null };
}

/* ── the request ─────────────────────────────────────────────────────────── */

export type OrderRequest =
  /** Send no page list: the order is untouched, or edited back to every file whole. */
  | { state: "whole" }
  | { state: "pages"; pages: MergePageRun[] }
  /** A file's pages are still being counted. */
  | { state: "counting" }
  /** Can't be sent as it is; the message is a sentence to show as-is. */
  | { state: "problem"; message: string };

/**
 * What the order adds to the merge request. `files` and `items` are the same
 * list in the same order — an item's index is its file's index.
 */
export function orderRequest(order: PageOrder, files: readonly OrderFile[], items: readonly MergeItem[]): OrderRequest {
  if (!order) return { state: "whole" };
  const slots = layout(order, files);
  const uncounted = slots.find((s) => s.kind === "file" && s.state === "uncounted");
  if (uncounted?.kind === "file") {
    const name = items[files.findIndex((f) => f.key === uncounted.key)]?.name ?? "A file";
    return {
      state: "problem",
      message: `The server couldn't count the pages of “${name}”, so it can't go into a merge by page. Remove it, or reset the page order.`,
    };
  }
  if (slots.some((s) => s.kind === "file")) return { state: "counting" };
  const index = new Map(files.map((f, i) => [f.key, i]));
  const pages = toRuns(pagesOf(slots).map((r) => ({ item: index.get(r.key)!, page: r.page })));
  const count = (i: number) => files[i]?.pages ?? undefined;
  if (pages.length && isDefaultOrder(pages, items, count)) return { state: "whole" };
  const problem = mergePagesProblem(pages, items, count);
  return problem ? { state: "problem", message: problem } : { state: "pages", pages };
}
