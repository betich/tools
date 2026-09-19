import { useState } from "react";
import type { PdfAnalysis, SizeCategory } from "@tools/shared";
import { cn } from "@/lib/cn";
import { bytes } from "@/lib/format";
import { CATEGORIES, change, share } from "./analysis";

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

type Key = SizeCategory | "rest";
type Split = { whole: number; values: Record<Key, number> };

/**
 * One analysis split by category. Whatever the walk could not attribute — the
 * xref table, object headers, free space — becomes `rest`, so the parts always
 * add up to the whole file.
 */
function split(analysis: PdfAnalysis): Split {
  const values = { rest: 0 } as Record<Key, number>;
  let counted = 0;
  for (const c of CATEGORIES) counted += values[c.key] = Math.max(0, analysis.breakdown[c.key] ?? 0);
  const whole = Math.max(analysis.bytes, counted);
  values.rest = whole - counted;
  return { whole, values };
}

/**
 * Where the file's bytes go: one bar split by category, with a legend under it
 * that names each part, its size and its share. Pointing at a legend row or a
 * segment lights both in periwinkle. Whatever the walk could not attribute is
 * left as bare track at the end, so the bar still reads as the whole file.
 *
 * Given `before`, it becomes the before/after of a run: two bars on one scale,
 * so the smaller file draws as a shorter bar, and each legend row reads
 * `before → after` with its change instead of its share.
 */
export function SizeBreakdown({
  analysis,
  before,
  className,
}: {
  analysis: PdfAnalysis;
  before?: PdfAnalysis;
  className?: string;
}) {
  const [hover, setHover] = useState<Key | null>(null);
  const after = split(analysis);
  const was = before ? split(before) : null;
  const scale = Math.max(after.whole, was?.whole ?? 0) || 1;

  const keys: { key: Key; label: string }[] = [
    ...CATEGORIES,
    ...(after.values.rest > 0 || (was?.values.rest ?? 0) > 0 ? [{ key: "rest" as const, label: "unattributed" }] : []),
  ];
  const fill = (key: Key) => (hover === key ? "bg-indigo" : key === "rest" ? "bg-transparent" : STEP[key]);
  const point = (key: Key) => ({ onPointerEnter: () => setHover(key), onPointerLeave: () => setHover(null) });

  const bar = (s: Split) => (
    <div
      className="bg-surface border-wash rounded-hairline flex h-3 gap-px overflow-hidden border"
      style={{ width: `${Math.max(1, (s.whole / scale) * 100)}%` }}
      role="img"
      aria-label={keys.map((k) => `${k.label} ${bytes(s.values[k.key])}`).join(", ")}
    >
      {keys.map((k) =>
        s.values[k.key] > 0 ? (
          <div
            key={k.key}
            {...point(k.key)}
            className={cn("h-full transition-colors duration-200", fill(k.key))}
            style={{ flexGrow: s.values[k.key], flexBasis: 0, minWidth: 2 }}
          />
        ) : null,
      )}
    </div>
  );

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {was ? (
        <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          <span className="text-meta text-meta font-mono uppercase">before</span>
          {bar(was)}
          <span className="text-meta text-meta font-mono uppercase">after</span>
          {bar(after)}
        </div>
      ) : (
        bar(after)
      )}

      <ul className={cn("grid gap-x-8", !was && "sm:grid-cols-2")}>
        {keys.map((k) => {
          const value = after.values[k.key];
          const old = was?.values[k.key] ?? 0;
          return (
            <li
              key={k.key}
              {...point(k.key)}
              className={cn(
                "border-hairline-faint flex items-baseline gap-3 border-b py-2 transition-colors duration-200",
                value <= 0 && old <= 0 && "opacity-40",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 self-center rounded-[1px] transition-colors duration-200",
                  k.key === "rest" ? "border-wash border" : "",
                  fill(k.key),
                )}
              />
              <span
                className={cn(
                  "text-meta flex-1 font-mono uppercase transition-colors duration-200",
                  hover === k.key ? "text-indigo" : "text-label",
                )}
              >
                {k.label}
              </span>
              {was ? (
                <>
                  <span className="text-meta text-label hidden font-mono tabular-nums tracking-normal sm:inline">
                    {bytes(old)} →
                  </span>
                  <span className="text-ink text-label font-mono tabular-nums tracking-normal">{bytes(value)}</span>
                  <span
                    // Not `cn`: tailwind-merge takes `text-meta` (a size here) for a colour and drops it.
                    className={`text-meta w-14 text-right font-mono tabular-nums tracking-normal ${value < old ? "text-indigo" : "text-label"}`}
                  >
                    {change(old, value)}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-ink text-label font-mono tabular-nums tracking-normal">{bytes(value)}</span>
                  <span className="text-meta text-label w-12 text-right font-mono tabular-nums tracking-normal">
                    {share(value, after.whole)}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
