/**
 * The one reading of a typed colour: `#rrggbb`, lower-case, or null.
 *
 * Strict by default — a whole `#rrggbb` only — for fields that write back
 * into what the user is typing, so `#abc` isn't expanded under the cursor.
 * `short` also takes `#rgb`; `bare` lets the `#` be left off.
 */
export function normaliseHex(value: string, opts: { short?: boolean; bare?: boolean } = {}): string | null {
  const m = /^(#?)([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m || (!m[1] && !opts.bare)) return null;
  const digits = m[2]!.toLowerCase();
  if (digits.length === 6) return `#${digits}`;
  return opts.short ? `#${digits.replace(/./g, (c) => c + c)}` : null;
}
