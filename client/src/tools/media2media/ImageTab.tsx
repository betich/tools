import { useState, type ReactNode } from "react";
import { downloadZip } from "client-zip";
import { FiArrowDown, FiArrowRight, FiCheck, FiDownload, FiSliders, FiSquare, FiX } from "react-icons/fi";
import { Dropzone } from "@/components/Dropzone";
import { Button, Field, IconButton, Segmented, Slider, TextButton, Toggle } from "@/components/ui";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/cn";
import { IMAGE_ACCEPT, formatMeta, formats, type OutputFormat } from "@/lib/codecs";
import { download } from "@/lib/download";
import { bytes, delta, pad } from "@/lib/format";
import { overriddenFields, resolveOptions, type BatchSettings, type OverrideField } from "./batch";
import { useImageBatch, type ImageRow } from "./useImageBatch";

const formatOptions = formats.map((f) => ({ value: f.value, label: f.label }));

/**
 * Batch conversion, laid out the way the work flows: what you brought on the
 * left, the machine in the middle, what you take away on the right. The one
 * button that moves the job forward is always the solid one — convert while
 * anything is waiting, then download once everything is made.
 *
 * Any one file can carry its own format, quality or size on top of the batch;
 * that lives on its output row, because it is a setting of the output.
 */
export function ImageTab() {
  const b = useImageBatch();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const { batch, totals } = b;
  const set = (next: Partial<BatchSettings>) => b.setBatch({ ...batch, ...next });

  const downloadAll = async () => {
    const ready = b.rows.filter((r) => r.fresh && r.out);
    if (ready.length === 0) return;
    const blob = await downloadZip(
      ready.map((r) => ({ name: r.name, input: r.out!.blob, lastModified: new Date(r.file.lastModified) })),
    ).blob();
    download(blob, `images-${ready.length}.zip`);
    toast(`${ready.length} files zipped`);
  };

  const addFiles = (files: File[]) => {
    if (b.addFiles(files) === 0) toast("no images in that drop");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_17rem_minmax(0,1fr)] xl:gap-8">
      <InputPanel rows={b.rows} totals={totals} onFiles={addFiles} onRemove={b.remove} onClear={b.clear} />
      <Machine batch={batch} set={set} totals={totals} onConvert={b.convert} onStop={b.stop} />
      <OutputPanel
        rows={b.rows}
        batch={batch}
        totals={totals}
        open={open}
        onToggle={(id) => setOpen((o) => (o === id ? null : id))}
        onOverride={b.setOverride}
        onReset={b.resetOverride}
        onDownloadAll={downloadAll}
      />
    </div>
  );
}

/** The block above each list. One height on both sides, so every output row sits across from its source. */
const headBlock = "flex flex-col justify-end gap-4 lg:min-h-[7.25rem]";

type Totals = ReturnType<typeof useImageBatch>["totals"];

/* ── the two sides ─────────────────────────────────────────────────────────── */

/** A side of the bench: ink over the ground, a hairline, and a header that says what it holds. */
function Panel({
  title,
  count,
  aside,
  label,
  children,
}: {
  title: string;
  count: ReactNode;
  aside?: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="border-wash rounded-card bg-surface flex min-w-0 flex-col border">
      <header className="border-hairline-faint flex min-h-14 items-center gap-3 border-b px-5">
        <h2 className="text-ink text-title font-mono font-bold uppercase">{title}</h2>
        <span className="text-meta text-micro font-mono uppercase tabular-nums">{count}</span>
        <span className="ml-auto flex items-center">{aside}</span>
      </header>
      <div className="flex flex-1 flex-col gap-5 p-5">{children}</div>
    </section>
  );
}

/** What the batch is made of, by the extension each file arrived with: `HEIC 08 · PNG 03`. */
function sourceKinds(rows: ImageRow[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const kind = sourceKind(r.file);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

function sourceKind(file: File): string {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(file.name)?.[1];
  const kind = (ext ?? file.type.split("/")[1] ?? "image").toLowerCase();
  return kind === "jpeg" ? "jpg" : kind;
}

function InputPanel({
  rows,
  totals,
  onFiles,
  onRemove,
  onClear,
}: {
  rows: ImageRow[];
  totals: Totals;
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const size = rows.reduce((n, r) => n + r.file.size, 0);
  return (
    <Panel
      title="in"
      label="files to convert"
      count={rows.length > 0 ? `${pad(totals.total)} files · ${bytes(size)}` : "nothing yet"}
      aside={rows.length > 0 ? <TextButton onClick={onClear}>clear</TextButton> : null}
    >
      {rows.length === 0 ? (
        <Dropzone
          onFiles={onFiles}
          accept={IMAGE_ACCEPT}
          cta="choose images"
          label="or drop them anywhere in here"
          hint="heic · jpeg · png · webp · avif · gif (first frame)"
          className="min-h-72 flex-1 gap-4"
        />
      ) : (
        <>
          <div className={headBlock}>
            <ul className="flex flex-wrap gap-2" aria-label="file types in this batch">
              {sourceKinds(rows).map(([kind, n]) => (
                <li
                  key={kind}
                  className="border-wash text-label text-micro flex items-baseline gap-2 rounded-full border px-2.5 py-1 font-mono uppercase"
                >
                  {kind}
                  <span className="text-ink tabular-nums tracking-normal">{pad(n)}</span>
                </li>
              ))}
            </ul>

            <Dropzone onFiles={onFiles} accept={IMAGE_ACCEPT} label="+ add more images" className="gap-1 px-4 py-4" />
          </div>

          <ul className="-mt-1 flex flex-col">
            {rows.map((row) => (
              <InputRow key={row.id} row={row} onRemove={() => onRemove(row.id)} />
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/** A square that shows the picture when the browser can draw it, and its kind when it can't (HEIC, mostly). */
function Thumb({ blob, kind }: { blob: Blob | null; kind?: string }) {
  const url = useObjectUrl(blob);
  const [broken, setBroken] = useState(false);
  return (
    <span className="checkers bg-surface rounded-xs relative flex size-10 shrink-0 items-center justify-center overflow-hidden">
      {kind && (!url || broken) ? (
        <span className="text-label text-micro font-mono uppercase tracking-normal">{kind}</span>
      ) : null}
      {url && !broken ? (
        <img
          src={url}
          alt=""
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : null}
    </span>
  );
}

function InputRow({ row, onRemove }: { row: ImageRow; onRemove: () => void }) {
  const kind = sourceKind(row.file);
  return (
    <li className="border-hairline-faint flex h-16 items-center gap-3 border-b last:border-b-0">
      <span className="text-meta text-micro w-5 shrink-0 font-mono tabular-nums tracking-[0.1em]">
        {pad(row.index + 1)}
      </span>
      <Thumb blob={row.file} kind={kind} />
      <span className="min-w-0 flex-1">
        <span className="text-ink text-small block truncate font-mono tracking-normal" title={row.file.name}>
          {row.file.name}
        </span>
        <span className="text-meta text-micro block truncate font-mono uppercase tabular-nums">
          {kind} · {bytes(row.file.size)}
        </span>
      </span>
      <IconButton label="remove" onClick={onRemove}>
        <FiX className="size-4" />
      </IconButton>
    </li>
  );
}

/* ── the machine ───────────────────────────────────────────────────────────── */

function Machine({
  batch,
  set,
  totals,
  onConvert,
  onStop,
}: {
  batch: BatchSettings;
  set: (next: Partial<BatchSettings>) => void;
  totals: Totals;
  onConvert: () => void;
  onStop: () => void;
}) {
  const meta = formatMeta(batch.format);
  return (
    <section aria-label="convert" className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-20 lg:self-start">
      {/* Not a <Field>: that is a <label>, and a label full of buttons fires the first one when its text is clicked. */}
      <div className="flex flex-col gap-3">
        <h2 className="text-meta text-micro font-mono uppercase">convert to</h2>
        <FormatGrid value={batch.format} onChange={(format) => set({ format })} />
        {meta.note ? <p className="text-label text-micro font-sans">{meta.note}</p> : null}
      </div>

      <QualityField value={batch.quality} format={batch.format} onChange={(quality) => set({ quality })} />
      <EdgeField value={batch.maxEdge} onChange={(maxEdge) => set({ maxEdge })} />

      <div className="flex flex-col gap-3">
        <h2 className="text-meta text-micro font-mono uppercase">metadata</h2>
        <Toggle checked={batch.keepExif} onChange={(keepExif) => set({ keepExif })} label="keep camera info" />
        {/* A disabled fieldset disables the switch inside it, keyboard included. */}
        <fieldset disabled={!batch.keepExif} className="min-w-0 disabled:opacity-40 [&:disabled_*]:cursor-not-allowed">
          <Toggle
            checked={batch.keepLocation}
            onChange={(keepLocation) => set({ keepLocation })}
            label="keep location"
          />
        </fieldset>
        <p className="text-label text-micro font-sans">{metadataNote(batch)}</p>
      </div>

      <ConvertButton format={meta.label} totals={totals} onConvert={onConvert} onStop={onStop} />
    </section>
  );
}

/** Every format as a cell you can hit without aiming. The chosen one is lit, not filled solid — solid is the button's. */
function FormatGrid({ value, onChange }: { value: OutputFormat; onChange: (f: OutputFormat) => void }) {
  return (
    <div role="radiogroup" aria-label="output format" className="grid grid-cols-3 gap-1.5">
      {formatOptions.map((f) => {
        const on = f.value === value;
        return (
          <button
            key={f.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(f.value)}
            className={cn(
              "text-micro rounded-xs flex h-11 cursor-pointer items-center justify-center border px-1 font-mono uppercase",
              "focus-visible:outline-indigo transition-colors duration-200 focus-visible:outline-1 focus-visible:outline-offset-2",
              on
                ? "border-indigo bg-surface-high text-ink font-bold"
                : "border-wash text-label hover:border-edge hover:text-indigo",
            )}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The step the page turns on. It is the solid shape while anything is waiting;
 * while it runs it becomes the way to stop, filling with the live colour as
 * files land; once every file is made it steps down, and download takes the solid.
 * From a laptop up it sits on a pipe that runs out to both panels.
 */
function ConvertButton({
  format,
  totals,
  onConvert,
  onStop,
}: {
  format: string;
  totals: Totals;
  onConvert: () => void;
  onStop: () => void;
}) {
  const busy = totals.running > 0;
  const share = totals.total > 0 ? totals.fresh / totals.total : 0;
  const Arrow = ({ className }: { className?: string }) => (
    <>
      <FiArrowDown className={cn("size-4 shrink-0 lg:hidden", className)} aria-hidden />
      <FiArrowRight className={cn("hidden size-4 shrink-0 lg:block", className)} aria-hidden />
    </>
  );

  let button: ReactNode;
  if (totals.total === 0) {
    button = (
      <Button size="lg" disabled>
        add images first
      </Button>
    );
  } else if (busy) {
    button = (
      <Button
        size="lg"
        variant="outline"
        onClick={onStop}
        className="border-signal text-ink hover:text-ink relative overflow-hidden"
        aria-describedby="convert-progress"
      >
        <span
          className="bg-signal/35 absolute inset-y-0 left-0 transition-[width] duration-300 ease-out"
          style={{ width: `${share * 100}%` }}
          aria-hidden
        />
        <span className="relative flex items-center gap-3">
          <FiSquare className="size-3.5" aria-hidden /> stop
          <span className="tabular-nums tracking-normal">
            {pad(totals.fresh)} / {pad(totals.total)}
          </span>
        </span>
      </Button>
    );
  } else if (totals.pending > 0) {
    button = (
      <Button size="lg" onClick={onConvert} className="group">
        convert {pad(totals.pending)} to {format}
        <Arrow className="transition-transform duration-200 group-hover:translate-x-1 max-lg:group-hover:translate-x-0 max-lg:group-hover:translate-y-0.5" />
      </Button>
    );
  } else {
    button = (
      <Button size="lg" variant="outline" disabled>
        <FiCheck className="size-4" aria-hidden /> all {pad(totals.total)} converted
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "relative",
          // The pipe: a hairline from the input panel into the button and on out to the output.
          "lg:before:absolute lg:before:right-full lg:before:top-1/2 lg:before:h-px lg:before:w-6 xl:before:w-8",
          "lg:after:absolute lg:after:left-full lg:after:top-1/2 lg:after:h-px lg:after:w-6 xl:after:w-8",
          busy ? "lg:before:bg-signal lg:after:bg-signal" : "lg:before:bg-edge lg:after:bg-edge",
        )}
      >
        {button}
      </div>
      <p id="convert-progress" className="text-meta text-micro text-center font-mono uppercase" aria-live="polite">
        {busy
          ? `converting · ${pad(totals.running)} in the works`
          : totals.failed > 0
            ? `${pad(totals.failed)} failed — see the output`
            : "nothing leaves this browser"}
      </p>
    </div>
  );
}

/* ── output ────────────────────────────────────────────────────────────────── */

function OutputPanel({
  rows,
  batch,
  totals,
  open,
  onToggle,
  onOverride,
  onReset,
  onDownloadAll,
}: {
  rows: ImageRow[];
  batch: BatchSettings;
  totals: Totals;
  open: string | null;
  onToggle: (id: string) => void;
  onOverride: <K extends OverrideField>(id: string, field: K, value: BatchSettings[K] | undefined) => void;
  onReset: (id: string) => void;
  onDownloadAll: () => void;
}) {
  const everything = totals.total > 0 && totals.fresh === totals.total;
  const saved = totals.before - totals.after;

  return (
    <Panel
      title="out"
      label="converted files"
      count={rows.length > 0 ? `${pad(totals.fresh)} / ${pad(totals.total)} ready` : "nothing yet"}
    >
      {rows.length === 0 ? (
        <div className="flex min-h-72 flex-1 flex-col items-center justify-center gap-3 text-center">
          <FiDownload className="text-edge size-6" aria-hidden />
          <p className="text-label text-body max-w-[30ch] font-sans">
            Converted files land here, ready to save — one at a time or all together as a zip.
          </p>
        </div>
      ) : (
        <>
          <div className={headBlock}>
            {totals.fresh > 0 ? (
              <div className="flex items-end justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-meta text-micro font-mono uppercase">{saved >= 0 ? "saved" : "grew"}</span>
                  <span className="text-label text-small font-mono tabular-nums tracking-normal">
                    {bytes(totals.before)} → <span className="text-ink">{bytes(totals.after)}</span>
                  </span>
                </div>
                <span
                  className={cn(
                    "text-display font-mono font-bold tabular-nums",
                    saved > 0 ? "text-indigo" : "text-ink",
                  )}
                >
                  {delta(totals.before, totals.after)}
                </span>
              </div>
            ) : null}

            <Button
              size="lg"
              variant={everything ? "primary" : "outline"}
              onClick={onDownloadAll}
              disabled={totals.fresh === 0}
            >
              <FiDownload className="size-4" aria-hidden />
              {everything
                ? `download all ${pad(totals.fresh)} · zip`
                : totals.fresh > 0
                  ? `zip the ${pad(totals.fresh)} ready`
                  : "download · convert first"}
            </Button>
          </div>

          <ul className="flex flex-col">
            {rows.map((row) => (
              <OutputRow
                key={row.id}
                row={row}
                batch={batch}
                open={open === row.id}
                onToggle={() => onToggle(row.id)}
                onOverride={(field, value) => onOverride(row.id, field, value)}
                onReset={() => onReset(row.id)}
              />
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function statusLine(row: ImageRow, format: string): string {
  if (row.status === "error") return row.error ?? "failed";
  if (row.status === "queued") return `${format} · queued`;
  if (row.status === "working") return `${format} · converting`;
  if (row.fresh && row.out) {
    const m = row.out.metadata;
    const exif = m.exif ? (m.location ? "exif + gps" : "exif") : "no exif";
    return `${row.out.width}×${row.out.height} · ${exif}`;
  }
  if (row.out) return "settings changed — convert again";
  return `${format} · waiting`;
}

function OutputRow({
  row,
  batch,
  open,
  onToggle,
  onOverride,
  onReset,
}: {
  row: ImageRow;
  batch: BatchSettings;
  open: boolean;
  onToggle: () => void;
  onOverride: <K extends OverrideField>(field: K, value: BatchSettings[K] | undefined) => void;
  onReset: () => void;
}) {
  const resolved = resolveOptions(batch, row.override);
  const format = formatMeta(resolved.format).label;
  const own = overriddenFields(row.override);
  const size = row.out?.blob.size ?? 0;
  const made = row.fresh && row.out;

  const putBack = (field: OverrideField) =>
    own.includes(field) ? (
      <TextButton onClick={() => onOverride(field, undefined)} className="text-[10px]">
        batch
      </TextButton>
    ) : null;

  return (
    <li className="border-hairline-faint border-b last:border-b-0">
      <div className="flex h-16 items-center gap-3">
        <span className="flex min-w-0 flex-1 items-center gap-3">
          {made ? (
            <Thumb blob={row.out!.blob} />
          ) : (
            <span className="border-hairline rounded-xs size-10 shrink-0 border border-dashed" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span
              className={cn("text-small block truncate font-mono tracking-normal", made ? "text-ink" : "text-label")}
              title={row.name}
            >
              {row.name}
            </span>
            <span
              className={cn(
                "text-meta text-micro block truncate font-mono",
                row.status === "error" ? "normal-case tracking-normal" : "uppercase",
              )}
            >
              {statusLine(row, format)}
              {own.length > 0 ? <span className="text-indigo"> · own settings</span> : null}
            </span>
          </span>
        </span>

        {made ? (
          <span className="flex shrink-0 flex-col items-end">
            <span
              className={cn("text-small font-mono tabular-nums tracking-normal", size < row.file.size ? "text-indigo" : "text-ink")}
            >
              {delta(row.file.size, size)}
            </span>
            <span className="text-meta text-micro font-mono tabular-nums tracking-normal">{bytes(size)}</span>
          </span>
        ) : null}

        <span className="flex shrink-0 items-center gap-3">
          <IconButton
            label="this file's settings"
            onClick={onToggle}
            aria-expanded={open}
            className={cn(open && "text-ink")}
          >
            <FiSliders className="size-4" />
          </IconButton>
          <IconButton
            label={`download ${row.name}`}
            circle
            onClick={() => row.out && download(row.out.blob, row.name)}
            disabled={!made}
            className={cn(made && "border-edge text-ink")}
          >
            <FiDownload className="size-3.5" />
          </IconButton>
        </span>
      </div>

      {open ? (
        <div className="border-hairline-faint mb-4 ml-5 flex flex-col gap-5 border-l pl-4">
          {/* Not a <Field>: that is a <label>, and a label full of buttons fires the first one when its text is clicked. */}
          <div className="flex flex-col gap-2">
            <span className="flex min-h-4 items-center justify-between gap-2">
              <span
                className={cn(
                  "text-micro font-mono uppercase transition-colors duration-200",
                  own.includes("format") ? "text-indigo" : "text-meta",
                )}
              >
                format
              </span>
              {putBack("format")}
            </span>
            <Segmented
              value={resolved.format}
              onChange={(f: OutputFormat) => onOverride("format", f)}
              options={formatOptions}
              className="flex-wrap gap-y-3"
            />
          </div>
          <QualityField
            value={resolved.quality}
            format={resolved.format}
            onChange={(q) => onOverride("quality", q)}
            changed={own.includes("quality")}
            action={putBack("quality")}
          />
          <EdgeField
            value={resolved.maxEdge}
            onChange={(e) => onOverride("maxEdge", e)}
            changed={own.includes("maxEdge")}
            action={putBack("maxEdge")}
          />
          {own.length > 0 ? (
            <TextButton onClick={onReset} className="self-start">
              follow the batch
            </TextButton>
          ) : (
            <p className="text-label text-micro font-sans">
              Following the batch. Change anything here and it applies to this file only.
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}

/* ── shared fields ─────────────────────────────────────────────────────────── */

function metadataNote(batch: BatchSettings): string {
  const meta = formatMeta(batch.format);
  if (!batch.keepExif) return "Every file leaves with no metadata at all — no camera, no date, no location.";
  if (!meta.carriesMetadata)
    return `${meta.label.toUpperCase()} files leave with no metadata at all. Camera info can only be copied into WebP, JPEG and PNG.`;
  return batch.keepLocation
    ? "The original EXIF is copied over, location included. Orientation is reset because the pixels are already upright."
    : "Camera, lens and date are copied over; the GPS location is removed. HEIC, JPEG, PNG and WebP sources only.";
}

function QualityField({
  value,
  format,
  onChange,
  changed,
  action,
}: {
  value: number;
  format: OutputFormat;
  onChange: (v: number) => void;
  changed?: boolean;
  action?: React.ReactNode;
}) {
  const lossy = formatMeta(format).lossy;
  return (
    <Field
      label="quality"
      hint={lossy ? undefined : "png is lossless — quality does nothing here"}
      changed={changed}
      action={action}
    >
      <div className="flex items-center gap-3">
        <Slider min={1} max={100} value={value} onChange={onChange} disabled={!lossy} />
        <span className="text-indigo text-small w-10 shrink-0 text-right font-mono tabular-nums tracking-normal">
          {value}
        </span>
      </div>
    </Field>
  );
}

function EdgeField({
  value,
  onChange,
  changed,
  action,
}: {
  value: number;
  onChange: (v: number) => void;
  changed?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <Field
      label="longest edge"
      hint={value === 0 ? "keeping the original size" : `capped at ${value}px, never enlarged`}
      changed={changed}
      action={action}
    >
      <div className="flex items-center gap-3">
        <Slider min={0} max={8192} step={64} value={value} onChange={onChange} />
        <span className="text-indigo text-small w-10 shrink-0 text-right font-mono tabular-nums tracking-normal">
          {value || "orig"}
        </span>
      </div>
    </Field>
  );
}
