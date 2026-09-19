import { FiDownload } from "react-icons/fi";
import { passInfo, type PdfAnalysis, type TaskInfo } from "@tools/shared";
import { QueueNotice } from "@/components/QueueNotice";
import { buttonClass, Section } from "@/components/ui";
import { bytes, pad } from "@/lib/format";
import { pdfJobs } from "@/lib/pdfjobs";
import { asRunResult, change } from "./analysis";
import { SizeBreakdown } from "./SizeBreakdown";
import { TargetOutcome, targetOutcome } from "./target";

/**
 * The runs of this job, newest on top. The chosen one — the newest unless
 * another row was picked — is shown in full: where it stands in the queue
 * while it waits or works, and once done the size change, the before/after
 * breakdown, what was skipped and why, the worker's notes as written, and the
 * download; a run with a target size (#12) says first whether it got there.
 * Earlier runs stay listed underneath in one line each, so trying
 * other settings never loses a result that was better.
 */
export function RunResults({
  jobId,
  runs,
  labels,
  input,
  shown,
  onShow,
}: {
  jobId: string;
  /** The job's compress tasks in creation order. */
  runs: TaskInfo[];
  /** Each run's settings in one line, by task id, where this tab remembers them. */
  labels: Record<string, string>;
  input: PdfAnalysis;
  shown: TaskInfo;
  onShow: (taskId: string) => void;
}) {
  const number = (task: TaskInfo) => runs.indexOf(task) + 1;
  const title = (task: TaskInfo) => labels[task.id] ?? `run ${pad(number(task))}`;

  return (
    <>
      <Section title={runs.length > 1 ? `run ${pad(number(shown))}` : "result"}>
        {labels[shown.id] ? (
          <span className="text-label text-micro font-mono uppercase">{labels[shown.id]}</span>
        ) : null}
        {shown.state === "done" ? (
          <Outcome jobId={jobId} task={shown} input={input} />
        ) : (
          <QueueNotice task={shown} />
        )}
      </Section>

      {runs.length > 1 ? (
        <Section title={`runs · ${runs.length}`}>
          <ul className="flex flex-col">
            {[...runs].reverse().map((task) => {
              const result = task.state === "done" ? asRunResult(task.result) : null;
              const current = task.id === shown.id;
              return (
                <li key={task.id} className="border-wash flex items-center gap-4 border-b py-2.5 last:border-b-0">
                  <span className="text-meta text-micro w-6 shrink-0 font-mono tabular-nums">{pad(number(task))}</span>
                  <button
                    type="button"
                    onClick={() => onShow(task.id)}
                    aria-pressed={current}
                    className="group min-w-0 flex-1 cursor-pointer text-left"
                  >
                    <span
                      className={`text-small block truncate font-mono uppercase transition-colors duration-200 group-hover:text-indigo ${current ? "text-ink" : "text-label"}`}
                    >
                      {title(task)}
                    </span>
                  </button>
                  <span className="text-label shrink-0 font-mono tabular-nums tracking-normal">
                    {result ? (
                      <>
                        <span className="text-ink">{bytes(result.bytes)}</span>{" "}
                        <span className={result.bytes < result.inputBytes ? "text-indigo" : "text-meta"}>
                          {result.keptOriginal ? "original" : change(result.inputBytes, result.bytes)}
                        </span>
                      </>
                    ) : (
                      <span className="text-meta text-micro uppercase">
                        {task.state === "done" ? "unreadable" : task.state === "failed" ? "stopped" : task.state}
                      </span>
                    )}
                  </span>
                  {result ? (
                    <a
                      href={pdfJobs.resultUrl(jobId, task.id)}
                      download={result.fileName}
                      aria-label={`download run ${pad(number(task))}`}
                      data-tip="download"
                      className="tooltip text-meta hover:text-indigo inline-flex size-4 shrink-0 items-center justify-center transition-colors duration-200"
                    >
                      <FiDownload className="size-3.5" />
                    </a>
                  ) : (
                    <span className="size-4 shrink-0" />
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

/** A finished run: the size change, the file to take away, then everything the worker had to say. */
function Outcome({ jobId, task, input }: { jobId: string; task: TaskInfo; input: PdfAnalysis }) {
  const result = asRunResult(task.result);
  if (!result) {
    return (
      <p className="text-meta text-body font-sans normal-case">
        The worker finished, but its answer could not be read. Run it again.
      </p>
    );
  }
  const smaller = result.bytes < result.inputBytes;
  const target = targetOutcome(result);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="text-ink text-headline font-mono tabular-nums tracking-normal" aria-label="size change">
          {bytes(result.inputBytes)} <span className="text-meta">→</span> {bytes(result.bytes)}{" "}
          <span className={smaller ? "text-indigo" : "text-meta"}>({change(result.inputBytes, result.bytes)})</span>
        </p>
        <a href={pdfJobs.resultUrl(jobId, task.id)} download={result.fileName} className={buttonClass()}>
          <FiDownload className="size-3.5" aria-hidden />
          download
        </a>
      </div>

      {target ? <TargetOutcome outcome={target} /> : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-label min-w-0 truncate font-mono tracking-normal" title={result.fileName}>
          {result.fileName}
        </span>
        {result.keptOriginal ? (
          <p className="text-prose text-body font-sans normal-case">
            Already as small as these settings make it — kept the original.
          </p>
        ) : null}
        {(target?.rest ?? result.notes).map((note, i) => (
          <p key={i} className="text-prose text-body font-sans normal-case">
            {note}
          </p>
        ))}
      </div>

      <SizeBreakdown analysis={result.analysis} before={input} />

      {result.skipped.length ? (
        <div className="flex flex-col gap-2">
          <span className="text-meta text-micro font-mono uppercase">skipped</span>
          <ul className="flex flex-col">
            {result.skipped.map((s) => (
              <li
                key={s.pass}
                className="border-hairline-faint flex flex-col gap-0.5 border-b py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4"
              >
                <span className="text-label text-micro w-48 shrink-0 font-mono uppercase">
                  {passInfo(s.pass)?.label ?? s.pass}
                </span>
                <span className="text-meta text-body font-sans normal-case">{s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
