import { useCallback, useMemo, useRef, useState, type SetStateAction } from "react";
import {
  docForRow,
  emptyData,
  newDoc,
  newTextLayer,
  patchLayer,
  pruneLayer,
  revert,
  tokensInAll,
  withKeys,
  type MergeData,
  type MergeDoc,
  type OverrideField,
  type TextLayer,
} from "@tools/shared";
import { useHistory } from "@/hooks/useHistory";

/**
 * Document state for the editor.
 *
 * Every mutation goes through `commit`, which snapshots the previous doc — so
 * undo is a property of the store rather than something each control has to
 * remember to do.
 */
export function useMerge(initial?: MergeDoc) {
  const history = useHistory<MergeDoc>(() => initial ?? newDoc());
  const { value: doc, commit, preview, snapshot, undo, redo } = history;
  const [data, setRawData] = useState<MergeData>(emptyData);
  // Every row has a key, always — the per-row layout hangs off it.
  const setData = useCallback((next: SetStateAction<MergeData>) => {
    setRawData((prev) => withKeys(typeof next === "function" ? next(prev) : next));
  }, []);
  // Editing one row's own layout rather than the main design.
  const [rowMode, setRowMode] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => doc.layers[0]?.id ?? null);
  const [rowIndex, setRowIndex] = useState(0);
  const [showValues, setShowValues] = useState(true);

  const clampedRow = Math.min(rowIndex, Math.max(0, data.rows.length - 1));
  const currentKey = data.rows.length > 0 ? (data.keys?.[clampedRow] ?? null) : null;
  // Row mode needs a row to be about.
  const editKey = rowMode ? currentKey : null;
  const editKeyRef = useRef(editKey);
  editKeyRef.current = editKey;

  /** The document as the stage and inspector should show it: the row's own layout in row mode. */
  const view = useMemo(() => docForRow(doc, editKey), [doc, editKey]);
  const selected = useMemo(() => view.layers.find((l) => l.id === selectedId) ?? null, [view.layers, selectedId]);

  /** An edit — to the main design, or in row mode, the layout part of it to this row. */
  const updateLayer = useCallback(
    (id: string, patch: Partial<TextLayer> | ((layer: TextLayer) => Partial<TextLayer>)) => {
      commit((prev) => patchLayer(prev, id, patch, editKeyRef.current));
    },
    [commit],
  );

  /**
   * Live drag/slider updates must not push a history entry per frame; they
   * write through and the caller snapshots once on gesture start.
   */
  const previewLayer = useCallback(
    (id: string, patch: Partial<TextLayer>) => preview((prev) => patchLayer(prev, id, patch, editKeyRef.current)),
    [preview],
  );

  /** Back to the main design: one field of one layer, one layer, or the whole row. */
  const revertRow = useCallback(
    (key: string, layerId?: string, field?: OverrideField) => commit((prev) => revert(prev, key, layerId, field)),
    [commit],
  );

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
      commit((prev) => pruneLayer({ ...prev, layers: prev.layers.filter((l) => l.id !== id) }, id));
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
    // A row's own layout is only meaningful drawn with that row's values.
    if ((!showValues && !editKey) || data.rows.length === 0) return null;
    return data.rows[clampedRow] ?? null;
  }, [showValues, editKey, data.rows, clampedRow]);

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
    view,
    currentKey,
    editKey,
    rowMode: editKey !== null,
    setRowMode,
    revertRow,
    setDoc: commit,
    replaceDoc: preview,
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
    canUndo: history.canUndo,
    usedFields,
    rowIndex,
    setRowIndex,
    currentRow,
    step,
    showValues,
    setShowValues,
  };
}
