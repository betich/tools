/**
 * Where an image lands on a merged PDF page (#16, #17). The browser preview
 * and the worker's merge both call `pageLayout` and draw exactly what it
 * returns, so the preview cannot drift from the output — the same discipline
 * as `render.ts`: pure arithmetic, no DOM or Node APIs.
 *
 * Every length it returns is in PDF points (72 per inch) with the origin at
 * the page's top-left and y growing downward, which is how a canvas draws.
 * PDF user space grows upward; `toPdfRect` flips a rect for a content stream.
 *
 * The image's pixel size is its *displayed* size — EXIF orientation applied —
 * which is what `createImageBitmap` hands the browser by default. The worker
 * must apply the same orientation before it places the pixels.
 */

import type { EngineId } from "./pdfcaps";
import type { UploadKind } from "./uploads";

/** Dots per inch along the displayed x and y axes. */
export type ImageDpi = { x: number; y: number };

/** An image as the layout needs it: displayed pixels and, if the file says, its density. */
export type LayoutImage = { width: number; height: number; dpi: ImageDpi | null };

export type PaperId = "a4" | "letter" | "legal" | "a3" | "a5";
export type PageFit = "contain" | "cover" | "fill";
export type PageOrientation = "auto" | "portrait" | "landscape";
export type MarginUnit = "mm" | "pt";

/**
 * How one image becomes one page. `image` makes the page the image's own
 * physical size (from its DPI, else 96 dpi) and ignores the rest; `paper`
 * puts it on a sheet with the fit, margin and orientation below.
 */
export type MergeItemOptions = {
  mode: "image" | "paper";
  paper: PaperId;
  fit: PageFit;
  orientation: PageOrientation;
  /** One margin on all four sides, in `marginUnit`. Paper mode only. */
  margin: number;
  marginUnit: MarginUnit;
};

export const DEFAULT_MERGE_ITEM: MergeItemOptions = {
  mode: "image",
  paper: "a4",
  fit: "contain",
  orientation: "auto",
  margin: 0,
  marginUnit: "mm",
};

/** The density a file without any is read at — a CSS pixel, as a browser prints. */
export const FALLBACK_DPI = 96;

export const POINTS_PER_INCH = 72;
export const POINTS_PER_MM = 72 / 25.4;

/** Portrait sizes in points. ISO sizes are defined in mm and rounded here the way every PDF tool rounds them. */
export const PAPER_SIZES: Record<PaperId, { label: string; width: number; height: number }> = {
  a4: { label: "A4", width: 595.28, height: 841.89 },
  letter: { label: "Letter", width: 612, height: 792 },
  legal: { label: "Legal", width: 612, height: 1008 },
  a3: { label: "A3", width: 841.89, height: 1190.55 },
  a5: { label: "A5", width: 419.53, height: 595.28 },
};

export const PAPER_IDS = Object.keys(PAPER_SIZES) as PaperId[];

/** x/y/width/height in points, top-left origin. */
export type Rect = { x: number; y: number; width: number; height: number };

export type PageLayout = {
  width: number;
  height: number;
  /** Where the image's full extent is drawn. Under `cover` it overhangs `clip`. */
  image: Rect;
  /** The region the image is clipped to, or null when it lies wholly inside the page anyway. */
  clip: Rect | null;
};

/** A margin in points, never negative. */
export function marginPoints(options: Pick<MergeItemOptions, "margin" | "marginUnit">): number {
  const m = Number.isFinite(options.margin) ? Math.max(0, options.margin) : 0;
  return options.marginUnit === "mm" ? m * POINTS_PER_MM : m;
}

/** The image's physical size in points: pixels over its DPI, or over 96 when it has none. */
export function imagePoints(image: LayoutImage): { width: number; height: number } {
  const dpi = usableDpi(image.dpi);
  return {
    width: (image.width / dpi.x) * POINTS_PER_INCH,
    height: (image.height / dpi.y) * POINTS_PER_INCH,
  };
}

/** A density from the file if it is plausible, else the fallback. Guards against the `1×1` some cameras write. */
export function usableDpi(dpi: ImageDpi | null): ImageDpi {
  const ok = (v: number) => Number.isFinite(v) && v >= 10 && v <= 10000;
  return dpi && ok(dpi.x) && ok(dpi.y) ? dpi : { x: FALLBACK_DPI, y: FALLBACK_DPI };
}

/** The smallest a page's content box may shrink to, so a huge margin still leaves somewhere to draw. */
const MIN_BOX = 1;

export function pageLayout(image: LayoutImage, options: MergeItemOptions): PageLayout {
  const natural = imagePoints(image);

  if (options.mode === "image") {
    const page = { width: natural.width, height: natural.height };
    return { ...page, image: { x: 0, y: 0, ...page }, clip: null };
  }

  const sheet = PAPER_SIZES[options.paper] ?? PAPER_SIZES.a4;
  const landscape =
    options.orientation === "landscape" || (options.orientation === "auto" && natural.width > natural.height);
  const width = landscape ? sheet.height : sheet.width;
  const height = landscape ? sheet.width : sheet.height;

  const inset = Math.min(marginPoints(options), (width - MIN_BOX) / 2, (height - MIN_BOX) / 2);
  const box: Rect = { x: inset, y: inset, width: width - inset * 2, height: height - inset * 2 };

  if (options.fit === "fill") return { width, height, image: box, clip: null };

  const sx = box.width / natural.width;
  const sy = box.height / natural.height;
  const scale = options.fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
  const w = natural.width * scale;
  const h = natural.height * scale;
  const placed: Rect = { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2, width: w, height: h };

  return { width, height, image: placed, clip: options.fit === "cover" ? box : null };
}

/** A top-left rect in PDF user space (bottom-left origin), for `re` and `cm` in a content stream. */
export function toPdfRect(layout: Pick<PageLayout, "height">, rect: Rect): Rect {
  return { x: rect.x, y: layout.height - rect.y - rect.height, width: rect.width, height: rect.height };
}

/* ── the merge request ─────────────────────────────────────────────────────── */

/**
 * One input to a merge, in order. `layout` applies to images; a PDF's pages go
 * in as they are and its `layout` is ignored. Multi-frame TIFFs make one page
 * per frame, every frame laid out with the same options.
 */
export type MergeItem = { upload: string; name: string; kind: UploadKind; layout: MergeItemOptions };

/** Output options for a merge (#17). `title: null` → first file's name without extension. */
export type MergeOutput = { title: string | null; bookmarks: boolean; pageLabels: boolean; compressImages: boolean };
export const DEFAULT_MERGE_OUTPUT: MergeOutput = { title: null, bookmarks: true, pageLabels: true, compressImages: false };

/**
 * Body of a `merge` task (TaskCreate.params). `engine` is DEFAULT_ENGINE when
 * absent. `pages` is the page view's output (#37); absent → every item whole,
 * in item order, which is exactly the request from before the page view.
 * The client omits it when `isDefaultOrder` holds.
 */
export type MergeParams = { items: MergeItem[]; output: MergeOutput; engine?: EngineId; pages?: MergePageRun[] };

/** TaskInfo.result for kind "merge". */
export type MergeResult = { bytes: number; pages: number; fileName: string; notes: string[] };

/* ── merge by page (#37) ───────────────────────────────────────────────────── */

/**
 * One output page: page `page` (0-based) of `items[item]`. Items, not uploads,
 * are the unit — the same PDF added twice is two files with their own
 * bookmark. An image item has one page, 0, which stands for the whole image
 * (every frame of a multi-frame TIFF): images are never split.
 */
export type MergePageRef = { item: number; page: number };

/**
 * A run of consecutive source pages, `[item, from, to]`: 0-based, inclusive,
 * `from <= to`. The output is the runs in order, so the list is still the
 * explicit page list, just compact.
 *
 * Why tuples of item indices: params are capped at 64 KiB by the server, and
 * items (name + layout, up to 200 of them) can take a good part of that. A
 * run costs ~16 bytes, so `MAX_MERGE_RUNS` of them stay under 16 KiB — where
 * `{ fileId, pageIndex }` per page would top out near 1,600 pages. Interleaving
 * two 20-page scans is 40 runs; a file kept whole is one.
 */
export type MergePageRun = [item: number, from: number, to: number];

/** Most runs a merge takes. The worker refuses more; the client says so before sending. */
export const MAX_MERGE_RUNS = 1_000;

/** Page count per item index; `undefined` when unknown. Items that are not PDFs (images) are always 1, whatever this says. */
export type ItemPageCount = (item: number) => number | undefined;

export type PageRangeResult = { ok: true; pages: number[] } | { ok: false; error: string };

const PAGE_TOKEN = /^(\d+)?-(\d+)?$|^(\d+)$/;

/**
 * Reads a typed page range like "1-3, 5, 8-" against a file of `count` pages,
 * into 0-based page indices in the order typed. "8-" runs to the last page,
 * "-3" from the first, "5-3" counts down. Commas, semicolons or spaces
 * separate; en and em dashes read as hyphens. A page given twice is kept
 * once, where it first appears. Anything out of range is refused with a
 * sentence to show as-is, never clamped.
 */
export function parsePageRange(text: string, count: number): PageRangeResult {
  if (count <= 0) return { ok: false, error: "This file has no pages." };
  const tokens = text.replace(/\s*[-–—]\s*/g, "-").split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) return { ok: false, error: "Type pages like 1-3, 5, 8-." };
  const past = (n: number) => `This file has ${count} ${count === 1 ? "page" : "pages"}; there is no page ${n}.`;
  const seen = new Set<number>();
  const pages: number[] = [];
  for (const token of tokens) {
    const m = PAGE_TOKEN.exec(token);
    if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) {
      return { ok: false, error: `“${token}” is not a page or a range.` };
    }
    const from = Number(m[3] ?? m[1] ?? 1);
    const to = m[3] !== undefined ? from : Number(m[2] ?? count);
    if (from < 1 || to < 1) return { ok: false, error: "Pages start at 1." };
    if (from > count) return { ok: false, error: past(from) };
    if (to > count) return { ok: false, error: past(to) };
    const step = to >= from ? 1 : -1;
    for (let p = from; ; p += step) {
      if (!seen.has(p)) (seen.add(p), pages.push(p - 1));
      if (p === to) break;
    }
  }
  return { ok: true, pages };
}

/**
 * The inverse of `parsePageRange`: 0-based pages, in order, as the text a
 * person would type for them — "1-3, 5, 8-". Consecutive pages fold in
 * either direction, and a run up to the last page drops its end ("8-").
 */
export function formatPageRange(pages: readonly number[], count: number): string {
  const runs: [number, number][] = [];
  for (const p of pages) {
    const last = runs[runs.length - 1];
    const step = last ? (last[0] === last[1] ? p - last[1] : Math.sign(last[1] - last[0])) : 0;
    if (last && (step === 1 || step === -1) && p === last[1] + step) last[1] = p;
    else runs.push([p, p]);
  }
  return runs
    .map(([a, b]) => (a === b ? `${a + 1}` : b === count - 1 && b > a ? `${a + 1}-` : `${a + 1}-${b + 1}`))
    .join(", ");
}

/** Packs a page list into runs,joining a page onto the run before it when it is the next page of the same item. */
export function toRuns(refs: readonly MergePageRef[]): MergePageRun[] {
  const runs: MergePageRun[] = [];
  for (const { item, page } of refs) {
    const last = runs[runs.length - 1];
    if (last && last[0] === item && last[2] + 1 === page) last[2] = page;
    else runs.push([item, page, page]);
  }
  return runs;
}

/** The page list the runs stand for, in output order. */
export function expandRuns(runs: readonly MergePageRun[]): MergePageRef[] {
  const refs: MergePageRef[] = [];
  for (const [item, from, to] of runs) for (let page = from; page <= to; page++) refs.push({ item, page });
  return refs;
}

/** Joins runs that continue one another, so equal page lists compare equal as runs. */
function joined(runs: readonly MergePageRun[]): MergePageRun[] {
  const out: MergePageRun[] = [];
  for (const [item, from, to] of runs) {
    const last = out[out.length - 1];
    if (last && last[0] === item && last[2] + 1 === from) last[2] = to;
    else out.push([item, from, to]);
  }
  return out;
}

/** Every item whole, in item order — or null when a PDF's page count is not known yet. */
export function defaultRuns(items: readonly MergeItem[], count: ItemPageCount): MergePageRun[] | null {
  const runs: MergePageRun[] = [];
  for (let i = 0; i < items.length; i++) {
    const n = items[i]!.kind === "pdf" ? count(i) : 1;
    if (n === undefined) return null;
    if (n > 0) runs.push([i, 0, n - 1]);
  }
  return runs;
}

/**
 * True when the runs make exactly the default output (every item whole, in
 * item order), so the client can leave `pages` out and the request is the
 * file-level one. An unknown PDF page count is never default.
 */
export function isDefaultOrder(runs: readonly MergePageRun[], items: readonly MergeItem[], count: ItemPageCount): boolean {
  const whole = defaultRuns(items, count);
  if (!whole) return false;
  const mine = joined(runs);
  return mine.length === whole.length && mine.every((r, i) => r.every((v, k) => v === whole[i]![k]));
}

const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * Why `pages` can't be merged, as a sentence to show as-is, or null. Checks
 * shape, item indices, images being page 0 only, and — where `count` knows
 * it — the last page of each PDF. The worker calls it once it has counted
 * pages; the client can call it before sending.
 */
export function mergePagesProblem(pages: unknown, items: readonly MergeItem[], count: ItemPageCount = () => undefined): string | null {
  if (!Array.isArray(pages)) return "The page list is not readable — pick the pages again.";
  if (!pages.length) return "Keep at least one page to merge.";
  if (pages.length > MAX_MERGE_RUNS) {
    return `The page order is in too many pieces (${pages.length.toLocaleString("en")}; at most ${MAX_MERGE_RUNS.toLocaleString("en")}). Keep more pages in their original runs.`;
  }
  for (const run of pages) {
    if (!Array.isArray(run) || run.length !== 3 || !run.every(isIndex)) return "The page list is not readable — pick the pages again.";
    const [i, from, to] = run as MergePageRun;
    if (from > to) return "The page list is not readable — pick the pages again.";
    const item = items[i];
    if (!item) return "The page list names a file that is not in this merge — pick the pages again.";
    const n = item.kind === "pdf" ? count(i) : 1;
    if (n !== undefined && to >= n) {
      return `“${item.name}” has ${n} ${n === 1 ? "page" : "pages"}; there is no page ${to + 1}.`;
    }
  }
  return null;
}

/* ── density from the file ─────────────────────────────────────────────────── */

/**
 * The DPI a JPEG, PNG or TIFF declares, or null. Reads EXIF resolution first
 * (it is what a camera or editor last wrote), then a JPEG's JFIF density, then
 * a PNG's pHYs. Values are swapped for EXIF orientations 5–8, so they follow
 * the displayed axes like `LayoutImage` does. Bytes may be just the head of
 * the file; anything past the end reads as absent. The worker reads density
 * with this same function so the page sizes agree.
 */
export function imageDpi(bytes: Uint8Array): ImageDpi | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return pngDpi(bytes);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDpi(bytes);
  if (bytes.length >= 8 && ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d))) {
    return tiffDpi(bytes, 0, bytes.length);
  }
  return null;
}

const u16 = (b: Uint8Array, i: number, le = false) => (le ? b[i]! | (b[i + 1]! << 8) : (b[i]! << 8) | b[i + 1]!);
const u32 = (b: Uint8Array, i: number, le = false) =>
  le ? (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0 : ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;

function pngDpi(b: Uint8Array): ImageDpi | null {
  let i = 8;
  while (i + 12 <= b.length) {
    const len = u32(b, i);
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    if (type === "pHYs" && i + 8 + 9 <= b.length) {
      // Unit 1 is per metre; unit 0 gives an aspect ratio only, which is not a density.
      if (b[i + 16] !== 1) return null;
      return { x: u32(b, i + 8) * 0.0254, y: u32(b, i + 12) * 0.0254 };
    }
    if (type === "IDAT" || type === "IEND") return null;
    i += 12 + len;
  }
  return null;
}

function jpegDpi(b: Uint8Array): ImageDpi | null {
  let jfif: ImageDpi | null = null;
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    // Start of scan: no more metadata segments.
    if (marker === 0xda || marker === 0xd9) break;
    const len = u16(b, i + 2);
    const start = i + 4;
    const end = Math.min(b.length, i + 2 + len);
    if (marker === 0xe0 && end - start >= 12 && ascii(b, start, 5) === "JFIF\0") {
      const unit = b[start + 7];
      const x = u16(b, start + 8);
      const y = u16(b, start + 10);
      if (unit === 1) jfif = { x, y };
      else if (unit === 2) jfif = { x: x * 2.54, y: y * 2.54 };
    }
    if (marker === 0xe1 && end - start >= 14 && ascii(b, start, 6) === "Exif\0\0") {
      const exif = tiffDpi(b, start + 6, end);
      if (exif) return exif;
    }
    i += 2 + len;
  }
  return jfif;
}

/** Resolution tags of a TIFF structure's first IFD — a TIFF file, or the body of a JPEG's EXIF segment. */
function tiffDpi(b: Uint8Array, base: number, end: number): ImageDpi | null {
  if (base + 8 > end) return null;
  const le = b[base] === 0x49;
  const ifd = base + u32(b, base + 4, le);
  if (ifd + 2 > end) return null;
  const count = u16(b, ifd, le);
  let x = 0;
  let y = 0;
  let unit = 2;
  let orientation = 1;
  for (let n = 0; n < count; n++) {
    const e = ifd + 2 + n * 12;
    if (e + 12 > end) break;
    const tag = u16(b, e, le);
    const rational = () => {
      const at = base + u32(b, e + 8, le);
      if (at + 8 > end) return 0;
      const den = u32(b, at + 4, le);
      return den ? u32(b, at, le) / den : 0;
    };
    if (tag === 0x011a) x = rational();
    else if (tag === 0x011b) y = rational();
    else if (tag === 0x0128) unit = u16(b, e + 8, le);
    else if (tag === 0x0112) orientation = u16(b, e + 8, le);
  }
  if (!x || !y || (unit !== 2 && unit !== 3)) return null;
  const k = unit === 3 ? 2.54 : 1;
  return orientation >= 5 && orientation <= 8 ? { x: y * k, y: x * k } : { x: x * k, y: y * k };
}

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[at + i] ?? 0);
  return s;
}
