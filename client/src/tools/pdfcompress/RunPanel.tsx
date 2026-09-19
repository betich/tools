import { useState } from "react";
import { FiChevronDown } from "react-icons/fi";
import {
  DEFAULT_ENGINE,
  ENGINES,
  PRESET_IDS,
  PRESETS,
  defaultCompressParams,
  passInfo,
  passesIn,
  type CompressParams,
  type PassId,
  type PdfAnalysis,
  type PresetId,
} from "@tools/shared";
import { EnginePicker } from "@/components/pdf/EnginePicker";
import { Button, Section, Sections, Segmented, Toggle } from "@/components/ui";
import { useEngineSupport, type RowSupport } from "@/hooks/useEngineSupport";
import { cn } from "@/lib/cn";
import { InputCautions } from "./SpecialInputs";

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
    ...(params.engine && params.engine !== DEFAULT_ENGINE ? [ENGINES[params.engine]?.label ?? params.engine] : []),
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

  const support = useEngineSupport(params.engine);
  const optIns = passesIn("advanced");
  // An opt-in the engine can't run is skipped, so it isn't counted as on.
  const on = params.advanced.filter((p) => support.pass(p).supported).length;
  const engineLabel = params.engine !== DEFAULT_ENGINE ? ENGINES[params.engine].label : null;

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
          <Fact
            label="images above"
            value={params.dpiCap ? `${params.dpiCap} dpi` : "kept"}
            support={support.pass("downsample")}
          />
          <Fact label="quality" value={String(params.quality)} support={support.pass("reencode-images")} />
          <Fact
            label="metadata"
            value={params.stripMetadata ? "stripped" : "kept"}
            support={params.stripMetadata ? support.pass("strip-metadata") : undefined}
          />
        </dl>
      </Section>

      <Section title="always on">
        <p className="text-meta text-body font-sans normal-case">Lossless — the pages look exactly the same.</p>
        <ul className="flex flex-col gap-1.5">
          {passesIn("lossless").map((pass) => {
            const { reason, note } = support.pass(pass);
            return (
              <li key={pass} className={cn("flex flex-col gap-0.5", reason && "opacity-35")}>
                <span className="text-label text-meta flex items-baseline gap-2.5 font-mono uppercase">
                  <span aria-hidden className="bg-ink/40 size-1 shrink-0 self-center rounded-full" />
                  {passInfo(pass).label}
                </span>
                {reason || note ? (
                  <span className="text-meta text-body pl-3.5 font-sans normal-case leading-snug">{reason ?? note}</span>
                ) : null}
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
            {["advanced", engineLabel, on ? `${on} on` : null].filter(Boolean).join(" · ")}
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
            <div className="flex flex-col gap-4">
              <span className="text-meta text-meta font-mono uppercase">engine</span>
              <EnginePicker tool="compress" value={params.engine} onChange={(engine) => setParams((p) => ({ ...p, engine }))} />
            </div>
            {/* #10 codecs go here, above the opt-ins; dim them with support.codec(id). */}
            <div className="flex flex-col gap-4">
              <span className="text-meta text-meta font-mono uppercase">changes the document</span>
              {optIns.map((pass) => {
                const { reason, note } = support.pass(pass);
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
        {/* #15: re-encrypt, and cautions about what the settings would undo in this file. */}
        <InputCautions analysis={analysis} params={params} onChange={setParams} />
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

/** A preset number, dimmed with the reason when the engine can't apply it, or with what it leaves out. */
function Fact({ label, value, support }: { label: string; value: string; support?: RowSupport }) {
  const said = support?.reason ?? support?.note;
  return (
    <div className={cn("border-hairline-faint flex flex-col gap-0.5 border-b py-1.5 last:border-b-0", support?.reason && "opacity-35")}>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-meta text-meta font-mono uppercase">{label}</dt>
        <dd className="text-ink text-label font-mono tabular-nums tracking-normal">{value}</dd>
      </div>
      {said ? <dd className="text-meta text-body font-sans normal-case leading-snug">{said}</dd> : null}
    </div>
  );
}
