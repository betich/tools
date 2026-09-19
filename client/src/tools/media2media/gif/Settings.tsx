import { useEffect, useState } from "react";
import { MIN_DELAY, MAX_DELAY, snapDelay } from "@/components/timeline/model";
import { ColorInput, Field, NumberInput, Section, Sections, Segmented, Toggle } from "@/components/ui";
import { normaliseHex } from "@/lib/color";
import type { GifSession } from "./session";
import { canvasSize, clampPlays, MAX_EDGE, MAX_PLAYS, resize, type Fit, type GifDoc } from "./model";

/**
 * Everything about the animation that isn't a single frame: timing, loops,
 * and the canvas the frames are drawn on. Typed numbers apply on enter or
 * when the field is left, so each is one undo step.
 */
export function Settings({ doc, session }: { doc: GifDoc; session: GifSession }) {
  const size = canvasSize(doc);
  const first = doc.frames[0];
  const firstAspect = first ? first.width / first.height : 1;
  const [lock, setLock] = useState(true);

  return (
    <Sections>
      <Section title="timing">
        <Field label="delay for every frame" hint="Milliseconds, in steps of 10 — a GIF stores hundredths of a second.">
          <DraftNumber
            value={sharedDelayOf(doc)}
            placeholder="mixed"
            min={MIN_DELAY}
            max={MAX_DELAY}
            step={10}
            label="delay for every frame, in milliseconds"
            onCommit={(ms) => {
              const delay = snapDelay(ms);
              session.update({ frames: doc.frames.map((f) => (f.delay === delay ? f : { ...f, delay })) });
            }}
          />
        </Field>

        <Group label="plays">
          <div className="flex items-center gap-4">
            <Segmented
              value={doc.plays === 0 ? "forever" : "count"}
              onChange={(v) => session.update({ plays: v === "forever" ? 0 : doc.plays || 1 })}
              options={[
                { value: "forever", label: "forever" },
                { value: "count", label: "times" },
              ]}
            />
            {doc.plays > 0 ? (
              <DraftNumber
                className="w-20"
                value={doc.plays}
                min={1}
                max={MAX_PLAYS}
                label="number of plays"
                onCommit={(n) => session.update({ plays: Math.max(1, clampPlays(n)) })}
              />
            ) : null}
          </div>
        </Group>

        <Toggle checked={doc.pingPong} onChange={(pingPong) => session.update({ pingPong })} label="ping-pong" />
      </Section>

      <Section title="canvas">
        <Group label="size" hint={doc.size ? undefined : "Follows the first frame."}>
          <Segmented
            value={doc.size ? "custom" : "first"}
            onChange={(v) => session.update({ size: v === "first" ? null : size })}
            options={[
              { value: "first", label: "first frame" },
              { value: "custom", label: "custom" },
            ]}
          />
        </Group>
        {doc.size ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <DraftNumber
                value={size.width}
                min={1}
                max={MAX_EDGE}
                label="canvas width in pixels"
                onCommit={(w) => session.update({ size: resize(size, "width", w, lock, size.width / size.height) })}
              />
              <span className="text-meta font-mono text-micro" aria-hidden>
                ×
              </span>
              <DraftNumber
                value={size.height}
                min={1}
                max={MAX_EDGE}
                label="canvas height in pixels"
                onCommit={(h) => session.update({ size: resize(size, "height", h, lock, size.width / size.height) })}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Toggle checked={lock} onChange={setLock} label="keep shape" />
              <button
                type="button"
                onClick={() => session.update({ size: resize(size, "width", size.width, true, firstAspect) })}
                className="text-meta hover:text-indigo cursor-pointer font-mono text-micro uppercase transition-colors duration-200"
              >
                first frame's shape
              </button>
            </div>
          </div>
        ) : null}

        <Group label="fit" hint="How a frame that isn't the canvas's shape sits on it.">
          <Segmented<Fit>
            value={doc.fit}
            onChange={(fit) => session.update({ fit })}
            options={[
              { value: "contain", label: "whole frame" },
              { value: "cover", label: "fill canvas" },
            ]}
          />
        </Group>

        <Group label="background">
          <Segmented
            value={doc.background ? "colour" : "transparent"}
            onChange={(v) => session.update({ background: v === "transparent" ? null : lastColour })}
            options={[
              { value: "transparent", label: "transparent" },
              { value: "colour", label: "colour" },
            ]}
          />
        </Group>
        {doc.background ? <BackgroundColour value={doc.background} session={session} /> : null}
      </Section>
    </Sections>
  );
}

/** A labelled row of choices. Like `Field`, but not a <label>, which would forward clicks to its first button. */
function Group({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className="text-meta font-mono text-micro uppercase">{label}</span>
      {children}
      {hint ? <span className="text-meta font-mono text-micro tracking-normal normal-case opacity-80">{hint}</span> : null}
    </div>
  );
}

function sharedDelayOf(doc: GifDoc): number | null {
  const d = doc.frames[0]?.delay;
  return d !== undefined && doc.frames.every((f) => f.delay === d) ? d : null;
}

let lastColour = "#ffffff";

/**
 * The picker and the typed value. Editing is one undo step from focus to
 * blur; half-typed values stay in the field and only a whole `#rrggbb`
 * reaches the canvas (so `#abc` isn't expanded under the cursor).
 */
function BackgroundColour({ value, session }: { value: string; session: GifSession }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div onFocusCapture={session.snapshot} onPointerDownCapture={session.snapshot}>
      <ColorInput
        value={draft}
        onChange={(v) => {
          setDraft(v);
          const hex = normaliseHex(v);
          if (!hex) return;
          lastColour = hex;
          session.preview({ ...session.doc, background: hex });
        }}
      />
    </div>
  );
}

/** A number field holding its own draft; enter or leaving it commits, escape puts the value back. */
function DraftNumber({
  value,
  onCommit,
  min,
  max,
  step = 1,
  label,
  placeholder,
  className,
}: {
  value: number | null;
  onCommit: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const shown = value === null ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) return setDraft(shown);
    const clamped = Math.min(max, Math.max(min, n));
    if (clamped !== value) onCommit(clamped);
    setDraft(shown);
  };

  return (
    <NumberInput
      className={className}
      value={draft}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(shown);
      }}
    />
  );
}

