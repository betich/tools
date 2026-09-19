import webpAnim, { type WebpAnimModule, type WebpAnimOptions } from "@/vendor/webp-anim/webp_anim.js";
import { WEBP_LOSSLESS, type EncodeOptions, type Encoder, type RawAnimation } from "./types";

/* ───────────────────────────────────────────────────────────────────────────
   Animated WebP through our own wasm build of libwebp's WebPAnimEncoder
   (BSD; client/wasm/webp-anim). Frames go in one at a time, straight RGBA
   with full alpha; libwebp finds each frame's changed rectangle itself.
   The loop count is WebP's own field (plays, 0 forever), and the animation
   is closed at its real end so the last frame keeps its own duration.
   ─────────────────────────────────────────────────────────────────────────── */

/** WebP stores a frame's duration in 24 bits of milliseconds. */
const MAX_DURATION = 0xffffff;
/** libwebp's speed/size trade-off, 0–6. 4 is its default. */
const METHOD = 4;
/** In lossless mode "quality" is effort; this is libwebp's default. */
const LOSSLESS_EFFORT = 75;

/**
 * When each frame starts and when the animation ends, in ms, from per-frame
 * delays. Every frame is at least 1 ms, so the timestamps strictly increase.
 */
export function timeline(delays: readonly number[]): { starts: number[]; end: number } {
  const starts: number[] = [];
  let t = 0;
  for (const d of delays) {
    starts.push(t);
    t += Math.min(MAX_DURATION, Math.max(1, Math.round(Number.isFinite(d) ? d : 1)));
  }
  return { starts, end: t };
}

/** libwebp's settings for the resolved options. */
export function webpConfig(options: EncodeOptions): { lossless: boolean; quality: number; method: number } {
  const lossless = options.quality >= WEBP_LOSSLESS;
  return { lossless, quality: lossless ? LOSSLESS_EFFORT : options.quality, method: METHOD };
}

let loaded: Promise<WebpAnimModule> | null = null;

/** The wasm module, instantiated once per worker. Tests pass the bytes in. */
export function loadWebpAnim(options?: WebpAnimOptions): Promise<WebpAnimModule> {
  loaded ??= webpAnim(options).catch((error) => {
    loaded = null;
    throw error;
  });
  return loaded;
}

/** Encodes with an already-loaded module. */
export function encodeWebp(m: WebpAnimModule, anim: RawAnimation, options: EncodeOptions): Uint8Array {
  const { width, height, frames } = anim;
  if (frames.length === 0) throw new Error("There are no frames to export.");
  const { lossless, quality, method } = webpConfig(options);
  if (anim.delays.length !== frames.length) throw new Error("Every frame needs a delay.");
  const { starts, end } = timeline(anim.delays);

  const enc = m._webp_anim_new(width, height, Math.max(0, Math.round(anim.plays)), lossless ? 1 : 0, quality, method);
  if (enc === 0) throw new Error(`WebP can't hold a ${width} × ${height} canvas (16383 px a side at most).`);
  const size = width * height * 4;
  const buf = m._malloc(size);
  try {
    if (buf === 0) throw new Error("The WebP encoder ran out of memory.");
    const fail = (what: string) => {
      const why = m.UTF8ToString(m._webp_anim_error(enc));
      return new Error(`WebP ${what} failed${why ? `: ${why}` : "."}`);
    };
    frames.forEach((f, i) => {
      if (f.length !== size) throw new Error(`Frame ${i + 1} is not ${width} × ${height}.`);
      // HEAPU8 is re-read each time: the heap may have grown (and moved) since.
      m.HEAPU8.set(f, buf);
      if (!m._webp_anim_add(enc, buf, starts[i]!)) throw fail(`frame ${i + 1}`);
    });
    const length = m._webp_anim_finish(enc, end);
    if (length <= 0) throw fail("assembly");
    const at = m._webp_anim_output(enc);
    return m.HEAPU8.slice(at, at + length);
  } finally {
    if (buf !== 0) m._free(buf);
    m._webp_anim_delete(enc);
  }
}

export const webp: Encoder = async (anim, options) => encodeWebp(await loadWebpAnim(), anim, options);
