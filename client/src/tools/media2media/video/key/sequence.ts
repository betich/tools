/* ───────────────────────────────────────────────────────────────────────────
   The other way out of the key: a zip of transparent PNGs, one per output
   frame, for editing software that won't take a transparent WebM.

   Frames are decoded straight from the file (read in ranges, as the export
   does), framed by Mediabunny with the same rotate/crop/resize the export
   plans, keyed by the same shader, and zipped as they're made (STORE —
   PNGs are already compressed). Where the browser can write to disk the
   zip streams there; otherwise it's held in memory up to the same limit as
   an export.
   ─────────────────────────────────────────────────────────────────────────── */

import { makeZip } from "client-zip";
import { bytes as formatBytes } from "@/lib/format";
import { planConversion } from "../plan";
import { clampSpeed, type SourceInfo, type VideoEdit } from "../settings";
import { ExportCanceled, ExportError, MEMORY_LIMIT, type ExportTarget } from "../target";
import { ProgressMeter, type ProgressReading } from "../timing";
import { createKeyer } from "./keyer";
import { frameName, sequenceTimes } from "./settings";

export type SequenceRequest = {
  file: Blob;
  /** For the frame names. */
  stem: string;
  edit: VideoEdit;
  source: SourceInfo;
  target: ExportTarget;
  signal?: AbortSignal;
  onProgress?: (p: ProgressReading & { bytes: number; frames: number }) => void;
};

export type SequenceResult = {
  blob: Blob | null;
  bytes: number;
  frames: number;
  /** The rate to import the frames at. */
  fps: number;
};

/** Used when the file doesn't say its frame rate and none was picked. */
const FALLBACK_FPS = 30;

export async function exportPngSequence(req: SequenceRequest): Promise<SequenceResult> {
  const { edit, source, signal } = req;
  if (!source.hasVideo) throw new ExportError("This file has no video to turn into frames.");
  if (signal?.aborted) throw new ExportCanceled();

  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.BlobSource(req.file), formats: mb.ALL_FORMATS });
  const keyer = createKeyer();
  const plan = planConversion({ ...edit, output: "video" }, source);
  const size = plan.size!;
  const speed = clampSpeed(edit.speed);
  // One PNG per output frame: at the picked rate, or the source's own, sped up.
  const fps = edit.fps ?? (source.fps ? source.fps * speed : FALLBACK_FPS);
  const times = sequenceTimes(source.start + edit.trim.in / 1000, source.start + edit.trim.out / 1000, fps, speed);
  if (times.length === 0) throw new ExportError("The trim keeps nothing — move the in or out point.");
  const limit = req.target.kind === "memory" ? (req.target.limit ?? MEMORY_LIMIT) : Infinity;

  let written = 0;
  let done = 0;
  const meter = new ProgressMeter(performance.now(), times.length);
  const encoder = pngEncoder(size.width, size.height);

  // The zip stream reports a failure its own way; this keeps the sentence.
  let failure: unknown = null;
  async function* frames() {
    try {
      yield* keyedFrames();
    } catch (e) {
      failure = e;
      throw e;
    }
  }

  async function* keyedFrames() {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode()))
      throw new ExportError("This browser can't decode the video in this file, so it can't make frames from it.");
    const sink = new mb.VideoSampleSink(track);
    for await (const sample of sink.samplesAtTimestamps(times)) {
      if (signal?.aborted) {
        sample?.close();
        throw new ExportCanceled();
      }
      if (!sample) continue;
      let framed: InstanceType<typeof mb.VideoSample> | null = null;
      try {
        framed = await sample.transform({
          rotate: plan.video.rotate,
          crop: plan.video.crop,
          width: size.width,
          height: size.height,
          fit: "fill",
        });
        const rgba = keyer.pixels(framed.toCanvasImageSource(), size.width, size.height, edit.key);
        const png = await encoder(rgba);
        written += png.size;
        if (written > limit)
          throw new ExportError(
            `The frames passed ${formatBytes(limit)}, the most this browser can hold in memory. Trim it, lower the size, or use Chrome or Edge, which write straight to disk.`,
          );
        const name = frameName(req.stem, done, times.length);
        done++;
        req.onProgress?.({ ...meter.read(performance.now(), done / times.length), bytes: written, frames: done });
        yield { name, input: png };
      } finally {
        framed?.close();
        sample.close();
      }
    }
  }

  try {
    const zip = makeZip(frames());
    if (req.target.kind === "stream") {
      // FileSystemWritableFileStream takes plain byte chunks as well as positioned writes.
      await zip.pipeTo(req.target.writable as unknown as WritableStream<Uint8Array>, { signal });
      return { blob: null, bytes: written, frames: done, fps };
    }
    const blob = await new Response(zip).blob();
    return { blob: new Blob([blob], { type: "application/zip" }), bytes: blob.size, frames: done, fps };
  } catch (caught) {
    const e = failure ?? caught;
    if (signal?.aborted) throw new ExportCanceled();
    if (e instanceof ExportError || e instanceof ExportCanceled) throw e;
    throw new ExportError(`The frames stopped: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    keyer.dispose();
    input.dispose();
  }
}

/** Straight RGBA bytes to a PNG, through a 2D canvas the browser encodes. */
function pngEncoder(width: number, height: number): (rgba: Uint8Array) => Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(width, height);
    const ctx = c.getContext("2d")!;
    return async (rgba) => {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer), width, height), 0, 0);
      return c.convertToBlob({ type: "image/png" });
    };
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  return (rgba) => {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer), width, height), 0, 0);
    return new Promise((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png"),
    );
  };
}
