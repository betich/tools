import type { FrameStore } from "./frames";
import { canvasSize, fitRect, playList, type GifDoc, type GifFrame, type Size } from "./model";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Paint one frame onto a canvas-sized context: background (or nothing),
 * then the frame fitted and centred. The live preview and the export both
 * draw through here, so what plays is what gets encoded.
 */
export function paintFrame(
  ctx: Ctx,
  bitmap: ImageBitmap | undefined,
  size: Size,
  doc: Pick<GifDoc, "fit" | "background">,
): void {
  ctx.clearRect(0, 0, size.width, size.height);
  if (doc.background) {
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, size.width, size.height);
  }
  if (!bitmap) return;
  const r = fitRect({ width: bitmap.width, height: bitmap.height }, size, doc.fit);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, r.x, r.y, r.width, r.height);
}

/** One finished frame for an encoder: straight (not premultiplied) RGBA at the canvas size. */
export type ComposedFrame = {
  image: ImageData;
  /** Milliseconds. */
  delay: number;
  /** Position in the played sequence (ping-pong included) and its length. */
  index: number;
  count: number;
  /** The doc frame it shows. Ping-pong shows most frames twice. */
  frame: GifFrame;
};

/** What an encoder needs besides the pixels. */
export type ExportSpec = {
  size: Size;
  /** 0 is forever; see `repeatCount` in the model for per-format meaning. */
  plays: number;
  count: number;
  duration: number;
};

export function exportSpec(doc: GifDoc): ExportSpec {
  const list = playList(doc);
  return {
    size: canvasSize(doc),
    plays: doc.plays,
    count: list.length,
    duration: list.reduce((t, f) => t + f.delay, 0),
  };
}

/**
 * The animation as encoders take it: every played frame composited onto the
 * canvas, in order, with its delay. Frames are made one at a time, so a
 * streaming encoder holds one canvas of pixels rather than the whole
 * animation. Each frame's pixels are its own, free to transfer to a worker.
 * Aborting stops between frames.
 */
export async function* composeFrames(
  doc: GifDoc,
  store: FrameStore,
  signal?: AbortSignal,
): AsyncGenerator<ComposedFrame, void, undefined> {
  const size = canvasSize(doc);
  const list = playList(doc);
  if (list.length === 0 || size.width === 0) return;
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can't draw offscreen, so the frames can't be put together.");

  for (let index = 0; index < list.length; index++) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Export cancelled", "AbortError");
    const frame = list[index]!;
    paintFrame(ctx, store.get(frame.id), size, doc);
    const image = ctx.getImageData(0, 0, size.width, size.height);
    yield { image, delay: frame.delay, index, count: list.length, frame };
    // Let the page breathe between frames on a long export.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
