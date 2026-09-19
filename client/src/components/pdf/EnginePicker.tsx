import {
  CODECS,
  DEFAULT_ENGINE,
  ENGINES,
  PASSES,
  enginesFor,
  supports,
  toolNote,
  type EngineId,
  type PdfTool,
} from "@tools/shared";
import { cn } from "@/lib/cn";

/** "JPEG (mozjpeg)" → "JPEG": the format, without the encoder behind it. */
const codecShort = (label: string) => label.replace(/\s*\(.*\)$/, "");

/** `11 of 12 passes · JPEG, Flate` — what an engine can do for a compress, read off the matrix. */
function reach(engine: EngineId): string {
  const info = ENGINES[engine];
  const passes = PASSES.filter((p) => supports(engine, p.id)).length;
  return [`${passes} of ${PASSES.length} passes`, info.codecs.map((c) => codecShort(CODECS[c].label)).join(", ")].join(" · ");
}

/**
 * The engine a tool runs on, one row per engine the matrix offers for that
 * tool, MuPDF first as the default. Each row says what the engine loses for
 * this tool; a caution (Ghostscript's re-distill) is shown whether or not the
 * row is chosen, since it is the reason not to choose it. Shared by Compress
 * (#13) and Merge (#18).
 */
export function EnginePicker({
  tool,
  value,
  onChange,
  className,
}: {
  tool: PdfTool;
  value: EngineId;
  onChange: (engine: EngineId) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label="engine" className={cn("flex flex-col", className)}>
      {enginesFor(tool).map((id) => {
        const info = ENGINES[id];
        const on = id === value;
        const note = toolNote(id, tool);
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(id)}
            className="group border-hairline-faint flex cursor-pointer gap-2.5 border-b py-2.5 text-left first:pt-0 last:border-b-0 last:pb-0 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-indigo"
          >
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-colors duration-200",
                on ? "border-indigo" : "border-hairline group-hover:border-indigo",
              )}
            >
              {on ? <span className="bg-indigo size-1.5 rounded-full" /> : null}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex items-baseline gap-2.5 font-mono uppercase">
                <span
                  className={cn(
                    "text-micro transition-colors duration-200",
                    on ? "text-ink" : "text-meta group-hover:text-indigo",
                  )}
                >
                  {info.label}
                </span>
                {id === DEFAULT_ENGINE ? <span className="text-meta text-micro opacity-70">default</span> : null}
              </span>
              {tool === "compress" ? (
                <span className="text-meta text-micro font-mono uppercase">{reach(id)}</span>
              ) : null}
              {note ? <span className="text-meta text-body font-sans normal-case leading-snug">{note}</span> : null}
              {info.caution ? (
                <span className="text-ink text-body font-sans normal-case leading-snug">{info.caution}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
