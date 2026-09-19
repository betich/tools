import { useCallback, useMemo, useReducer, useRef } from "react";
import { History } from "@/lib/history";

export type HistoryApi<T> = {
  value: T;
  /** Record a step and replace the value. */
  set: (next: T) => void;
  /** Replace the value without a step of its own — every frame of a drag. */
  preview: (next: T) => void;
  /** Call on gesture start (pointer-down, slider grab). The gesture becomes one step. */
  snapshot: () => void;
  /** `set` or `preview` by name, for components that report which one they mean. */
  change: (next: T, kind: "commit" | "preview") => void;
  undo: () => void;
  redo: () => void;
  /** Replace the value and clear every step. */
  reset: (value: T) => void;
  canUndo: boolean;
  canRedo: boolean;
};

/**
 * Undo history for one value, snapshotting on gesture start rather than per
 * frame. The bookkeeping lives in a plain `History` held in a ref; state is
 * only a version counter, so nothing is ever mutated inside an updater.
 */
export function useHistory<T>(initial: T | (() => T), limit = 50): HistoryApi<T> {
  const ref = useRef<History<T> | null>(null);
  if (ref.current === null) {
    ref.current = new History(typeof initial === "function" ? (initial as () => T)() : initial, limit);
  }
  const h = ref.current;
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  const set = useCallback((next: T) => (h.set(next), bump()), [h]);
  const preview = useCallback((next: T) => (h.preview(next), bump()), [h]);
  const snapshot = useCallback(() => h.snapshot(), [h]);
  const change = useCallback(
    (next: T, kind: "commit" | "preview") => {
      if (kind === "commit") h.set(next);
      else h.preview(next);
      bump();
    },
    [h],
  );
  const undo = useCallback(() => {
    if (h.undo()) bump();
  }, [h]);
  const redo = useCallback(() => {
    if (h.redo()) bump();
  }, [h]);
  const reset = useCallback((value: T) => (h.reset(value), bump()), [h]);

  return useMemo(
    () => ({
      value: h.present,
      set,
      preview,
      snapshot,
      change,
      undo,
      redo,
      reset,
      canUndo: h.canUndo,
      canRedo: h.canRedo,
    }),
    // `version` stands in for the ref's contents.
    [version, h, set, preview, snapshot, change, undo, redo, reset],
  );
}
