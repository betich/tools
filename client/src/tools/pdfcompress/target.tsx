import { useEffect, useState, type ReactNode } from "react";
import type { RunResult, TargetSize } from "@tools/shared";
import { Field, Input, Slider } from "@/components/ui";
import { cn } from "@/lib/cn";
import { bytes, parseSize } from "@/lib/format";
import { PutBack } from "./controls";
import { DPI_MIN, clampDpi, clampQuality } from "./overrides";

/*
 * Target size (#12). The user names a size; the worker searches image by
 * image for the best quality that fits, starting from the preset's numbers
 * and never going below the floors, and gives up at the time budget with the
 * smallest result it found. The search settings live apart from the size so
 * clearing the size and setting it again keeps them.
 */

/** Flip when the #12 search lands on the worker. */
export const TARGET_SIZE_READY = false;

export type SearchSettings = Omit<TargetSize, "bytes">;

/** The ticket's floors (~q40 / 72 dpi) and a two-minute budget. */
export const SEARCH_DEFAULTS: SearchSettings = { timeBudgetMs: 120_000, qualityFloor: 40, dpiFloor: 72 };

/** Binary megabytes, the same unit `bytes()` prints, so a typed "10" reads back as "10 MB". */
const MB = 1024 * 1024;

const BUDGET_MIN = 15_000;
const BUDGET_MAX = 600_000;
const BUDGET_STEP = 15_000;
const DPI_FLOOR_MAX = 300;

/** The box's text for a size: MB with at most two decimals. */
const draftFor = (n: number | null) => (n === null ? "" : String(Math.round((n / MB) * 100) / 100));

/** `2 min` / `45 s` / `1 min 30 s`. */
export function budgetLabel(ms: number): string {
  const s = Math.round(ms / 1000);
  const min = Math.floor(s / 60);
  const rest = s % 60;
  return min === 0 ? `${rest} s` : rest === 0 ? `${min} min` : `${min} min ${rest} s`;
}

/**
 * The target size box, beside the presets. Empty is off. Committed on Enter
 * or leaving the box, like the DPI box; an unreadable entry says so and keeps
 * the last good value. Once set, it says what the preset now means and where
 * the search stops.
 */
export function TargetField({
  value,
  search,
  inputBytes,
  onChange,
}: {
  value: number | null;
  search: SearchSettings;
  inputBytes: number | null;
  onChange: (bytes: number | null) => void;
}) {
  const [draft, setDraft] = useState(draftFor(value));
  const [unreadable, setUnreadable] = useState(false);
  useEffect(() => setDraft(draftFor(value)), [value]);

  const commit = () => {
    const n = parseSize(draft);
    if (n === undefined) return setUnreadable(true);
    setUnreadable(false);
    setDraft(draftFor(n));
    if (n !== value) onChange(n);
  };

  return (
    <div className="flex flex-col gap-2">
      <Field
        label="target size"
        changed={value !== null}
        action={value !== null ? <PutBack label="no target" onClick={() => onChange(null)} /> : null}
      >
        <span className="flex items-center gap-2.5">
          <Input
            aria-label="target size in MB"
            inputMode="decimal"
            value={draft}
            placeholder="off"
            onChange={(e) => {
              setDraft(e.target.value);
              setUnreadable(false);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
            className="w-24 px-2 py-1 text-right"
          />
          <span className="text-meta text-label font-mono uppercase">mb</span>
        </span>
      </Field>
      {unreadable ? (
        <p className="text-meta text-body font-sans normal-case leading-snug">
          Couldn't read that as a size. Try 10, 2.5 or 800 KB.
        </p>
      ) : value !== null ? (
        <p className="text-meta text-body font-sans normal-case leading-snug">
          {inputBytes !== null && inputBytes <= value
            ? `The file is already ${bytes(inputBytes)}, under the target. `
            : null}
          The preset is where the search starts. It won't go below quality {search.qualityFloor} or{" "}
          {search.dpiFloor} dpi, or run past {budgetLabel(search.timeBudgetMs)} — change those in Advanced.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Advanced → target size: the time budget and the two floors. Sliders take
 * `onCommitStart` like every other slider on the page. They can be set with
 * no target; they just wait for one.
 */
export function SearchSection({
  value,
  active,
  onChange,
  onCommitStart,
}: {
  value: SearchSettings;
  active: boolean;
  onChange: (v: SearchSettings) => void;
  onCommitStart?: () => void;
}) {
  const set = (patch: Partial<SearchSettings>) => onChange({ ...value, ...patch });
  const back = (key: keyof SearchSettings, label: string) =>
    value[key] !== SEARCH_DEFAULTS[key] ? (
      <PutBack label={`back to ${label}`} onClick={() => set({ [key]: SEARCH_DEFAULTS[key] })} />
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <span className="text-meta text-meta font-mono uppercase">target size</span>
      <p className="text-meta text-body font-sans normal-case leading-snug">
        {active
          ? "How long the search may take, and how far it may lower quality and resolution to fit."
          : "Used once a target size is set beside the presets."}
      </p>
      <Field
        label="time budget"
        changed={value.timeBudgetMs !== SEARCH_DEFAULTS.timeBudgetMs}
        action={back("timeBudgetMs", budgetLabel(SEARCH_DEFAULTS.timeBudgetMs))}
      >
        <span className="flex items-center gap-3">
          <Slider
            value={value.timeBudgetMs}
            min={BUDGET_MIN}
            max={BUDGET_MAX}
            step={BUDGET_STEP}
            onChange={(v) => set({ timeBudgetMs: Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, v)) })}
            onCommitStart={onCommitStart}
          />
          <Readout>{budgetLabel(value.timeBudgetMs)}</Readout>
        </span>
      </Field>
      <Field
        label="quality floor"
        changed={value.qualityFloor !== SEARCH_DEFAULTS.qualityFloor}
        action={back("qualityFloor", String(SEARCH_DEFAULTS.qualityFloor))}
      >
        <span className="flex items-center gap-3">
          <Slider
            value={value.qualityFloor}
            min={1}
            max={100}
            onChange={(q) => set({ qualityFloor: clampQuality(q) })}
            onCommitStart={onCommitStart}
          />
          <Readout>{value.qualityFloor}</Readout>
        </span>
      </Field>
      <Field
        label="resolution floor"
        changed={value.dpiFloor !== SEARCH_DEFAULTS.dpiFloor}
        action={back("dpiFloor", `${SEARCH_DEFAULTS.dpiFloor} dpi`)}
      >
        <span className="flex items-center gap-3">
          <Slider
            value={value.dpiFloor}
            min={DPI_MIN}
            max={DPI_FLOOR_MAX}
            onChange={(v) => set({ dpiFloor: Math.min(DPI_FLOOR_MAX, clampDpi(v)) })}
            onCommitStart={onCommitStart}
          />
          <Readout>{value.dpiFloor} dpi</Readout>
        </span>
      </Field>
    </div>
  );
}

/** A slider's value beside it; one width for all three so the tracks line up. */
function Readout({ children }: { children: ReactNode }) {
  return (
    <span className="text-indigo text-label w-20 shrink-0 text-right font-mono tabular-nums tracking-normal">
      {children}
    </span>
  );
}

/** The worker's gap sentence for a missed target — "reached 12.4 MB of 10 MB — non-image data is …". */
const isGapNote = (note: string) => /^reached\b/i.test(note);

/**
 * How a target run ended, for the result: hit, or missed with the worker's
 * sentence saying why, set above the other notes because it is the answer.
 * `rest` is the notes left to list underneath.
 */
export function targetOutcome(result: RunResult): { line: string; reached: boolean; gap: string | null; rest: string[] } | null {
  const t = result.target;
  if (!t) return null;
  const gap = t.reached ? null : (result.notes.find(isGapNote) ?? `reached ${bytes(result.bytes)} of ${bytes(t.bytes)}`);
  return {
    line: `target ${bytes(t.bytes)} · ${t.reached ? "reached" : "not reached"}`,
    reached: t.reached,
    gap,
    rest: gap ? result.notes.filter((n) => n !== gap) : result.notes,
  };
}

export function TargetOutcome({ outcome }: { outcome: NonNullable<ReturnType<typeof targetOutcome>> }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={cn("text-meta font-mono uppercase", outcome.reached ? "text-indigo" : "text-meta")}>
        {outcome.line}
      </span>
      {outcome.gap ? <p className="text-ink text-body font-sans normal-case">{outcome.gap}</p> : null}
    </div>
  );
}
