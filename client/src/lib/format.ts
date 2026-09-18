/** `1.2 MB` — short, mono-friendly, never more than one decimal. */
export function bytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/** `-64%` / `+12%` — signed, because a bigger output is worth noticing. */
export function delta(before: number, after: number): string {
  if (!before) return "—";
  const pct = Math.round(((after - before) / before) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/** The site's timestamp format: `YYYY.MM.DD HH:MM`. */
export function stamp(date: Date | string | number = new Date()): string {
  const d = new Date(date);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Zero-padded sequence numbers, per the reference system. */
export const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export function ms(n: number): string {
  return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`;
}
