import { useEffect, useState } from "react";
import { FiRotateCcw } from "react-icons/fi";
import { IconButton, NumberInput, Slider, Toggle } from "@/components/ui";
import { clampDpi, clampQuality, DPI_MAX, DPI_MIN } from "./overrides";

/*
 * The two numbers a compress run turns on, shared by the settings column and
 * the per-image editor so both read and behave the same. Sliders report
 * `onCommitStart` as the drag begins: nothing here keeps undo history, but the
 * page holds the before/after crop until the slider is let go, so a drag asks
 * the worker once rather than once a frame.
 */

/** Image quality, 1–100, with the house readout beside the slider. */
export function QualityControl({
  value,
  onChange,
  onCommitStart,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommitStart?: () => void;
  disabled?: boolean;
}) {
  return (
    <span className="flex items-center gap-3">
      <Slider
        value={value}
        min={1}
        max={100}
        onChange={(v) => onChange(clampQuality(v))}
        onCommitStart={onCommitStart}
        disabled={disabled}
      />
      <span className={`text-indigo text-small w-8 text-right font-mono tabular-nums ${disabled ? "opacity-35" : ""}`}>
        {value}
      </span>
    </span>
  );
}

/**
 * The DPI cap: images drawn above it are downsampled to it. A slider for
 * feel, a number box for an exact figure (committed on Enter or leaving the
 * box, clamped), and a switch for "never downsample" — `null`, which brings
 * back `fallback` when switched off again.
 */
export function DpiControl({
  value,
  fallback,
  onChange,
  onCommitStart,
  disabled,
}: {
  value: number | null;
  fallback: number;
  onChange: (v: number | null) => void;
  onCommitStart?: () => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => setDraft(value === null ? "" : String(value)), [value]);

  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) return setDraft(value === null ? "" : String(value));
    const v = clampDpi(n);
    setDraft(String(v));
    if (v !== value) onChange(v);
  };
  const full = value === null;

  return (
    <span className="flex flex-col gap-2.5">
      <span className="flex items-center gap-3">
        <Slider
          value={value ?? fallback}
          min={DPI_MIN}
          max={DPI_MAX}
          onChange={(v) => onChange(clampDpi(v))}
          onCommitStart={onCommitStart}
          disabled={disabled || full}
        />
        <NumberInput
          aria-label="dpi cap"
          value={draft}
          placeholder="—"
          min={DPI_MIN}
          max={DPI_MAX}
          disabled={disabled || full}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          className="w-16 shrink-0 px-2 py-1 text-right"
        />
      </span>
      <span className={disabled ? "pointer-events-none opacity-35" : undefined}>
        <Toggle checked={full} onChange={(on) => onChange(on ? null : fallback)} label="keep full resolution" />
      </span>
    </span>
  );
}

/** The put-back glyph at the end of a changed field's label: back to where the value came from. */
export function PutBack({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <IconButton
      label={label}
      onClick={(e) => {
        // Inside a <label>, a click would otherwise also land on the field's control.
        e.preventDefault();
        onClick();
      }}
    >
      <FiRotateCcw className="size-3" aria-hidden />
    </IconButton>
  );
}
