import { useRef, useState } from "react";
import {
  formatPageRange,
  PAPER_IDS,
  PAPER_SIZES,
  parsePageRange,
  type MergeItemOptions,
  type PageFit,
  type PageOrientation,
  type MarginUnit,
} from "@tools/shared";
import { Field, Input, NumberInput, Section, Segmented, Select, TextButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { pad } from "@/lib/format";
import type { MergeEntry } from "./useMergeFiles";

/** The selected PDF's pages in the merge (#37): its count as the order knows it, the pages kept in output order, and the two ways to change them. */
export type FilePages = {
  count: number | null | undefined;
  kept: number[];
  onApply: (pages: number[]) => void;
  onReset: () => void;
};

const MODES: { value: MergeItemOptions["mode"]; label: string }[] = [
  { value: "image", label: "image size" },
  { value: "paper", label: "paper" },
];
const FITS: { value: PageFit; label: string }[] = [
  { value: "contain", label: "contain" },
  { value: "cover", label: "cover" },
  { value: "fill", label: "fill" },
];
const ORIENTATIONS: { value: PageOrientation; label: string }[] = [
  { value: "auto", label: "auto" },
  { value: "portrait", label: "portrait" },
  { value: "landscape", label: "landscape" },
];
const UNITS: { value: MarginUnit; label: string }[] = [
  { value: "mm", label: "mm" },
  { value: "pt", label: "pt" },
];

/**
 * The selected image's page. The mode is a toggle, not a pair of checkboxes:
 * a page is either the image's own size or a sheet of paper, and only the
 * paper has a fit, a margin and an orientation.
 */
export function PageOptions({
  entry,
  images,
  pages,
  onChange,
  onApplyToAll,
}: {
  entry: MergeEntry | null;
  /** For a PDF: its pages in the merge, or null while the order doesn't know it (not uploaded yet). */
  pages: FilePages | null;
  /** How many images the list holds, so "apply to all" only offers itself when it would do something. */
  images: number;
  onChange: (change: Partial<MergeItemOptions>) => void;
  onApplyToAll: () => void;
}) {
  if (!entry) return null;

  if (entry.kind === "pdf") return <PdfPages key={entry.key} pages={pages} />;

  const o = entry.layout;
  return (
    <Section
      title="page"
      aside={images > 1 ? <TextButton onClick={onApplyToAll}>apply to all images</TextButton> : undefined}
    >
      <Segmented value={o.mode} onChange={(mode) => onChange({ mode })} options={MODES} />

      {o.mode === "image" ? (
        <p className="text-prose font-sans text-body normal-case">
          The page is the picture at its printed size, from the DPI saved in the file — or 96 DPI when there is none.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <Field label="paper">
            <Select value={o.paper} onChange={(e) => onChange({ paper: e.target.value as MergeItemOptions["paper"] })}>
              {PAPER_IDS.map((id) => {
                const p = PAPER_SIZES[id];
                return (
                  <option key={id} value={id}>
                    {p.label} · {Math.round((p.width / 72) * 25.4)} × {Math.round((p.height / 72) * 25.4)} mm
                  </option>
                );
              })}
            </Select>
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-meta font-mono text-meta uppercase">fit</span>
            <Segmented value={o.fit} onChange={(fit) => onChange({ fit })} options={FITS} />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-meta font-mono text-meta uppercase">orientation</span>
            <Segmented value={o.orientation} onChange={(orientation) => onChange({ orientation })} options={ORIENTATIONS} />
          </div>

          <div className="flex items-end gap-4">
            <Field label="margin" className="w-28">
              <NumberInput
                min={0}
                step={o.marginUnit === "mm" ? 1 : 6}
                value={o.margin}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onChange({ margin: Number.isFinite(v) ? Math.max(0, v) : 0 });
                }}
              />
            </Field>
            <Segmented
              className="pb-2.5"
              value={o.marginUnit}
              onChange={(marginUnit) => {
                // Keep the margin's physical size when the unit flips.
                const k = marginUnit === "pt" ? 72 / 25.4 : 25.4 / 72;
                onChange({ marginUnit, margin: Math.round(o.margin * k * 10) / 10 });
              }}
              options={UNITS}
            />
          </div>
        </div>
      )}
    </Section>
  );
}

/**
 * Which of a PDF's pages go in, as a range to type: "1-3, 5, 8-", in the order
 * they should come out. The box shows the pages kept now; ↵ or leaving the
 * box applies what was typed, escape puts it back. A range that can't be read
 * says why under the box and changes nothing. Reset brings every page back,
 * in order, where the file's first page sits.
 */
function PdfPages({ pages }: { pages: FilePages | null }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Escape blurs the box, and the blur must not apply what escape just threw away.
  const dropped = useRef(false);
  const count = pages?.count;

  if (!pages || typeof count !== "number") {
    return (
      <Section title="pages">
        <p className="text-prose font-sans text-body normal-case">
          {count === null
            ? "The server couldn't count this file's pages — it may be locked or damaged — so they can't be picked. It can only go in whole."
            : pages
              ? "Counting this file's pages…"
              : "A PDF goes in as it is: every page, at its own size. Its pages can be picked once it has uploaded."}
        </p>
      </Section>
    );
  }

  const whole = pages.kept.length === count && pages.kept.every((p, i) => p === i);
  const shown = formatPageRange(pages.kept);
  const value = draft ?? shown;
  const forget = () => (setDraft(null), setError(null));

  const apply = () => {
    if (dropped.current) return void (dropped.current = false);
    if (draft === null) return;
    const text = draft.trim();
    if (text === shown) return forget();
    const read = parsePageRange(text, count);
    if (!read.ok) return setError(read.error);
    forget();
    pages.onApply(read.pages);
  };

  return (
    <Section
      title={`pages · ${pad(pages.kept.length)} of ${pad(count)}`}
      aside={whole ? undefined : <TextButton onClick={() => (forget(), pages.onReset())}>reset</TextButton>}
    >
      <Field label="keep" changed={draft !== null && draft.trim() !== shown}>
        <Input
          value={value}
          placeholder="1-3, 5, 8-"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          onChange={(e) => (setDraft(e.target.value), setError(null))}
          onBlur={apply}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
            else if (e.key === "Escape") {
              dropped.current = true;
              forget();
              e.currentTarget.blur();
            }
          }}
        />
      </Field>
      <p className={cn("font-sans text-body normal-case", error ? "text-prose" : "text-meta")} aria-live="polite">
        {error ?? "Type pages in the order they should go out: 8- runs to the last page, 5-3 counts down."}
      </p>
    </Section>
  );
}
