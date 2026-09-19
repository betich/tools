/* ───────────────────────────────────────────────────────────────────────────
   The spin generator: one image → N frames of it turning, for the GIF
   timeline. Two kinds of turn:

   - flat — in the picture plane, like a record;
   - coin — about the vertical axis with perspective, the back face showing
     for the half turn it faces the viewer.

   The math (angles, easing, how much room a turn needs) is plain arithmetic
   under `bun test`. `drawSpin` paints one angle onto any 2D context, and is
   the only painter: the live preview, the worker and the main-thread
   fallback all go through it, so what plays in the panel is what lands on
   the timeline.
   ─────────────────────────────────────────────────────────────────────────── */

import type { IncomingFrame } from "../frames";

export type SpinKind = "flat" | "coin";
export type SpinEasing = "linear" | "ease-in-out";
/**
 * What the coin shows from behind: the front seen through (`mirror`), the
 * front again reading the right way (`same`), a second image, or nothing.
 */
export type SpinBack = "mirror" | "same" | "image" | "none";

export type SpinSettings = {
  kind: SpinKind;
  /** Whether frames are set by count or by degrees per frame. The other follows. */
  by: "count" | "step";
  count: number;
  /** Degrees per frame. Rounded to the nearest step that divides 360 exactly. */
  step: number;
  /** 1 turns clockwise (flat) or turns the face to the right (coin); -1 the other way. */
  direction: 1 | -1;
  easing: SpinEasing;
  /** Coin only. 0 is flat-on (orthographic), 1 is a camera just clear of the near edge. */
  perspective: number;
  back: SpinBack;
  /** Longest edge of the image in the output, in pixels. */
  edge: number;
  /** Grow the canvas so no angle clips the image. */
  room: boolean;
  /** Extra transparent pixels on every side. */
  padding: number;
  /** Milliseconds per frame. */
  delay: number;
};

export const MIN_FRAMES = 2;
export const MAX_FRAMES = 360;
export const MAX_SPIN_EDGE = 2048;
export const MAX_PADDING = 512;

export const defaultSpin = (): SpinSettings => ({
  kind: "flat",
  by: "count",
  count: 36,
  step: 10,
  direction: 1,
  easing: "linear",
  perspective: 0.5,
  back: "mirror",
  edge: 480,
  room: true,
  padding: 0,
  delay: 40,
});

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* ── Frames and angles ──────────────────────────────────────────────────── */

/**
 * How many frames one turn takes. A step that doesn't divide 360 would
 * leave a seam, so steps round to the nearest whole number of frames.
 */
export function frameCount(s: Pick<SpinSettings, "by" | "count" | "step">): number {
  const n = s.by === "count" ? s.count : 360 / Math.max(s.step, 1e-6);
  return clamp(Math.round(Number.isFinite(n) ? n : MIN_FRAMES), MIN_FRAMES, MAX_FRAMES);
}

/** Degrees per frame for a count, before easing. */
export const stepFor = (count: number) => 360 / count;

/** Sine ease-in-out: 0 → 0, ½ → ½, 1 → 1, flat at both ends. */
export function ease(t: number, easing: SpinEasing): number {
  const x = clamp(t, 0, 1);
  return easing === "linear" ? x : (1 - Math.cos(Math.PI * x)) / 2;
}

/**
 * The angle of every frame, in degrees: frame i is at `ease(i/N)·360`. The
 * turn stops one step short of 360, so the loop's last frame leads into the
 * first instead of repeating it. Easing needs no special case — it maps
 * 0 → 0 and 1 → 1, so the join stays seamless; it just lingers there.
 */
export function spinAngles(count: number, easing: SpinEasing, direction: 1 | -1): number[] {
  const n = clamp(Math.round(count), MIN_FRAMES, MAX_FRAMES);
  return Array.from({ length: n }, (_, i) => {
    const a = direction * 360 * ease(i / n, easing);
    return a === 0 ? 0 : a; // no -0 in names
  });
}

/* ── Layout ─────────────────────────────────────────────────────────────── */

export type Size = { width: number; height: number };

/**
 * Where a spin sits. Every length is in output pixels, so scaling the whole
 * layout (`scaleLayout`) draws the same picture smaller, which is how the
 * preview stays cheap.
 */
export type SpinLayout = {
  kind: SpinKind;
  /** The canvas. */
  width: number;
  height: number;
  /** The image's box at 0°, centred on the canvas. */
  imageWidth: number;
  imageHeight: number;
  /** Coin only: camera distance from the axis. Infinity is no perspective. */
  distance: number;
};

/** The image's size in the output: its longest edge at `edge`, never enlarged past what `edge` asks. */
export function imageBox(natural: Size, edge: number): Size {
  const long = Math.max(natural.width, natural.height, 1);
  const k = clamp(Math.round(edge), 1, MAX_SPIN_EDGE) / long;
  return {
    width: Math.max(1, Math.round(natural.width * k)),
    height: Math.max(1, Math.round(natural.height * k)),
  };
}

/**
 * Camera distance for a perspective strength. At 1 the camera is 1.25 image
 * widths from the axis — the near edge swells to about 1.7× — and as the
 * strength falls it backs away, reaching infinity (no perspective) at 0.
 */
export function cameraDistance(imageWidth: number, perspective: number): number {
  const p = clamp(perspective, 0, 1);
  if (p === 0) return Infinity;
  return (imageWidth * 1.25) / p;
}

/** A coin column at object x `u` (from the axis) under turn `theta`: its screen x and its height scale. */
export function projectColumn(u: number, theta: number, distance: number): { x: number; scale: number } {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  if (!Number.isFinite(distance)) return { x: u * c, scale: 1 };
  // The column moves `u·sinθ` away from the camera; nearer is bigger.
  const scale = distance / (distance + u * s);
  return { x: u * c * scale, scale };
}

/**
 * The inverse of `projectColumn`: which object x lands on screen x `x`.
 * Null where the ray misses (edge-on, or behind the camera).
 */
export function unprojectColumn(x: number, theta: number, distance: number): number | null {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  if (!Number.isFinite(distance)) return Math.abs(c) < 1e-9 ? null : x / c;
  const denom = c * distance - x * s;
  if (Math.abs(denom) < 1e-9) return null;
  return (x * distance) / denom;
}

/**
 * How far a coin reaches from its centre over a whole turn: the near edge
 * swings wider than the image and grows taller as it comes towards the
 * camera. Sampled finely enough to be exact to well under a pixel.
 */
export function coinReach(imageWidth: number, imageHeight: number, distance: number): { x: number; y: number } {
  const half = imageWidth / 2;
  let x = half;
  let y = imageHeight / 2;
  const samples = 1440;
  for (let i = 0; i < samples; i++) {
    const theta = (i / samples) * 2 * Math.PI;
    for (const u of [-half, half]) {
      const p = projectColumn(u, theta, distance);
      x = Math.max(x, Math.abs(p.x));
      y = Math.max(y, (imageHeight / 2) * p.scale);
    }
  }
  return { x, y };
}

/**
 * The canvas a spin needs. With `room`, a flat turn gets a square on the
 * image's diagonal (the circle its corners sweep) and a coin gets the
 * widest and tallest it ever projects; without, the canvas is the image and
 * the corners clip as they pass. Padding is added outside either.
 */
export function spinLayout(
  natural: Size,
  s: Pick<SpinSettings, "kind" | "edge" | "room" | "padding" | "perspective">,
): SpinLayout {
  const box = imageBox(natural, s.edge);
  const distance = s.kind === "coin" ? cameraDistance(box.width, s.perspective) : Infinity;
  let w = box.width;
  let h = box.height;
  if (s.room) {
    if (s.kind === "flat") {
      w = h = Math.ceil(Math.hypot(box.width, box.height));
    } else {
      const reach = coinReach(box.width, box.height, distance);
      w = Math.ceil(reach.x * 2);
      h = Math.ceil(reach.y * 2);
    }
  }
  const pad = 2 * clamp(Math.round(s.padding), 0, MAX_PADDING);
  // Keep the canvas's parity with the image's so it centres on whole pixels.
  if ((w - box.width) % 2) w += 1;
  if ((h - box.height) % 2) h += 1;
  return { kind: s.kind, width: w + pad, height: h + pad, imageWidth: box.width, imageHeight: box.height, distance };
}

/** The same picture at `k` times the size — for a small, cheap preview. */
export function scaleLayout(l: SpinLayout, k: number): SpinLayout {
  return {
    kind: l.kind,
    width: Math.max(1, Math.round(l.width * k)),
    height: Math.max(1, Math.round(l.height * k)),
    imageWidth: l.imageWidth * k,
    imageHeight: l.imageHeight * k,
    distance: l.distance * k,
  };
}

/**
 * The most decoded pixels a spin may hand the timeline. Frames are held as
 * bitmaps until export, so 360 frames of a 2000px square (≈5.8 GB) would
 * take the tab down; 1 GiB is a long, large GIF already.
 */
export const MAX_SPIN_BYTES = 1024 ** 3;

/** Decoded size of a spin's frames, RGBA. */
export const spinBytes = (layout: Pick<SpinLayout, "width" | "height">, count: number) =>
  layout.width * layout.height * 4 * count;

/** Which face a coin shows at `angle` degrees. */
export function faceAt(angle: number): "front" | "back" {
  return Math.cos((angle * Math.PI) / 180) >= 0 ? "front" : "back";
}

/** The name a spin frame carries on the timeline: `spin 012°`. */
export function spinFrameName(angle: number): string {
  const a = ((angle % 360) + 360) % 360;
  const tenths = Math.round(a * 10) % 3600;
  const whole = String(Math.floor(tenths / 10)).padStart(3, "0");
  return `spin ${whole}${tenths % 10 ? `.${tenths % 10}` : ""}°`;
}

/* ── Drawing ────────────────────────────────────────────────────────────── */

/** What `drawSpin` needs of a canvas context — satisfied by the page's and a worker's. */
export type SpinCtx = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "translate"
  | "rotate"
  | "drawImage"
  | "clearRect"
  | "imageSmoothingEnabled"
  | "imageSmoothingQuality"
>;

type Source = CanvasImageSource & { width: number; height: number };

export type SpinSources = {
  front: Source;
  /** Only for `back: "image"`, already fitted to the front's shape (see `fitBack`). */
  back: Source | null;
};

/**
 * Paints the image at `angle` degrees, centred, onto a transparent canvas
 * of `layout`'s size. Flat turns are a canvas rotation. A coin is drawn one
 * destination column at a time: under a turn about the vertical axis every
 * column of the image stays a vertical line, just moved and scaled by its
 * depth, so a column-wide slice of the source is exactly right — no WebGL,
 * and the same on the page and in a worker.
 */
export function drawSpin(ctx: SpinCtx, src: SpinSources, layout: SpinLayout, angle: number, back: SpinBack): void {
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const cx = layout.width / 2;
  const cy = layout.height / 2;
  const w = layout.imageWidth;
  const h = layout.imageHeight;
  const theta = (angle * Math.PI) / 180;

  if (layout.kind === "flat") {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(theta);
    ctx.drawImage(src.front, -w / 2, -h / 2, w, h);
    ctx.restore();
    return;
  }

  const facing = Math.cos(theta) >= 0 ? "front" : "back";
  let image: Source = src.front;
  // Reading the back the right way round means sampling it from the other side.
  let flip = false;
  if (facing === "back") {
    if (back === "none") return;
    if (back === "image" && src.back) image = src.back;
    flip = back !== "mirror";
  }

  const half = w / 2;
  const d = layout.distance;
  const a = projectColumn(-half, theta, d).x;
  const b = projectColumn(half, theta, d).x;
  const left = Math.min(a, b);
  const right = Math.max(a, b);
  if (right - left < 1e-3) return; // edge-on

  const sw = image.width;
  const sh = image.height;
  const toSource = (u: number) => {
    const t = (clamp(u, -half, half) + half) / w; // 0…1 across the image
    return (flip ? 1 - t : t) * sw;
  };

  for (let x = Math.floor(cx + left); x < Math.ceil(cx + right); x++) {
    const x0 = Math.max(x, cx + left);
    const x1 = Math.min(x + 1, cx + right);
    if (x1 - x0 <= 0) continue;
    const u0 = unprojectColumn(x0 - cx, theta, d);
    const u1 = unprojectColumn(x1 - cx, theta, d);
    const um = unprojectColumn((x0 + x1) / 2 - cx, theta, d);
    if (u0 === null || u1 === null || um === null) continue;
    let s0 = toSource(u0);
    let s1 = toSource(u1);
    if (s0 > s1) [s0, s1] = [s1, s0];
    // A near-zero slice (the far edge squeezed) still needs some source.
    if (s1 - s0 < 1e-3) s1 = Math.min(sw, s0 + 1e-3);
    const colH = h * projectColumn(clamp(um, -half, half), theta, d).scale;
    ctx.drawImage(image, s0, 0, s1 - s0, sh, x0, cy - colH / 2, x1 - x0, colH);
  }
}

/* ── Sources ────────────────────────────────────────────────────────────── */

/** A context that can make bitmaps: a worker's OffscreenCanvas, or the page's. */
function surface(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable in this browser");
  return { canvas, ctx };
}

/**
 * The second image contained in the front's shape and centred, so the two
 * faces are the same coin — a portrait back on a landscape front shrinks to
 * fit rather than stretching.
 */
export async function fitBack(back: ImageBitmap, front: Size): Promise<ImageBitmap> {
  const { canvas, ctx } = surface(front.width, front.height);
  const k = Math.min(front.width / back.width, front.height / back.height);
  const w = back.width * k;
  const h = back.height * k;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(back, (front.width - w) / 2, (front.height - h) / 2, w, h);
  return canvas.transferToImageBitmap();
}

/** The source scaled once to about the size it's drawn at, so thin coin slices don't alias. */
export function scaledTo(image: ImageBitmap, box: Size): Promise<ImageBitmap> {
  return createImageBitmap(image, {
    resizeWidth: Math.max(1, Math.round(box.width)),
    resizeHeight: Math.max(1, Math.round(box.height)),
    resizeQuality: "high",
    premultiplyAlpha: "none",
  });
}

/* ── Generating ─────────────────────────────────────────────────────────── */

/** What a worker (or the fallback) needs to render every frame. */
export type SpinJob = {
  front: ImageBitmap;
  back: ImageBitmap | null;
  layout: SpinLayout;
  angles: number[];
  backMode: SpinBack;
};

/**
 * Renders a job, a frame at a time. Shared by the worker and the page's
 * fallback; `onFrame` gets each bitmap as it's made.
 */
export async function renderSpinJob(
  job: SpinJob,
  onFrame: (bitmap: ImageBitmap, index: number) => void | Promise<void>,
): Promise<void> {
  const box = { width: job.layout.imageWidth, height: job.layout.imageHeight };
  const front = await scaledTo(job.front, box);
  const back = job.back
    ? await fitBack(job.back, { width: Math.round(box.width), height: Math.round(box.height) })
    : null;
  const { canvas, ctx } = surface(job.layout.width, job.layout.height);
  try {
    for (let i = 0; i < job.angles.length; i++) {
      drawSpin(ctx, { front, back }, job.layout, job.angles[i]!, job.backMode);
      await onFrame(canvas.transferToImageBitmap(), i);
    }
  } finally {
    front.close();
    back?.close();
  }
}

export type SpinRequest = { id: number; job: SpinJob };
export type SpinResponse =
  | { id: number; kind: "frame"; index: number; bitmap: ImageBitmap }
  | { id: number; kind: "done" }
  | { id: number; kind: "error"; error: string };

/**
 * One image → the frames of one turn, ready for `gifSession.addFrames`.
 * Rendering happens in a worker so a few hundred large frames don't freeze
 * the page; where a worker can't draw (no OffscreenCanvas there) it falls
 * back to the page, yielding between frames. The input bitmaps stay the
 * caller's.
 */
export async function framesFromSpin(
  front: ImageBitmap,
  back: ImageBitmap | null,
  s: SpinSettings,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<IncomingFrame[]> {
  const layout = spinLayout(front, s);
  const angles = spinAngles(frameCount(s), s.easing, s.direction);
  const useBack = s.kind === "coin" && s.back === "image" && back ? back : null;
  const bitmaps: ImageBitmap[] = [];
  onProgress?.(0, angles.length);

  const collect = (bitmap: ImageBitmap, index: number) => {
    if (signal?.aborted) return bitmap.close();
    bitmaps[index]?.close(); // a worker that died part-way, redone on the page
    bitmaps[index] = bitmap;
    onProgress?.(bitmaps.filter(Boolean).length, angles.length);
  };

  try {
    try {
      await inWorker({ front, back: useBack, layout, angles, backMode: s.back }, collect, signal);
    } catch (error) {
      if (signal?.aborted || !(error instanceof WorkerUnavailable)) throw error;
      await renderSpinJob({ front, back: useBack, layout, angles, backMode: s.back }, async (bitmap, i) => {
        collect(bitmap, i);
        await new Promise((r) => setTimeout(r, 0));
        if (signal?.aborted) throw signal.reason;
      });
    }
    if (signal?.aborted) throw signal.reason ?? new DOMException("Spin cancelled", "AbortError");
  } catch (error) {
    for (const b of bitmaps) b?.close();
    throw error;
  }

  return angles.map((angle, i) => ({ image: bitmaps[i]!, name: spinFrameName(angle), delay: s.delay }));
}

class WorkerUnavailable extends Error {}

let nextJob = 1;

/** Runs a job on a fresh worker, which is closed when the job ends. */
async function inWorker(
  job: SpinJob,
  onFrame: (bitmap: ImageBitmap, index: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") throw new WorkerUnavailable();
  const worker = new Worker(new URL("./spin.worker.ts", import.meta.url), { type: "module" });
  const id = nextJob++;
  // Copies, so the caller keeps its bitmaps and these can be transferred.
  const front = await createImageBitmap(job.front);
  const back = job.back ? await createImageBitmap(job.back) : null;
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal?.reason ?? new DOMException("Spin cancelled", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = (e: MessageEvent<SpinResponse>) => {
        const msg = e.data;
        if (msg.id !== id) return;
        if (msg.kind === "frame") onFrame(msg.bitmap, msg.index);
        else if (msg.kind === "done") resolve();
        else reject(msg.error === "unavailable" ? new WorkerUnavailable() : new Error(msg.error));
      };
      worker.onerror = () => reject(new WorkerUnavailable());
      const request: SpinRequest = { id, job: { ...job, front, back } };
      worker.postMessage(request, back ? [front, back] : [front]);
    });
  } finally {
    worker.terminate();
  }
}
