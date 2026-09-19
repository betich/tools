import type { TaskInfo } from "@tools/shared";
import { cn } from "@/lib/cn";
import { pad } from "@/lib/format";

/**
 * Where one task stands on the server. Queued, it says how many jobs are
 * ahead; running, it names the worker's stage and fills a hairline track with
 * the same single periwinkle rule as `UploadProgress`; failed, it gives the
 * worker's sentence exactly as written, because that sentence already says
 * what to try next. A failed task keeps its fill at opacity — there is no
 * error colour.
 */
export function QueueNotice({ task, className }: { task: TaskInfo; className?: string }) {
  const { state, progress } = task;
  const total = progress?.total ?? 0;
  const done = state === "done" ? total : Math.min(progress?.done ?? 0, total);
  const fraction = state === "done" ? 1 : total > 0 ? done / total : 0;
  const width = Math.max(2, String(total).length);

  const label =
    state === "queued"
      ? "queued"
      : state === "running"
        ? (progress?.stage ?? "starting")
        : state === "done"
          ? "done"
          : "stopped";

  return (
    <div className={cn("flex flex-col gap-2", className)} aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("text-micro font-mono uppercase", state === "done" ? "text-indigo" : "text-meta")}>
          {label}
        </span>
        {state !== "queued" && total > 0 ? (
          <span className="text-meta text-micro font-mono uppercase tabular-nums">
            {pad(done, width)} / {pad(total, width)}
          </span>
        ) : null}
      </div>

      {state === "queued" ? (
        <p className="text-prose text-body font-sans normal-case">
          {task.ahead > 0 ? `${task.ahead} ${task.ahead === 1 ? "job" : "jobs"} ahead of yours` : "Yours is next"}
        </p>
      ) : (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
          className="bg-wash relative h-0.5 w-full overflow-hidden rounded-full"
        >
          <div
            className={cn(
              "bg-indigo absolute inset-y-0 left-0 transition-[width,opacity] duration-200",
              state === "failed" && "opacity-35",
            )}
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
      )}

      {state === "failed" && task.error ? (
        <p className="text-meta text-body font-sans normal-case leading-snug">{task.error}</p>
      ) : state === "running" && progress?.note ? (
        <p className="text-meta text-body font-sans normal-case leading-snug">{progress.note}</p>
      ) : null}
    </div>
  );
}
