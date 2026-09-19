import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isWhole,
  layout,
  moveFile,
  NO_SELECTION,
  pick,
  prune,
  removePages,
  resetFile,
  setFilePages,
  type OrderFile,
  type PageOrder,
  type Selection,
} from "./pageOrder";
import { pdfPageCount } from "./thumbnail";
import type { MergeEntry } from "./useMergeFiles";

/**
 * Page counts for the list's PDFs, by upload id: a number once the worker has
 * counted, `null` when it can't. A PDF is only counted when `want` says so —
 * the page view is open, the order has been edited, or it is the file being
 * looked at — so a file-level merge asks the server for nothing new.
 */
function usePageCounts(entries: MergeEntry[], want: (entry: MergeEntry) => boolean) {
  const [counts, setCounts] = useState<ReadonlyMap<string, number | null>>(new Map());
  const asked = useRef(new Set<string>());
  const ctrl = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      ctrl.current?.abort();
      ctrl.current = null;
    },
    [],
  );

  const wanted = entries.flatMap((e) =>
    e.kind === "pdf" && e.upload.phase === "done" && !asked.current.has(e.upload.result.id) && want(e) ? [e.upload.result.id] : [],
  );
  const signature = wanted.join(",");

  useEffect(() => {
    if (!signature) return;
    ctrl.current ??= new AbortController();
    const signal = ctrl.current.signal;
    for (const id of signature.split(",")) {
      asked.current.add(id);
      void pdfPageCount(id, signal).then((pages) => {
        if (!signal.aborted) setCounts((m) => new Map(m).set(id, pages));
      });
    }
  }, [signature]);

  return counts;
}

/** What the order knows of each entry: images are one page; a PDF is its count, `undefined` until known. */
function orderFiles(entries: MergeEntry[], counts: ReadonlyMap<string, number | null>): OrderFile[] {
  return entries.map((e) => ({
    key: e.key,
    pages: e.kind !== "pdf" ? 1 : e.upload.phase === "done" ? counts.get(e.upload.result.id) : e.upload.phase === "failed" ? null : undefined,
  }));
}

/**
 * The page view's state: the order (see `pageOrder.ts`), the page counts it
 * is laid out with, and the pages picked in it. Every change to the order
 * goes through `commit`, one call per gesture, which is where #42 hangs its
 * undo history; the selection is view state and is never undone.
 *
 * Counts are only asked for when needed: every PDF's while the page view is
 * open (`all`) or the order has been edited, and otherwise only the PDF being
 * looked at (`focus`), for its range box.
 */
export function usePageOrder(entries: MergeEntry[], { all, focus }: { all: boolean; focus: string | null }) {
  const [order, setOrder] = useState<PageOrder>(null);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const counts = usePageCounts(entries, (e) => all || order !== null || e.key === focus);
  const files = orderFiles(entries, counts);

  // Kept stable while nothing the order reads has changed, so upload progress doesn't re-lay the grid.
  const signature = files.map((f) => `${f.key}:${f.pages}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the signature on purpose
  const stable = useMemo(() => files, [signature]);
  const live = useRef(stable);
  live.current = stable;

  const slots = useMemo(() => layout(order, stable), [order, stable]);
  const ids = useMemo(() => slots.flatMap((s) => (s.kind === "page" ? [s.id] : [])), [slots]);

  // Pages that left the output leave the selection too.
  useEffect(() => {
    const shown = new Set(ids);
    setSelection((s) => prune(s, shown));
  }, [ids]);

  /** The one way the order changes. */
  const commit = useCallback((edit: (order: PageOrder, files: OrderFile[]) => PageOrder) => {
    setOrder((o) => edit(o, live.current));
  }, []);

  const removePicked = useCallback(() => {
    if (!selection.ids.size) return;
    const gone = selection.ids;
    commit((o, f) => removePages(o, f, gone));
    setSelection(NO_SELECTION);
  }, [commit, selection]);

  return {
    order,
    /** Each entry's page count as the order sees it, in list order. */
    files: stable,
    slots,
    selection,
    /** Untouched, or edited back to every file whole: the request carries no page list. */
    untouched: useMemo(() => isWhole(slots, stable), [slots, stable]),
    pick: useCallback(
      (id: string, how?: { shift?: boolean; mod?: boolean }) => setSelection((s) => pick(s, ids, id, how)),
      [ids],
    ),
    pickAll: useCallback(() => setSelection({ ids: new Set(ids), anchor: ids[0] ?? null }), [ids]),
    clearPicked: useCallback(() => setSelection(NO_SELECTION), []),
    removePicked,
    setPages: useCallback((key: string, pages: number[]) => commit((o, f) => setFilePages(o, f, key, pages)), [commit]),
    reset: useCallback((key: string) => commit((o, f) => resetFile(o, f, key)), [commit]),
    resetAll: useCallback(() => commit(() => null), [commit]),
    /** After the file list moved `key` to `to`: the file's pages move with it. */
    fileMoved: useCallback(
      (key: string, to: number) =>
        commit((o, f) => {
          const next = f.filter((x) => x.key !== key);
          const moved = f.find((x) => x.key === key);
          if (!moved) return o;
          next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
          return moveFile(o, next, key);
        }),
      [commit],
    ),
    /** Forget the order — the list was emptied. */
    clear: useCallback(() => (setOrder(null), setSelection(NO_SELECTION)), []),
  };
}

export type PageOrderState = ReturnType<typeof usePageOrder>;
