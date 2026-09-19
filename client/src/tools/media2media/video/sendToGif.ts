/* ───────────────────────────────────────────────────────────────────────────
   Video → GIF tab: decode the trimmed clip at the GIF's frame rate and
   width, straight from the `File` through Mediabunny's CanvasSink (rotate
   and crop done by the sink), pass each frame through the tab's frame hook
   (the chroma keyer), and hand the results to the GIF session as bitmaps
   that keep their alpha. Nothing leaves memory; nothing is re-encoded.
   ─────────────────────────────────────────────────────────────────────────── */

import type { IncomingFrame } from "../gif/frames";
import type { FrameHook } from "./frameHook";
import { clampCrop, outputDuration, rotatedSize, type Rotation, type SourceInfo, type VideoEdit } from "./settings";
import { foldDropped, gifDelays, gifFrameName, gifSampleTimes, gifSize, sendProblem, type GifSend } from "./toGif";

type Made = IncomingFrame & { delay: number };

export class SendError extends Error {}
export class SendCanceled extends Error {}

export type SendRequest = {
  file: Blob;
  name: string;
  edit: VideoEdit;
  source: SourceInfo;
  settings: GifSend;
  frameHook?: FrameHook | null;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
};

export async function framesForGif(req: SendRequest): Promise<IncomingFrame[]> {
  const { edit, source, settings, signal } = req;
  if (!source.hasVideo) throw new SendError("This file has no video in it to make frames from.");
  if (!source.videoDecodable)
    throw new SendError("This browser can't decode this video, so it can't make frames from it.");

  const size = gifSize(edit, source, settings.width);
  const times = gifSampleTimes(edit, settings.fps);
  const problem = sendProblem(size, times.length);
  if (problem) throw new SendError(problem);
  const delays = gifDelays(times.length, settings.fps, outputDuration(edit));

  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.BlobSource(req.file), formats: mb.ALL_FORMATS });
  const made: (Made | null)[] = [];
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode()))
      throw new SendError("This browser can't decode this video, so it can't make frames from it.");
    // The sink's rotation replaces the file's own, so ours goes on top of it.
    const rotation = (((await track.getRotation()) + edit.rotate) % 360) as Rotation;
    const sink = new mb.CanvasSink(track, {
      width: size.width,
      height: size.height,
      fit: "fill",
      rotation,
      crop: edit.crop ? clampCrop(edit.crop, rotatedSize(source, edit.rotate)) : undefined,
      // Transparent videos (VP9 alpha) stay transparent; the keyer adds its own.
      alpha: true,
    });

    const hook = req.frameHook ?? null;
    let i = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(times.map((ms) => source.start + ms / 1000))) {
      if (signal?.aborted) throw new SendCanceled();
      const index = i++;
      if (!wrapped) {
        made.push(null);
        continue;
      }
      let picture: CanvasImageSource | null = wrapped.canvas;
      if (hook) {
        picture = await hook(wrapped.canvas, {
          width: size.width,
          height: size.height,
          time: (times[index]! - edit.trim.in) / 1000,
          purpose: "export",
        });
      }
      // Copied at once: the hook and the sink may both reuse their canvases.
      made.push(
        picture === null
          ? null
          : {
              image: await createImageBitmap(picture as ImageBitmapSource),
              name: gifFrameName(req.name, index, times.length),
              delay: 0,
            },
      );
      req.onProgress?.(index + 1, times.length);
    }
    if (signal?.aborted) throw new SendCanceled();

    const frames = foldDropped(made, delays);
    if (frames.length === 0)
      throw new SendError("No frames came out of this clip — every one was dropped or couldn't be decoded.");
    return frames;
  } catch (e) {
    for (const f of made) f?.image.close();
    if (e instanceof SendError || e instanceof SendCanceled) throw e;
    throw new SendError(`Making the frames stopped: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    input.dispose();
  }
}
