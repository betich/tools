import { useState } from "react";
import { FiChevronDown } from "react-icons/fi";
import {
  PRESET_IDS,
  PRESETS,
  defaultCompressParams,
  passInfo,
  passesIn,
  reasonUnsupported,
  supportNote,
  type CompressParams,
  type PassId,
  type PdfAnalysis,
  type PresetId,
} from "@tools/shared";
import { Button, Section, Sections, Segmented, Toggle } from "@/components/ui";
import { cn } from "@/lib/cn";

/** What each preset is for, in one line under the picker. */
const PURPOSE: Record<PresetId, string> = {
  screen: "Smallest file, for reading on a screen. Photos lose detail when zoomed in.",
  ebook: "Sharp on any screen and fine on a home printer. The usual choice.",
  print: "Keeps enough resolution to print well. Saves less.",
};

/** What switching an opt-in on costs, since every one of them changes the document, not just its bytes. */
const CONSEQUENCE: Partial<Record<PassId, string>> = {
  "remove-extras": "Drops attachments, scripts, bookmarks, annotations and form fields.",
  flatten: "Draws form fields and annotations into the page. They can no longer be edited.",
  grayscale: "Turns colour into shades of grey.",
};

/** `Ebook · 150 dpi · q75 · grayscale` — a run's settings in one line, for its row in the history. */
export function describeParams(params: CompressParams): string {
  return [
    PRESETS[params.preset]?.label ?? params.preset,
    params.dpiCap ? `${params.dpiCap} dpi` : "full resolution",
    `q${params.quality}`,
    ...params.advanced.map((p) => passInfo(p)?.verb ?? p),
  ].join(" · ");
}

/**
 * The settings column and the run action. A preset sets the resolution cap,
 * the image quality and whether metadata goes; the lossless passes always run
 * and are listed so it is clear what "lossless" covers. Advanced holds what
 * changes the document itself, off until asked for, in the order later tickets
 * fill it: the engine (#13), the codecs (#10), these opt-ins, then the time
 * budget of a target size (#12). `busy` while the queue holds a task for this
 * job — one at a time per caller — and RUN says why it waits.
 */
export function RunPanel({
  analysis,
  busy,
  onRun,
}: {
  analysis: PdfAnalysis | null;
  busy: boolean;
  onRun?: (params: CompressParams) => void;
}) {
  const [params, setParams] = useState<CompressParams>(() => defaultCompressParams());
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // The preset owns the numbers; the opt-ins and anything later tickets add survive a change of preset.
  const pick = (id: PresetId) =>
    setParams((p) => {
      const d = defaultCompressParams(id);
      return { ...p, preset: id, dpiCap: d.dpiCap, quality: d.quality, stripMetadata: d.stripMetadata };
    });

  const toggle = (pass: PassId, on: boolean) =>
    setParams((p) => ({ ...p, advanced: on ? [...p.advanced, pass] : p.advanced.filter((x) => x !== pass) }));

  const optIns = passesIn("advanced");
  const on = params.advanced.length;

  return (
    <Sections>
      <Section title="preset">
        <Segmented
          value={params.preset}
          onChange={pick}
          options={PRESET_IDS.map((id) => ({ value: id, label: PRESETS[id].label }))}
        />
        <p className="text-prose text-body font-sans normal-case">{PURPOSE[params.preset]}</p>
        <dl className="flex flex-col">
          <Fact label="images above" value={params.dpiCap ? `${params.dpiCap} dpi` : "kept"} />
          <Fact label="quality" value={String(params.quality)} />
          <Fact label="metadata" value={params.stripMetadata ? "stripped" : "kept"} />
        </dl>
      </Section>

      <Section title="always on">
        <p className="text-meta text-body font-sans normal-case">Lossless — the pages look exactly the same.</p>
        <ul className="flex flex-col gap-1.5">
          {passesIn("lossless").map((pass) => {
            const reason = reasonUnsupported(params.engine, pass);
            return (
              <li
                key={pass}
                title={reason ?? undefined}
                className={`text-label text-meta flex items-baseline gap-2.5 font-mono uppercase ${reason ? "opacity-35" : ""}`}
              >
                <span aria-hidden className="bg-ink/40 size-1 shrink-0 self-center rounded-full" />
                {passInfo(pass).label}
              </li>
            );
          })}
        </ul>
      </Section>

      <section className="flex flex-col gap-4">
        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((o) => !o)}
          className="group flex min-h-5 cursor-pointer items-center justify-between gap-3 text-left"
        >
          <span className="text-meta text-meta group-hover:text-indigo font-mono uppercase transition-colors duration-200">
            advanced{on ? ` · ${on} on` : ""}
          </span>
          <FiChevronDown
            aria-hidden
            className={cn(
              "text-meta group-hover:text-indigo size-3.5 transition-[transform,color] duration-200",
              advancedOpen && "rotate-180",
            )}
          />
        </button>

        {advancedOpen ? (
          <div className="flex flex-col gap-6">
            {/* #13 engine picker goes first, then #10 codecs, above the opt-ins. */}
            <div className="flex flex-col gap-4">
              <span className="text-meta text-meta font-mono uppercase">changes the document</span>
              {optIns.map((pass) => {
                const reason = reasonUnsupported(params.engine, pass);
                const note = supportNote(params.engine, pass);
                return (
                  <div key={pass} className={cn("flex flex-col gap-1.5", reason && "opacity-35")}>
                    <Toggle
                      checked={params.advanced.includes(pass)}
                      onChange={(v) => !reason && toggle(pass, v)}
                      label={passInfo(pass).verb}
                    />
                    <p className="text-meta text-body pl-6 font-sans normal-case leading-snug">
                      {reason ?? [CONSEQUENCE[pass], note].filter(Boolean).join(" ")}
                    </p>
                  </div>
                );
              })}
            </div>
            {/* #12 target size's time budget goes last. */}
          </div>
        ) : null}
      </section>

      <div className="flex flex-col gap-3">
        <Button disabled={!analysis || busy || !onRun} onClick={() => onRun?.(params)} className="w-full">
          run
        </Button>
        {busy ? (
          <p className="text-meta text-body font-sans normal-case">
            The worker is busy with this file. Run again once it's done.
          </p>
        ) : !analysis ? (
          <p className="text-meta text-body font-sans normal-case">Ready once the analysis lands.</p>
        ) : null}
      </div>
    </Sections>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-hairline-faint flex items-baseline justify-between gap-3 border-b py-1.5 last:border-b-0">
      <dt className="text-meta text-meta font-mono uppercase">{label}</dt>
      <dd className="text-ink text-label font-mono tabular-nums tracking-normal">{value}</dd>
    </div>
  );
}
