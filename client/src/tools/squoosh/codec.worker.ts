/// <reference lib="webworker" />
import type { EncodeOptions, WorkerRequest, WorkerResponse } from "./types";

/**
 * Squoosh's codecs, running off the main thread.
 *
 * Decoding is delegated to `createImageBitmap`, which already understands every
 * format a browser can open — that keeps four decoder wasm bundles out of the
 * page. Only the encoders are wasm, and each is imported the first time it is
 * actually asked for.
 */

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, buffer, type, options } = event.data;
  const started = performance.now();
  try {
    const imageData = await toImageData(new Blob([buffer], { type }), options.maxEdge);
    const { data: encoded, mime } = await encode(imageData, options);
    const response: WorkerResponse = {
      id,
      ok: true,
      buffer: encoded,
      mime,
      width: imageData.width,
      height: imageData.height,
      elapsedMs: performance.now() - started,
    };
    (self as unknown as Worker).postMessage(response, [encoded]);
  } catch (error) {
    const response: WorkerResponse = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
    (self as unknown as Worker).postMessage(response);
  }
};

async function toImageData(blob: Blob, maxEdge: number): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const scale = maxEdge > 0 ? Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height)) : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable in this browser");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return ctx.getImageData(0, 0, width, height);
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
