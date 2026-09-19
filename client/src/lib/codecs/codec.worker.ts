/// <reference lib="webworker" />
import type { EncodeOptions } from "./formats";
import type { WorkerRequest, WorkerResponse, WorkerSource } from "./protocol";
import { isHeif } from "./sniff";

/**
 * The codecs, off the main thread.
 *
 * Decoding goes through `createImageBitmap`, which already understands every
 * format the browser can open. The one exception is HEIC outside Safari: when
 * the browser refuses bytes that say HEIF, libheif is imported and does it.
 * Encoders are wasm, each imported the first time it is asked for.
 */

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  const started = performance.now();
  const post = (response: WorkerResponse, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage(response, transfer);
  try {
    const maxEdge = req.op === "decode" ? req.maxEdge : req.options.maxEdge;
    const { image, sourceWidth, sourceHeight } = await toImageData(req.source, maxEdge);
    if (req.op === "decode") {
      const elapsedMs = performance.now() - started;
      post({ id: req.id, ok: true, op: "decode", image, sourceWidth, sourceHeight, elapsedMs }, [image.data.buffer]);
      return;
    }
    const { data, mime } = await encode(image, req.options);
    const elapsedMs = performance.now() - started;
    post(
      { id: req.id, ok: true, op: "encode", buffer: data, mime, width: image.width, height: image.height, sourceWidth, sourceHeight, elapsedMs },
      [data],
    );
  } catch (error) {
    post({ id: req.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

async function decodeSource(source: WorkerSource): Promise<ImageBitmap | ImageData> {
  if (source.kind === "pixels") return source.image;
  try {
    return await createImageBitmap(new Blob([source.buffer], { type: source.type }), { imageOrientation: "from-image" });
  } catch (error) {
    if (!isHeif(source.buffer)) throw error;
    const { decodeHeif } = await import("./heic");
    return decodeHeif(source.buffer);
  }
}

async function toImageData(source: WorkerSource, maxEdge: number) {
  const decoded = await decodeSource(source);
  const sourceWidth = decoded.width;
  const sourceHeight = decoded.height;
  const scale = maxEdge > 0 ? Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight)) : 1;
  if (scale === 1 && decoded instanceof ImageData) return { image: decoded, sourceWidth, sourceHeight };

  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const bitmap = decoded instanceof ImageData ? await createImageBitmap(decoded) : decoded;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable in this browser");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { image: ctx.getImageData(0, 0, width, height), sourceWidth, sourceHeight };
}

async function encode(imageData: ImageData, options: EncodeOptions): Promise<{ data: ArrayBuffer; mime: string }> {
  switch (options.format) {
    case "webp": {
      const { encode: enc } = await import("@jsquash/webp");
      // webp grades effort as `method`, 0 (fast) to 6 (slow and small).
      return { data: await enc(imageData, { quality: options.quality, method: clamp(options.effort, 0, 6) }), mime: "image/webp" };
    }
    case "avif": {
      const { encode: enc } = await import("@jsquash/avif");
      // Higher effort means a slower, smaller encode; the codec grades speed the other way.
      const speed = clamp(10 - options.effort, 0, 10);
      return { data: await enc(imageData, { quality: options.quality, speed }), mime: "image/avif" };
    }
    case "jpeg": {
      const { encode: enc } = await import("@jsquash/jpeg");
      return { data: await enc(imageData, { quality: options.quality }), mime: "image/jpeg" };
    }
    case "png": {
      const { encode: enc } = await import("@jsquash/png");
      const raw = await enc(imageData);
      const { optimise } = await import("@jsquash/oxipng");
      // PNG is lossless, so the quality slider does nothing; effort is the dial.
      const optimised = await optimise(raw, { level: clamp(options.effort, 0, 6) });
      return { data: optimised, mime: "image/png" };
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
