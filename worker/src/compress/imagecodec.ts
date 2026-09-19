import { open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  planPasses,
  type CodecId,
  type CompressParams,
  type ImageOverride,
} from "@tools/shared";
import { TaskError, type TaskContext } from "../jobs";
import { extractIdat } from "../images";
import { ANALYSIS_MAX_PAGES, headroom, needsPredownsample } from "../limits";
import { wantedPasses } from "./pipeline";

/**
 * One image of a PDF, decoded, resampled and encoded again (#10). MuPDF 1.25
 * can't rewrite images from JS, so the pixels leave the PDF
 * (scripts/images.js), go through libvips (Lanczos), mozjpeg, OpenJPEG or a
 * PNG deflate, and come back as raw streams. The compress step
 * (./images.ts), the crop task (handlers/crop.ts) and the target-size search
 * (#12) all go through here, so a crop shows exactly what a run writes.
 *
 * For #12:
 *
 *   const [info] = await listImages(ctx, pdf, { ids: [id] });
 *   const source = await decodeImage(ctx, pdf, info, dir);          // once per image
 *   const out = await encodeImage(ctx, { pdf, info, settings: { codec, quality, dpiCap, grayscale: false }, dir, source, tag: "q60" });
 *   // out.file, out.total (bytes of the image with its masks as written) — compare with storedBytes(info)
 *   await writeImages(ctx, pdf, outPdf, [out, …]);
 *
 * `encodeImage` throws `Kept` (reason) for an image that stays as it is and
 * `TaskError` when a tool fails or memory runs out (`isOutOfMemory`).
 *
 * Scratch files are named by object number and `tag`, so several tries of one
 * image can sit side by side; the caller deletes what it no longer needs.
 */

const SCRIPT = join(import.meta.dir, "../../scripts/images.js");
/**
 * libvips on bytes out of the upload: untrusted loaders (magick, pdf, svg, …)
 * blocked, and only explicit loaders used. The PNM files MuPDF writes are
 * ours, but ppmload counts as untrusted, so vips on those runs without the block.
 */
const VIPS_ENV = { VIPS_BLOCK_UNTRUSTED: "1" };
/** An image is only downsampled when it is this much over the cap — resampling by a few percent blurs for nothing. */
export const DOWNSAMPLE_SLACK = 1.1;
/** Below this, an image without an override isn't worth a process start — a run leaves it as it is. */
export const MIN_IMAGE_BYTES = 4096;
/** How long the page walk that finds each image's resolution may take. */
const LIST_DEADLINE_MS = 60_000;

export type ImageInfo = {
  /** Object number — `PdfImage.id` as a number. */
  id: number;
  width: number;
  height: number;
  bpc: number;
  colour: "gray" | "rgb" | "cmyk" | "indexed" | "lab" | "separation" | "devicen" | "none" | "other";
  /** "DeviceRGB", "ICCBased(4)", … for sentences. */
  colourName: string;
  filters: string[];
  imageMask: boolean;
  defaultDecode: boolean;
  /** A /Mask colour-key array. */
  colourKey: boolean;
  /** JPX with its alpha in the codestream. */
  smaskInData: boolean;
  smask: { id: number; width: number; height: number; bpc: number; bytes: number; matte: boolean } | null;
  /** The image stream as stored. */
  bytes: number;
  /** A stencil /Mask stream's bytes, which stays as it is. */
  maskBytes: number;
  /** Lowest effective DPI over its placements — its largest drawing. Null when never drawn (or not reached). */
  dpi: number | null;
  /** First page it is drawn on, 1-based. */
  page: number | null;
};

/** Bytes of the image with its masks, as `PdfImage.bytes` counts them. */
export const storedBytes = (i: ImageInfo) => i.bytes + (i.smask?.bytes ?? 0) + i.maskBytes;

/** What one image is written with: the run's settings with its override laid over them. */
export type ImageSettings = { codec: CodecId; quality: number; dpiCap: number | null; grayscale: boolean };

/**
 * Settings for one image, or null when its override says skip. `downsample`
 * and `grayscale` say whether the run does those passes; an override's own
 * DPI cap applies either way — asking for 100 dpi on one image is asking.
 */
export function settingsFor(
  params: CompressParams,
  override: ImageOverride | undefined,
  passes: { downsample: boolean; grayscale: boolean },
): ImageSettings | null {
  if (override?.skip) return null;
  return {
    codec: override?.codec ?? params.codec,
    quality: override?.quality ?? params.quality,
    dpiCap: override && override.dpiCap !== undefined ? override.dpiCap : passes.downsample ? params.dpiCap : null,
    grayscale: passes.grayscale,
  };
}

/** Which image passes a run with these params does — for callers outside the pipeline (the crop). */
export function imagePasses(params: CompressParams): { downsample: boolean; grayscale: boolean } {
  const run = planPasses(params.engine, wantedPasses(params)).run;
  return { downsample: run.includes("downsample"), grayscale: run.includes("grayscale") };
}

// ── why an image stays as it is ────────────────────────────────────────────

export type KeepReason =
  | "stencil"
  | "bitonal"
  | "cmyk"
  | "indexed"
  | "colour"
  | "colour-key"
  | "inline-alpha"
  | "memory"
  | "unreadable"
  | "jxl"
  | "larger";

export class Kept extends Error {
  constructor(readonly reason: KeepReason) {
    super(`kept: ${reason}`);
  }
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A note per reason for RunResult.notes; null for reasons that are simply how such images are. */
export function keptNote(reason: KeepReason, n: number): string | null {
  const imgs = count(n, "image");
  switch (reason) {
    case "cmyk":
      return `${count(n, "CMYK image")} kept as ${n === 1 ? "it was" : "they were"} — without colour management here, re-encoding would shift ${n === 1 ? "its" : "their"} colours.`;
    case "indexed":
      return `${count(n, "palette image")} kept as ${n === 1 ? "it was" : "they were"} — a palette already stores ${n === 1 ? "it" : "them"} compactly.`;
    case "colour":
      return `${imgs} in special colour spaces (spot, Lab or DeviceN) kept as ${n === 1 ? "it was" : "they were"}.`;
    case "colour-key":
      return `${imgs} with colour-key transparency kept as ${n === 1 ? "it was" : "they were"} — lossy re-encoding would break the transparent colour.`;
    case "inline-alpha":
      return `${imgs} with transparency inside the JPEG 2000 stream kept as ${n === 1 ? "it was" : "they were"}.`;
    case "memory":
      return `${imgs} ${n === 1 ? "was" : "were"} too large to re-encode in the memory this server has, and kept as ${n === 1 ? "it was" : "they were"}.`;
    case "unreadable":
      return `${imgs} couldn't be decoded and ${n === 1 ? "was" : "were"} kept as ${n === 1 ? "it was" : "they were"}.`;
    case "jxl":
      return JXL_NOT_YET;
    default:
      return null;
  }
}

/** #14 fills the libjxl branch in `encodeImage`; until then this is why nothing is written as JPEG XL. */
export const JXL_NOT_YET = "JPEG XL isn't available yet — images set to it keep their encoding.";

/**
 * Why an image is left as it is whatever the settings, from its dictionary.
 * Bitonal scans stay (never lossy JBIG2, and JPEG would blur and grow them);
 * CMYK, palette and special colour spaces stay rather than converting colour
 * without the ICC management this MuPDF build lacks.
 */
export function keepReason(i: ImageInfo): KeepReason | null {
  const jpx = i.filters.includes("JPXDecode");
  if (i.imageMask) return "stencil";
  if (i.filters.some((f) => f === "JBIG2Decode" || f === "CCITTFaxDecode")) return "bitonal";
  if (!jpx && i.bpc > 0 && i.bpc < 8) return "bitonal";
  if (i.colour === "cmyk") return "cmyk";
  if (i.colour === "indexed") return "indexed";
  if (i.colour === "none" ? !jpx : i.colour !== "gray" && i.colour !== "rgb") return "colour";
  if (i.colourKey) return "colour-key";
  if (i.smaskInData) return "inline-alpha";
  return null;
}

/** The pixel size the settings ask for: the cap over the image's lowest placement DPI, never larger. */
export function targetSize(i: ImageInfo, s: ImageSettings): { width: number; height: number } {
  if (s.dpiCap === null || i.dpi === null || i.dpi <= s.dpiCap * DOWNSAMPLE_SLACK) return { width: i.width, height: i.height };
  const scale = s.dpiCap / i.dpi;
  return { width: Math.max(1, Math.round(i.width * scale)), height: Math.max(1, Math.round(i.height * scale)) };
}

// ── listing ────────────────────────────────────────────────────────────────

/**
 * The image XObjects in `pdf` (masks folded into their owners), with each
 * one's lowest placement DPI. `ids` / `pages` narrow the walk (the crop knows
 * both from the analysis).
 */
export async function listImages(
  ctx: TaskContext,
  pdf: string,
  opts: { ids?: number[]; pages?: number[]; password?: string } = {},
): Promise<ImageInfo[]> {
  const out = join(ctx.workDir, `images-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  await ctx.run(
    "mutool",
    [
      "run",
      SCRIPT,
      "list",
      pdf,
      out,
      opts.ids ? opts.ids.join(",") : "all",
      opts.pages?.length ? opts.pages.join(",") : "all",
      String(ANALYSIS_MAX_PAGES),
      String(LIST_DEADLINE_MS),
      ...(opts.password ? [opts.password] : []),
    ],
    { label: "MuPDF", where: "while reading the images", timeoutMs: LIST_DEADLINE_MS * 2 },
  );
  return JSON.parse(await readFile(out, "utf8")) as ImageInfo[];
}

// ── pixels ─────────────────────────────────────────────────────────────────

/** Samples as a binary PNM (P5 gray / P6 RGB) — what vips, cjpeg and opj_compress all read. */
export type Pixels = { path: string; width: number; height: number; channels: 1 | 3 };

const pnmName = (dir: string, stem: string, channels: number) => join(dir, `${stem}.${channels === 1 ? "pgm" : "ppm"}`);
const where = (i: ImageInfo) => `${i.page ? `on page ${i.page} ` : ""}(image ${i.width}×${i.height})`;
const HINT = "Try a lower DPI cap, or skip that image.";

/** Width, height and channels from a binary PNM's header. */
export async function pnmSize(path: string): Promise<{ width: number; height: number; channels: 1 | 3 }> {
  const f = await open(path, "r");
  try {
    const head = Buffer.alloc(512);
    const { bytesRead } = await f.read(head, 0, head.length, 0);
    const text = head.subarray(0, bytesRead).toString("latin1").replace(/#[^\n]*\n/g, " ");
    const m = /^P([56])\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(text);
    if (!m) throw new Error(`${path} is not a binary PGM/PPM`);
    return { channels: m[1] === "5" ? 1 : 3, width: Number(m[2]), height: Number(m[3]) };
  } finally {
    await f.close();
  }
}

/**
 * The image's samples at full size, or — when that won't fit in memory and
 * it is a plain JPEG — shrunk on load by libjpeg (1/2, 1/4, 1/8) to the
 * largest size that fits, never below `atLeast`. `rgb` converts other colour
 * spaces for showing (the crop's "before"); without it, only gray and RGB
 * images decode. Throws `Kept("memory")` when nothing fits.
 */
export async function decodeImage(
  ctx: TaskContext,
  pdf: string,
  info: ImageInfo,
  dir: string,
  opts: {
    password?: string;
    rgb?: boolean;
    atLeast?: { width: number; height: number };
    tag?: string;
    /** Memory to plan against; the current headroom by default. */
    room?: number;
  } = {},
): Promise<Pixels> {
  const channels = info.colour === "gray" ? 1 : 3;
  const stem = `${info.id}-source${opts.tag ? `-${opts.tag}` : ""}`;
  const room = opts.room ?? headroom();
  if (!needsPredownsample(info.width, info.height, channels, room)) {
    const out = join(dir, `${stem}.pnm`);
    await ctx.run("mutool", ["run", SCRIPT, "decode", pdf, String(info.id), out, opts.rgb ? "rgb" : "raw", ...(opts.password ? [opts.password] : [])], {
      label: "MuPDF",
      where: where(info),
      hint: HINT,
    });
    return { path: out, ...(await pnmSize(out)) };
  }

  const plainJpeg = info.filters.length === 1 && info.filters[0] === "DCTDecode" && info.defaultDecode && (info.colour === "gray" || info.colour === "rgb");
  const min = opts.atLeast ?? { width: info.width, height: info.height };
  const shrink = [8, 4, 2].find(
    (s) =>
      Math.ceil(info.width / s) >= min.width &&
      Math.ceil(info.height / s) >= min.height &&
      !needsPredownsample(Math.ceil(info.width / s), Math.ceil(info.height / s), channels, room),
  );
  if (!plainJpeg || !shrink) throw new Kept("memory");
  const raw = join(dir, `${stem}.jpg`);
  await ctx.run("mutool", ["run", SCRIPT, "raw", pdf, String(info.id), raw, ...(opts.password ? [opts.password] : [])], {
    label: "MuPDF",
    where: where(info),
  });
  const out = pnmName(dir, stem, channels);
  await ctx.run("vips", ["jpegload", raw, out, "--shrink", String(shrink)], { env: VIPS_ENV, label: "vips", where: where(info), hint: HINT });
  return { path: out, ...(await pnmSize(out)) };
}

/** Lanczos to exactly `width`×`height`; the file as it is when it is already that small. */
async function resize(ctx: TaskContext, px: Pixels, size: { width: number; height: number }, out: string, info: ImageInfo): Promise<Pixels> {
  if (size.width >= px.width && size.height >= px.height) return px;
  const h = Math.min(1, size.width / px.width);
  const v = Math.min(1, size.height / px.height);
  await ctx.run("vips", ["resize", px.path, out, String(h), "--vscale", String(v), "--kernel", "lanczos3"], {
    label: "vips",
    where: where(info),
    hint: HINT,
  });
  return { path: out, ...(await pnmSize(out)) };
}

/** A PNG deflate of the samples, as a FlateDecode stream with PNG predictors (its IDAT data). */
async function deflate(ctx: TaskContext, px: Pixels, stem: string, dir: string, info: ImageInfo): Promise<{ file: string; bytes: number }> {
  const png = join(dir, `${stem}.png`);
  await ctx.run("vips", ["pngsave", px.path, png, "--compression", "9", "--filter", "all"], {
    label: "vips",
    where: where(info),
    hint: HINT,
  });
  const file = join(dir, `${stem}.idat`);
  const bytes = await extractIdat(png, file);
  await rm(png, { force: true });
  return { file, bytes };
}

/** OpenJPEG's quality: PSNR in dB for 1–99 (irreversible 9/7 wavelet), lossless 5/3 at 100. */
export const jpxPsnr = (quality: number) => 22 + quality * 0.2;

// ── encoding ───────────────────────────────────────────────────────────────

export type Encoded = {
  id: number;
  /** The stream to write, as stored. */
  file: string;
  filter: "DCTDecode" | "JPXDecode" | "FlateDecode";
  width: number;
  height: number;
  colors: 1 | 3;
  /** FlateDecode with PNG predictors (DecodeParms written with it). */
  predictor: boolean;
  /** Converted to gray: the colour space becomes DeviceGray. */
  gray: boolean;
  /** Smaller than the image in pixels. */
  downsampled: boolean;
  /** A resampled soft mask, when the image's size changed (lossless, FlateDecode). */
  smask?: { file: string; width: number; height: number; bytes: number };
  /** The image stream's bytes. */
  bytes: number;
  /** Bytes of the image with its masks once written — compare with `storedBytes(info)`. */
  total: number;
  /** The samples that were encoded — what a lossless codec's output decodes to. */
  pixels: Pixels;
};

/**
 * Encodes one image under `settings`: decode (unless `source` is given),
 * Lanczos to the DPI cap, gray if asked, then the codec. Throws `Kept` for an
 * image that stays as it is (its dictionary, memory, or a codec not
 * available yet) and `TaskError` when a tool fails or runs out of memory.
 * Whether to use the result — it may be bigger — is the caller's call.
 */
export async function encodeImage(
  ctx: TaskContext,
  job: { pdf: string; info: ImageInfo; settings: ImageSettings; dir: string; password?: string; source?: Pixels; tag?: string },
): Promise<Encoded> {
  const { info, settings, dir } = job;
  const reason = keepReason(info);
  if (reason) throw new Kept(reason);
  // #14: the libjxl branch goes here — cjxl the pixels, and the crop decodes the JXL for its "after".
  if (settings.codec === "libjxl") throw new Kept("jxl");

  const stem = `${info.id}${job.tag ? `-${job.tag}` : ""}`;
  const target = targetSize(info, settings);
  const source = job.source ?? (await decodeImage(ctx, job.pdf, info, dir, { password: job.password, atLeast: target, tag: job.tag }));
  let px = await resize(ctx, source, target, pnmName(dir, `${stem}-resized`, source.channels), info);
  const downsampled = px.width < info.width || px.height < info.height;

  // Gray keeps a Matte'd (premultiplied) image in colour: its Matte has one value per colour channel.
  const gray = settings.grayscale && px.channels === 3 && !info.smask?.matte;
  if (gray) {
    const out = pnmName(dir, `${stem}-gray`, 1);
    await ctx.run("vips", ["colourspace", px.path, out, "b-w"], { label: "vips", where: where(info), hint: HINT });
    px = { path: out, ...(await pnmSize(out)) };
  }

  let file: string;
  let filter: Encoded["filter"];
  let predictor = false;
  switch (settings.codec) {
    case "mozjpeg": {
      file = join(dir, `${stem}.jpg`);
      filter = "DCTDecode";
      await ctx.run("cjpeg", ["-quality", String(settings.quality), "-outfile", file, px.path], {
        label: "mozjpeg",
        where: where(info),
        hint: HINT,
      });
      break;
    }
    case "openjpeg": {
      file = join(dir, `${stem}.j2k`);
      filter = "JPXDecode";
      // Every resolution level must be at least a pixel: at most log2 of the short side, plus one.
      const levels = Math.max(1, Math.min(6, Math.floor(Math.log2(Math.min(px.width, px.height))) + 1));
      const lossy = settings.quality < 100 ? ["-I", "-q", jpxPsnr(settings.quality).toFixed(1)] : [];
      await ctx.run("opj_compress", ["-i", px.path, "-o", file, "-n", String(levels), ...lossy], {
        label: "OpenJPEG",
        where: where(info),
        hint: HINT,
      });
      break;
    }
    case "flate": {
      const d = await deflate(ctx, px, stem, dir, info);
      file = d.file;
      filter = "FlateDecode";
      predictor = true;
      break;
    }
  }
  const bytes = (await stat(file)).size;

  let smask: Encoded["smask"];
  if (info.smask && downsampled) {
    // The mask follows the image's new size, losslessly (a mask of another size keeps its own proportion).
    const m = info.smask;
    const size = {
      width: Math.max(1, Math.round((m.width * px.width) / info.width)),
      height: Math.max(1, Math.round((m.height * px.height) / info.height)),
    };
    const maskInfo: ImageInfo = { ...info, id: m.id, width: m.width, height: m.height, bpc: 8, colour: "gray", smask: null, filters: [], defaultDecode: true };
    const decoded = await decodeImage(ctx, job.pdf, maskInfo, dir, { password: job.password, atLeast: size, tag: job.tag });
    const resized = await resize(ctx, decoded, size, pnmName(dir, `${m.id}-mask-resized${job.tag ? `-${job.tag}` : ""}`, 1), maskInfo);
    const d = await deflate(ctx, resized, `${m.id}-mask${job.tag ? `-${job.tag}` : ""}`, dir, maskInfo);
    smask = { file: d.file, width: resized.width, height: resized.height, bytes: d.bytes };
  }

  return {
    id: info.id,
    file,
    filter,
    width: px.width,
    height: px.height,
    colors: px.channels,
    predictor,
    gray,
    downsampled,
    smask,
    bytes,
    total: bytes + (smask ? smask.bytes : (info.smask?.bytes ?? 0)) + info.maskBytes,
    pixels: px,
  };
}

/**
 * The encoded stream decoded again, as the viewer will see it — the crop's
 * "after". A lossless stream is its own input.
 */
export async function decodeEncoded(ctx: TaskContext, e: Encoded, dir: string): Promise<Pixels> {
  if (e.filter === "FlateDecode") return e.pixels;
  const out = pnmName(dir, `${e.id}-after`, e.colors);
  if (e.filter === "DCTDecode") {
    await ctx.run("vips", ["jpegload", e.file, out], { env: VIPS_ENV, label: "vips" });
  } else {
    await ctx.run("opj_decompress", ["-i", e.file, "-o", out], { label: "OpenJPEG" });
  }
  return { path: out, ...(await pnmSize(out)) };
}

/** Writes the encoded images into `pdf` as `out`, object numbers unchanged. */
export async function writeImages(ctx: TaskContext, pdf: string, out: string, images: Encoded[], password?: string): Promise<void> {
  const list = join(ctx.workDir, `replace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  await Bun.write(
    list,
    JSON.stringify(
      images.map((e) => ({
        id: e.id,
        file: e.file,
        filter: e.filter,
        width: e.width,
        height: e.height,
        colors: e.colors,
        predictor: e.predictor,
        gray: e.gray,
        smask: e.smask && { file: e.smask.file, width: e.smask.width, height: e.smask.height },
      })),
    ),
  );
  await ctx.run("mutool", ["run", SCRIPT, "replace", pdf, out, list, ...(password ? [password] : [])], {
    label: "MuPDF",
    where: "while writing the images back",
  });
}

/** Whether a TaskError is the out-of-memory sentence (limits.outOfMemorySentence). */
export const isOutOfMemory = (err: unknown) => err instanceof TaskError && err.message.startsWith("Ran out of memory");
