import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  defaultCompressParams,
  type CompressParams,
  type ImageOverride,
  type JobInfo,
  type PdfAnalysis,
} from "@tools/shared";
import { Dropzone } from "@/components/Dropzone";
import { QueueNotice } from "@/components/QueueNotice";
import { RetentionNote } from "@/components/RetentionNote";
import { Empty, Section, TextButton } from "@/components/ui";
import { UploadProgress } from "@/components/UploadProgress";
import { useJob } from "@/hooks/useJob";
import { useToast } from "@/hooks/useToast";
import { useUpload } from "@/hooks/useUpload";
import { bytes } from "@/lib/format";
import { asAnalysis, pdfaName } from "./analysis";
import { CropPanel } from "./CropPanel";
import { FontTable } from "./FontTable";
import { ImageTable } from "./ImageTable";
import { cropParams, describeOverride, type Box } from "./overrides";
import { RunResults } from "./RunResults";
import { describeParams, RunPanel } from "./RunPanel";
import { SignatureDialog, UnlockPrompt } from "./SpecialInputs";
import { SizeBreakdown } from "./SizeBreakdown";
import { useCrop } from "./useCrop";

/**
 * The open job's id, per tab. A reload re-attaches to it while the server still
 * has it (an hour past the last action); sessionStorage rather than the address
 * so a copied link never hands someone else the file.
 */
const STORE = "tools.pdfcompress.job";

const stored = (): string | null => {
  try {
    return sessionStorage.getItem(STORE);
  } catch {
    return null;
  }
};
const remember = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(STORE, id);
    else sessionStorage.removeItem(STORE);
  } catch {
    // Storage blocked: the page still works, it just forgets on reload.
  }
};

/**
 * Each run's settings in one line, by task id. The queue keeps a task's params
 * to itself, so this tab remembers what it asked for; after a reload in another
 * tab the history falls back to run numbers.
 */
const RUNS = "tools.pdfcompress.runs";

const storedLabels = (): Record<string, string> => {
  try {
    return JSON.parse(sessionStorage.getItem(RUNS) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
};
const rememberLabels = (labels: Record<string, string> | null) => {
  try {
    if (labels) sessionStorage.setItem(RUNS, JSON.stringify(labels));
    else sessionStorage.removeItem(RUNS);
  } catch {
    // As above: only the history's labels are lost.
  }
};

const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/**
 * The compress page's state owner: one PDF, dropped or picked, goes up with
 * progress, becomes a job, and the job's `analyse` task runs on the worker
 * while the queue notice says where it stands. Then the analysis — where the
 * bytes go, every image and every font — with the settings column (#9) beside
 * it. The retention note and discard stay visible from the moment the server
 * holds anything. Only mounted while the api answers.
 */
export function CompressWorkbench() {
  const upload = useUpload();
  const job = useJob();
  const toast = useToast();
  const [restoring, setRestoring] = useState(() => stored() !== null);
  const [creating, setCreating] = useState(false);

  // Re-attach to this tab's job after a reload. `attach` reports a vanished job as `expired`.
  useEffect(() => {
    const id = stored();
    if (!id) return;
    void job.attach(id).finally(() => setRestoring(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  useEffect(() => {
    if (job.expired) {
      remember(null);
      rememberLabels(null);
    }
  }, [job.expired]);

  const open = useCallback(
    async (uploadId: string) => {
      setCreating(true);
      const created = await job.createJob({ tool: "compress", uploads: [uploadId] });
      setCreating(false);
      if (created) {
        remember(created.id);
        rememberLabels(null);
      }
    },
    [job],
  );

  const pick = useCallback(
    async (files: File[]) => {
      const file = files.find(isPdf);
      if (!file) return toast(files.length === 1 ? `${files[0]!.name} is not a pdf` : "none of those is a pdf");
      if (files.length > 1) toast("one pdf at a time — took the first");
      const done = await upload.start(file);
      if (done) await open(done.id);
    },
    [upload, open, toast],
  );

  const discard = useCallback(async () => {
    if (!(await job.discard())) return;
    remember(null);
    rememberLabels(null);
    upload.reset();
  }, [job, upload]);

  const info = job.job;

  if (restoring) {
    return (
      <Frame>
        <Empty>reopening your file…</Empty>
      </Frame>
    );
  }

  if (info) return <Opened info={info} job={job} onDiscard={discard} />;

  // Nothing on a job yet: the drop target, or the upload and job creation in flight.
  if (upload.state.phase === "idle") {
    return (
      <div className="flex flex-col gap-4">
        {job.expired ? (
          <p className="text-meta text-body font-sans normal-case">
            That file's hour ran out, so the server has deleted it. Drop it again to start over.
          </p>
        ) : job.error ? (
          <p className="text-meta text-body font-sans normal-case">{job.error}</p>
        ) : null}
        <Dropzone
          onFiles={pick}
          accept="application/pdf,.pdf"
          multiple={false}
          cta="choose a pdf"
          label="or drop one here"
          hint="up to 1 GB"
          className="min-h-64"
        />
      </div>
    );
  }

  const uploaded = upload.state.phase === "done" ? upload.state.result : null;
  return (
    <Frame>
      <div className="flex w-full max-w-xl flex-col gap-5">
        <UploadProgress
          state={upload.state}
          onCancel={upload.cancel}
          onRetry={async () => {
            const done = await upload.retry();
            if (done) await open(done.id);
          }}
        />
        {uploaded ? (
          creating ? (
            <Empty>opening a job…</Empty>
          ) : job.error ? (
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-meta text-body font-sans normal-case">{job.error}</p>
              <TextButton onClick={() => open(uploaded.id)}>try again</TextButton>
            </div>
          ) : null
        ) : null}
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-meta text-body font-sans normal-case">Files are deleted an hour after your last action.</p>
          {upload.state.phase === "failed" || (uploaded && !creating) ? (
            <TextButton onClick={upload.reset}>choose another file</TextButton>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}

/**
 * The job is on the server: its file, the analyse task until it lands, then
 * the analysis with the settings beside it. Each RUN adds a compress task to
 * the same job, so trying other settings needs no new upload; the runs appear
 * above the analysis, newest shown in full.
 */
function Opened({ info, job, onDiscard }: { info: JobInfo; job: ReturnType<typeof useJob>; onDiscard: () => unknown }) {
  const input = info.inputs[0];
  const analysis = asAnalysis(info.analysis);
  // An encrypted file's first analysis is a placeholder until its password is given (#15).
  const locked = analysis?.locked === true;
  const readable = locked ? null : analysis;
  // The newest, because an unlock queues a second analysis after the locked one.
  const analyse = [...info.tasks].reverse().find((t) => t.kind === "analyse") ?? null;
  const reading = analyse?.state === "queued" || analyse?.state === "running";
  const runs = info.tasks.filter((t) => t.kind === "compress");
  // Anything the queue is doing for this job — the analysis, a run, a crop. One task at a time per caller.
  const busy = job.activeTask !== null;
  const [labels, setLabels] = useState(storedLabels);
  const [picked, setPicked] = useState<string | null>(null);
  const shown = runs.find((t) => t.id === picked) ?? runs[runs.length - 1] ?? null;
  // A signed file's run waits here for the dialog's confirmation.
  const [confirming, setConfirming] = useState<CompressParams | null>(null);

  // The settings column's params as they stand, and the per-image overrides laid over them at RUN (#10).
  const [settings, setSettings] = useState<CompressParams>(() => defaultCompressParams());
  const [overrides, setOverrides] = useState<Record<string, ImageOverride>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<Record<string, Box | null>>({});
  const held = useHeld();

  const image = (selected && readable?.images.find((i) => i.id === selected)) || null;
  const crop = useCrop({
    jobId: info.id,
    tasks: info.tasks,
    params:
      image && !overrides[image.id]?.skip
        ? cropParams({ ...settings, overrides }, image.id, boxes[image.id] ?? null)
        : null,
    busy,
    held: held.on,
  });

  const override = (id: string, o: ImageOverride | null) =>
    setOverrides((all) => {
      const next = { ...all };
      if (o) next[id] = o;
      else delete next[id];
      return next;
    });

  const send = useCallback(
    async (panel: CompressParams) => {
      const params = { ...panel, overrides };
      const task = await job.addTask({ kind: "compress", params });
      if (!task) return;
      setPicked(null);
      setLabels((l) => {
        const next = { ...l, [task.id]: describeParams(params) };
        rememberLabels(next);
        return next;
      });
    },
    [job, overrides],
  );

  const run = useCallback(
    (params: CompressParams) => {
      if (readable?.flags?.signed) setConfirming(params);
      else void send(params);
    },
    [readable, send],
  );

  const imageTable = readable ? (
    <ImageTable
      images={readable.images}
      total={readable.bytes}
      selected={selected}
      onSelect={(id) => setSelected((s) => (s === id ? null : id))}
      overrideLabel="override"
      override={(i) => {
        const text = describeOverride(overrides[i.id]);
        return text ? (
          <span className="text-ink">{text}</span>
        ) : (
          <span className="text-meta" aria-label="follows the run">
            —
          </span>
        );
      }}
      detail={(i) => (
        <CropPanel
          jobId={info.id}
          image={i}
          params={settings}
          override={overrides[i.id]}
          onOverride={(o) => override(i.id, o)}
          box={boxes[i.id] ?? null}
          onBox={(box) => setBoxes((b) => ({ ...b, [i.id]: box }))}
          crop={crop}
          onCommitStart={held.hold}
          onClose={() => setSelected(null)}
        />
      )}
    />
  ) : null;

  return (
    <div className="flex flex-col gap-10">
      <header className="border-hairline-faint flex flex-col gap-3 border-b pb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <span className="text-ink text-title min-w-0 truncate font-mono tracking-normal" title={input?.name}>
            {input?.name ?? "document.pdf"}
          </span>
          <Facts analysis={analysis} size={input?.size ?? null} />
        </div>
        <RetentionNote onDiscard={onDiscard} />
        {job.error ? <p className="text-meta text-body font-sans normal-case">{job.error}</p> : null}
      </header>

      <div className="grid items-start gap-10 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-12">
        <aside className="order-last lg:sticky lg:top-20 lg:order-none lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-1">
          <RunPanel analysis={readable} busy={busy} onRun={run} onChange={setSettings} onCommitStart={held.hold} />
        </aside>

        <div className="flex min-w-0 flex-col gap-10">
          {readable && shown ? (
            <RunResults jobId={info.id} runs={runs} labels={labels} input={readable} shown={shown} onShow={setPicked} />
          ) : null}
          {readable ? (
            <Analysis analysis={readable} images={imageTable} />
          ) : locked && !reading && analyse?.state !== "failed" ? (
            <UnlockPrompt onUnlock={job.unlock} />
          ) : analyse ? (
            <Section title="analysis">
              <QueueNotice task={analyse} />
              {analyse.state === "failed" ? (
                <p className="text-meta text-body font-sans normal-case">
                  Nothing was changed. Discard this file and try another, or the same one again later.
                </p>
              ) : null}
            </Section>
          ) : (
            <Section title="analysis">
              <Empty>waiting for the queue…</Empty>
            </Section>
          )}
        </div>
      </div>

      {confirming ? (
        <SignatureDialog
          signers={readable?.flags?.signed ?? []}
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            const params = confirming;
            setConfirming(null);
            void send({ ...params, acceptSignatureLoss: true });
          }}
        />
      ) : null}
    </div>
  );
}

/** `12.4 MB · 214 pages · PDF 1.7 · PDF/A-2b · tagged` — the size is known from the upload before the analysis lands. */
function Facts({ analysis, size }: { analysis: PdfAnalysis | null; size: number | null }) {
  const parts = [
    bytes(analysis?.bytes ?? size ?? NaN),
    analysis && !analysis.locked ? `${analysis.pages} ${analysis.pages === 1 ? "page" : "pages"}` : null,
    analysis?.version ? `PDF ${analysis.version}` : null,
    analysis?.flags?.pdfa ? pdfaName(analysis.flags.pdfa) : null,
    analysis?.flags?.tagged ? "tagged" : null,
    analysis?.flags?.encrypted ? "encrypted" : null,
  ].filter(Boolean);
  return <span className="text-label text-label font-mono tabular-nums tracking-normal">{parts.join(" · ")}</span>;
}

/** What the file is carrying, in the order the eye asks: where the bytes go, then the images, then the fonts. */
function Analysis({ analysis, images }: { analysis: PdfAnalysis; images: ReactNode }) {
  const notes = flagNotes(analysis);
  return (
    <>
      {analysis.truncated || notes.length ? (
        <div className="border-edge rounded-xs flex flex-col gap-1.5 border px-4 py-3">
          {analysis.truncated ? (
            <p className="text-ink text-body font-sans normal-case">
              The analysis stopped early — this file is larger than one pass reads, so the figures below cover only part
              of it.
            </p>
          ) : null}
          {notes.map((n) => (
            <p key={n} className="text-prose text-body font-sans normal-case">
              {n}
            </p>
          ))}
        </div>
      ) : null}

      <Section title="where the bytes go">
        <SizeBreakdown analysis={analysis} />
      </Section>

      <Section title={`images · ${analysis.images.length}`}>{images}</Section>

      <Section title={`fonts · ${analysis.fonts.length}`}>
        <FontTable fonts={analysis.fonts} />
      </Section>
    </>
  );
}

/**
 * The flags #15 fills in that change what compressing will do, as sentences.
 * PDF/A and tagging are facts about the file, not cautions, so they sit in the
 * header line instead; the run column warns when a setting would break them.
 */
function flagNotes({ flags }: PdfAnalysis): string[] {
  if (!flags) return [];
  const notes: string[] = [];
  if (flags.encrypted)
    notes.push("Encrypted — opened with the password you gave. The output has no password unless you keep it.");
  if (flags.signed?.length)
    notes.push(`Signed by ${flags.signed.join(", ")} — compressing it changes the bytes the signature covers.`);
  else if (flags.signed)
    notes.push("This file carries a digital signature. Compressing it changes the bytes it covers.");
  if (flags.repaired > 0)
    notes.push(
      `Repaired ${flags.repaired} broken ${flags.repaired === 1 ? "object" : "objects"}. The output is written from the repaired file.`,
    );
  return notes;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="border-wash rounded-card flex min-h-64 items-center justify-center border px-6 py-10">
      {children}
    </div>
  );
}

/**
 * Whether a slider is being dragged. `hold` is the sliders' `onCommitStart`;
 * the hold lasts until the pointer or key is let go anywhere on the page, so
 * the before/after crop is asked for once, on release, not once a frame.
 */
function useHeld() {
  const [on, setOn] = useState(false);
  const hold = useCallback(() => {
    setOn(true);
    const release = () => {
      setOn(false);
      for (const type of ["pointerup", "pointercancel", "keyup"] as const) window.removeEventListener(type, release);
    };
    for (const type of ["pointerup", "pointercancel", "keyup"] as const) window.addEventListener(type, release);
  }, []);
  return { on, hold };
}
