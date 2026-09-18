import { useCallback, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

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
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  label: string;
  hint?: string;
  className?: string;
  children?: ReactNode;
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
        handle(e.dataTransfer.files);
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
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={cn(
          "cursor-pointer font-mono text-meta uppercase transition-colors duration-200",
          over ? "text-indigo" : "text-label hover:text-indigo",
        )}
      >
        {label}
      </button>
      {hint ? <p className="text-meta font-mono text-meta uppercase opacity-80">{hint}</p> : null}
      {children}
    </div>
  );
}
