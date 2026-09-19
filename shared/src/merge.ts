import type { ExportFormat, MergeData, MergeRow } from "./types";

const TOKEN = /<([^<>]+)>/g;

/** Field names referenced by a template string, in order of first appearance. */
export function tokensIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const name = m[1]!.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Replace `<field>` with the row's value. Unknown fields are left as the raw
 * token so a typo is visible on the canvas instead of silently vanishing.
 */
export function resolve(text: string, row: MergeRow | null): string {
  if (!row) return text;
  return text.replace(TOKEN, (raw, name: string) => {
    const key = name.trim();
    const hit = key in row ? row[key] : findCaseInsensitive(row, key);
    return hit ?? raw;
  });
}

function findCaseInsensitive(row: MergeRow, key: string): string | undefined {
  const lower = key.toLowerCase();
  for (const k of Object.keys(row)) if (k.toLowerCase() === lower) return row[k];
  return undefined;
}

/** Every token used across a set of template strings. */
export function tokensInAll(texts: string[]): string[] {
  const out: string[] = [];
  for (const t of texts) for (const name of tokensIn(t)) if (!out.includes(name)) out.push(name);
  return out;
}

/** Tokens referenced by the doc that the loaded data cannot fill. */
export function missingFields(used: string[], data: MergeData): string[] {
  const have = new Set(data.fields.map((f) => f.toLowerCase()));
  return used.filter((f) => !have.has(f.toLowerCase()));
}

/** Build a filename for a row, e.g. `cert-<name>` -> `cert-ada-lovelace.png`. */
export function fileNameFor(pattern: string, row: MergeRow, index: number, ext: string): string {
  // Keep any script's letters, digits and combining marks — a Thai or Japanese column must not
  // slug away to nothing and leave every file named `row-001`.
  const base = resolve(pattern, row)
    .replace(/<[^<>]*>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || `row-${String(index + 1).padStart(3, "0")}`}.${ext}`;
}

export const extensionFor = (format: ExportFormat) => (format === "jpeg" ? "jpg" : format);

export const emptyData: MergeData = { fields: [], rows: [] };
