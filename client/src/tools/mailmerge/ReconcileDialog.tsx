import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiArrowRight, FiX } from "react-icons/fi";
import type { MergeRow } from "@tools/shared";
import { Button, Select, TextButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { guessColumn } from "./rows";

/**
 * The sheet came back with different column names from the ones the template
 * asks for. Two columns: on the left, each `<token>` the template uses that the
 * sheet cannot fill; on the right, the sheet column that should fill it, with
 * that column's first value underneath so you can tell `name` from `nickname`
 * without opening the file.
 *
 * Applying rewrites the template's tokens to the sheet's names — the sheet is
 * the thing that changes outside this tool, so the template follows it, and
 * the next reload of the same file matches without asking. It is a step on the
 * edit timeline, so it rolls back with the reload that caused it.
 */
export function ReconcileDialog({
  severed,
  matched,
  fields,
  sample,
  source,
  onApply,
  onClose,
}: {
  /** Tokens the template uses that the sheet has no column for. */
  severed: string[];
  /** How many of the template's tokens still find their column. */
  matched: number;
  fields: string[];
  sample: MergeRow | undefined;
  source?: string;
  onApply: (map: Record<string, string>) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const first = useRef<HTMLSelectElement>(null);
  const [map, setMap] = useState<Record<string, string>>(() => {
    const taken = new Set<string>();
    const out: Record<string, string> = {};
    for (const token of severed) {
      const guess = guessColumn(token, fields, taken);
      out[token] = guess;
      if (guess) taken.add(guess);
    }
    return out;
  });

  const chosen = useMemo(() => Object.fromEntries(Object.entries(map).filter(([, v]) => v)), [map]);
  const count = Object.keys(chosen).length;
  // A column that fills two tokens is allowed, but worth saying out loud.
  const doubled = new Set(Object.values(chosen).filter((v, i, all) => all.indexOf(v) !== i));

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="animate-toast-in fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-[rgb(2_2_8/0.72)] px-4 pt-[10vh] pb-10"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        className="border-wash bg-panel-high rounded-card w-full max-w-[38rem] border"
        style={{ boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)" }}
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <h2 id={titleId} className="flex min-w-0 items-baseline gap-3">
            <span className="text-ink shrink-0 font-mono text-title font-bold uppercase">match columns</span>
            {source ? (
              <span className="text-label truncate font-mono text-small tracking-normal">{source}</span>
            ) : null}
          </h2>
          <button
            type="button"
            aria-label="close"
            onClick={onClose}
            className="text-meta hover:text-indigo -mr-1 cursor-pointer p-1 transition-colors duration-200"
          >
            <FiX className="size-4" />
          </button>
        </header>

        <div className="border-hairline-faint border-t" />

        <p className="text-prose max-w-[46ch] px-6 pt-5 font-sans text-body normal-case">
          The template asks for {severed.length === 1 ? "a column" : `${severed.length} columns`} this sheet doesn’t
          have. Pick the column that should fill {severed.length === 1 ? "it" : "each one"} — the template will use the
          sheet’s name from now on.
        </p>

        {/* the two columns */}
        <div className="px-6 pt-5 pb-2">
          <div className="text-meta grid grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1.25fr)] gap-x-3 pb-2.5 font-mono text-micro uppercase">
            <span>template asks for</span>
            <span aria-hidden />
            <span>sheet column</span>
          </div>

          <ul className="border-hairline-faint flex flex-col border-t">
            {severed.map((token, i) => {
              const value = map[token] ?? "";
              const example = value ? sample?.[value] : undefined;
              return (
                <li
                  key={token}
                  className="border-hairline-faint grid grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1.25fr)] items-start gap-x-3 border-b py-3"
                >
                  <span className="flex min-h-9 items-center">
                    <span
                      className={cn(
                        "inline-flex max-w-full items-center truncate rounded-full border px-2.5 py-1 font-mono text-micro tracking-normal transition-colors duration-200",
                        value ? "border-indigo/50 text-ink" : "border-edge border-dashed text-label",
                      )}
                    >
                      &lt;{token}&gt;
                    </span>
                  </span>

                  <span className="flex min-h-9 items-center justify-center" aria-hidden>
                    <FiArrowRight className={cn("size-3.5 transition-colors duration-200", value ? "text-indigo" : "text-meta")} />
                  </span>

                  <span className="flex min-w-0 flex-col gap-1.5">
                    <Select
                      ref={i === 0 ? first : undefined}
                      value={value}
                      aria-label={`sheet column for ${token}`}
                      onChange={(e) => setMap((prev) => ({ ...prev, [token]: e.target.value }))}
                    >
                      <option value="">leave unmatched</option>
                      {fields.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </Select>
                    <span className="text-meta min-w-0 truncate font-mono text-micro">
                      {value ? (
                        <>
                          <span className="uppercase">e.g.</span>{" "}
                          <span className="text-label tracking-normal">{example?.replace(/\n/g, " ") || "empty in row 01"}</span>
                          {doubled.has(value) ? <span className="uppercase"> · fills two</span> : null}
                        </>
                      ) : (
                        <span className="uppercase">stays as &lt;{token}&gt; on the poster</span>
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>

          {matched > 0 ? (
            <p className="text-meta pt-3 font-mono text-micro uppercase">
              {matched} other {matched === 1 ? "column" : "columns"} still {matched === 1 ? "matches" : "match"}
            </p>
          ) : null}
        </div>

        <div className="border-hairline-faint mt-3 border-t" />

        <footer className="flex items-center justify-between gap-4 px-6 py-4">
          <TextButton onClick={onClose}>later</TextButton>
          <Button onClick={() => onApply(chosen)} disabled={count === 0}>
            {count === 0 ? "pick a column" : `match ${count}`}
          </Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
