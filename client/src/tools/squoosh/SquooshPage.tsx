import { useEffect, useState } from "react";
import { downloadZip } from "client-zip";
import { FiDownload, FiX } from "react-icons/fi";
import { Dropzone } from "@/components/Dropzone";
import { PageHead, Shell } from "@/components/Shell";
import { Empty, Field, IconButton, Section, Segmented, Slider, Stat, TextButton } from "@/components/ui";
import { useHotkey } from "@/hooks/useHotkey";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/cn";
import { bytes, delta, ms, pad } from "@/lib/format";
import { download } from "@/lib/download";
import { IMAGE_ACCEPT } from "@/lib/codecs";
import { useCodec } from "./useCodec";
import { formatMeta, formats, type Job, type OutputFormat } from "./types";

export function SquooshPage() {
  const { options, setOptions, jobs, addFiles, remove, clear, totals, busy, outputName, preview } = useCodec();
  const toast = useToast();
  const [compare, setCompare] = useState<Job | null>(null);

  const meta = formatMeta(options.format);

  useHotkey("Escape", () => setCompare(null), { enabled: compare !== null, allowInInput: true });

  const downloadAll = async () => {
    const done = jobs.filter((j) => j.status === "done" && j.outBlob);
    if (done.length === 0) return;
    const blob = await downloadZip(done.map((j) => ({ name: outputName(j), input: j.outBlob! }))).blob();
    download(blob, `squooshed-${done.length}.zip`);
    toast(`${done.length} files zipped`);
  };

  return (
    <Shell width="page">
      <PageHead
        title="squoosh"
        note="Compress and convert images. Every codec runs in this browser — no upload, no account, no limit."
        actions={
          jobs.length > 0 ? (
            <>
              <TextButton onClick={downloadAll} disabled={totals.done === 0}>
                download all
              </TextButton>
              <TextButton onClick={clear}>clear</TextButton>
            </>
          ) : null
        }
      />

      <div className="grid gap-10 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-12">
        <aside className="flex flex-col gap-6">
          <Section title="format">
            <Segmented
              value={options.format}
              onChange={(format: OutputFormat) => setOptions({ ...options, format })}
              options={formats.map((f) => ({ value: f.value, label: f.label }))}
              className="flex-wrap"
            />
            {meta.note ? <p className="text-meta font-sans text-label">{meta.note}</p> : null}
          </Section>

          <Section title="settings">
            <div className="flex flex-col gap-5">
              <Field label="quality" hint={meta.lossy ? undefined : "png is lossless — quality does nothing here"}>
                <div className="flex items-center gap-3">
                  <Slider
                    min={1}
                    max={100}
                    value={options.quality}
                    onChange={(quality) => setOptions({ ...options, quality })}
                    className={cn(!meta.lossy && "pointer-events-none opacity-40")}
                  />
                  <span className="text-indigo w-8 shrink-0 text-right font-mono text-label tabular-nums">{options.quality}</span>
                </div>
              </Field>

              <Field label="effort" hint={meta.effortHint}>
                <div className="flex items-center gap-3">
                  <Slider
                    min={0}
                    max={6}
                    value={options.effort}
                    onChange={(effort) => setOptions({ ...options, effort })}
                    className={cn(!meta.effortful && "pointer-events-none opacity-40")}
                  />
                  <span className="text-indigo w-8 shrink-0 text-right font-mono text-label tabular-nums">{options.effort}</span>
                </div>
              </Field>

              <Field label="longest edge" hint={options.maxEdge === 0 ? "keeping original size" : `capped at ${options.maxEdge}px`}>
                <div className="flex items-center gap-3">
                  <Slider min={0} max={4096} step={64} value={options.maxEdge} onChange={(maxEdge) => setOptions({ ...options, maxEdge })} />
                  <span className="text-indigo w-12 shrink-0 text-right font-mono text-label tabular-nums">
                    {options.maxEdge || "orig"}
                  </span>
                </div>
              </Field>
            </div>
          </Section>

          {totals.done > 0 ? (
            <Section title="totals">
              <div className="grid grid-cols-2 gap-4">
                <Stat label="before" value={bytes(totals.before)} />
                <Stat label="after" value={bytes(totals.after)} />
                <Stat label="saved" value={bytes(Math.max(0, totals.saved))} accent />
                <Stat label="change" value={delta(totals.before, totals.after)} accent />
              </div>
            </Section>
          ) : null}
        </aside>

        <div className="flex min-w-0 flex-col gap-6">
          <Dropzone
            onFiles={(files) => {
              const n = addFiles(files);
              if (n === 0) toast("no images in that drop");
            }}
            accept={IMAGE_ACCEPT}
            label="drop images, or choose files"
            hint="jpeg · png · webp · avif · gif · heic"
          />

          <Section
            title="queue"
            aside={
              <span className="text-meta font-mono text-meta uppercase">
                {busy ? "working" : `${pad(totals.done)} / ${pad(totals.total)}`}
              </span>
            }
          >
            {jobs.length === 0 ? (
              <Empty>nothing queued yet</Empty>
            ) : (
              <ul className="flex flex-col">
                {jobs.map((job, i) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    index={i}
                    name={outputName(job)}
                    onRemove={() => remove(job.id)}
                    onCompare={() => setCompare(job)}
                    onDownload={() => job.outBlob && download(job.outBlob, outputName(job))}
                  />
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {compare ? <Compare job={compare} name={outputName(compare)} onClose={() => setCompare(null)} preview={preview} /> : null}
    </Shell>
  );
}

function JobRow({
  job,
  index,
  name,
  onRemove,
  onCompare,
  onDownload,
}: {
  job: Job;
  index: number;
  name: string;
  onRemove: () => void;
  onCompare: () => void;
  onDownload: () => void;
}) {
  const done = job.status === "done";

  return (
    <li className="border-wash flex items-center gap-4 border-b py-3 last:border-b-0">
      <span className="text-meta w-6 shrink-0 font-mono text-meta tabular-nums tracking-[0.14em]">{pad(index + 1)}</span>

      <button
        type="button"
        onClick={onCompare}
        disabled={!done}
        className="group min-w-0 flex-1 cursor-pointer text-left disabled:cursor-default"
      >
        <span className="text-ink group-hover:text-indigo block truncate font-mono text-label tracking-normal transition-colors duration-200">
          {name}
        </span>
        <span className="text-meta font-mono text-meta uppercase">
          {job.status === "error"
            ? job.error
            : done
              ? `${job.outWidth}×${job.outHeight} · ${ms(job.elapsedMs)}`
              : job.status}
        </span>
      </button>

      <span className="hidden shrink-0 items-baseline gap-2 font-mono text-label tabular-nums sm:flex">
        <span className="text-meta">{bytes(job.file.size)}</span>
        <span className="text-meta">→</span>
        <span className="text-ink">{done ? bytes(job.outSize) : "—"}</span>
      </span>

      <span
        className={cn(
          "w-14 shrink-0 text-right font-mono text-label tabular-nums",
          done && job.outSize < job.file.size ? "text-indigo" : "text-meta",
        )}
      >
        {done ? delta(job.file.size, job.outSize) : ""}
      </span>

      <span className="flex shrink-0 items-center gap-3">
        <IconButton label="download" onClick={onDownload} disabled={!done}>
          <FiDownload className="size-4" />
        </IconButton>
        <IconButton label="remove" onClick={onRemove}>
          <FiX className="size-4" />
        </IconButton>
      </span>
    </li>
  );
}

/** Before/after lightbox. Hold space, or use the toggle, to flip back to the original. */
function Compare({
  job,
  name,
  onClose,
  preview,
}: {
  job: Job;
  name: string;
  onClose: () => void;
  preview: (file: File) => Promise<Blob>;
}) {
  const [showing, setShowing] = useState<"after" | "before">("after");
  // The original as-is, until the browser refuses it (HEIC outside Safari); then a decoded copy.
  const [beforeBlob, setBeforeBlob] = useState<Blob>(job.file);

  const beforeUrl = useObjectUrl(beforeBlob);
  const afterUrl = useObjectUrl(job.outBlob);

  const onImageError = () => {
    if (showing !== "before" || beforeBlob !== job.file) return;
    preview(job.file).then(setBeforeBlob, () => undefined);
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => e.code === "Space" && (e.preventDefault(), setShowing("before"));
    const up = (e: KeyboardEvent) => e.code === "Space" && setShowing("after");
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-60 flex flex-col items-center justify-center gap-4 px-[5vw] py-[6vh]"
      style={{ background: "var(--scrim)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`compare ${name}`}
    >
      <img
        src={(showing === "after" ? afterUrl : beforeUrl) ?? undefined}
        alt={name}
        className="checkers max-h-full max-w-full rounded-md object-contain"
        style={{ boxShadow: "var(--shadow-lightbox)" }}
        onClick={(e) => e.stopPropagation()}
        onError={onImageError}
      />
      <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
        <Segmented
          value={showing}
          onChange={setShowing}
          options={[
            { value: "before", label: `before ${bytes(job.file.size)}` },
            { value: "after", label: `after ${bytes(job.outSize)}` },
          ]}
        />
        <span className="text-meta font-mono text-meta uppercase">hold space</span>
        <TextButton onClick={onClose}>esc</TextButton>
      </div>
    </div>
  );
}
