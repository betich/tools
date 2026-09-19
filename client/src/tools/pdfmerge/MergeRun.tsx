import type { JobInfo, MergeResult, TaskInfo } from "@tools/shared";
import { QueueNotice } from "@/components/QueueNotice";
import { RetentionNote } from "@/components/RetentionNote";
import { Button } from "@/components/ui";
import { pdfJobs } from "@/lib/pdfjobs";
import { bytes } from "@/lib/format";

/** `TaskInfo.result` is `unknown` on the wire; this is the shape a done merge task carries. */
export function asMergeResult(value: unknown): MergeResult | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<MergeResult>;
  if (typeof r.bytes !== "number" || typeof r.pages !== "number" || typeof r.fileName !== "string") return null;
  return { bytes: r.bytes, pages: r.pages, fileName: r.fileName, notes: Array.isArray(r.notes) ? r.notes.map(String) : [] };
}

/** The newest merge task of the job, whatever its state. */
export function latestMerge(job: JobInfo | null): TaskInfo | null {
  return [...(job?.tasks ?? [])].reverse().find((t) => t.kind === "merge") ?? null;
}

/**
 * Where the merge stands on the server: the queue notice while it waits and
 * runs, the worker's sentence if it failed, and once done the file — pages,
 * size, anything the worker had to say about it — with the download. The
 * download is a plain absolute link, so a large PDF streams to disk rather than
 * through a Blob. Beside it, "compress this" hands the file to Compress (#18),
 * which is also what "compress on export" does by itself. The retention note
 * and discard sit under it from the moment the server holds a job.
 */
export function MergeRun({
  job,
  task,
  stale,
  error,
  onDiscard,
  onCompress,
  handing = false,
  compressNext = false,
}: {
  job: JobInfo;
  task: TaskInfo | null;
  /** The list or options changed since this merge was asked for. */
  stale: boolean;
  error: string | null;
  onDiscard: () => unknown;
  /** Opens the finished file in Compress. */
  onCompress?: () => void;
  /** The hand-off to Compress is in flight. */
  handing?: boolean;
  /** "Compress on export" was on for this merge, so Compress opens by itself once it is done. */
  compressNext?: boolean;
}) {
  const result = task?.state === "done" ? asMergeResult(task.result) : null;

  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      {task && !result ? <QueueNotice task={task} /> : null}
      {task && !result && compressNext && task.state !== "failed" ? (
        <p className="text-meta text-body font-sans normal-case">Compress opens with the merged file when this is done.</p>
      ) : null}

      {task && result ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-ink text-small min-w-0 truncate font-mono tracking-normal" title={result.fileName}>
                {result.fileName}
              </span>
              <span className="text-label text-micro font-mono tabular-nums tracking-normal">
                {result.pages} {result.pages === 1 ? "page" : "pages"} · {bytes(result.bytes)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {onCompress ? (
                <Button variant="outline" disabled={handing} onClick={onCompress}>
                  {handing ? "opening compress…" : "compress this"}
                </Button>
              ) : null}
              <a
                href={pdfJobs.resultUrl(job.id, task.id)}
                download={result.fileName}
                className="bg-ink text-paper text-micro hover:bg-indigo focus-visible:outline-indigo inline-flex h-9 items-center justify-center whitespace-nowrap rounded-xs px-4 font-mono font-bold uppercase transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                download
              </a>
            </div>
          </div>
          {stale ? (
            <p className="text-meta text-body font-sans normal-case">
              Made before your last change — merge again to include it.
            </p>
          ) : null}
          {result.notes.map((n, i) => (
            <p key={i} className="text-prose text-body font-sans normal-case">
              {n}
            </p>
          ))}
        </div>
      ) : null}

      {task?.state === "failed" ? (
        <p className="text-meta text-body font-sans normal-case">
          No file was made. Merge again, or change a setting first.
        </p>
      ) : null}

      {error ? <p className="text-meta text-body font-sans normal-case">{error}</p> : null}
      <RetentionNote onDiscard={onDiscard} />
    </div>
  );
}
