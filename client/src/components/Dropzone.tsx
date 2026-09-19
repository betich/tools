import { useCallback, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { filesFromDrop } from "@/lib/droppedFiles";
import { Button } from "./ui";

/**
 * Drop target. The dashed hairline is the system's one documented departure
 * from solid rules — dashed reads as "not a boundary yet, put something here".
 */
export function Dropzone({
  onFiles,
  accept,
  multiple = true,
  label,
  hint,
  className,
  children,
  cta,
  onPick,
  folders = false,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  label: string;
  hint?: string;
  className?: string;
  children?: ReactNode;
  /**
   * When the drop is the reason the section exists, the picker is a real
   * outline button carrying this label, and `label` becomes the line under it.
   */
  cta?: ReactNode;
  /** Replaces the hidden input — e.g. a picker that can hand back a file handle. */
  onPick?: () => void;
  /** Walk into dropped folders and hand over the files inside, each with its path in `webkitRelativePath`. */
  folders?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handle = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      onFiles(Array.from(list));
    },
    [onFiles],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!folders) return handle(e.dataTransfer.files);
        void filesFromDrop(e.dataTransfer).then((files) => files.length > 0 && onFiles(files));
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2.5 rounded-card border border-dashed px-6 py-10 text-center transition-colors duration-200",
        over ? "border-indigo bg-[rgba(90,87,240,0.16)]" : "border-hairline hover:border-edge",
        className,
      )}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = "";
        }}
        className="sr-only"
        aria-label={label}
      />
      {cta ? (
        <>
          <Button variant="outline" onClick={() => (onPick ? onPick() : input.current?.click())}>
            {cta}
          </Button>
          <p className={cn("font-mono text-meta uppercase transition-colors duration-200", over ? "text-indigo" : "text-label")}>
            {over ? "let go to load it" : label}
          </p>
        </>
      ) : (
        <button
          type="button"
          onClick={() => (onPick ? onPick() : input.current?.click())}
          className={cn(
            "cursor-pointer font-mono text-meta uppercase transition-colors duration-200",
            over ? "text-indigo" : "text-label hover:text-indigo",
          )}
        >
          {label}
        </button>
      )}
      {hint ? <p className="text-meta font-mono text-meta uppercase opacity-80">{hint}</p> : null}
      {children}
    </div>
  );
}
