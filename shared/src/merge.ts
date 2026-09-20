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

/**
 * The names a set of rows is saved under, with collisions numbered:
 * `merge.png`, `merge-2.png`, `merge-3.png`.
 *
 * Two rows earn the same name whenever the pattern resolves to the same text —
 * a pattern whose token names no column in the sheet resolves to the same text
 * for *every* row. A ZIP will happily hold thirty-six entries called
 * `merge.png`, and unzipping leaves one file, so the names must be made unique
 * before the archive is built. Both the browser's export and the server's
 * batch go through here, so a set downloaded either way lands the same.
 */
export function uniqueNames(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
    const dot = name.lastIndexOf(".");
    const stem = dot === -1 ? name : name.slice(0, dot);
    const ext = dot === -1 ? "" : name.slice(dot);
    let n = 2;
    while (taken.has(`${stem}-${n}${ext}`)) n++;
    const out = `${stem}-${n}${ext}`;
    taken.add(out);
    return out;
  });
}

export const emptyData: MergeData = { fields: [], rows: [] };
