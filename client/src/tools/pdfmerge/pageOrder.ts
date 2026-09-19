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
 * A whole file in an edited order whose pages weren't known when it was
 * edited (still counting, or the count failed). It keeps the file's place
 * among the others, and lays out as every page once the count comes.
 */
export type FileRef = { key: string; page: null };

/** One entry of an edited order: a page, or a file waiting on its count. */
export type OrderRef = PageRef | FileRef;

/** Why a file's pages aren't known: the server's sentence when it gave one, and whether asking again could count them. */
export type Uncounted = { reason: string | null; retry: boolean };

/**
 * What the order needs to know of a file: its key and its page count —
 * `undefined` while it is being counted, `Uncounted` when it can't be (a
 * locked or broken PDF, a failed upload, or no worker just now). An image is
 * always one page.
 */
export type OrderFile = { key: string; pages: number | Uncounted | undefined };

/**
 * `null` is untouched: every file whole, in file order, and the merge request
 * carries no page list at all — so it is byte for byte the file-level merge.
 * Once edited, `refs` is the output in order for the files in `taken`; a file
 * that isn't taken (added since) goes in whole after them, as a new file goes
 * on the end of the file list.
 */
export type PageOrder = null | { refs: OrderRef[]; taken: string[] };

/** One place in the output as the page view draws it: a page, or a file whose pages aren't known yet. */
export type Slot =
  | { kind: "page"; id: string; ref: PageRef }
  | { kind: "file"; id: string; key: string; state: "counting" }
  | { kind: "file"; id: string; key: string; state: "uncounted"; why: Uncounted };

export const refId = (r: OrderRef) => (r.page === null ? `${r.key}#file` : `${r.key}#${r.page}`);

const isPage = (r: OrderRef): r is PageRef => r.page !== null;

const known = (f: OrderFile | undefined): f is OrderFile & { pages: number } => typeof f?.pages === "number";

function fileSlot(f: OrderFile): Slot {
  const id = refId({ key: f.key, page: null });
  return f.pages === undefined || typeof f.pages === "number"
    ? { kind: "file", id, key: f.key, state: "counting" }
    : { kind: "file", id, key: f.key, state: "uncounted", why: f.pages };
}

/** The output, in order: every page that goes out, and a placeholder for each file still to be counted. */
export function layout(order: PageOrder, files: readonly OrderFile[]): Slot[] {
  const slots: Slot[] = [];
  const whole = (f: OrderFile) => {
    if (known(f)) for (let page = 0; page < f.pages; page++) slots.push(pageSlot({ key: f.key, page }));
    else slots.push(fileSlot(f));
  };
  if (!order) {
    files.forEach(whole);
    return slots;
  }
  const byKey = new Map(files.map((f) => [f.key, f]));
  for (const ref of order.refs) {
    const f = byKey.get(ref.key);
    if (!f) continue;
    if (ref.page === null) whole(f);
    else if (!known(f) || ref.page < f.pages) slots.push(pageSlot(ref));
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

type Written = { refs: OrderRef[]; taken: string[] };

/**
 * The order written out in full, every file in the list taken: a file whose
 * pages aren't known is written as one `FileRef` where it is, so a change to
 * one page moves no other file.
 */
function materialize(order: PageOrder, files: readonly OrderFile[]): Written {
  const refs = layout(order, files).map((s): OrderRef => (s.kind === "page" ? s.ref : { key: s.key, page: null }));
  return { refs, taken: files.map((f) => f.key) };
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
  let place = m.refs.findIndex((r) => r.key === key);
  if (place < 0) {
    const above = new Set(files.slice(0, at).map((f) => f.key));
    place = 0;
    m.refs.forEach((r, i) => above.has(r.key) && (place = i + 1));
  }
  const rest: OrderRef[] = m.refs.filter((r) => r.key !== key);
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

/**
 * `moveFile` for a list move as the file list reports it: `files` is the list
 * as it was, and `key` has gone to index `to`.
 */
export function moveFileTo(order: PageOrder, files: readonly OrderFile[], key: string, to: number): PageOrder {
  const moved = files.find((f) => f.key === key);
  if (!moved) return order;
  const next = files.filter((f) => f.key !== key);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return moveFile(order, next, key);
}

/**
 * Takes the pages in `ids` out of where they are and puts them back as one
 * block, in the order they were shown, before page `before` — or at the end
 * when it is `null`. If `before` is itself one of the pages moving, the block
 * lands before the first page after it that stays. This is a drop in the page
 * view, across files as much as within one.
 */
export function movePages(order: PageOrder, files: readonly OrderFile[], ids: ReadonlySet<string>, before: string | null): PageOrder {
  const m = materialize(order, files);
  const at = before === null ? -1 : m.refs.findIndex((r) => refId(r) === before);
  const gap = at < 0 ? m.refs.length : at;
  // Where the block goes, counted among the pages that stay.
  const place = m.refs.slice(0, gap).filter((r) => !ids.has(refId(r))).length;
  return landed(order, files, m, spliceBlock(m.refs, ids, place));
}

/**
 * The keyboard's move: the picked pages, gathered into one block where the
 * first of them is, step one page earlier (`-1`) or later (`1`) past the pages
 * that stay.
 */
export function shiftPages(order: PageOrder, files: readonly OrderFile[], ids: ReadonlySet<string>, by: -1 | 1): PageOrder {
  const m = materialize(order, files);
  const first = m.refs.findIndex((r) => ids.has(refId(r)));
  if (first < 0) return order;
  const stay = m.refs.filter((r) => !ids.has(refId(r))).length;
  return landed(order, files, m, spliceBlock(m.refs, ids, Math.max(0, Math.min(stay, first + by))));
}

/**
 * Deals the picked pages out one file at a time — the first picked page of
 * each file, then the second of each, and so on — where the first of them is.
 * Files take turns in the order their pages first appear; one that runs out
 * drops out of the deal. Two scans of one stack, fronts and backs, become one
 * document in a gesture: pick both, interleave. (Backs scanned last page
 * first are put right with the range box, "20-1", before or after.)
 */
export function interleavePages(order: PageOrder, files: readonly OrderFile[], ids: ReadonlySet<string>): PageOrder {
  const m = materialize(order, files);
  const piles = new Map<string, PageRef[]>();
  for (const r of m.refs) if (isPage(r) && ids.has(refId(r))) piles.set(r.key, [...(piles.get(r.key) ?? []), r]);
  if (piles.size < 2) return order;
  const decks = [...piles.values()];
  const longest = Math.max(...decks.map((d) => d.length));
  const dealt: PageRef[] = [];
  for (let i = 0; i < longest; i++) for (const d of decks) if (i < d.length) dealt.push(d[i]!);
  const first = m.refs.findIndex((r) => ids.has(refId(r)));
  return landed(order, files, m, spliceBlock(m.refs, ids, first, dealt));
}

/** True when the picked pages come from more than one file, so there is something to interleave. */
export function canInterleave(slots: readonly Slot[], ids: ReadonlySet<string>): boolean {
  const keys = new Set<string>();
  for (const s of slots) if (s.kind === "page" && ids.has(s.id)) keys.add(s.ref.key);
  return keys.size > 1;
}

/** `refs` with the pages in `ids` lifted out and set down as `block` (by default, as they were shown) at `place` among the rest. */
function spliceBlock(refs: readonly OrderRef[], ids: ReadonlySet<string>, place: number, block = refs.filter((r) => ids.has(refId(r)))) {
  const rest = refs.filter((r) => !ids.has(refId(r)));
  rest.splice(place, 0, ...block);
  return rest;
}

/** A move's result: `order` itself when every page landed where it was, so it is no undo step; the new order otherwise. */
function landed(order: PageOrder, files: readonly OrderFile[], m: Written, refs: OrderRef[]): PageOrder {
  if (refs.every((r, i) => refId(r) === refId(m.refs[i]!))) return order;
  return settle({ refs, taken: m.taken }, files);
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

/** A sentence from the server, as it was sent, ended with a full stop when it had none. */
const said = (reason: string) => (/[.!?…]$/.test(reason) ? reason : `${reason}.`);

/** Why a file whose pages can't be counted holds the merge up, naming it. */
function uncountedProblem(name: string, why: Uncounted): string {
  if (why.retry) {
    return `The pages of “${name}” couldn't be counted just now. ${why.reason ? `${said(why.reason)} ` : ""}Try again, or reset the page order.`;
  }
  return `“${name}” can't be merged by page${why.reason ? `: ${said(why.reason)}` : "."} Remove it, or reset the page order.`;
}

/**
 * What the order adds to the merge request. `files` and `items` are the same
 * list in the same order — an item's index is its file's index.
 */
export function orderRequest(order: PageOrder, files: readonly OrderFile[], items: readonly MergeItem[]): OrderRequest {
  if (!order) return { state: "whole" };
  const slots = layout(order, files);
  for (const s of slots) {
    if (s.kind !== "file" || s.state !== "uncounted") continue;
    const name = items[files.findIndex((f) => f.key === s.key)]?.name ?? "A file";
    return { state: "problem", message: uncountedProblem(name, s.why) };
  }
  if (slots.some((s) => s.kind === "file")) return { state: "counting" };
  const index = new Map(files.map((f, i) => [f.key, i]));
  const pages = toRuns(pagesOf(slots).map((r) => ({ item: index.get(r.key)!, page: r.page })));
  const count = (i: number) => {
    const n = files[i]?.pages;
    return typeof n === "number" ? n : undefined;
  };
  if (pages.length && isDefaultOrder(pages, items, count)) return { state: "whole" };
  const problem = mergePagesProblem(pages, items, count);
  return problem ? { state: "problem", message: problem } : { state: "pages", pages };
}
