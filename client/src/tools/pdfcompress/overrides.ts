import {
  CODECS,
  type CodecId,
  type CompressParams,
  type CropParams,
  type CropResult,
  type ImageOverride,
  type PdfImage,
} from "@tools/shared";

/** The resolution range the DPI controls offer — below 36 text in a scan stops being legible, above 600 nothing gains. */
export const DPI_MIN = 36;
export const DPI_MAX = 600;

export const clampDpi = (n: number) => Math.min(DPI_MAX, Math.max(DPI_MIN, Math.round(n)));
export const clampQuality = (n: number) => Math.min(100, Math.max(1, Math.round(n)));

/** Short names for a codec in a table cell or a one-line summary. */
export const CODEC_SHORT: Record<CodecId, string> = {
  mozjpeg: "jpeg",
  openjpeg: "jpeg 2000",
  libjxl: "jpeg xl",
  flate: "flate",
};

/**
 * `lossy · alpha as soft mask · every viewer · /DCTDecode` — what a codec
 * trades, in one line, straight from the capability table so the words can't
 * drift from what the worker writes. Same words as #13's `codecCapabilities`
 * (components/pdf/CodecCapabilities.tsx); once both are merged, one can go.
 */
export function codecLine(codec: CodecId): string {
  const c = CODECS[codec];
  const kind = c.lossy && c.lossless ? "lossy + lossless" : c.lossy ? "lossy" : "lossless";
  const alpha = c.alpha === "inline" ? "alpha in stream" : "alpha as soft mask";
  const viewers = { all: "every viewer", most: "most viewers", few: "few viewers" }[c.viewers];
  return [kind, alpha, viewers, `/${c.filter}`].join(" · ");
}

/** An override with its unset fields dropped; `null` when nothing is left, so the image follows the run again. */
export function pruneOverride(o: ImageOverride): ImageOverride | null {
  const out: ImageOverride = {};
  if (o.codec !== undefined) out.codec = o.codec;
  if (o.quality !== undefined) out.quality = o.quality;
  if (o.dpiCap !== undefined) out.dpiCap = o.dpiCap;
  if (o.skip) out.skip = true;
  return Object.keys(out).length ? out : null;
}

/** `jpeg 2000 · q60 · 100 dpi` / `skip` — an image's override in the table's trailing cell; null when it has none. */
export function describeOverride(o: ImageOverride | undefined): string | null {
  if (!o) return null;
  if (o.skip) return "skip";
  const parts = [
    o.codec ? CODEC_SHORT[o.codec] : null,
    o.quality !== undefined ? `q${o.quality}` : null,
    o.dpiCap === null ? "full res" : o.dpiCap !== undefined ? `${o.dpiCap} dpi` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** What one image is actually written with: the run's settings with its override laid over them. */
export function effectiveFor(params: CompressParams, o: ImageOverride | undefined) {
  return {
    codec: o?.codec ?? params.codec,
    quality: o?.quality ?? params.quality,
    dpiCap: o?.dpiCap !== undefined ? o.dpiCap : params.dpiCap,
    skip: !!o?.skip,
  };
}

/** The side of the square the crop shows, in image pixels — about 1:1 at the panel's width. */
export const CROP_SIDE = 400;

export type Box = [number, number, number, number];

/** Whether an image is big enough that a crop is only part of it, so there is something to pick. */
export const canPick = (image: PdfImage) => image.width > CROP_SIDE || image.height > CROP_SIDE;

/**
 * The crop box, `[left, top, right, bottom]` in image pixels from the top-left
 * corner, as a square of `CROP_SIDE` (or the whole side when the image is
 * smaller) centred on a point and pushed back inside the image.
 */
export function boxAround(image: PdfImage, cx: number, cy: number): Box {
  const w = Math.min(CROP_SIDE, image.width);
  const h = Math.min(CROP_SIDE, image.height);
  const left = Math.round(Math.min(Math.max(cx - w / 2, 0), image.width - w));
  const top = Math.round(Math.min(Math.max(cy - h / 2, 0), image.height - h));
  return [left, top, left + w, top + h];
}

/** The box the worker uses for `box: null` — the centre — so the overview can draw it. */
export const centreBox = (image: PdfImage): Box => boxAround(image, image.width / 2, image.height / 2);

/**
 * The crop task's params. Only this image's override is sent, so changing
 * another row's override doesn't redraw this one — the params double as the
 * cache key for a crop already drawn. A crop draws the settings as set and
 * never searches, so the target size (#12) is left off and editing it doesn't
 * ask the worker again.
 */
export function cropParams(params: CompressParams, imageId: string, box: Box | null): CropParams {
  const own = params.overrides[imageId];
  return { imageId, params: { ...params, overrides: own ? { [imageId]: own } : {}, target: null }, box };
}

/** A crop task's `result`, checked before its names go into URLs. */
export function asCropResult(value: unknown): CropResult | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<CropResult>;
  if (typeof r.before !== "string" || typeof r.after !== "string" || typeof r.afterBytes !== "number") return null;
  return r as CropResult;
}
