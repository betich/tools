/// <reference lib="webworker" />
import { containerOf, embedExif, findExif } from "./containers";
import { hasLocation, orientationOnlyExif, orientTransform, readOrientation, sanitiseExif } from "./exif";
import type { EncodeOptions } from "./formats";
import type { MetadataWritten, WorkerRequest, WorkerResponse, WorkerSource } from "./protocol";
import { isHeif } from "./sniff";

/**
 * The codecs, off the main thread.
 *
 * Decoding goes through `createImageBitmap`, which already understands every
 * format the browser can open. The one exception is HEIC outside Safari: when
 * the browser refuses bytes that say HEIF, libheif is imported and does it.
 * Encoders are wasm, each imported the first time it is asked for.
 *
 * Pixels always come out upright: the browser applies EXIF orientation (and
 * libheif applies HEIF's own rotation), and if a browser turns out not to, the
 * worker rotates a JPEG itself. Outputs carry no metadata unless asked; then
 * the source's EXIF is sanitised and written back where the format allows.
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
    const encoded = await encode(image, req.options);
    const { buffer, metadata } = withMetadata(encoded.data, req.source, req.options, image);
    const elapsedMs = performance.now() - started;
    post(
      {
        id: req.id,
        ok: true,
        op: "encode",
        buffer,
        mime: encoded.mime,
        width: image.width,
        height: image.height,
        sourceWidth,
        sourceHeight,
        elapsedMs,
        metadata,
      },
      [buffer],
    );
  } catch (error) {
    post({ id: req.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

async function decodeSource(source: WorkerSource): Promise<ImageBitmap | ImageData> {
  if (source.kind === "pixels") return source.image;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([source.buffer], { type: source.type }), { imageOrientation: "from-image" });
  } catch (error) {
    if (!isHeif(source.buffer)) throw error;
    const { decodeHeif } = await import("./heic");
    return decodeHeif(source.buffer);
  }
  return uprightJpeg(bitmap, source.buffer);
}

let honoured: Promise<boolean> | null = null;

/**
 * Whether this browser's `createImageBitmap` applies EXIF orientation. Asked
 * once per worker with a 2×1 JPEG tagged "rotate 90°": a browser that honours
 * the tag hands back a 1×2 bitmap. When unsure, trust the browser.
 */
function browserOrients(): Promise<boolean> {
  honoured ??= (async () => {
    try {
      const canvas = new OffscreenCanvas(2, 1);
      canvas.getContext("2d")?.fillRect(0, 0, 2, 1);
      const jpeg = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg" })).arrayBuffer());
      const probe = embedExif(jpeg, orientationOnlyExif(6));
      if (!probe) return true;
      const bitmap = await createImageBitmap(new Blob([probe], { type: "image/jpeg" }), { imageOrientation: "from-image" });
      const turned = bitmap.width === 1;
      bitmap.close();
      return turned;
    } catch {
      return true;
    }
  })();
  return honoured;
}

/** Turns a JPEG upright by hand, only when its EXIF asks and the browser didn't. */
async function uprightJpeg(bitmap: ImageBitmap, buffer: ArrayBuffer): Promise<ImageBitmap> {
  const bytes = new Uint8Array(buffer);
  if (containerOf(bytes) !== "jpeg") return bitmap;
  const exif = findExif(bytes);
  const orientation = exif ? readOrientation(exif) : 1;
  if (orientation === 1 || (await browserOrients())) return bitmap;

  const t = orientTransform(orientation, bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(t.width, t.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return bitmap;
  ctx.setTransform(...t.matrix);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.transferToImageBitmap();
}

/**
 * Puts the source's EXIF back into the output when asked and the format can
 * hold it — sanitised first (see `sanitiseExif`). Anything that fails leaves
 * the output as the encoder wrote it: bare.
 */
function withMetadata(
  data: ArrayBuffer,
  source: WorkerSource,
  options: EncodeOptions,
  image: ImageData,
): { buffer: ArrayBuffer; metadata: MetadataWritten } {
  const bare = { buffer: data, metadata: { exif: false, location: false } };
  const mode = options.metadata ?? "none";
  if (mode === "none" || source.kind !== "bytes") return bare;
  const exif = findExif(new Uint8Array(source.buffer));
  if (!exif) return bare;
  const clean = sanitiseExif(exif, { keepLocation: mode === "all", width: image.width, height: image.height });
  const out = clean ? embedExif(new Uint8Array(data), clean) : null;
  if (!clean || !out) return bare;
  return { buffer: out.buffer, metadata: { exif: true, location: hasLocation(clean) } };
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
    case "jxl": {
      const { default: enc } = await import("@jsquash/jxl/encode");
      // jxl grades effort 1–9; spread the shared 0–6 dial across it.
      const effort = clamp(Math.round(1 + (options.effort * 4) / 3), 1, 9);
      return { data: await enc(imageData, { quality: options.quality, effort }), mime: "image/jxl" };
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
