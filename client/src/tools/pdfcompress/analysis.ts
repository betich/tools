import type { PdfAnalysis, PdfImage, SizeCategory } from "@tools/shared";

/** The breakdown's categories in the order the bar draws them — the usual heaviest first. */
export const CATEGORIES: { key: SizeCategory; label: string }[] = [
  { key: "images", label: "images" },
  { key: "fonts", label: "fonts" },
  { key: "content", label: "content" },
  { key: "metadata", label: "metadata" },
  { key: "other", label: "other" },
];

/**
 * `JobInfo.analysis` is typed `unknown` by the queue, which never looks inside
 * it. This checks the shape the page is about to read, so a half-written or
 * older result shows as "no analysis" instead of throwing mid-render.
 */
export function asAnalysis(value: unknown): PdfAnalysis | null {
  if (!value || typeof value !== "object") return null;
  const a = value as Partial<PdfAnalysis>;
  if (typeof a.bytes !== "number" || !a.breakdown || !Array.isArray(a.images) || !Array.isArray(a.fonts)) return null;
  return a as PdfAnalysis;
}

/** `1–3, 7, 9–12` — consecutive pages folded into ranges; past `max` parts the rest is counted, not listed. */
export function pageRanges(pages: number[], max = 3): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const p of sorted) {
    const last = runs[runs.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else runs.push([p, p]);
  }
  const shown = runs.slice(0, max).map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`));
  const rest = runs.slice(max).reduce((n, [a, b]) => n + b - a + 1, 0);
  return shown.join(", ") + (rest ? ` +${rest}` : "") || "—";
}

const FILTERS: Record<string, string> = {
  DCTDecode: "jpeg",
  JPXDecode: "jpeg 2000",
  FlateDecode: "flate",
  JBIG2Decode: "jbig2",
  CCITTFaxDecode: "ccitt g4",
  LZWDecode: "lzw",
  RunLengthDecode: "rle",
  none: "raw",
};

/** The codec a PDF filter name stands for, in the words the settings use; unknown filters pass through. */
export const codecName = (filter: string) => FILTERS[filter] ?? filter;

const SPACES: Record<string, string> = { DeviceRGB: "rgb", DeviceGray: "gray", DeviceCMYK: "cmyk" };

/** `rgb 8` / `gray 1` / `ICCBased(3) 8` — the device spaces shortened, everything else as the file names it. */
export function colourName(image: PdfImage): string {
  return `${SPACES[image.colorSpace] ?? image.colorSpace} ${image.bitsPerComponent}${image.alpha ? " +α" : ""}`;
}

/**
 * A share of the whole: tenths below 10% (a scan's hundred small images would
 * otherwise all read `0%`), whole numbers above, and `<0.1%` rather than a
 * misleading zero.
 */
export function share(part: number, whole: number): string {
  if (!whole || part <= 0) return "0%";
  const pct = (part / whole) * 100;
  return pct < 0.1 ? "<0.1%" : `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}
