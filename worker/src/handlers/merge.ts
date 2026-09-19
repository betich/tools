import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_MERGE_ITEM,
  DEFAULT_MERGE_OUTPUT,
  imageDpi,
  PAPER_IDS,
  pageLayout,
  toPdfRect,
  type ImageDpi,
  type MergeItemOptions,
  type MergeOutput,
  type MergeResult,
  type PageLayout,
} from "@tools/shared";
import { registerHandler, TaskError, type TaskContext, type TaskInput } from "../jobs";
import {
  extractIdat,
  jpegInfo,
  placementMatrix,
  pngColors,
  pngInfo,
  pngPassesThrough,
  swapsAxes,
  type Orientation,
} from "../images";
import { predownsampleSize } from "../limits";

/**
 * Merge (#17): PDFs and images, in the order given, into one PDF.
 *
 * The pipeline is MuPDF for the parts it is good at and qpdf for the join:
 *
 * 1. Each image becomes a small PDF of its own (`scripts/merge-pages.js`),
 *    one `mutool run` per file, placed exactly where the shared `pageLayout`
 *    says — the same function the browser preview draws with, evaluated here
 *    in Bun and handed to the script as finished numbers. A JPEG goes in byte
 *    for byte as DCTDecode and its EXIF orientation becomes the placement
 *    matrix; a plain PNG's IDAT stream goes in as FlateDecode without being
 *    decoded; everything else is normalised by vips (or libheif) to PNG first.
 * 2. qpdf joins the original PDFs and those image PDFs page by page. It reads
 *    each source lazily and writes as it goes, where MuPDF's graft would copy
 *    every stream of every input into memory until the save — a 900 MB merge
 *    on a Pi that shares its 8 GB is the case this is built for.
 * 3. `scripts/merge-finish.js` adds what the join drops: a bookmark per file
 *    with each PDF's own outline nested under it, page labels, the title.
 *    It saves incrementally, so it copies no streams either.
 * 4. A last lossless qpdf pass packs objects into object streams.
 *
 * Named destinations, AcroForm field trees beyond what qpdf carries, and
 * structure trees of the source PDFs are not merged.
 */

const SCRIPTS = join(import.meta.dir, "..", "scripts");
const MAX_ITEMS = 200;
const MAX_FRAMES = 500;
const MAX_PAGES = 10_000;
/** mozjpeg quality when "compress images" is on: visually clean, about a third of lossless PNG for photos. */
const JPEG_QUALITY = 85;
const HEAD_BYTES = 512 * 1024;
/** vips must never reach for ImageMagick, poppler & co. on a user's file. */
const VIPS_ENV = { VIPS_BLOCK_UNTRUSTED: "1" };
const OOM_HINT = "Try a smaller copy of that file.";

type Item = { input: TaskInput; name: string; layout: MergeItemOptions };
type Options = { items: Item[]; output: MergeOutput };

/** A flate image as merge-pages.js takes it: a zlib stream of PNG-filtered rows. */
type FlateSpec = { type: "flate"; path: string; width: number; height: number; bpc: number; colors: number };
type ImageSpec = ({ type: "dct"; path: string } | FlateSpec) & { smask?: FlateSpec };
type PageSpec = { width: number; height: number; content: string; image: ImageSpec };
type FileEntry = { title: string; label: string; start: number; count: number; source: string | null };

// ── params ─────────────────────────────────────────────────────────────────

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

function layoutOf(v: unknown): MergeItemOptions {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof MergeItemOptions, unknown>>;
  const d = DEFAULT_MERGE_ITEM;
  return {
    mode: pick(o.mode, ["image", "paper"], d.mode),
    paper: pick(o.paper, PAPER_IDS, d.paper),
    fit: pick(o.fit, ["contain", "cover", "fill"], d.fit),
    orientation: pick(o.orientation, ["auto", "portrait", "landscape"], d.orientation),
    margin: typeof o.margin === "number" && Number.isFinite(o.margin) ? Math.min(Math.max(o.margin, 0), 1000) : d.margin,
    marginUnit: pick(o.marginUnit, ["mm", "pt"], d.marginUnit),
  };
}

/** Reads the task's params against the job's uploads. The client's `kind` is ignored — the sniffed one decides. */
function optionsOf(raw: unknown, inputs: TaskInput[]): Options {
  const p = (raw && typeof raw === "object" ? raw : {}) as { items?: unknown; output?: unknown };
  if (!Array.isArray(p.items) || !p.items.length) throw new TaskError("Add at least one file to merge.");
  if (p.items.length > MAX_ITEMS) throw new TaskError(`A merge takes at most ${MAX_ITEMS} files.`);
  const byId = new Map(inputs.map((i) => [i.id, i]));
  const items = p.items.map((raw): Item => {
    const it = (raw && typeof raw === "object" ? raw : {}) as { upload?: unknown; name?: unknown; layout?: unknown };
    const input = typeof it.upload === "string" ? byId.get(it.upload) : undefined;
    if (!input) throw new TaskError("One of the files is not part of this merge — add it again.");
    const name = typeof it.name === "string" && it.name.trim() ? it.name.trim().slice(0, 255) : input.name;
    return { input, name, layout: layoutOf(it.layout) };
  });
  const o = (p.output && typeof p.output === "object" ? p.output : {}) as Partial<Record<keyof MergeOutput, unknown>>;
  const d = DEFAULT_MERGE_OUTPUT;
  const output: MergeOutput = {
    title: typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 200) : null,
    bookmarks: bool(o.bookmarks, d.bookmarks),
    pageLabels: bool(o.pageLabels, d.pageLabels),
    compressImages: bool(o.compressImages, d.compressImages),
  };
  return { items, output };
}

/** A file name without its extension — the default title, as the client computes it. */
const stem = (name: string) => name.replace(/\.[^./\\]+$/, "").trim() || name.trim() || "merged";

/**
 * The download name: the title as typed, Unicode and case kept, with only the
 * characters a file system refuses replaced.
 */
export function mergeFileName(title: string): string {
  const safe = title
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.-]+|[\s.]+$/g, "")
    .slice(0, 150)
    .trim();
  return `${safe || "merged"}.pdf`;
}

// ── geometry ───────────────────────────────────────────────────────────────

const num = (v: number) => {
  const s = (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
};

/**
 * The page's content stream: clip to the layout's clip box under `cover`,
 * then draw /Im0 into the layout's image rect. `pageLayout` is top-left
 * origin; `toPdfRect` flips each rect for PDF user space.
 */
function contentStream(layout: PageLayout, orientation: Orientation): string {
  let s = "q\n";
  if (layout.clip) {
    const c = toPdfRect(layout, layout.clip);
    s += `${num(c.x)} ${num(c.y)} ${num(c.width)} ${num(c.height)} re W n\n`;
  }
  s += `${placementMatrix(toPdfRect(layout, layout.image), orientation).map(num).join(" ")} cm\n/Im0 Do\nQ\n`;
  return s;
}

function page(layout: PageLayout, orientation: Orientation, image: ImageSpec): PageSpec {
  return { width: layout.width, height: layout.height, content: contentStream(layout, orientation), image };
}

// ── tools ──────────────────────────────────────────────────────────────────

type Header = {
  width: number;
  height: number;
  bands: number;
  pages: number;
  orientation: Orientation;
  /** From the file's resolution tags, in dpi along the stored axes; null when it has none. */
  dpi: ImageDpi | null;
};

/** `vipsheader -a` for one image (or one page of a multi-page file). */
async function header(ctx: TaskContext, file: string, where: string): Promise<Header> {
  const r = await ctx.run("vipsheader", ["-a", file], { stdout: true, env: VIPS_ENV, label: "vips", where, hint: OOM_HINT, check: false });
  if (r.code !== 0) throw new TaskError(`${where.replace(/^in /, "")} could not be read as an image.`);
  const f = new Map<string, string>();
  for (const line of r.stdout.split("\n")) {
    const at = line.indexOf(": ");
    if (at > 0) f.set(line.slice(0, at).trim(), line.slice(at + 2).trim());
  }
  const n = (k: string) => Number(f.get(k));
  const o = n("orientation");
  // vips reports resolution in pixels per mm and invents 1 px/mm when the file has none; the unit is only set when it had some.
  const dpi = f.has("resolution-unit") && n("xres") > 0 && n("yres") > 0 ? { x: n("xres") * 25.4, y: n("yres") * 25.4 } : null;
  return {
    width: n("width"),
    height: n("height"),
    bands: n("bands") || 3,
    pages: Math.max(1, n("n-pages") || 1),
    orientation: o >= 1 && o <= 8 ? (o as Orientation) : 1,
    dpi,
  };
}

async function readHead(path: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(path).slice(0, HEAD_BYTES).arrayBuffer());
}

/** Splits a PNG's alpha off, when it has one, and lifts both out as flate specs. */
async function flateFromPng(ctx: TaskContext, png: string, tag: string, where: string): Promise<FlateSpec & { smask?: FlateSpec }> {
  const info = pngInfo(await readHead(png));
  if (!info || info.interlaced || info.colorType === 3) throw new Error(`unexpected PNG from vips: ${JSON.stringify(info)}`);
  const colors = pngColors(info.colorType);
  const alpha = info.colorType === 4 || info.colorType === 6;
  const base = { width: info.width, height: info.height, bpc: info.bitDepth };
  if (!alpha) {
    await extractIdat(png, join(ctx.workDir, `${tag}.idat`));
    return { type: "flate", path: join(ctx.workDir, `${tag}.idat`), colors, ...base };
  }
  const color = join(ctx.workDir, `${tag}-color.png`);
  const mask = join(ctx.workDir, `${tag}-alpha.png`);
  await ctx.run("vips", ["extract_band", png, color, "0", "--n", String(colors)], { env: VIPS_ENV, where, hint: OOM_HINT });
  await ctx.run("vips", ["extract_band", png, mask, String(colors)], { env: VIPS_ENV, where, hint: OOM_HINT });
  await extractIdat(color, join(ctx.workDir, `${tag}-color.idat`));
  await extractIdat(mask, join(ctx.workDir, `${tag}-alpha.idat`));
  return {
    type: "flate",
    path: join(ctx.workDir, `${tag}-color.idat`),
    colors,
    ...base,
    smask: { type: "flate", path: join(ctx.workDir, `${tag}-alpha.idat`), colors: 1, ...base },
  };
}

/**
 * With "compress images" on, the colour channels go through mozjpeg — unless
 * the JPEG comes out bigger than the lossless stream (flat screenshots and
 * line art do), in which case lossless stays. Alpha is always lossless.
 */
async function maybeJpeg(ctx: TaskContext, flate: FlateSpec & { smask?: FlateSpec }, png: string, tag: string, where: string): Promise<ImageSpec> {
  const colorPng = flate.smask ? join(ctx.workDir, `${tag}-color.png`) : png;
  const pnm = join(ctx.workDir, `${tag}.${flate.colors === 1 ? "pgm" : "ppm"}`);
  const jpg = join(ctx.workDir, `${tag}.jpg`);
  await ctx.run("vips", ["copy", colorPng, pnm], { env: VIPS_ENV, where, hint: OOM_HINT });
  await ctx.run("cjpeg", ["-quality", String(JPEG_QUALITY), "-outfile", jpg, pnm], { label: "mozjpeg", where, hint: OOM_HINT });
  const [jpegBytes, flateBytes] = await Promise.all([stat(jpg), stat(flate.path)]);
  if (jpegBytes.size >= flateBytes.size) return flate;
  return { type: "dct", path: jpg, ...(flate.smask ? { smask: flate.smask } : {}) };
}

// ── items → pages ──────────────────────────────────────────────────────────

type Built = { pages: PageSpec[]; notes: string[] };

/** A JPEG: bytes untouched, turned by the placement matrix when EXIF says so. */
async function jpegPages(item: Item): Promise<Built | null> {
  const head = await readHead(item.input.path);
  const info = jpegInfo(head);
  if (!info || ![1, 3, 4].includes(info.components) || !info.width || !info.height) return null;
  const turned = swapsAxes(info.orientation);
  const layout = pageLayout(
    { width: turned ? info.height : info.width, height: turned ? info.width : info.height, dpi: imageDpi(head) },
    item.layout,
  );
  return { pages: [page(layout, info.orientation, { type: "dct", path: item.input.path })], notes: [] };
}

/**
 * Anything else, one page per frame: vips normalises the frame to PNG — EXIF
 * orientation applied, colour to sRGB or grey — and its IDAT becomes the
 * page's image. The layout is always computed from the frame's full displayed
 * size, so shrinking a huge frame to fit memory changes its pixels, never
 * where it lands.
 */
async function rasterPages(ctx: TaskContext, item: Item, compress: boolean, n: number, of: number): Promise<Built> {
  const { input } = item;
  const notes: string[] = [];
  let source = input.path;
  let fileDpi: ImageDpi | null = null;
  const head = await readHead(input.path);

  if (input.kind === "heic" || input.kind === "avif") {
    // libheif applies the file's rotation and mirroring (irot/imir) as it decodes.
    source = join(ctx.workDir, `item${n}-decoded.png`);
    await ctx.run("heif-dec", ["--quiet", input.path, source], { label: "libheif", where: `in "${item.name}"`, hint: OOM_HINT });
  } else if (input.kind === "png") {
    fileDpi = imageDpi(head);
    const png = pngInfo(head);
    if (png && pngPassesThrough(png)) {
      const idat = join(ctx.workDir, `item${n}.idat`);
      await extractIdat(input.path, idat);
      const flate: FlateSpec = { type: "flate", path: idat, width: png.width, height: png.height, bpc: png.bitDepth, colors: pngColors(png.colorType) };
      const image = compress ? await maybeJpeg(ctx, flate, input.path, `item${n}`, `in "${item.name}"`) : flate;
      return { pages: [page(pageLayout({ width: png.width, height: png.height, dpi: fileDpi }, item.layout), 1, image)], notes };
    }
  }

  const first = await header(ctx, source, `in "${item.name}"`);
  const frames = input.kind === "tiff" ? Math.min(first.pages, MAX_FRAMES) : 1;
  if (input.kind === "tiff" && first.pages > MAX_FRAMES) notes.push(`Only the first ${MAX_FRAMES} of ${first.pages} pages of ${item.name} were merged.`);

  const pages: PageSpec[] = [];
  for (let f = 0; f < frames; f++) {
    const frameFile = frames > 1 || input.kind === "tiff" ? `${source}[page=${f}]` : source;
    const where = `in "${item.name}"${frames > 1 ? ` (page ${f + 1})` : ""}`;
    const h = f === 0 ? first : await header(ctx, frameFile, where);
    const turned = swapsAxes(h.orientation);
    const width = turned ? h.height : h.width;
    const height = turned ? h.width : h.height;
    const tiffDpi = h.dpi && turned ? { x: h.dpi.y, y: h.dpi.x } : h.dpi;
    const dpi = input.kind === "tiff" ? tiffDpi : fileDpi;
    const layout = pageLayout({ width, height, dpi }, item.layout);

    // Shrink on load when decoding the frame at full size would not fit in memory.
    const smaller = predownsampleSize(width, height, h.bands);
    const box = smaller ?? { width, height };
    if (smaller) notes.push(`${item.name}${frames > 1 ? ` page ${f + 1}` : ""} was scaled from ${width}×${height} to ${smaller.width}×${smaller.height} pixels to fit in memory.`);

    const tag = `item${n}-f${f}`;
    const png = join(ctx.workDir, `${tag}.png`);
    await ctx.run(
      "vips",
      ["thumbnail", frameFile, png, String(box.width), "--height", String(box.height), "--size", "down"],
      { env: VIPS_ENV, where: `${where} (image ${width}×${height})`, hint: OOM_HINT },
    );
    const flate = await flateFromPng(ctx, png, tag, where);
    const image = compress ? await maybeJpeg(ctx, flate, png, tag, where) : flate;
    pages.push(page(layout, 1, image));
    if (frames > 1) ctx.progress("preparing", n, of, `${item.name} · page ${f + 1} of ${frames}`);
  }
  return { pages, notes };
}

/** Pages of a PDF input, refusing one that needs a password to open. */
async function pdfPages(ctx: TaskContext, item: Item): Promise<number> {
  const locked = await ctx.run("qpdf", ["--requires-password", item.input.path], { check: false });
  // 0: a password is needed; 2: not encrypted; 3: encrypted, opens without one.
  if (locked.code === 0) throw new TaskError(`${item.name} is password-protected — remove the password and add it again.`);
  const r = await ctx.run("qpdf", ["--warning-exit-0", "--show-npages", item.input.path], { stdout: true, check: false, where: `in "${item.name}"` });
  const pages = Number(r.stdout.trim());
  if (r.code !== 0 || !Number.isInteger(pages) || pages < 1) throw new TaskError(`${item.name} could not be read as a PDF.`);
  return pages;
}

// ── the task ───────────────────────────────────────────────────────────────

registerHandler("merge", async (ctx) => {
  const { items, output } = optionsOf(ctx.task.params, ctx.inputs);
  const title = output.title ?? stem(items[0]!.name);
  const fileName = mergeFileName(title);
  const notes: string[] = [];
  const parts: string[] = [];
  const files: FileEntry[] = [];
  let total = 0;

  for (const [n, item] of items.entries()) {
    ctx.progress("preparing", n, items.length, item.name);
    let count: number;
    let source: string | null = null;
    if (item.input.kind === "pdf") {
      count = await pdfPages(ctx, item);
      source = item.input.path;
      parts.push(item.input.path);
    } else {
      const built =
        (item.input.kind === "jpeg" ? await jpegPages(item) : null) ??
        (await rasterPages(ctx, item, output.compressImages, n, items.length));
      notes.push(...built.notes);
      const spec = join(ctx.workDir, `item${n}.json`);
      const part = join(ctx.workDir, `item${n}.pdf`);
      await writeFile(spec, JSON.stringify({ pages: built.pages }));
      await ctx.run("mutool", ["run", join(SCRIPTS, "merge-pages.js"), spec, part], {
        label: "MuPDF",
        where: `while placing "${item.name}"`,
        hint: OOM_HINT,
      });
      count = built.pages.length;
      parts.push(part);
    }
    files.push({ title: item.name, label: stem(item.name).slice(0, 40), start: total, count, source });
    total += count;
    if (total > MAX_PAGES) throw new TaskError(`A merge makes at most ${MAX_PAGES.toLocaleString("en")} pages.`);
  }
  ctx.progress("preparing", items.length, items.length);

  ctx.progress("joining", 0, 1, `${total} pages`);
  const joined = join(ctx.workDir, "joined.pdf");
  await ctx.run("qpdf", ["--warning-exit-0", "--empty", "--pages", ...parts, "--", joined], {
    label: "qpdf",
    where: "while joining the files",
    hint: "Try merging fewer files at once.",
  });

  ctx.progress("bookmarks", 0, 1);
  const finishSpec = join(ctx.workDir, "finish.json");
  await writeFile(finishSpec, JSON.stringify({ title, bookmarks: output.bookmarks, pageLabels: output.pageLabels, pages: total, files }));
  await ctx.run("mutool", ["run", join(SCRIPTS, "merge-finish.js"), finishSpec, joined], {
    label: "MuPDF",
    where: "while adding bookmarks",
    hint: "Try turning bookmarks off.",
  });

  ctx.progress("optimising", 0, 1);
  const out = join(ctx.outDir, "merged.pdf");
  await ctx.run("qpdf", ["--warning-exit-0", "--object-streams=generate", "--compress-streams=y", joined, out], {
    label: "qpdf",
    where: "while writing the PDF",
    hint: "Try merging fewer files at once.",
  });
  ctx.progress("optimising", 1, 1);

  const result: MergeResult = { bytes: (await stat(out)).size, pages: total, fileName, notes };
  return { result, file: { name: "merged.pdf", downloadName: fileName } };
});
