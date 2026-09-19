/**
 * A per-frame hook: the one seam through which a frame's pixels can be
 * changed (chroma key, overlays), used by both the live preview and the
 * export, so what you see is what you get.
 *
 * It receives each frame *after* rotate, crop and resize — the output's
 * framing — and returns what to use instead: a canvas (reused across calls
 * is fine; it is copied before the next call), a new `VideoFrame` (handed
 * over: the caller closes it — the keyer returns one for `"export"`), the
 * same `frame` to leave it alone, or `null` to drop it. It may be async (a WebGL readback), and runs
 * one frame at a time.
 *
 * In the preview the frame is at preview scale, so `width`/`height` differ
 * from the export's. Keep any maths in fractions of the frame.
 */
export type FrameHook = (frame: CanvasImageSource, info: FrameInfo) => HookResult | Promise<HookResult>;

export type HookResult = CanvasImageSource | null;

export type FrameInfo = {
  width: number;
  height: number;
  /** Seconds into the source (preview) or into the output before any speed change (export). */
  time: number;
  purpose: "preview" | "export";
};
