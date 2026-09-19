import { CODECS, type CodecId, type CodecInfo } from "@tools/shared";
import { cn } from "@/lib/cn";

const VIEWERS: Record<CodecInfo["viewers"], string> = { all: "every viewer", most: "most viewers", few: "few viewers" };

/** `lossy + lossless · alpha in stream · most viewers · /JPXDecode` — a codec's capabilities, off the matrix. */
export function codecCapabilities(codec: CodecId): string[] {
  const c = CODECS[codec];
  return [
    c.lossy && c.lossless ? "lossy + lossless" : c.lossy ? "lossy" : "lossless",
    c.alpha === "inline" ? "alpha in stream" : "alpha as soft mask",
    VIEWERS[c.viewers],
    `/${c.filter}`,
  ];
}

/**
 * The capability line under a codec row (#10): what it can and can't carry,
 * who can open it, and the PDF filter it writes. Chrome, so uppercase mono;
 * the filter name keeps its case since it is what a PDF inspector shows.
 */
export function CodecCapabilities({ codec, className }: { codec: CodecId; className?: string }) {
  const parts = codecCapabilities(codec);
  const filter = parts.pop();
  return (
    <p className={cn("text-meta text-meta font-mono", className)}>
      <span className="uppercase">{parts.join(" · ")} · </span>
      <span className="tracking-normal">{filter}</span>
    </p>
  );
}
