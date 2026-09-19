import { useCallback, useMemo, useState } from "react";

/**
 * Undo history for one value, kept as a single piece of state so every step
 * is a pure function of the last — safe under StrictMode, which runs state
 * updaters twice.
 *
 * `commit` is an edit that can be undone: it records what was there before.
 * `preview` writes through without a record, for the frames of a drag; the
 * gesture calls `snapshot` once as it begins, so the whole drag is one step
 * (CLAUDE.md: undo snapshots happen on gesture start, not per frame).
 */
export type History<T> = { past: T[]; present: T; future: T[] };

export const HISTORY_LIMIT = 40;

type Edit<T> = T | ((prev: T) => T);
const resolve = <T>(edit: Edit<T>, prev: T): T => (typeof edit === "function" ? (edit as (p: T) => T)(prev) : edit);

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** An undoable edit. Nothing is recorded when the edit changes nothing. */
export function commitTo<T>(h: History<T>, edit: Edit<T>, limit = HISTORY_LIMIT): History<T> {
  const next = resolve(edit, h.present);
  if (Object.is(next, h.present)) return h;
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [] };
}

/** A write-through: the value changes, the history doesn't. */
export function previewTo<T>(h: History<T>, edit: Edit<T>): History<T> {
  const next = resolve(edit, h.present);
  return Object.is(next, h.present) ? h : { ...h, present: next };
}

/** The value as it is now, recorded as a step to come back to: a gesture is beginning. */
export function snapshotOf<T>(h: History<T>, limit = HISTORY_LIMIT): History<T> {
  return { past: [...h.past, h.present].slice(-limit), present: h.present, future: [] };
}

export function undoOf<T>(h: History<T>, limit = HISTORY_LIMIT): History<T> {
  const previous = h.past.at(-1);
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: previous as T, future: [h.present, ...h.future].slice(0, limit) };
}

export function redoOf<T>(h: History<T>, limit = HISTORY_LIMIT): History<T> {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present].slice(-limit), present: h.future[0] as T, future: h.future.slice(1) };
}

/** A value with undo and redo. See `History`. */
export function useHistory<T>(initial: T | (() => T), limit = HISTORY_LIMIT) {
  const [h, setH] = useState<History<T>>(() => startHistory(typeof initial === "function" ? (initial as () => T)() : initial));

  const commit = useCallback((edit: Edit<T>) => setH((x) => commitTo(x, edit, limit)), [limit]);
  const preview = useCallback((edit: Edit<T>) => setH((x) => previewTo(x, edit)), []);
  const snapshot = useCallback(() => setH((x) => snapshotOf(x, limit)), [limit]);
  const undo = useCallback(() => setH((x) => undoOf(x, limit)), [limit]);
  const redo = useCallback(() => setH((x) => redoOf(x, limit)), [limit]);
  /** Starts over from `value` with no history, as when the thing being edited is thrown away. */
  const reset = useCallback((value: T) => setH(startHistory(value)), []);

  return useMemo(
    () => ({
      value: h.present,
      commit,
      preview,
      snapshot,
      undo,
      redo,
      reset,
      canUndo: h.past.length > 0,
      canRedo: h.future.length > 0,
    }),
    [h, commit, preview, snapshot, undo, redo, reset],
  );
}
