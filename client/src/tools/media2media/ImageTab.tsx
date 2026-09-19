import { useState } from "react";
import { downloadZip } from "client-zip";
import { FiDownload, FiSliders, FiX } from "react-icons/fi";
import { Dropzone } from "@/components/Dropzone";
import {
  Button,
  Empty,
  Field,
  IconButton,
  Section,
  Sections,
  Segmented,
  Slider,
  Stat,
  TextButton,
  Toggle,
} from "@/components/ui";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/cn";
import { IMAGE_ACCEPT, formatMeta, formats, type OutputFormat } from "@/lib/codecs";
import { download } from "@/lib/download";
import { bytes, delta, ms, pad } from "@/lib/format";
import { overriddenFields, resolveOptions, type BatchSettings, type OverrideField } from "./batch";
import { useImageBatch, type ImageRow } from "./useImageBatch";

const formatOptions = formats.map((f) => ({ value: f.value, label: f.label }));

/**
 * Batch conversion: drop a camera roll, pick one format for all of it,
 * convert across the codec workers, take the lot as a zip. Any one file can
 * carry its own format, quality or size on top of the batch.
 */
export function ImageTab() {
  const b = useImageBatch();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const { batch, totals } = b;
  const meta = formatMeta(batch.format);
  const set = (next: Partial<BatchSettings>) => b.setBatch({ ...batch, ...next });

  const busy = totals.running > 0;
  const doneShare = totals.total > 0 ? totals.fresh / totals.total : 0;

  const downloadAll = async () => {
    const ready = b.rows.filter((r) => r.fresh && r.out);
    if (ready.length === 0) return;
    const blob = await downloadZip(
      ready.map((r) => ({ name: r.name, input: r.out!.blob, lastModified: new Date(r.file.lastModified) })),
    ).blob();
    download(blob, `images-${ready.length}.zip`);
    toast(`${ready.length} files zipped`);
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-12">
      <aside>
        <Sections>
          <Section title="format">
            <Segmented
              value={batch.format}
              onChange={(format: OutputFormat) => set({ format })}
              options={formatOptions}
              className="flex-wrap gap-y-3"
            />
            {meta.note ? <p className="text-meta text-label font-sans">{meta.note}</p> : null}
          </Section>

          <Section title="settings">
            <QualityField value={batch.quality} format={batch.format} onChange={(quality) => set({ quality })} />
            <EdgeField value={batch.maxEdge} onChange={(maxEdge) => set({ maxEdge })} />
          </Section>

          <Section title="metadata">
            <Toggle checked={batch.keepExif} onChange={(keepExif) => set({ keepExif })} label="keep camera info" />
            {/* A disabled fieldset disables the switch inside it, keyboard included. */}
            <fieldset disabled={!batch.keepExif} className="min-w-0 disabled:opacity-40 [&:disabled_*]:cursor-not-allowed">
              <Toggle
                checked={batch.keepLocation}
                onChange={(keepLocation) => set({ keepLocation })}
                label="keep location"
              />
            </fieldset>
            <p className="text-meta text-label font-sans">{metadataNote(batch)}</p>
          </Section>

          {totals.fresh > 0 ? (
            <Section title="totals">
              <div className="grid grid-cols-2 gap-4">
                <Stat label="before" value={bytes(totals.before)} />
                <Stat label="after" value={bytes(totals.after)} />
                <Stat label="saved" value={bytes(Math.max(0, totals.before - totals.after))} accent />
                <Stat label="change" value={delta(totals.before, totals.after)} accent />
              </div>
            </Section>
          ) : null}
        </Sections>
      </aside>

      <div className="flex min-w-0 flex-col gap-6">
        <Dropzone
          onFiles={(files) => {
            if (b.addFiles(files) === 0) toast("no images in that drop");
          }}
          accept={IMAGE_ACCEPT}
          label="drop photos, or choose files"
          hint="heic · jpeg · png · webp · avif · gif (first frame)"
        />

        <Section
          title="files"
          aside={
            <span className="text-meta text-meta font-mono uppercase tabular-nums">
              {pad(totals.fresh)} / {pad(totals.total)}
            </span>
          }
        >
          {b.rows.length === 0 ? (
            <Empty>nothing here yet</Empty>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                {busy ? (
                  <Button onClick={b.stop}>stop</Button>
                ) : totals.pending > 0 ? (
                  <Button onClick={b.convert}>convert {pad(totals.pending)}</Button>
                ) : (
                  <Button onClick={downloadAll}>
                    <FiDownload className="size-3.5" /> download zip
                  </Button>
                )}
                {totals.pending > 0 || busy ? (
                  <Button variant="outline" onClick={downloadAll} disabled={totals.fresh === 0}>
                    zip {pad(totals.fresh)} ready
                  </Button>
                ) : null}
                <TextButton onClick={b.clear} className="ml-auto">
                  clear
                </TextButton>
              </div>

              <div
                role="progressbar"
                aria-label="files converted"
                aria-valuemin={0}
                aria-valuemax={totals.total}
                aria-valuenow={totals.fresh}
                className="bg-wash relative h-0.5 w-full overflow-hidden rounded-full"
              >
                <div
                  className="bg-indigo absolute inset-y-0 left-0 transition-[width] duration-200"
                  style={{ width: `${doneShare * 100}%` }}
                />
              </div>

              <ul className="flex flex-col">
                {b.rows.map((row) => (
                  <FileRow
                    key={row.id}
                    row={row}
                    batch={batch}
                    open={open === row.id}
                    onToggle={() => setOpen((o) => (o === row.id ? null : row.id))}
                    onRemove={() => b.remove(row.id)}
                    onOverride={(field, value) => b.setOverride(row.id, field, value)}
                    onReset={() => b.resetOverride(row.id)}
                  />
                ))}
              </ul>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

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
        <Slider
          min={1}
          max={100}
          value={value}
          onChange={onChange}
          disabled={!lossy}
        />
        <span className="text-indigo text-label w-10 shrink-0 text-right font-mono tabular-nums tracking-normal">{value}</span>
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
        <span className="text-indigo text-label w-10 shrink-0 text-right font-mono tabular-nums tracking-normal">
          {value || "orig"}
        </span>
      </div>
    </Field>
  );
}

function statusLine(row: ImageRow): string {
  if (row.status === "error") return row.error ?? "failed";
  if (row.status === "queued") return "queued";
  if (row.status === "working") return "converting";
  if (row.fresh && row.out) {
    const m = row.out.metadata;
    const exif = m.exif ? (m.location ? "exif + location" : "exif, no location") : "no metadata";
    return `${row.out.width}×${row.out.height} · ${ms(row.out.elapsedMs)} · ${exif}`;
  }
  if (row.out) return "settings changed — convert again";
  return "ready";
}

function FileRow({
  row,
  batch,
  open,
  onToggle,
  onRemove,
  onOverride,
  onReset,
}: {
  row: ImageRow;
  batch: BatchSettings;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onOverride: <K extends OverrideField>(field: K, value: BatchSettings[K] | undefined) => void;
  onReset: () => void;
}) {
  const resolved = resolveOptions(batch, row.override);
  const own = overriddenFields(row.override);
  const size = row.out?.blob.size ?? 0;
  const thumb = useObjectUrl(row.fresh ? (row.out?.blob ?? null) : null);

  const putBack = (field: OverrideField) =>
    own.includes(field) ? (
      <TextButton onClick={() => onOverride(field, undefined)} className="text-[10px]">
        batch
      </TextButton>
    ) : null;

  return (
    <li className="border-wash border-b last:border-b-0">
      <div className="flex items-center gap-4 py-3">
        <span className="text-meta text-meta w-6 shrink-0 font-mono tabular-nums tracking-[0.14em]">
          {pad(row.index + 1)}
        </span>

        <span className="checkers bg-surface rounded-xs size-9 shrink-0 overflow-hidden">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              className="size-full object-cover"
              loading="lazy"
              decoding="async"
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
          ) : null}
        </span>

        <div className="min-w-0 flex-1">
          <span className="text-ink text-label block truncate font-mono tracking-normal" title={row.file.name}>
            {row.name}
          </span>
          <span
            className={cn(
              "text-meta block truncate font-mono",
              row.status === "error" ? "text-meta normal-case tracking-normal" : "text-meta uppercase",
            )}
          >
            {statusLine(row)}
            {own.length > 0 ? <span className="text-indigo"> · own settings</span> : null}
          </span>
        </div>

        <span className="text-label hidden shrink-0 items-baseline gap-2 font-mono tabular-nums sm:flex">
          <span className="text-meta">{bytes(row.file.size)}</span>
          <span className="text-meta">→</span>
          <span className={row.fresh ? "text-ink" : "text-meta"}>{row.out ? bytes(size) : "—"}</span>
        </span>

        <span
          className={cn(
            "text-label w-12 shrink-0 text-right font-mono tabular-nums",
            row.fresh && size < row.file.size ? "text-indigo" : "text-meta",
          )}
        >
          {row.fresh ? delta(row.file.size, size) : ""}
        </span>

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
            label="download"
            onClick={() => row.out && download(row.out.blob, row.name)}
            disabled={!row.fresh}
          >
            <FiDownload className="size-4" />
          </IconButton>
          <IconButton label="remove" onClick={onRemove}>
            <FiX className="size-4" />
          </IconButton>
        </span>
      </div>

      {open ? (
        <div className="border-hairline-faint mb-4 ml-10 flex flex-col gap-5 border-l pl-5">
          {/* Not a <Field>: that is a <label>, and a label full of buttons fires the first one when its text is clicked. */}
          <div className="flex flex-col gap-2">
            <span className="flex min-h-4 items-center justify-between gap-2">
              <span
                className={cn(
                  "text-meta font-mono uppercase transition-colors duration-200",
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
            {formatMeta(resolved.format).note ? (
              <p className="text-meta text-label font-sans">{formatMeta(resolved.format).note}</p>
            ) : null}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
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
          </div>
          {own.length > 0 ? (
            <TextButton onClick={onReset} className="self-start">
              follow the batch
            </TextButton>
          ) : (
            <p className="text-meta text-label font-sans">
              Following the batch. Change anything here and it applies to this file only.
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}
