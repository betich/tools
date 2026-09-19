import { matchKeys, newRowKey, withKeys, type DataEdit, type DataStep, type MergeData, type MergeDoc, type MergeRow } from "@tools/shared";

/**
 * The data's edit timeline. Every step stores enough to be undone, so rolling
 * back to a point is replaying inverses from the newest step down to it. The
 * timeline rides inside `MergeData` and is saved with the merge.
 */

/** Brief on purpose: past this, the oldest steps are baked in. */
export const TIMELINE_LIMIT = 24;

export function record(data: MergeData, step: DataStep, next: Omit<MergeData, "history">): MergeData {
  const entry = { ...step, id: crypto.randomUUID(), at: new Date().toISOString() } as DataEdit;
  return { ...next, history: [...(data.history ?? []), entry].slice(-TIMELINE_LIMIT) };
}

/** Change some fields of one row. A change that changes nothing is not a step. */
export function changeRow(data: MergeData, row: number, values: MergeRow): MergeData {
  const current = data.rows[row];
  if (!current) return data;
  const changes: Record<string, [string, string]> = {};
  for (const field of data.fields) {
    const from = current[field] ?? "";
    const to = values[field] ?? "";
    if (from !== to) changes[field] = [from, to];
  }
  if (Object.keys(changes).length === 0) return data;
  const rows = data.rows.map((r, i) => (i === row ? { ...r, ...values } : r));
  return record(data, { kind: "change", row, changes }, { ...data, rows });
}

export function addRow(data: MergeData, values: MergeRow): MergeData {
  const keyed = withKeys(data);
  const row = data.rows.length;
  const key = newRowKey();
  const clean = Object.fromEntries(data.fields.map((f) => [f, values[f] ?? ""]));
  return record(
    data,
    { kind: "add", row, values: clean, key },
    { ...keyed, rows: [...data.rows, clean], keys: [...keyed.keys!, key] },
  );
}

/** The row's key rides in the step, so rolling the removal back reattaches its layout. */
export function removeRow(data: MergeData, row: number): MergeData {
  const values = data.rows[row];
  if (!values) return data;
  const keyed = withKeys(data);
  return record(
    data,
    { kind: "remove", row, values, key: keyed.keys![row] },
    { ...keyed, rows: data.rows.filter((_, i) => i !== row), keys: keyed.keys!.filter((_, i) => i !== row) },
  );
}

/**
 * A new version of the sheet. The old one is kept in the step, so this rolls
 * back too. Each incoming row inherits the key of the old row it matches, so a
 * row's own layout survives the reload.
 */
export function reloadSheet(data: MergeData, incoming: MergeData): MergeData {
  const keyed = withKeys(data);
  const before = { fields: data.fields, rows: data.rows, source: data.source, keys: keyed.keys };
  const keys = matchKeys({ fields: data.fields, rows: data.rows, keys: keyed.keys! }, incoming);
  return record(
    data,
    { kind: "reload", before, source: incoming.source, count: incoming.rows.length },
    { fields: incoming.fields, rows: incoming.rows, source: incoming.source, keys },
  );
}

/** Rewrite `<from>` tokens to `<to>` across every layer, matching case-insensitively. */
export function remapTokens(doc: MergeDoc, map: Record<string, string>): MergeDoc {
  const lower = new Map(Object.entries(map).map(([from, to]) => [from.toLowerCase(), to]));
  return {
    ...doc,
    layers: doc.layers.map((layer) => ({
      ...layer,
      text: layer.text.replace(/<([^<>]+)>/g, (raw, name: string) => {
        const to = lower.get(name.trim().toLowerCase());
        return to ? `<${to}>` : raw;
      }),
    })),
  };
}

/** Undo `entryId` and everything after it. */
export function rollback(doc: MergeDoc, data: MergeData, entryId: string): { doc: MergeDoc; data: MergeData } {
  const history = data.history ?? [];
  const index = history.findIndex((e) => e.id === entryId);
  if (index === -1) return { doc, data };

  let fields = data.fields;
  let rows = [...data.rows];
  let keys = [...withKeys(data).keys!];
  let source = data.source;
  let nextDoc = doc;

  for (let i = history.length - 1; i >= index; i--) {
    const step = history[i]!;
    switch (step.kind) {
      case "change": {
        const undo = Object.fromEntries(Object.entries(step.changes).map(([field, [from]]) => [field, from]));
        if (rows[step.row]) rows[step.row] = { ...rows[step.row], ...undo };
        break;
      }
      case "add":
        rows.splice(step.row, 1);
        keys.splice(step.row, 1);
        break;
      case "remove":
        rows.splice(step.row, 0, step.values);
        keys.splice(step.row, 0, step.key ?? newRowKey());
        break;
      case "reload":
        fields = step.before.fields;
        rows = [...step.before.rows];
        keys = step.before.keys ? [...step.before.keys] : rows.map(() => newRowKey());
        source = step.before.source;
        break;
      case "remap":
        nextDoc = remapTokens(nextDoc, Object.fromEntries(Object.entries(step.map).map(([from, to]) => [to, from])));
        break;
    }
  }

  return { doc: nextDoc, data: { fields, rows, source, keys, history: history.slice(0, index) } };
}

/** How many steps rolling back to this entry would undo. */
export function stepsFrom(data: MergeData, entryId: string): number {
  const history = data.history ?? [];
  const index = history.findIndex((e) => e.id === entryId);
  return index === -1 ? 0 : history.length - index;
}

/* ── reconciling a sheet with the template ─────────────────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The sheet column most likely meant by a template token — the same name
 * spelled differently, then one name inside the other. Returns "" when nothing
 * is close enough to guess; a wrong guess is worse than an empty choice.
 */
export function guessColumn(token: string, fields: string[], taken: Set<string>): string {
  const want = norm(token);
  if (!want) return "";
  const free = fields.filter((f) => !taken.has(f));
  return (
    free.find((f) => norm(f) === want) ??
    free.find((f) => norm(f).includes(want) || (norm(f).length >= 3 && want.includes(norm(f)))) ??
    ""
  );
}

/** Tokens the template uses that the sheet cannot fill. */
export function severed(used: string[], fields: string[]): string[] {
  const have = new Set(fields.map((f) => f.toLowerCase()));
  return used.filter((f) => !have.has(f.toLowerCase()));
}

/** A one-line name for a row: its first non-empty value among the fields that matter. */
export function rowTitle(row: MergeRow | undefined, fields: string[]): string {
  if (!row) return "";
  for (const f of fields) if (row[f]?.trim()) return row[f]!.replace(/\n/g, " ");
  return "";
}
