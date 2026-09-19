import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CropParams, CropResult, PdfAnalysis } from "@tools/shared";
import { readParams } from "../compress";
import {
  decodeEncoded,
  decodeImage,
  encodeImage,
  imagePasses,
  isOutOfMemory,
  Kept,
  listImages,
  MIN_IMAGE_BYTES,
  settingsFor,
  storedBytes,
  type ImageInfo,
  type Pixels,
} from "../compress/imagecodec";
import { registerHandler, TaskError, type TaskContext } from "../jobs";
import { passwordFile } from "../special";

/**
 * A `crop` task (#10): one image, zoomed, before and after — the same region
 * of the original and of what a run with these settings would write for it,
 * encoded by the same code the run uses (compress/imagecodec.ts). It runs in
 * the priority lane, beside a compress, so it only ever encodes one image.
 *
 * `box` is `[left, top, right, bottom]` in the image's pixels, top-left
 * origin; null is a `CROP_SIDE` square in the centre (the client's
 * `centreBox`). The after crop covers the same region in the after image's
 * own pixels — fewer of them when it was downsampled; the client scales both
 * to one size. `afterBytes` is the whole image re-encoded, masks included,
 * comparable with `PdfImage.bytes`; the original's bytes when the run would
 * keep it as it is.
 */

const BEFORE = "before.png";
const AFTER = "after.png";
/** The client's `CROP_SIDE`. */
const CROP_SIDE = 400;

type Box = [number, number, number, number];

function readCrop(raw: unknown): { imageId: number; params: unknown; box: Box | null } {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<CropParams>;
  const id = typeof p.imageId === "string" && /^\d{1,9}$/.test(p.imageId) ? Number(p.imageId) : 0;
  if (!id) throw new TaskError("These crop settings aren't valid — reload the page and try again.");
  const box = Array.isArray(p.box) && p.box.length === 4 && p.box.every((n) => typeof n === "number" && Number.isFinite(n)) ? (p.box as Box) : null;
  return { imageId: id, params: p.params, box };
}

/** The box inside a `width`×`height` image, at least a pixel; the centre square when there is none. */
function clampBox(box: Box | null, width: number, height: number): Box {
  if (!box) {
    const w = Math.min(CROP_SIDE, width);
    const h = Math.min(CROP_SIDE, height);
    const left = Math.floor((width - w) / 2);
    const top = Math.floor((height - h) / 2);
    return [left, top, left + w, top + h];
  }
  const l = Math.min(Math.max(0, Math.floor(box[0])), width - 1);
  const t = Math.min(Math.max(0, Math.floor(box[1])), height - 1);
  const r = Math.max(l + 1, Math.min(width, Math.ceil(box[2])));
  const b = Math.max(t + 1, Math.min(height, Math.ceil(box[3])));
  return [l, t, r, b];
}

/** Writes `box` (in `from` pixels) of `px`, scaled to its own pixel size, as a PNG. */
async function cropTo(ctx: TaskContext, px: Pixels, box: Box, from: { width: number; height: number }, out: string): Promise<void> {
  const sx = px.width / from.width;
  const sy = px.height / from.height;
  const [l, t, r, b] = clampBox([box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy], px.width, px.height);
  // Our own PNM (ppmload is on vips' untrusted list, so no VIPS_BLOCK_UNTRUSTED here).
  await ctx.run("vips", ["extract_area", px.path, out, String(l), String(t), String(r - l), String(b - t)], { label: "vips" });
}

registerHandler("crop", async (ctx) => {
  const input = ctx.inputs[0];
  if (!input) throw new Error("crop needs one input");
  const crop = readCrop(ctx.task.params);
  const params = readParams(crop.params);
  const analysis = (ctx.analysis as PdfAnalysis | null) ?? null;
  const known = analysis?.images.find((i) => i.id === String(crop.imageId));
  const password = ctx.job.password ? await passwordFile(ctx.workDir, ctx.job.password) : undefined;

  ctx.progress("drawing the crop", 0, 2);
  const [info]: (ImageInfo | undefined)[] = await listImages(ctx, input.path, {
    ids: [crop.imageId],
    pages: known?.pages,
    password,
  });
  if (!info) throw new TaskError("That image isn't in this file.");
  const dir = join(ctx.workDir, "crop");
  await mkdir(dir, { recursive: true });
  const box = clampBox(crop.box, info.width, info.height);
  const size = { width: info.width, height: info.height };

  let before: Pixels;
  try {
    before = await decodeImage(ctx, input.path, info, dir, { password, rgb: true });
  } catch (err) {
    if (err instanceof Kept) throw new TaskError("This image is too large to preview in the memory this server has.");
    throw err;
  }
  await cropTo(ctx, before, box, size, join(ctx.outDir, BEFORE));
  ctx.progress("drawing the crop", 1, 2);

  let after = before;
  let afterBytes = storedBytes(info);
  const override = params.overrides[String(crop.imageId)];
  const settings = settingsFor(params, override, imagePasses(params));
  // What the run would leave alone: skipped, too small to bother with (compress/images.ts).
  if (settings && (override || afterBytes >= MIN_IMAGE_BYTES)) {
    try {
      // The decoded "before" is the encoder's input too, when it is gray or RGB (rgb mode changed nothing).
      const source = info.colour === "gray" || info.colour === "rgb" ? before : undefined;
      const out = await encodeImage(ctx, { pdf: input.path, info, settings, dir, password, source });
      // A run keeps the original when re-encoding doesn't make it smaller (unless it had to go gray).
      if (out.total < afterBytes || out.gray) {
        after = await decodeEncoded(ctx, out, dir);
        afterBytes = out.total;
      }
    } catch (err) {
      // Kept as it is by the run: the after is the before.
      if (!(err instanceof Kept) && !(err instanceof TaskError && isOutOfMemory(err))) throw err;
    }
  }
  await cropTo(ctx, after, box, size, join(ctx.outDir, AFTER));
  ctx.progress("drawing the crop", 2, 2);

  const result: CropResult = { before: BEFORE, after: AFTER, afterBytes };
  return { result };
});
