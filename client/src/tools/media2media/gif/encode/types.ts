/* ───────────────────────────────────────────────────────────────────────────
   What the animation encoders take and what each one can do.

   One table (`FORMATS`) says, per format, which controls mean something and
   why the others don't, so the export panel can dim an option with its
   reason instead of offering a knob the encoder ignores. A new format is a
   new key here, a new entry in the worker's registry, and nothing else.
   ─────────────────────────────────────────────────────────────────────────── */

export type AnimFormat = "gif" | "apng" | "webp";

export type Dither = "off" | "ordered" | "diffusion";

export type EncodeOptions = {
  /** 1–100. gifski's quality, which also sets how lossy it is; WebP's, where 100 is lossless. */
  quality: number;
  /** 0 is every colour (full colour, lossless); otherwise the palette size, 2–256. */
  colours: number;
  dither: Dither;
  /**
   * Frame diff. A pixel whose channels all moved by this much or less keeps
   * the previous frame's value, so only real changes are written. 0 writes
   * every changed pixel exactly (both encoders already skip identical ones).
   */
  tolerance: number;
  /** Search the settings for the best result under this many bytes; null is off. */
  targetBytes: number | null;
};

/** The animation as pixels: straight RGBA at the canvas size, one buffer per played frame. */
export type RawAnimation = {
  width: number;
  height: number;
  /** Times it plays through; 0 is forever. Each encoder stores it its own way. */
  plays: number;
  frames: Uint8Array[];
  /** Milliseconds, one per frame. */
  delays: number[];
};

/** One frame on its way to the worker. Its buffer is transferred, so it is unusable after `encode`. */
export type EncodeFrame = { rgba: Uint8ClampedArray | Uint8Array; delay: number };

export type AnimFrames = { width: number; height: number; plays: number; frames: EncodeFrame[] };

export type EncodeProgress = { fraction: number; label: string };

export type Control = "quality" | "colours" | "dither" | "tolerance";

/** `true` when the control works, or the sentence that says why it doesn't. */
export type Support = true | string;

export type FormatInfo = {
  label: string;
  ext: string;
  mime: string;
  /** One line of prose about what this format is good for. */
  blurb: string;
  controls: Record<Control, Support>;
  /** Which dithering modes the encoder can do, given the other options. */
  dithers: (options: EncodeOptions) => Record<Dither, Support>;
  /** Options as this encoder will actually use them. */
  resolve: (options: EncodeOptions) => EncodeOptions;
};

const GIFSKI_DITHER = "gifski always dithers with its own error diffusion, tuned across frames.";

export const FORMATS: Record<AnimFormat, FormatInfo> = {
  gif: {
    label: "gif",
    ext: "gif",
    mime: "image/gif",
    blurb:
      "gifski — the best-looking GIF there is. Up to 256 colours a frame, and a pixel is either shown or see-through.",
    controls: {
      quality: true,
      colours: "gifski picks up to 256 colours for every frame itself.",
      dither: true,
      tolerance: true,
    },
    dithers: () => ({ off: GIFSKI_DITHER, ordered: GIFSKI_DITHER, diffusion: true }),
    resolve: (o) => ({
      ...o,
      quality: clampQuality(o.quality),
      colours: 256,
      dither: "diffusion",
      tolerance: clampTolerance(o.tolerance),
    }),
  },
  apng: {
    label: "apng",
    ext: "png",
    mime: "image/apng",
    blurb: "Animated PNG — every colour and full transparency. Bigger than a GIF unless the palette is cut.",
    controls: {
      quality: "APNG is lossless — cut the colours or raise the frame-diff tolerance to make it smaller.",
      colours: true,
      dither: true,
      tolerance: true,
    },
    dithers: (o) => {
      if (o.colours === 0) {
        const why = "Every colour is kept, so there is nothing to dither — choose a palette first.";
        return { off: true, ordered: why, diffusion: why };
      }
      return { off: true, ordered: true, diffusion: true };
    },
    resolve: (o) => {
      const colours = o.colours === 0 ? 0 : clampColours(o.colours);
      return {
        ...o,
        quality: 100,
        colours,
        dither: colours === 0 ? "off" : o.dither,
        tolerance: clampTolerance(o.tolerance),
      };
    },
  },
  webp: {
    label: "webp",
    ext: "webp",
    mime: "image/webp",
    blurb:
      "Animated WebP — every colour and full transparency, usually the smallest of the three. Quality 100 is lossless.",
    controls: {
      quality: true,
      colours: "WebP keeps every colour; lower the quality to make it smaller.",
      dither: "WebP keeps every colour, so there is nothing to dither.",
      tolerance: true,
    },
    dithers: () => {
      const why = "WebP keeps every colour, so there is nothing to dither.";
      return { off: true, ordered: why, diffusion: why };
    },
    resolve: (o) => ({
      ...o,
      quality: clampQuality(o.quality),
      colours: 0,
      dither: "off",
      tolerance: clampTolerance(o.tolerance),
    }),
  },
};

/** Formats whose size knob is quality (the rest cut the palette). */
export const QUALITY_FORMATS: readonly AnimFormat[] = ["gif", "webp"];

/** WebP at this quality is written lossless. */
export const WEBP_LOSSLESS = 100;

export const ANIM_FORMATS = Object.keys(FORMATS) as AnimFormat[];

export const MAX_TOLERANCE = 64;

export const DEFAULT_OPTIONS: EncodeOptions = {
  quality: 90,
  colours: 0,
  dither: "diffusion",
  tolerance: 0,
  targetBytes: null,
};

export function clampQuality(n: number): number {
  return Number.isFinite(n) ? Math.min(100, Math.max(1, Math.round(n))) : 90;
}

export function clampColours(n: number): number {
  return Number.isFinite(n) ? Math.min(256, Math.max(2, Math.round(n))) : 256;
}

export function clampTolerance(n: number): number {
  return Number.isFinite(n) ? Math.min(MAX_TOLERANCE, Math.max(0, Math.round(n))) : 0;
}

/** What one rung of a size search changed, in words: `quality 64`, `48 colours · tolerance 6`. */
export function describeOptions(format: AnimFormat, o: EncodeOptions): string {
  const parts: string[] = [];
  if (format === "webp") parts.push(o.quality >= WEBP_LOSSLESS ? "lossless" : `quality ${o.quality}`);
  else if (format === "gif") parts.push(`quality ${o.quality}`);
  else parts.push(o.colours === 0 ? "every colour" : `${o.colours} colours`);
  if (o.tolerance > 0) parts.push(`tolerance ${o.tolerance}`);
  return parts.join(" · ");
}

/**
 * One format's encoder, as the worker runs it: finished frames and resolved
 * options in, file bytes out. It may write over `anim.frames`. The loop
 * count is the encoder's to store.
 */
export type Encoder = (anim: RawAnimation, options: EncodeOptions) => Promise<Uint8Array>;
