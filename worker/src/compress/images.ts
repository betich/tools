import { mkdir, rm } from "node:fs/promises";
import { TaskError } from "../jobs";
import { passwordFile } from "../special";
import {
  encodeImage,
  isOutOfMemory,
  JXL_NOT_YET,
  Kept,
  keepReason,
  keptNote,
  listImages,
  MIN_IMAGE_BYTES,
  settingsFor,
  storedBytes,
  writeImages,
  type Encoded,
  type KeepReason,
} from "./imagecodec";
import { registerStep } from "./pipeline";

/**
 * Downsample and re-encode (#10), and grayscale when asked: every image,
 * largest first, is decoded, taken down to its DPI cap with Lanczos and
 * encoded with its codec at its quality (the run's, or its override's), and
 * goes back only if it came out smaller — or gray, when that was asked for.
 * Masks: a soft mask is resampled with its image and stays lossless; a
 * stencil mask stays as it is. What can't be re-encoded safely (CMYK, palette
 * and spot colour, colour-key masks, bitonal scans — never lossy JBIG2)
 * keeps its bytes; see imagecodec.ts for the per-image work.
 *
 * One image failing — out of memory under its cap, a codec refusing it —
 * keeps that image and the run goes on.
 */

const STAGE = "re-encoding images";

registerStep({
  id: "images",
  phase: "images",
  stage: STAGE,
  engines: ["mupdf"],
  passes: ["downsample", "reencode-images", "grayscale"],
  async run(run) {
    const { ctx, params } = run;
    if (params.codec === "libjxl") {
      // #14 replaces this with the libjxl branch in encodeImage.
      run.skip("reencode-images", JXL_NOT_YET);
      run.skip("downsample", JXL_NOT_YET);
      run.skip("grayscale", JXL_NOT_YET);
    }
    const password = ctx.job.password ? await passwordFile(ctx.workDir, ctx.job.password) : undefined;
    const images = (await listImages(ctx, run.current, { password })).sort((a, b) => storedBytes(b) - storedBytes(a));
    const dir = run.scratch("images");
    await mkdir(dir);

    const passes = { downsample: run.wants("downsample"), grayscale: run.wants("grayscale") };
    const done: Encoded[] = [];
    const kept = new Map<KeepReason, number>();
    const keep = (r: KeepReason) => kept.set(r, (kept.get(r) ?? 0) + 1);

    for (const [i, info] of images.entries()) {
      if (ctx.signal.aborted) break;
      ctx.progress(STAGE, i, images.length, `image ${i + 1} of ${images.length} · ${info.width}×${info.height}`);
      const override = params.overrides[String(info.id)];
      const settings = settingsFor(params, override, passes);
      // No settings: skipped. JPEG XL for the whole run: skipped above, reported once.
      if (!settings || (settings.codec === "libjxl" && !override?.codec)) continue;
      if (!override && storedBytes(info) < MIN_IMAGE_BYTES) continue;
      const reason = keepReason(info);
      if (reason) {
        keep(reason);
        continue;
      }
      try {
        const out = await encodeImage(ctx, { pdf: run.current, info, settings, dir, password });
        if (out.total < storedBytes(info) || out.gray) done.push(out);
        else {
          keep("larger");
          await rm(out.file, { force: true });
        }
      } catch (err) {
        if (err instanceof Kept) keep(err.reason);
        else if (err instanceof TaskError && !ctx.signal.aborted) keep(isOutOfMemory(err) ? "memory" : "unreadable");
        else throw err;
      } finally {
        // Decoded and resampled pixels are the big files; the encoded streams wait for the write.
        await removePixels(dir, [info.id, info.smask?.id]);
      }
    }
    ctx.progress(STAGE, images.length, images.length);

    const summary = summarise(done, kept.get("larger") ?? 0);
    if (summary) run.note(summary);
    for (const [reason, n] of kept) {
      const note = keptNote(reason, n);
      if (note) run.note(note);
    }
    if (done.length) {
      const out = run.scratch("images.pdf");
      await writeImages(ctx, run.current, out, done, password);
      // Saved without object streams or garbage collection (object numbers hold); the structure pass packs it.
      await run.adopt(out);
    }
    await rm(dir, { recursive: true, force: true });
  },
});

/** An image's (and its mask's) decoded and resampled samples — `<id>-….pnm|pgm|ppm`, and a shrink-on-load JPEG. */
async function removePixels(dir: string, ids: (number | undefined)[]): Promise<void> {
  for (const id of ids) {
    if (id === undefined) continue;
    for await (const f of new Bun.Glob(`${id}-*.{pnm,pgm,ppm,jpg}`).scan({ cwd: dir, absolute: true })) await rm(f, { force: true });
  }
}

/** "Re-encoded 12 images, 9 of them downsampled; 2 were smaller as they were." */
function summarise(done: Encoded[], larger: number): string | null {
  if (!done.length) return null;
  const n = done.length;
  const down = done.filter((e) => e.downsampled).length;
  const gray = done.filter((e) => e.gray).length;
  const parts = [`Re-encoded ${n} ${n === 1 ? "image" : "images"}`];
  if (down) parts.push(n === 1 ? "downsampled" : `${down === n ? "all" : down} of them downsampled`);
  if (gray) parts.push(gray === n ? (n === 1 ? "in gray" : "all in gray") : `${gray} in gray`);
  const tail = larger ? `; ${larger} ${larger === 1 ? "was" : "were"} smaller as ${larger === 1 ? "it was" : "they were"}` : "";
  return `${parts.join(", ")}${tail}.`;
}
