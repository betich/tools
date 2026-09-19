import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHistory } from "@/hooks/useHistory";
import {
  filePages,
  interleavePages,
  isWhole,
  layout,
  moveFileTo,
  movePages,
  NO_SELECTION,
  pick,
  prune,
  removePages,
  resetFile,
  setFilePages,
  shiftPages,
  type OrderFile,
  type PageOrder,
  type Selection,
  type Uncounted,
} from "./pageOrder";
import { pdfPageCount, type PageCount } from "./thumbnail";
import type { MergeEntry } from "./useMergeFiles";

/** A count that failed for now (no worker, a dropped connection) is asked again after this long, or at once on retry. */
const RETRY_MS = 15_000;

/**
 * Page counts for the list's PDFs, by upload id, as `pdfPageCount` gives them.
 * A PDF is only counted when `want` says so — the page view is open, the
 * order has been edited, or it is the file being looked at — so a file-level
 * merge asks the server for nothing new. A refusal (locked, broken) is final;
 * a count that is only unavailable for now is asked again on its own after a
 * while, or at once by `retry`.
 */
function usePageCounts(entries: MergeEntry[], want: (entry: MergeEntry) => boolean) {
  const [counts, setCounts] = useState<ReadonlyMap<string, PageCount>>(new Map());
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
      void pdfPageCount(id, signal).then((count) => {
        if (!signal.aborted) setCounts((m) => new Map(m).set(id, count));
      });
    }
  }, [signature]);

  const unavailable = [...counts].flatMap(([id, c]) => (c.state === "unavailable" ? [id] : [])).join(",");

  /** Forgets every count that was only unavailable, so each is asked again — shown as counting meanwhile. */
  const retry = useCallback(() => {
    if (!unavailable) return;
    const ids = unavailable.split(",");
    for (const id of ids) asked.current.delete(id);
    setCounts((m) => {
      const next = new Map(m);
      for (const id of ids) if (next.get(id)?.state === "unavailable") next.delete(id);
      return next;
    });
  }, [unavailable]);

  useEffect(() => {
    if (!unavailable) return;
    const t = setTimeout(retry, RETRY_MS);
    return () => clearTimeout(t);
  }, [unavailable, retry]);

  return { counts, retry };
}

/** What the order knows of each entry: images are one page; a PDF is its count, `undefined` until known. */
function orderFiles(entries: MergeEntry[], counts: ReadonlyMap<string, PageCount>): OrderFile[] {
  const failedUpload: Uncounted = { reason: null, retry: false };
  return entries.map((e) => {
    if (e.kind !== "pdf") return { key: e.key, pages: 1 };
    if (e.upload.phase === "failed") return { key: e.key, pages: failedUpload };
    const c = e.upload.phase === "done" ? counts.get(e.upload.result.id) : undefined;
    const pages =
      c?.state === "counted" ? c.pages : c ? { reason: c.reason, retry: c.state === "unavailable" } : undefined;
    return { key: e.key, pages };
  });
}

/**
 * One PDF's pages in the merge, for its range box (#37): its count as the
 * order knows it, the pages kept in output order, and the ways to change them.
 */
export type FilePages = {
  count: OrderFile["pages"];
  kept: number[];
  onApply: (pages: number[]) => void;
  onReset: () => void;
  /** Asks the server again for any count that failed only for now. */
  onRetry: () => void;
};

/**
 * The page view's state: the order (see `pageOrder.ts`), the page counts it
 * is laid out with, and the pages picked in it. Every change to the order
 * goes through `commit`, one call per gesture, and is one step of undo
 * history (#42); the selection is view state and is never undone. Only the
 * order is kept in history — never the entries, whose uploads are live — and
 * an old order laid out today drops any file removed since, so undo can't
 * bring a removed file back.
 *
 * Counts are only asked for when needed: every PDF's while the page view is
 * open (`all`) or the order has been edited, and otherwise only the PDF being
 * looked at (`focus`), for its range box.
 */
export function usePageOrder(entries: MergeEntry[], { all, focus }: { all: boolean; focus: string | null }) {
  const history = useHistory<PageOrder>(null);
  const order = history.value;
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const { counts, retry: retryCounts } = usePageCounts(entries, (e) => all || order !== null || e.key === focus);
  const files = orderFiles(entries, counts);

  // Kept stable while nothing the order reads has changed, so upload progress doesn't re-lay the grid.
  const signature = files.map((f) => `${f.key}:${JSON.stringify(f.pages ?? null)}`).join(",");
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

  /**
   * The one way the order changes: one call per gesture, one undo step. A
   * drag changes nothing until it lands, so its drop is its one commit.
   */
  const { commit: record, reset: forget } = history;
  const commit = useCallback(
    (edit: (order: PageOrder, files: OrderFile[]) => PageOrder) => record((o) => edit(o, live.current)),
    [record],
  );

  const removePicked = useCallback(() => {
    if (!selection.ids.size) return;
    const gone = selection.ids;
    commit((o, f) => removePages(o, f, gone));
    setSelection(NO_SELECTION);
  }, [commit, selection]);

  const setPages = useCallback((key: string, pages: number[]) => commit((o, f) => setFilePages(o, f, key, pages)), [commit]);
  const reset = useCallback((key: string) => commit((o, f) => resetFile(o, f, key)), [commit]);

  // The PDF being looked at, once it has uploaded (or failed to): its pages, for its range box.
  const focusAt = entries.findIndex((e) => e.key === focus);
  const focusEntry = focusAt >= 0 ? entries[focusAt]! : null;
  const focusCount = focusAt >= 0 ? stable[focusAt]?.pages : undefined;
  const focusReady = focusEntry?.kind === "pdf" && (focusEntry.upload.phase === "done" || focusEntry.upload.phase === "failed");
  const focused = useMemo(
    (): FilePages | null =>
      focus && focusReady
        ? {
            count: focusCount,
            kept: typeof focusCount === "number" ? filePages(slots, focus) : [],
            onApply: (list) => setPages(focus, list),
            onReset: () => reset(focus),
            onRetry: retryCounts,
          }
        : null,
    [focus, focusReady, focusCount, slots, setPages, reset, retryCounts],
  );

  return {
    order,
    /** Each entry's page count as the order sees it, in list order. */
    files: stable,
    slots,
    selection,
    /** The PDF being looked at (`focus`): its pages in the merge, or null when it isn't an uploaded PDF. */
    focused,
    /** Asks the server again for any count that failed only for now (the worker was offline, say). */
    retryCounts,
    /** Untouched, or edited back to every file whole: the request carries no page list. */
    untouched: useMemo(() => isWhole(slots, stable), [slots, stable]),
    pick: useCallback(
      (id: string, how?: { shift?: boolean; mod?: boolean }) => setSelection((s) => pick(s, ids, id, how)),
      [ids],
    ),
    pickAll: useCallback(() => setSelection({ ids: new Set(ids), anchor: ids[0] ?? null }), [ids]),
    clearPicked: useCallback(() => setSelection(NO_SELECTION), []),
    removePicked,
    setPages,
    reset,
    resetAll: useCallback(() => commit(() => null), [commit]),
    /** After the file list moved `key` to `to`: the file's pages move with it. */
    fileMoved: useCallback((key: string, to: number) => commit((o, f) => moveFileTo(o, f, key, to)), [commit]),
    /** Drops pages `ids` before page `before` (`null`: at the end). */
    movePages: useCallback(
      (ids: ReadonlySet<string>, before: string | null) => commit((o, f) => movePages(o, f, ids, before)),
      [commit],
    ),
    /** The keyboard's move: pages `ids` one place earlier or later. */
    shiftPages: useCallback((ids: ReadonlySet<string>, by: -1 | 1) => commit((o, f) => shiftPages(o, f, ids, by)), [commit]),
    /** Deals pages `ids` out a file at a time: fronts and backs into one document. */
    interleave: useCallback((ids: ReadonlySet<string>) => commit((o, f) => interleavePages(o, f, ids)), [commit]),
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    /** Forget the order and its history — the list was emptied. */
    clear: useCallback(() => (forget(null), setSelection(NO_SELECTION)), [forget]),
  };
}

export type PageOrderState = ReturnType<typeof usePageOrder>;
