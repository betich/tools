/* ───────────────────────────────────────────────────────────────────────────
   Encoding an animation, from the page's side. One call, whatever the
   format:

     const blob = await encode("gif", frames, options, signal, onProgress);

   Each call runs in its own worker, which is terminated when it finishes or
   the signal aborts (a wasm encode can't be stopped any other way). The
   frames' buffers are transferred, not copied. With `options.targetBytes`
   the worker searches the settings for the best file that fits; the full
   story — settings used, how the search went — comes from `encodeAnimation`.
   ─────────────────────────────────────────────────────────────────────────── */

import { composeFrames, exportSpec } from "../compose";
import type { FrameStore } from "../frames";
import type { GifDoc } from "../model";
import type { EncodeMessage, EncodeReport, EncodeRequest } from "./encode.worker";
import { FORMATS, type AnimFormat, type AnimFrames, type EncodeOptions, type EncodeProgress } from "./types";

export * from "./types";
export type { EncodeReport } from "./encode.worker";
export type { FitReport } from "./target";

export type EncodeResult = EncodeReport & { blob: Blob };

/** The pixels an export may hold at once. Past this a tab runs out of memory before the encoder finishes. */
export const MAX_RAW_BYTES = 1024 * 1024 * 1024;

const cancelled = () => new DOMException("Export cancelled", "AbortError");

/** Encodes and returns the file. */
export async function encode(
  format: AnimFormat,
  frames: AnimFrames,
  options: EncodeOptions,
  signal?: AbortSignal,
  onProgress?: (p: EncodeProgress) => void,
): Promise<Blob> {
  return (await encodeAnimation(format, frames, options, signal, onProgress)).blob;
}

/** `encode`, plus what was done: the settings used, the frame-diff share and the target search's outcome. */
export function encodeAnimation(
  format: AnimFormat,
  frames: AnimFrames,
  options: EncodeOptions,
  signal?: AbortSignal,
  onProgress?: (p: EncodeProgress) => void,
): Promise<EncodeResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? cancelled());
    if (frames.frames.length === 0) return reject(new Error("There are no frames to export."));

    const worker = new Worker(new URL("./encode.worker.ts", import.meta.url), { type: "module" });
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(signal?.reason ?? cancelled());
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    worker.addEventListener("message", (e: MessageEvent<EncodeMessage>) => {
      const msg = e.data;
      if (msg.type === "progress") return onProgress?.({ fraction: msg.fraction, label: msg.label });
      finish();
      if (msg.type === "error") return reject(new Error(msg.message));
      resolve({ ...msg.report, blob: new Blob([msg.bytes], { type: FORMATS[format].mime }) });
    });
    worker.addEventListener("error", (e) => {
      finish();
      reject(new Error(e.message || "The encoder stopped unexpectedly — most likely it ran out of memory."));
    });

    const buffers = frames.frames.map((f) => ownBuffer(f.rgba));
    const request: EncodeRequest = {
      format,
      width: frames.width,
      height: frames.height,
      plays: frames.plays,
      frames: buffers,
      delays: frames.frames.map((f) => f.delay),
      options,
    };
    worker.postMessage(request, buffers);
  });
}

/** The frame's pixels as a whole ArrayBuffer of their own, ready to transfer. */
function ownBuffer(rgba: Uint8Array | Uint8ClampedArray): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = rgba;
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) return buffer;
  return rgba.slice().buffer as ArrayBuffer;
}

/** Raw pixel bytes the doc's export holds: canvas × 4 × played frames. */
export function rawBytes(doc: GifDoc): number {
  const spec = exportSpec(doc);
  return spec.size.width * spec.size.height * 4 * spec.count;
}

/**
 * The doc's played frames, composited, as the encoders take them. Refuses,
 * with a sentence to show, when the pixels alone would outgrow a tab.
 */
export async function framesFor(
  doc: GifDoc,
  store: FrameStore,
  signal?: AbortSignal,
  onProgress?: (p: EncodeProgress) => void,
): Promise<AnimFrames> {
  const spec = exportSpec(doc);
  if (rawBytes(doc) > MAX_RAW_BYTES) {
    throw new Error(
      `${spec.count} frames at ${spec.size.width} × ${spec.size.height} is more than a browser tab can hold to encode. ` +
        "Shrink the canvas or drop some frames.",
    );
  }
  const frames: AnimFrames["frames"] = [];
  for await (const f of composeFrames(doc, store, signal)) {
    frames.push({ rgba: f.image.data, delay: f.delay });
    onProgress?.({ fraction: (f.index + 1) / f.count, label: `drawing frame ${f.index + 1} / ${f.count}` });
  }
  return { width: spec.size.width, height: spec.size.height, plays: spec.plays, frames };
}
