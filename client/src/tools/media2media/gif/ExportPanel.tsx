import { useEffect, useRef, useState, type ReactNode } from "react";
import { FiDownload } from "react-icons/fi";
import { Button, Field, Input, Section, Sections, Slider, Stat, TextButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { download } from "@/lib/download";
import { bytes, delta, ms, parseSize } from "@/lib/format";
import { exportSpec } from "./compose";
import {
  ANIM_FORMATS,
  clampColours,
  DEFAULT_OPTIONS,
  describeOptions,
  encodeAnimation,
  FORMATS,
  framesFor,
  MAX_TOLERANCE,
  rawBytes,
  type AnimFormat,
  type Dither,
  type EncodeOptions,
  type EncodeResult,
  type Support,
} from "./encode";
import type { FrameStore } from "./frames";
import type { GifDoc } from "./model";

type Settings = { format: AnimFormat; options: EncodeOptions };

/** Kept at module level, like the session, so the choices survive a tab switch. */
let remembered: Settings = { format: "gif", options: DEFAULT_OPTIONS };

type Job = { fraction: number; label: string };
type Done = EncodeResult & { format: AnimFormat; doc: GifDoc; key: string; raw: number };

const DITHERS: { value: Dither; label: string }[] = [
  { value: "off", label: "off" },
  { value: "ordered", label: "ordered" },
  { value: "diffusion", label: "diffusion" },
];

/**
 * Export: the format, the encoder's own controls, an optional target size,
 * then the one action. A control the chosen encoder can't honour stays in
 * place, dimmed, with the reason under it — so switching formats never
 * makes the panel jump. Encoding runs in a worker; the result says how big
 * the pixels were, how big the file is, and whether it met the target.
 */
export function ExportPanel({ doc, store }: { doc: GifDoc; store: FrameStore }) {
  const [settings, setSettings] = useState<Settings>(remembered);
  const [job, setJob] = useState<Job | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<AbortController | null>(null);

  useEffect(() => {
    remembered = settings;
  }, [settings]);
  useEffect(() => () => running.current?.abort(), []);

  const { format, options } = settings;
  const info = FORMATS[format];
  const resolved = info.resolve(options);
  const key = JSON.stringify({ format, options: resolved, target: options.targetBytes });
  const current = done !== null && done.doc === doc && done.key === key;
  const spec = exportSpec(doc);

  const set = (patch: Partial<EncodeOptions>) => setSettings((s) => ({ ...s, options: { ...s.options, ...patch } }));

  const run = async () => {
    running.current?.abort();
    const ctrl = new AbortController();
    running.current = ctrl;
    setError(null);
    setJob({ fraction: 0, label: "drawing frames" });
    try {
      const raw = rawBytes(doc);
      const frames = await framesFor(doc, store, ctrl.signal, (p) =>
        setJob({ fraction: p.fraction * 0.15, label: p.label }),
      );
      const result = await encodeAnimation(format, frames, resolved, ctrl.signal, (p) =>
        setJob({ fraction: 0.15 + p.fraction * 0.85, label: p.label }),
      );
      if (!ctrl.signal.aborted) setDone({ ...result, format, doc, key, raw });
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "The export failed.");
    } finally {
      if (running.current === ctrl) {
        running.current = null;
        setJob(null);
      }
    }
  };

  const stop = () => {
    running.current?.abort();
    running.current = null;
    setJob(null);
  };

  const fileName = (d: Done) => `animation.${FORMATS[d.format].ext}`;

  return (
    <Sections>
      <Section title="export">
        <Group label="format">
          <Choices
            value={format}
            onChange={(f) => setSettings((s) => ({ ...s, format: f }))}
            options={ANIM_FORMATS.map((f) => ({ value: f, label: FORMATS[f].label, support: true }))}
          />
          <Prose>{info.blurb}</Prose>
        </Group>

        <Control support={info.controls.quality}>
          <Field label="quality">
            <span className="flex items-center gap-3">
              <Slider value={resolved.quality} min={1} max={100} onChange={(quality) => set({ quality })} />
              <Readout>{resolved.quality}</Readout>
            </span>
          </Field>
        </Control>

        <Control support={info.controls.colours}>
          <Group label="colours">
            <Choices
              value={resolved.colours === 0 ? "all" : "palette"}
              onChange={(v) => set({ colours: v === "all" ? 0 : clampColours(options.colours || 256) })}
              options={[
                // A format without the choice has the whole control dimmed, so the options needn't be.
                { value: "all", label: "every colour", support: true },
                { value: "palette", label: "palette", support: true },
              ]}
            />
            {resolved.colours > 0 ? (
              <span className="flex items-center gap-3">
                <Slider value={resolved.colours} min={2} max={256} onChange={(colours) => set({ colours })} />
                <Readout>{resolved.colours}</Readout>
              </span>
            ) : null}
          </Group>
        </Control>

        <DitherControl format={format} options={resolved} onChange={(dither) => set({ dither })} />

        <Field
          label="frame diff"
          hint="Changes smaller than this keep what's already on screen, so only real motion is written. 0 is exact."
        >
          <span className="flex items-center gap-3">
            <Slider
              value={resolved.tolerance}
              min={0}
              max={MAX_TOLERANCE}
              onChange={(tolerance) => set({ tolerance })}
            />
            <Readout>{resolved.tolerance === 0 ? "exact" : `± ${resolved.tolerance}`}</Readout>
          </span>
        </Field>

        <TargetBox value={options.targetBytes} onChange={(targetBytes) => set({ targetBytes })} />
      </Section>

      <Section title="file">
        <p className="text-meta text-meta font-mono uppercase">
          <span className="tabular-nums">{spec.count}</span> frames
          {" · "}
          <span className="tabular-nums tracking-normal">
            {spec.size.width} × {spec.size.height}
          </span>
          {" · "}
          {spec.plays === 0 ? "plays forever" : spec.plays === 1 ? "plays once" : `plays ${spec.plays} times`}
          {" · "}
          {info.label}
        </p>

        {job ? (
          <Progress job={job} onStop={stop} />
        ) : error ? (
          <p className="text-ink text-body font-sans normal-case leading-snug">{error}</p>
        ) : null}

        {done ? <Outcome done={done} stale={!current} /> : null}

        <div className="flex flex-wrap items-center justify-end gap-3">
          {done ? (
            <Button variant={current ? "primary" : "outline"} onClick={() => download(done.blob, fileName(done))}>
              <FiDownload className="size-3.5" aria-hidden />
              download {FORMATS[done.format].label}
            </Button>
          ) : null}
          {!current ? (
            <Button onClick={run} disabled={!!job || spec.count === 0}>
              {done ? `export again` : `export ${info.label}`}
            </Button>
          ) : null}
        </div>
      </Section>
    </Sections>
  );
}

/* ── Controls ───────────────────────────────────────────────────────────── */

/** A control the encoder may not honour: dimmed and explained when it can't. */
function Control({ support, children }: { support: Support; children: ReactNode }) {
  if (support === true) return <>{children}</>;
  return (
    <div className="flex flex-col gap-2">
      <div className="opacity-35" inert>
        {children}
      </div>
      <Prose>{support}</Prose>
    </div>
  );
}

function DitherControl({
  format,
  options,
  onChange,
}: {
  format: AnimFormat;
  options: EncodeOptions;
  onChange: (d: Dither) => void;
}) {
  const support = FORMATS[format].dithers(options);
  const reasons = [...new Set(Object.values(support).filter((s): s is string => s !== true))];
  return (
    <Group label="dithering">
      <Choices
        value={options.dither}
        onChange={onChange}
        options={DITHERS.map((d) => ({ ...d, support: support[d.value] }))}
      />
      {reasons.map((r) => (
        <Prose key={r}>{r}</Prose>
      ))}
    </Group>
  );
}

/** Like `Segmented`, but an option can be dimmed with its reason as a tooltip. */
function Choices<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; support: Support }[];
}) {
  return (
    <div className="flex items-center gap-4" role="group">
      {options.map((o) => (
        <TextButton
          key={o.value}
          active={o.value === value}
          aria-pressed={o.value === value}
          disabled={o.support !== true}
          title={o.support === true ? undefined : o.support}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </TextButton>
      ))}
    </div>
  );
}

/** The target size box: empty is off; committed on Enter or leaving it, like PDF Compress's. */
function TargetBox({ value, onChange }: { value: number | null; onChange: (n: number | null) => void }) {
  const shown = value === null ? "" : String(Math.round((value / 1024 / 1024) * 100) / 100);
  const [draft, setDraft] = useState(shown);
  const [unreadable, setUnreadable] = useState(false);
  useEffect(() => setDraft(shown), [shown]);

  const commit = () => {
    const n = parseSize(draft);
    if (n === undefined) return setUnreadable(true);
    setUnreadable(false);
    if (n !== value) onChange(n);
    else setDraft(shown);
  };

  return (
    <div className="flex flex-col gap-2">
      <Field label="target size" changed={value !== null}>
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
              if (e.key === "Escape") setDraft(shown);
            }}
            className="w-24 px-2 py-1 text-right"
          />
          <span className="text-meta text-label font-mono uppercase">mb</span>
        </span>
      </Field>
      {unreadable ? (
        <Prose>Couldn't read that as a size. Try 2, 0.5 or 800 KB.</Prose>
      ) : value !== null ? (
        <Prose>
          The settings above are where the search starts; it only goes down from there — lower quality or fewer colours
          first, then more frame-diff tolerance.
        </Prose>
      ) : null}
    </div>
  );
}

/* ── Progress and result ────────────────────────────────────────────────── */

function Progress({ job, onStop }: { job: Job; onStop: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-label text-meta truncate font-mono uppercase">{job.label}</span>
        <TextButton onClick={onStop}>stop</TextButton>
      </div>
      <div
        role="progressbar"
        aria-label="exporting"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(job.fraction * 100)}
        className="bg-wash relative h-0.5 w-full overflow-hidden rounded-full"
      >
        <div
          className="bg-indigo absolute inset-y-0 left-0 transition-[width] duration-200"
          style={{ width: `${Math.max(2, job.fraction * 100)}%` }}
        />
      </div>
    </div>
  );
}

function Outcome({ done, stale }: { done: Done; stale: boolean }) {
  const fit = done.fit;
  return (
    <div className={cn("flex flex-col gap-4 transition-opacity duration-200", stale && "opacity-60")}>
      <div className="grid grid-cols-3 gap-4">
        <Stat label="as pixels" value={bytes(done.raw)} />
        <Stat label="file" value={bytes(done.blob.size)} accent />
        <Stat label="change" value={delta(done.raw, done.blob.size)} />
      </div>
      <span className="text-label text-meta font-mono uppercase">
        {describeOptions(done.format, done.options)}
        {" · "}
        <span className="tabular-nums tracking-normal">{Math.round(done.changedShare * 100)}%</span> of the canvas per
        frame
        {" · "}
        <span className="tabular-nums tracking-normal">{ms(done.elapsedMs)}</span>
      </span>
      {fit ? (
        <div className="flex flex-col gap-1.5">
          <span className={cn("text-meta font-mono uppercase", fit.reached ? "text-indigo" : "text-meta")}>
            target {bytes(fit.target)} · {fit.reached ? "reached" : "not reached"} · {fit.tries}{" "}
            {fit.tries === 1 ? "try" : "tries"}
          </span>
          {fit.gap ? <p className="text-ink text-body font-sans normal-case leading-snug">{fit.gap}</p> : null}
        </div>
      ) : null}
      {stale ? <Prose>Made before the last change — export again to catch up.</Prose> : null}
    </div>
  );
}

/* ── Bits ───────────────────────────────────────────────────────────────── */

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className="text-meta text-meta font-mono uppercase">{label}</span>
      {children}
    </div>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <p className="text-meta text-body font-sans normal-case leading-snug">{children}</p>;
}

/** A slider's value beside it, one width for all so the tracks line up. */
function Readout({ children }: { children: ReactNode }) {
  return (
    <span className="text-indigo text-label w-16 shrink-0 text-right font-mono tabular-nums tracking-normal">
      {children}
    </span>
  );
}
