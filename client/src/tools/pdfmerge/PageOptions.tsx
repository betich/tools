import { PAPER_IDS, PAPER_SIZES, type MergeItemOptions, type PageFit, type PageOrientation, type MarginUnit } from "@tools/shared";
import { Field, NumberInput, Section, Segmented, Select, TextButton } from "@/components/ui";
import type { MergeEntry } from "./useMergeFiles";

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
  onChange,
  onApplyToAll,
}: {
  entry: MergeEntry | null;
  /** How many images the list holds, so "apply to all" only offers itself when it would do something. */
  images: number;
  onChange: (change: Partial<MergeItemOptions>) => void;
  onApplyToAll: () => void;
}) {
  if (!entry) return null;

  if (entry.kind === "pdf") {
    return (
      <Section title="page">
        <p className="text-prose font-sans text-body normal-case">A PDF goes in as it is: every page, at its own size.</p>
      </Section>
    );
  }

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
