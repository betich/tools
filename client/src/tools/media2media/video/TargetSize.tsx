import { useEffect, useState } from "react";
import { FiRotateCcw } from "react-icons/fi";
import { Field, IconButton, Input, Prose, Section, TextButton, Value } from "@/components/ui";
import { bytes, parseSize } from "@/lib/format";
import { formatBitrate, formatOff, type Budget, type BudgetRefusal, type Outcome } from "./budget";
import { outputSize, type SourceInfo, type VideoEdit } from "./settings";

const MB = 1024 * 1024;
const draftFor = (n: number | null) => (n === null ? "" : String(Math.round((n / MB) * 100) / 100));

/**
 * Compress to a target size (#29). Empty is off. With a size named, the
 * quality level is set aside and the encoder is handed a bitrate worked out
 * from the size, the length and the sound; the section shows that bitrate
 * and, when it's thin for the picture, a smaller height that would do.
 */
export function TargetSizeSection({
  edit,
  source,
  fileBytes,
  value,
  budget,
  onChange,
  onHeight,
  disabled,
}: {
  edit: VideoEdit;
  source: SourceInfo;
  fileBytes: number;
  value: number | null;
  budget: Budget | BudgetRefusal | null;
  onChange: (bytes: number | null) => void;
  /** Take the suggested height: one undo step on the edit. */
  onHeight: (height: number) => void;
  disabled: boolean;
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

  const size = outputSize(edit, source);

  return (
    <Section title="target size">
      <fieldset disabled={disabled} className="flex flex-col gap-3 disabled:opacity-35">
        <Field
          label="aim for"
          changed={value !== null}
          action={
            value !== null ? (
              <IconButton
                label="no target"
                onClick={(e) => {
                  // Inside a <label>, a click would otherwise also land on the box.
                  e.preventDefault();
                  onChange(null);
                }}
              >
                <FiRotateCcw className="size-3" aria-hidden />
              </IconButton>
            ) : null
          }
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
          <Prose>Couldn't read that as a size. Try 25, 8.5 or 800 KB.</Prose>
        ) : value === null ? (
          <Prose>Name a size and the quality setting steps aside: the encoder gets the bitrate that fits.</Prose>
        ) : budget && !budget.ok ? (
          <Prose>{budget.reason}</Prose>
        ) : budget ? (
          <>
            <span className="text-meta text-meta font-mono tabular-nums tracking-normal">
              {[
                `video ${formatBitrate(budget.videoBitrate)}`,
                budget.audio ? `audio ${formatBitrate(budget.audio.bitrate)}` : "no audio",
                `${budget.bitsPerPixel.toFixed(3)} bpp`,
              ].join(" · ")}
            </span>
            {fileBytes <= value ? <Prose>The file is already {bytes(fileBytes)}, under the target.</Prose> : null}
            {budget.thin ? (
              <div className="flex flex-col gap-2">
                <Prose>
                  That's thin for {size.width}×{size.height} — expect blocky motion.
                  {budget.suggestHeight
                    ? ` At ${budget.suggestHeight}p the same size goes further.`
                    : " Trimming it or a lower frame rate would help."}
                </Prose>
                {budget.suggestHeight ? (
                  <TextButton className="w-fit" onClick={() => onHeight(budget.suggestHeight!)}>
                    use {budget.suggestHeight}p
                  </TextButton>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </fieldset>
    </Section>
  );
}

/**
 * Under a finished export that aimed at a size: how close it came, and,
 * after an overshoot, the one retry at a corrected bitrate.
 */
export function TargetOutcome({
  outcome,
  bitrateMode,
  retry,
  onRetry,
}: {
  outcome: Outcome;
  bitrateMode: "constant" | "variable" | null;
  /** The corrected bitrate on offer, or null when there's no retry (on target, or already retried). */
  retry: number | null;
  onRetry: (bitrate: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-meta text-meta font-mono uppercase">
        target <Value>{bytes(outcome.targetBytes)}</Value>{" "}
        <Value accent={!outcome.over}>{formatOff(outcome.off)}</Value>
        {bitrateMode ? (
          <span className="ml-3">{bitrateMode === "constant" ? "constant bitrate" : "variable bitrate"}</span>
        ) : null}
      </p>
      {outcome.over ? (
        retry ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <Prose>It came out over. One more pass at a corrected bitrate should land under.</Prose>
            <TextButton onClick={() => onRetry(retry)}>retry at {formatBitrate(retry)}</TextButton>
          </div>
        ) : (
          <Prose>Still over — name a slightly smaller size, or lower the height, and export again.</Prose>
        )
      ) : null}
    </div>
  );
}
