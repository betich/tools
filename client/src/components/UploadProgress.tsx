import type { UploadState } from "@/hooks/useUpload";
import { cn } from "@/lib/cn";
import { bytes, pad } from "@/lib/format";
import { TextButton } from "./ui";

/**
 * One file going up: what it is, how many parts have landed, how many bytes.
 * A single periwinkle rule fills a hairline track; a stopped upload keeps its
 * fill but drops to opacity, because there is no error colour. The label is
 * chrome; the filename and the byte count are values, so they drop tracking.
 */
export function UploadProgress({
  state,
  onCancel,
  onRetry,
  className,
}: {
  state: Exclude<UploadState, { phase: "idle" }>;
  onCancel?: () => void;
  onRetry?: () => void;
  className?: string;
}) {
  const { file, progress } = state;
  const total = progress?.total ?? file.size;
  const sent = state.phase === "done" ? total : (progress?.sent ?? 0);
  const fraction = total > 0 ? Math.min(1, sent / total) : state.phase === "done" ? 1 : 0;
  const width = String(progress?.parts ?? 0).length;

  const label =
    state.phase === "done" ? "uploaded" : state.phase === "failed" ? "stopped" : progress ? "uploading" : "starting";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("font-mono text-micro uppercase", state.phase === "done" ? "text-indigo" : "text-meta")}>{label}</span>
        {progress ? (
          <span className="text-meta font-mono text-micro uppercase tabular-nums">
            part {pad(state.phase === "done" ? progress.parts : progress.partsDone, Math.max(2, width))} / {pad(progress.parts, Math.max(2, width))}
          </span>
        ) : null}
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ink min-w-0 truncate font-mono text-small tracking-normal" title={file.name}>
          {file.name}
        </span>
        <span className="text-label shrink-0 font-mono text-small tracking-normal tabular-nums">
          {bytes(sent)} / {bytes(total)}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label={`upload ${file.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        className="bg-wash relative h-0.5 w-full overflow-hidden rounded-full"
      >
        <div
          className={cn(
            "bg-indigo absolute inset-y-0 left-0 transition-[width,opacity] duration-200",
            state.phase === "failed" && "opacity-35",
          )}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>

      {state.phase === "failed" || (state.phase === "uploading" && onCancel) ? (
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-meta font-sans text-body leading-snug normal-case" aria-live="polite">
            {state.phase === "failed" ? state.message : null}
          </p>
          {state.phase === "uploading" && onCancel ? <TextButton onClick={onCancel}>stop</TextButton> : null}
          {state.phase === "failed" && onRetry ? <TextButton onClick={onRetry}>try again</TextButton> : null}
        </div>
      ) : null}
    </div>
  );
}
