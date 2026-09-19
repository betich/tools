import { useState } from "react";
import type { PdfAnalysis, SizeCategory } from "@tools/shared";
import { cn } from "@/lib/cn";
import { bytes } from "@/lib/format";
import { CATEGORIES, share } from "./analysis";

/**
 * Ink steps for the categories, heaviest first. There is one hue in the system,
 * so the categories are told apart by how much ink they carry (25–60%), and
 * periwinkle is kept for the one being pointed at.
 */
const STEP: Record<SizeCategory, string> = {
  images: "bg-ink/60",
  fonts: "bg-ink/48",
  content: "bg-ink/38",
  metadata: "bg-ink/30",
  other: "bg-ink/25",
};

/**
 * Where the file's bytes go: one bar split by category, with a legend under it
 * that names each part, its size and its share. Pointing at a legend row or a
 * segment lights both in periwinkle. Whatever the walk could not attribute —
 * the xref table, object headers, free space — is left as bare track at the
 * end, so the bar still reads as the whole file.
 */
export function SizeBreakdown({ analysis, className }: { analysis: PdfAnalysis; className?: string }) {
  const [hover, setHover] = useState<SizeCategory | "rest" | null>(null);
  const { breakdown } = analysis;
  const counted = CATEGORIES.reduce((n, c) => n + Math.max(0, breakdown[c.key] ?? 0), 0);
  const whole = Math.max(analysis.bytes, counted);
  const rest = whole - counted;

  const rows = [
    ...CATEGORIES.map((c) => ({ key: c.key as SizeCategory | "rest", label: c.label, value: breakdown[c.key] ?? 0 })),
    ...(rest > 0 ? [{ key: "rest" as const, label: "unattributed", value: rest }] : []),
  ];
  const fill = (key: SizeCategory | "rest") =>
    hover === key ? "bg-indigo" : key === "rest" ? "bg-transparent" : STEP[key];

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div
        className="bg-surface border-wash rounded-hairline flex h-3 w-full gap-px overflow-hidden border"
        role="img"
        aria-label={rows.map((r) => `${r.label} ${bytes(r.value)}`).join(", ")}
      >
        {rows.map((r) =>
          r.value > 0 ? (
            <div
              key={r.key}
              onPointerEnter={() => setHover(r.key)}
              onPointerLeave={() => setHover(null)}
              className={cn("h-full transition-colors duration-200", fill(r.key))}
              style={{ flexGrow: r.value, flexBasis: 0, minWidth: 2 }}
            />
          ) : null,
        )}
      </div>

      <ul className="grid gap-x-8 sm:grid-cols-2">
        {rows.map((r) => (
          <li
            key={r.key}
            onPointerEnter={() => setHover(r.key)}
            onPointerLeave={() => setHover(null)}
            className={cn(
              "border-hairline-faint flex items-baseline gap-3 border-b py-2 transition-colors duration-200",
              r.value <= 0 && "opacity-40",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 self-center rounded-[1px] transition-colors duration-200",
                r.key === "rest" ? "border-wash border" : "",
                fill(r.key),
              )}
            />
            <span
              className={cn(
                "text-meta flex-1 font-mono uppercase transition-colors duration-200",
                hover === r.key ? "text-indigo" : "text-label",
              )}
            >
              {r.label}
            </span>
            <span className="text-ink text-label font-mono tabular-nums tracking-normal">{bytes(r.value)}</span>
            <span className="text-meta text-label w-12 text-right font-mono tabular-nums tracking-normal">
              {share(r.value, whole)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
