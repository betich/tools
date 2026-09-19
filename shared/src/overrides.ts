import type { LayerOverride, MergeData, MergeDoc, MergeRow, TextLayer } from "./types";

/**
 * Per-row layout, laid over the main design.
 *
 * A row may move, resize and rotate a layer and change its type size; nothing
 * else. What it has not changed follows the main design, so editing the main
 * design still reaches every row except where that row said otherwise.
 */

export const OVERRIDABLE = ["x", "y", "width", "height", "rotation", "size"] as const;
export type OverrideField = (typeof OVERRIDABLE)[number];

export function newRowKey(): string {
  return `r${Math.random().toString(36).slice(2, 10)}`;
}

/** Keys parallel to the rows. Missing or short key lists are topped up, never reshuffled. */
export function withKeys(data: MergeData): MergeData {
  const keys = data.keys ?? [];
  if (keys.length === data.rows.length) return data.keys ? data : { ...data, keys };
  const next = data.rows.map((_, i) => keys[i] ?? newRowKey());
  return { ...data, keys: next };
}

export function keyAt(data: MergeData, index: number): string | null {
  return data.keys?.[index] ?? null;
}

/** The value a field has on a layer, whether it lives on the layer or its font. */
export function fieldOf(layer: TextLayer, field: OverrideField): number {
  return field === "size" ? layer.font.size : layer[field];
}

export function applyOverride(layer: TextLayer, ov: LayerOverride | undefined): TextLayer {
  if (!ov) return layer;
  const { size, ...box } = ov;
  return { ...layer, ...box, font: size === undefined ? layer.font : { ...layer.font, size } };
}

/** The document as one row draws it. Returns `doc` itself when the row has nothing of its own. */
export function docForRow(doc: MergeDoc, key: string | null | undefined): MergeDoc {
  const own = key ? doc.overrides?.[key] : undefined;
  if (!own || Object.keys(own).length === 0) return doc;
  return { ...doc, layers: doc.layers.map((l) => applyOverride(l, own[l.id])) };
}

export function hasOverrides(doc: MergeDoc, key: string | null | undefined): boolean {
  if (!key) return false;
  const own = doc.overrides?.[key];
  return Boolean(own && Object.values(own).some((ov) => Object.keys(ov).length > 0));
}

/** Override keys whose row has gone — kept, not dropped, so a rollback can bring them back. */
export function strandedKeys(doc: MergeDoc, data: MergeData): string[] {
  const live = new Set(data.keys ?? []);
  return Object.keys(doc.overrides ?? {}).filter((k) => !live.has(k) && hasOverrides(doc, k));
}

/**
 * Apply a layer patch. With no row key it is an edit to the main design. With
 * one, the layout fields it *changes* become that row's override and everything
 * else still goes to the main design — a colour picked while editing one row is
 * the colour of every row, because a row cannot own its colour.
 */
export function patchLayer(
  doc: MergeDoc,
  id: string,
  patch: Partial<TextLayer> | ((layer: TextLayer) => Partial<TextLayer>),
  key: string | null,
): MergeDoc {
  const main = doc.layers.find((l) => l.id === id);
  if (!main) return doc;

  if (!key) {
    const resolved = typeof patch === "function" ? patch(main) : patch;
    return { ...doc, layers: doc.layers.map((l) => (l === main ? { ...l, ...resolved } : l)) };
  }

  const own = doc.overrides?.[key]?.[id];
  const shown = applyOverride(main, own);
  const resolved = typeof patch === "function" ? patch(shown) : patch;

  const nextOwn: LayerOverride = { ...own };
  let changedOwn = false;
  const toMain: Partial<TextLayer> = { ...resolved };

  for (const field of OVERRIDABLE) {
    const value = field === "size" ? resolved.font?.size : resolved[field];
    if (value === undefined) continue;
    if (value !== fieldOf(shown, field)) {
      nextOwn[field] = value;
      changedOwn = true;
    }
    if (field !== "size") delete toMain[field];
  }
  // The font travels whole; the main design keeps its own size inside it.
  if (resolved.font) toMain.font = { ...resolved.font, size: main.font.size };

  const mainChanged = Object.keys(toMain).length > 0;
  let next = doc;
  if (mainChanged) next = { ...next, layers: next.layers.map((l) => (l.id === id ? { ...l, ...toMain } : l)) };
  if (changedOwn) {
    const rowOwn = { ...(next.overrides?.[key] ?? {}), [id]: nextOwn };
    next = { ...next, overrides: { ...(next.overrides ?? {}), [key]: rowOwn } };
  }
  return next;
}

/** Put fields back to the main design: one field, one layer, or the whole row. */
export function revert(doc: MergeDoc, key: string, layerId?: string, field?: OverrideField): MergeDoc {
  const row = doc.overrides?.[key];
  if (!row) return doc;
  let nextRow: Record<string, LayerOverride>;
  if (!layerId) nextRow = {};
  else if (!field) {
    const { [layerId]: _, ...rest } = row;
    nextRow = rest;
  } else {
    const { [field]: _, ...rest } = row[layerId] ?? {};
    nextRow = { ...row, [layerId]: rest };
    if (Object.keys(rest).length === 0) delete nextRow[layerId];
  }
  const overrides = { ...doc.overrides };
  if (Object.keys(nextRow).length === 0) delete overrides[key];
  else overrides[key] = nextRow;
  return { ...doc, overrides };
}

/** Drop override entries for layers that no longer exist. */
export function pruneLayer(doc: MergeDoc, layerId: string): MergeDoc {
  if (!doc.overrides) return doc;
  let touched = false;
  const overrides: NonNullable<MergeDoc["overrides"]> = {};
  for (const [key, row] of Object.entries(doc.overrides)) {
    if (row[layerId]) {
      touched = true;
      const { [layerId]: _, ...rest } = row;
      if (Object.keys(rest).length) overrides[key] = rest;
    } else overrides[key] = row;
  }
  return touched ? { ...doc, overrides } : doc;
}

/**
 * Carry keys from the old rows to a reloaded sheet: first a row with every
 * shared value the same, then — for rows whose details changed — a row with the
 * same first value (usually the name), when exactly one old row has it.
 */
export function matchKeys(
  before: { fields: string[]; rows: MergeRow[]; keys: string[] },
  incoming: { fields: string[]; rows: MergeRow[] },
): string[] {
  const shared = incoming.fields.filter((f) => before.fields.includes(f));
  const used = new Set<number>();
  const whole = (r: MergeRow) => JSON.stringify(shared.map((f) => (r[f] ?? "").trim()));

  const byWhole = new Map<string, number[]>();
  before.rows.forEach((r, i) => byWhole.set(whole(r), [...(byWhole.get(whole(r)) ?? []), i]));

  const out: (string | null)[] = incoming.rows.map((r) => {
    const i = byWhole.get(whole(r))?.find((j) => !used.has(j));
    if (i === undefined) return null;
    used.add(i);
    return before.keys[i] ?? null;
  });

  const first = shared[0];
  if (first) {
    const val = (r: MergeRow) => (r[first] ?? "").trim().toLowerCase();
    incoming.rows.forEach((r, j) => {
      if (out[j] || !val(r)) return;
      const candidates = before.rows.map((_, i) => i).filter((i) => !used.has(i) && val(before.rows[i]!) === val(r));
      if (candidates.length !== 1) return;
      used.add(candidates[0]!);
      out[j] = before.keys[candidates[0]!] ?? null;
    });
  }

  return out.map((k) => k ?? newRowKey());
}
