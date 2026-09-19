import { useEffect, useRef, useState } from "react";
import { FiChevronDown, FiChevronUp, FiFileText, FiImage, FiX } from "react-icons/fi";
import { IconButton, TextButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { bytes, pad } from "@/lib/format";
import type { MergeEntry } from "./useMergeFiles";

/**
 * The inputs in the order they will be joined. A row selects; its actions sit
 * at its end and show on approach, as the layer list's do. Rows drag to a new
 * place, and the arrows do the same for a keyboard.
 */
export function FileList({
  entries,
  selected,
  onSelect,
  onMove,
  onMoveTo,
  onRemove,
  onRetry,
}: {
  entries: MergeEntry[];
  selected: string | null;
  onSelect: (key: string) => void;
  onMove: (key: string, by: -1 | 1) => void;
  onMoveTo: (key: string, to: number) => void;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);

  return (
    <ul className="-mx-1.5 flex flex-col gap-0.5" onDragEnd={() => (setDragging(null), setOver(null))}>
      {entries.map((entry, i) => {
        const here = entry.key === selected;
        return (
          <li
            key={entry.key}
            draggable
            onDragStart={(e) => {
              setDragging(entry.key);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", entry.key);
            }}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setOver(e.clientY < r.top + r.height / 2 ? i : i + 1);
            }}
            onDrop={(e) => {
              if (!dragging || over === null) return;
              e.preventDefault();
              e.stopPropagation();
              const from = entries.findIndex((x) => x.key === dragging);
              onMoveTo(dragging, over > from ? over - 1 : over);
              setDragging(null);
              setOver(null);
            }}
            className={cn("group relative flex flex-col", dragging === entry.key && "opacity-35")}
          >
            {/* The drop line: a 1px periwinkle rule where the row will land. */}
            {dragging && over === i ? <span className="bg-indigo absolute -top-px right-1.5 left-1.5 h-px" aria-hidden /> : null}
            {dragging && over === i + 1 && i === entries.length - 1 ? (
              <span className="bg-indigo absolute right-1.5 -bottom-px left-1.5 h-px" aria-hidden />
            ) : null}

            <button
              type="button"
              onClick={() => onSelect(entry.key)}
              aria-current={here || undefined}
              className={cn(
                "flex min-w-0 cursor-pointer items-center gap-3 rounded-xs py-2 pr-2.5 pl-2.5 text-left transition-colors duration-200",
                here ? "bg-surface-high" : "hover:bg-hover-wash",
                "group-hover:pr-24 group-focus-within:pr-24 [@media(pointer:coarse)]:pr-24",
                here && "pr-24",
              )}
            >
              <span className={cn("shrink-0 font-mono text-micro tabular-nums", here ? "text-indigo" : "text-meta")}>{pad(i + 1)}</span>
              <Thumb entry={entry} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    "min-w-0 truncate font-mono text-small tracking-normal transition-colors duration-200",
                    here ? "text-ink" : "text-label group-hover:text-indigo",
                  )}
                  title={entry.file.name}
                >
                  {entry.file.name}
                </span>
                <span className="text-meta truncate font-mono text-micro uppercase tabular-nums">
                  {entry.kind} · {bytes(entry.file.size)} · {status(entry)}
                </span>
              </span>
            </button>

            <span
              className={cn(
                "absolute top-4 right-2.5 flex items-center gap-2.5 transition-opacity duration-200",
                here ? "opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100",
              )}
            >
              <IconButton label="move up" onClick={() => onMove(entry.key, -1)} disabled={i === 0}>
                <FiChevronUp className="size-3.5" />
              </IconButton>
              <IconButton label="move down" onClick={() => onMove(entry.key, 1)} disabled={i === entries.length - 1}>
                <FiChevronDown className="size-3.5" />
              </IconButton>
              <IconButton label="remove" data-tip-pos="top-right" onClick={() => onRemove(entry.key)}>
                <FiX className="size-3.5" />
              </IconButton>
            </span>

            {entry.upload.phase === "uploading" ? (
              <span className="bg-wash mx-2.5 mb-1 block h-px overflow-hidden" aria-hidden>
                <span
                  className="bg-indigo block h-full transition-[width] duration-200"
                  style={{ width: `${entry.upload.total ? (entry.upload.sent / entry.upload.total) * 100 : 0}%` }}
                />
              </span>
            ) : null}

            {entry.upload.phase === "failed" ? (
              <span className="flex items-baseline justify-between gap-3 px-2.5 pb-2 pl-10">
                <span className="text-meta font-sans text-body leading-snug normal-case">{entry.upload.message}</span>
                <TextButton className="shrink-0 whitespace-nowrap" onClick={() => onRetry(entry.key)}>
                  try again
                </TextButton>
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function status(entry: MergeEntry): string {
  const u = entry.upload;
  if (u.phase === "queued") return "waiting";
  if (u.phase === "uploading") return `uploading ${u.total ? Math.floor((u.sent / u.total) * 100) : 0}%`;
  if (u.phase === "failed") return "stopped";
  return "uploaded";
}

/** 32px of the file: its own pixels for an image the browser can draw, a glyph for anything else. */
function Thumb({ entry }: { entry: MergeEntry }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bitmap = entry.source.state === "image" ? entry.source.bitmap : null;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !bitmap) return;
    const side = 64;
    const k = Math.min(side / bitmap.width, side / bitmap.height);
    c.width = Math.max(1, Math.round(bitmap.width * k));
    c.height = Math.max(1, Math.round(bitmap.height * k));
    c.getContext("2d")?.drawImage(bitmap, 0, 0, c.width, c.height);
  }, [bitmap]);

  return (
    <span className="border-hairline-faint flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-hairline border">
      {bitmap ? (
        <canvas ref={canvas} className="max-h-full max-w-full" aria-hidden />
      ) : entry.kind === "pdf" ? (
        <FiFileText className="text-meta size-3.5" aria-hidden />
      ) : (
        <FiImage className="text-meta size-3.5" aria-hidden />
      )}
    </span>
  );
}
