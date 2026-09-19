import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronDown, FiPlus } from "react-icons/fi";
import {
  DEFAULT_ENGINE,
  DEFAULT_MERGE_OUTPUT,
  ENGINES,
  type EngineId,
  type JobInfo,
  type MergeOutput,
  type MergeParams,
} from "@tools/shared";
import { Dropzone } from "@/components/Dropzone";
import { EnginePicker } from "@/components/pdf/EnginePicker";
import { Button, Empty, Section, Sections, TextButton, Toggle } from "@/components/ui";
import { useJob } from "@/hooks/useJob";
import { useToast } from "@/hooks/useToast";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { bytes, pad } from "@/lib/format";
import { pdfJobs } from "@/lib/pdfjobs";
import { FileList } from "./FileList";
import { latestMerge, MergeRun } from "./MergeRun";
import { OutputOptions } from "./OutputOptions";
import { PageOptions } from "./PageOptions";
import { PagePreview } from "./PagePreview";
import { ACCEPT, defaultTitle, mergeParams, useMergeFiles } from "./useMergeFiles";

const FORMATS = "pdf · jpg · png · webp · avif · gif · heic · tiff";

/**
 * The open merge job's id, per tab. A reload re-attaches to it while the
 * server still has it, to show the merge and its download; the file list
 * itself lives in the page and does not survive. sessionStorage rather than
 * the address so a copied link never hands someone else the files.
 */
const STORE = "tools.pdfmerge.job";

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
 * Hands a job to the Compress page (#18): its own re-attach key, which it reads
 * on mount, and its run labels cleared since they belonged to whatever job it
 * had before. Mirrors `remember`/`rememberLabels` in CompressWorkbench.
 */
const COMPRESS_STORE = "tools.pdfcompress.job";
const COMPRESS_RUNS = "tools.pdfcompress.runs";
const rememberForCompress = (id: string) => {
  try {
    sessionStorage.setItem(COMPRESS_STORE, id);
    sessionStorage.removeItem(COMPRESS_RUNS);
    return true;
  } catch {
    return false;
  }
};

const sameSet = (a: string[], b: string[]) => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};

/**
 * Files on the left in the order they will be joined, the selected one's page
 * options and the output options under them, and that page drawn on the right
 * above the merge button and, once asked for, the merge itself. Only mounted
 * while the api answers, since every file starts uploading as soon as it is
 * added.
 *
 * Merging opens a job over the list's uploads and adds a `merge` task to it.
 * Merging again with the same files reuses the job; with a different set it
 * opens a new one and leaves the old to run out its hour, because discarding
 * it would delete uploads the list still points at.
 */
export function MergeWorkbench() {
  const files = useMergeFiles();
  const job = useJob();
  const toast = useToast();
  const navigate = useNavigate();
  const picker = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [output, setOutput] = useState<MergeOutput>(DEFAULT_MERGE_OUTPUT);
  const [restoring, setRestoring] = useState(() => stored() !== null);
  const [starting, setStarting] = useState(false);
  const [engine, setEngine] = useState<EngineId>(DEFAULT_ENGINE);
  const [compressAfter, setCompressAfter] = useState(false);
  // The merge task being handed to Compress, and why the last hand-off was refused.
  const [handing, setHanding] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  // Merges asked for with "compress on export" on: each goes to Compress the moment it is done.
  const onward = useRef(new Set<string>());
  // What each task of this page's asked for, to tell when the list has moved on since. Lost on reload, which reads as stale.
  const asked = useRef(new Map<string, string>());

  // Re-attach to this tab's job after a reload. `attach` reports a vanished job as `expired`.
  useEffect(() => {
    const id = stored();
    if (!id) return;
    void job.attach(id).finally(() => setRestoring(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  useEffect(() => {
    if (job.expired) remember(null);
  }, [job.expired]);

  const add = useCallback(
    (list: File[]) => {
      const { added, refused } = files.add(list);
      if (refused.length) toast(refused.length === 1 ? `${refused[0]} is not a pdf or an image` : `${refused.length} files skipped — not pdfs or images`);
      if (added[0]) setSelected((s) => s ?? added[0]!);
    },
    [files, toast],
  );

  const { entries } = files;
  const index = entries.findIndex((e) => e.key === selected);
  const entry = index >= 0 ? entries[index]! : null;
  const params = mergeParams(entries, output, engine);
  const task = latestMerge(job.job);
  const busy = starting || job.activeTask !== null;
  // The shown merge was asked for with exactly what the page holds now.
  const current = task !== null && asked.current.get(task.id) === JSON.stringify(params);
  const stopped = entries.filter((e) => e.upload.phase === "failed").length;
  const waiting = entries.filter((e) => e.upload.phase === "queued" || e.upload.phase === "uploading").length;
  const images = entries.filter((e) => e.kind !== "pdf").length;

  const remove = (key: string) => {
    if (key === selected) {
      const at = entries.findIndex((e) => e.key === key);
      setSelected(entries[at + 1]?.key ?? entries[at - 1]?.key ?? null);
    }
    files.remove(key);
  };

  /**
   * Opens the finished merge in Compress: the server turns its output into a
   * new compress job's upload and queues the analysis, and the Compress page
   * re-attaches to that job on mount as it would after a reload. A refusal is
   * shown under the merge as the server worded it, and the page stays put.
   */
  const compress = async (taskId: string) => {
    const id = job.job?.id;
    if (!id || handing) return;
    setHanding(taskId);
    setHandoffError(null);
    try {
      const next = await pdfJobs.handoff(id, taskId);
      if (!rememberForCompress(next.id)) {
        setHandoffError("This browser won't let the page remember the job, so Compress can't pick it up. Download the file and drop it there instead.");
        return;
      }
      navigate("/pdf-compress");
    } catch (error) {
      setHandoffError(error instanceof ApiError ? error.message : "The API could not be reached. Try again in a moment.");
    } finally {
      setHanding(null);
    }
  };

  // With "compress on export" on, a merge this page asked for goes straight on to Compress once it is done.
  useEffect(() => {
    if (!task || !onward.current.has(task.id)) return;
    if (task.state === "done") {
      onward.current.delete(task.id);
      void compress(task.id);
    } else if (task.state === "failed") onward.current.delete(task.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on the task's state, not on `compress`'s identity
  }, [task?.id, task?.state]);

  const merge = async (request: MergeParams) => {
    setStarting(true);
    setHandoffError(null);
    try {
      const uploads = [...new Set(request.items.map((i) => i.upload))];
      let open: JobInfo | null = job.job;
      if (!open || !sameSet(open.inputs.map((i) => i.id), uploads)) {
        open = await job.createJob({ tool: "merge", uploads });
        if (!open) return;
        remember(open.id);
      }
      const created = await job.addTask({ kind: "merge", params: request }, open.id);
      if (created) {
        asked.current.set(created.id, JSON.stringify(request));
        if (compressAfter) onward.current.add(created.id);
      }
    } finally {
      setStarting(false);
    }
  };

  // Discard deletes the job's uploads too, so the list goes with it.
  const discard = async () => {
    if (!(await job.discard())) return;
    remember(null);
    files.clear();
    setSelected(null);
    asked.current.clear();
    onward.current.clear();
    setHandoffError(null);
  };

  const startOver = () => {
    job.reset();
    remember(null);
    setHandoffError(null);
  };

  const onwardProps = (t: typeof task) => ({
    onCompress: () => t && void compress(t.id),
    handing: t !== null && handing === t.id,
    compressNext: t !== null && onward.current.has(t.id),
  });

  if (restoring) {
    return (
      <div className="border-wash rounded-card flex min-h-64 items-center justify-center border px-6 py-10">
        <Empty>reopening your merge…</Empty>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        {job.job ? (
          <Reopened info={job.job} onStartOver={startOver}>
            <MergeRun
              job={job.job}
              task={task}
              stale={false}
              error={handoffError ?? job.error}
              onDiscard={discard}
              {...onwardProps(task)}
            />
          </Reopened>
        ) : job.expired ? (
          <p className="text-meta text-body font-sans normal-case">
            That merge's hour ran out, so the server has deleted its files. Add them again to start over.
          </p>
        ) : job.error ? (
          <p className="text-meta text-body font-sans normal-case">{job.error}</p>
        ) : null}
        <Dropzone
          onFiles={add}
          accept={ACCEPT}
          cta="choose files"
          label={job.job ? "or drop PDFs and images for a new merge" : "or drop PDFs and images here"}
          hint={FORMATS}
          className="min-h-64"
        />
      </div>
    );
  }

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Sections>
        <Section
          title={`files · ${pad(entries.length)}`}
          aside={
            <Button variant="outline" size="sm" onClick={() => picker.current?.click()}>
              <FiPlus className="size-3" aria-hidden />
              add
            </Button>
          }
        >
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            aria-label="add files"
            onChange={(e) => {
              add(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <FileList
            entries={entries}
            selected={selected}
            onSelect={setSelected}
            onMove={files.move}
            onMoveTo={files.moveTo}
            onRemove={remove}
            onRetry={files.retry}
          />
          <Dropzone onFiles={add} accept={ACCEPT} label="drop more files here" className="py-5" />
        </Section>

        <PageOptions
          entry={entry}
          images={images}
          onChange={(change) => entry && files.setLayout(entry.key, change)}
          onApplyToAll={() => entry && files.layoutToAll(entry.key)}
        />

        <OutputOptions
          output={output}
          fallbackTitle={defaultTitle(entries[0]?.file.name)}
          onChange={(change) => setOutput((o) => ({ ...o, ...change }))}
        />
      </Sections>

      <div className="flex flex-col gap-6 lg:sticky lg:top-20">
        <PagePreview entry={entry} index={index} count={entries.length} />

        <MergeBar
          status={
            stopped
              ? `${pad(stopped)} ${stopped === 1 ? "upload" : "uploads"} stopped`
              : waiting
                ? `${pad(waiting)} ${waiting === 1 ? "file" : "files"} still uploading`
                : `${pad(entries.length)} ${entries.length === 1 ? "file" : "files"} · one pdf`
          }
          disabled={!params || busy}
          label={starting ? "starting…" : job.activeTask ? "merging…" : "merge"}
          onMerge={() => params && void merge(params)}
          // Once there is a current file, download is the action; merging again steps back to outline.
          quiet={current && task?.state === "done"}
          options={
            <MergeOptions
              engine={engine}
              onEngine={setEngine}
              compressAfter={compressAfter}
              onCompressAfter={setCompressAfter}
            />
          }
        />

        {job.job ? (
          <MergeRun
            job={job.job}
            task={task}
            stale={task !== null && !current}
            error={handoffError ?? job.error}
            onDiscard={discard}
            {...onwardProps(task)}
          />
        ) : job.error ? (
          <p className="text-meta text-body font-sans normal-case">{job.error}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The merge button and the line that says whether it can go yet.
 *
 * `options` is the seam for #18: the "compress on export" toggle and the
 * engine picker sit here, beside the button they change, and add `engine` to
 * the params built in `MergeWorkbench`.
 */
function MergeBar({
  status,
  disabled,
  label,
  onMerge,
  quiet,
  options,
}: {
  status: string;
  disabled: boolean;
  label: string;
  onMerge: () => void;
  quiet?: boolean;
  options?: ReactNode;
}) {
  return (
    <div className="border-hairline-faint flex flex-col gap-4 border-t pt-5">
      {options}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-meta font-mono text-meta uppercase tabular-nums" aria-live="polite">
          {status}
        </p>
        <Button variant={quiet ? "outline" : "primary"} disabled={disabled} onClick={onMerge}>
          {label}
        </Button>
      </div>
    </div>
  );
}

/**
 * What goes in MergeBar's options slot (#18): whether the merged file goes on
 * to Compress, and the engine that joins the files, folded to one line since
 * MuPDF is right for nearly every merge.
 */
function MergeOptions({
  engine,
  onEngine,
  compressAfter,
  onCompressAfter,
}: {
  engine: EngineId;
  onEngine: (engine: EngineId) => void;
  compressAfter: boolean;
  onCompressAfter: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Toggle checked={compressAfter} onChange={onCompressAfter} label="compress on export" />
        {compressAfter ? (
          <p className="text-meta text-body font-sans normal-case">
            The merged file opens in Compress, analysed, when it is done.
          </p>
        ) : null}
      </div>
      <section className="flex flex-col gap-4">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="group flex min-h-5 cursor-pointer items-center justify-between gap-3 text-left"
        >
          <span className="text-meta text-meta group-hover:text-indigo font-mono uppercase transition-colors duration-200">
            engine · {ENGINES[engine].label}
          </span>
          <FiChevronDown
            aria-hidden
            className={cn("text-meta group-hover:text-indigo size-3.5 transition-[transform,color] duration-200", open && "rotate-180")}
          />
        </button>
        {open ? <EnginePicker tool="merge" value={engine} onChange={onEngine} /> : null}
      </section>
    </div>
  );
}

/** After a reload: the list is gone from the page, but the job — and its download — is still on the server. */
function Reopened({ info, onStartOver, children }: { info: JobInfo; onStartOver: () => void; children: ReactNode }) {
  return (
    <div className="border-wash rounded-card flex flex-col gap-6 border px-6 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-meta font-mono text-meta uppercase">your last merge · {pad(info.inputs.length)} files</h2>
        <TextButton onClick={onStartOver}>start a new merge</TextButton>
      </div>
      <ol className="flex flex-col gap-1">
        {info.inputs.map((input, i) => (
          <li key={`${input.id}-${i}`} className="flex items-baseline gap-3 font-mono tabular-nums">
            <span className="text-meta text-meta">{pad(i + 1)}</span>
            <span className="text-label text-ink min-w-0 flex-1 truncate tracking-normal" title={input.name}>
              {input.name}
            </span>
            <span className="text-meta text-meta tracking-normal">{bytes(input.size)}</span>
          </li>
        ))}
      </ol>
      {children}
    </div>
  );
}
