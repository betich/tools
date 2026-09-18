import { useCallback, useMemo, useRef, useState } from "react";
import { newDoc, newTextLayer, tokensInAll, type MergeData, type MergeDoc, type TextLayer } from "@tools/shared";
import { emptyData } from "@tools/shared";

const HISTORY_LIMIT = 40;

/**
 * Document state for the editor.
 *
 * Every mutation goes through `commit`, which snapshots the previous doc — so
 * undo is a property of the store rather than something each control has to
 * remember to do.
 */
export function useMerge(initial?: MergeDoc) {
  const [doc, setDoc] = useState<MergeDoc>(() => initial ?? newDoc());
  const [data, setData] = useState<MergeData>(emptyData);
  const [selectedId, setSelectedId] = useState<string | null>(() => doc.layers[0]?.id ?? null);
  const [rowIndex, setRowIndex] = useState(0);
  const [showValues, setShowValues] = useState(true);

  const past = useRef<MergeDoc[]>([]);
  const future = useRef<MergeDoc[]>([]);

  const commit = useCallback((next: MergeDoc | ((prev: MergeDoc) => MergeDoc)) => {
    setDoc((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      if (resolved === prev) return prev;
      past.current = [...past.current, prev].slice(-HISTORY_LIMIT);
      future.current = [];
      return resolved;
    });
  }, []);

  const undo = useCallback(() => {
    setDoc((current) => {
      const previous = past.current.at(-1);
      if (!previous) return current;
      past.current = past.current.slice(0, -1);
      future.current = [current, ...future.current].slice(0, HISTORY_LIMIT);
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setDoc((current) => {
      const next = future.current[0];
      if (!next) return current;
      future.current = future.current.slice(1);
      past.current = [...past.current, current].slice(-HISTORY_LIMIT);
      return next;
    });
  }, []);

  const selected = useMemo(() => doc.layers.find((l) => l.id === selectedId) ?? null, [doc.layers, selectedId]);

  const updateLayer = useCallback(
    (id: string, patch: Partial<TextLayer> | ((layer: TextLayer) => Partial<TextLayer>)) => {
      commit((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => (l.id === id ? { ...l, ...(typeof patch === "function" ? patch(l) : patch) } : l)),
      }));
    },
    [commit],
  );

  /**
   * Live drag/slider updates must not push a history entry per frame; they
   * write through and the caller snapshots once on gesture start.
   */
  const previewLayer = useCallback((id: string, patch: Partial<TextLayer>) => {
    setDoc((prev) => ({ ...prev, layers: prev.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  }, []);

  const snapshot = useCallback(() => {
    setDoc((prev) => {
      past.current = [...past.current, prev].slice(-HISTORY_LIMIT);
      future.current = [];
      return prev;
    });
  }, []);

  const addLayer = useCallback(() => {
    const layer = newTextLayer({
      name: `text ${doc.layers.length + 1}`,
      y: 120 + doc.layers.length * 40,
      width: Math.round(doc.canvas.width * 0.8),
      x: Math.round(doc.canvas.width * 0.1),
    });
    commit((prev) => ({ ...prev, layers: [...prev.layers, layer] }));
    setSelectedId(layer.id);
  }, [commit, doc.canvas.width, doc.layers.length]);

  const duplicateLayer = useCallback(
    (id: string) => {
      const source = doc.layers.find((l) => l.id === id);
      if (!source) return;
      const copy = { ...structuredClone(source), id: newTextLayer().id, name: `${source.name} copy`, y: source.y + 24 };
      commit((prev) => ({ ...prev, layers: [...prev.layers, copy] }));
      setSelectedId(copy.id);
    },
    [commit, doc.layers],
  );

  const removeLayer = useCallback(
    (id: string) => {
      commit((prev) => ({ ...prev, layers: prev.layers.filter((l) => l.id !== id) }));
      setSelectedId((current) => (current === id ? null : current));
    },
    [commit],
  );

  const reorderLayer = useCallback(
    (id: string, direction: -1 | 1) => {
      commit((prev) => {
        const i = prev.layers.findIndex((l) => l.id === id);
        const j = i + direction;
        if (i === -1 || j < 0 || j >= prev.layers.length) return prev;
        const layers = [...prev.layers];
        [layers[i], layers[j]] = [layers[j]!, layers[i]!];
        return { ...prev, layers };
      });
    },
    [commit],
  );

  const usedFields = useMemo(() => tokensInAll(doc.layers.map((l) => l.text)), [doc.layers]);

  const currentRow = useMemo(() => {
    if (!showValues || data.rows.length === 0) return null;
    return data.rows[Math.min(rowIndex, data.rows.length - 1)] ?? null;
  }, [showValues, data.rows, rowIndex]);

  const step = useCallback(
    (direction: -1 | 1) => {
      setRowIndex((i) => {
        const n = data.rows.length;
        if (n === 0) return 0;
        return (i + direction + n) % n;
      });
    },
    [data.rows.length],
  );

  return {
    doc,
    setDoc: commit,
    replaceDoc: setDoc,
    data,
    setData,
    selected,
    selectedId,
    setSelectedId,
    updateLayer,
    previewLayer,
    snapshot,
    addLayer,
    duplicateLayer,
    removeLayer,
    reorderLayer,
    undo,
    redo,
    canUndo: past.current.length > 0,
    usedFields,
    rowIndex,
    setRowIndex,
    currentRow,
    step,
    showValues,
    setShowValues,
  };
}
