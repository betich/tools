/* ───────────────────────────────────────────────────────────────────────────
   The chroma key: what the user asked for, and the maths that turns it into
   shader uniforms. Pure — no WebGL, React or DOM — so `bun test` checks the
   colour science, and the settings are a plain object any tab can carry
   (the GIF tab applies the same key to a clip sent over).

   The key works in BT.709 Y'CbCr on the gamma-encoded values, the space the
   video came in: a pixel's distance from the key colour is measured in the
   chroma plane only (CbCr), so a shadow on the green screen — the same hue,
   darker — keys with the lit part. `keyPixel` is the shader, line for line,
   in JavaScript; the tests pin it, and the shader is written to match.
   ─────────────────────────────────────────────────────────────────────────── */

import { normaliseHex } from "@/lib/color";
import { fileStem } from "../../names";

export type KeySettings = {
  enabled: boolean;
  /** `#RRGGBB`, the backdrop's colour — picked off the picture with the eyedropper. */
  color: string;
  /** 0–100: how far from the key colour still counts as backdrop. */
  tolerance: number;
  /** 0–100: the width of the ramp from backdrop to subject — the soft edge. */
  softness: number;
  /** 0–100: how much of the key's hue is pulled out of what stays. */
  spill: number;
};

/** Chroma-key green (the paint, as a camera sees it under even light). */
export const DEFAULT_KEY: KeySettings = {
  enabled: false,
  color: "#00B140",
  tolerance: 40,
  softness: 30,
  spill: 60,
};

export type Rgb = [number, number, number];

/** What the shader is handed. Every value is in 0–1 colour units. */
export type KeyUniforms = {
  /** The key colour's chroma, (Cb, Cr). */
  key: [number, number];
  /** The key's chroma as a unit vector — the direction spill is pulled out along. Zero for a grey key. */
  dir: [number, number];
  /** Chroma distance at and under which a pixel is fully transparent. */
  inner: number;
  /** Chroma distance at and over which a pixel is fully opaque. */
  outer: number;
  /**
   * Chroma distance at which spill cleaning has eased from full back to the
   * slider's amount. Between `outer` and here are the opaque pixels that
   * still lean towards the key — the fringe.
   */
  clean: number;
  /** 0–1. */
  spill: number;
};

/* ── Colour ──────────────────────────────────────────────────────────────── */

// BT.709 luma weights.
const KR = 0.2126;
const KB = 0.0722;
const KG = 1 - KR - KB;
/** Cb = (B − Y) / CB_SCALE, Cr = (R − Y) / CR_SCALE: both span −0.5…0.5. */
const CB_SCALE = 2 * (1 - KB);
const CR_SCALE = 2 * (1 - KR);

/** `#RRGGBB` or `#RGB` to 0–1 channels; null for anything else. */
export function parseHex(hex: string): Rgb | null {
  const v = normaliseHex(hex, { short: true, bare: true });
  if (!v) return null;
  const n = parseInt(v.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 0–1 channels (or 0–255 with `bytes`) to `#RRGGBB`. */
export function toHex([r, g, b]: Rgb, bytes = false): string {
  const k = bytes ? 1 : 255;
  const h = (x: number) =>
    Math.round(Math.min(255, Math.max(0, x * k)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

export function rgbToYCbCr([r, g, b]: Rgb): [number, number, number] {
  const y = KR * r + KG * g + KB * b;
  return [y, (b - y) / CB_SCALE, (r - y) / CR_SCALE];
}

export function yCbCrToRgb(y: number, cb: number, cr: number): Rgb {
  const r = y + CR_SCALE * cr;
  const b = y + CB_SCALE * cb;
  const g = (y - KR * r - KB * b) / KG;
  return [r, g, b];
}

/* ── Settings → uniforms ─────────────────────────────────────────────────── */

/** The largest chroma distance tolerance reaches, at 100. A saturated green sits ~0.6 from grey. */
export const MAX_INNER = 0.4;
/** The widest soft edge, at 100. */
export const MAX_SOFT = 0.3;
/** The fringe band past the soft edge is never narrower than this. */
export const MIN_FRINGE = 0.08;

const pct = (v: number) => (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) / 100 : 0);

export function keyUniforms(s: KeySettings): KeyUniforms {
  const rgb = parseHex(s.color) ?? parseHex(DEFAULT_KEY.color)!;
  const [, cb, cr] = rgbToYCbCr(rgb);
  const len = Math.hypot(cb, cr);
  const inner = pct(s.tolerance) * MAX_INNER;
  // A hair of ramp even at 0, so the edge is antialiased rather than stair-stepped.
  const outer = inner + Math.max(1 / 255, pct(s.softness) * MAX_SOFT);
  return {
    key: [cb, cr],
    dir: len > 1e-4 ? [cb / len, cr / len] : [0, 0],
    inner,
    outer,
    clean: outer + Math.max(outer - inner, MIN_FRINGE),
    spill: pct(s.spill),
  };
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * One pixel through the key: 0–1 RGB in, straight (not premultiplied) RGBA
 * out. The shader in `shader.ts` does exactly this.
 *
 * Alpha ramps with the chroma distance from the key. Spill is the key's hue
 * in what stays — green bounce on hair, the fringe where subject and screen
 * blend — and is removed by taking the pixel's chroma component along the
 * key's direction (only where it points *towards* the key) and pulling it
 * out, luma untouched. Pixels on the soft edge, and a band of opaque ones
 * just past it (`outer`…`clean`), are part backdrop whatever their alpha
 * says, so they're cleaned fully, easing back to the slider's amount across
 * the band: that's what leaves no green fringe.
 */
export function keyPixel(rgb: Rgb, u: KeyUniforms): [number, number, number, number] {
  const [y, cb, cr] = rgbToYCbCr(rgb);
  const d = Math.hypot(cb - u.key[0], cr - u.key[1]);
  const alpha = smoothstep(u.inner, u.outer, d);

  const along = Math.max(0, cb * u.dir[0] + cr * u.dir[1]);
  const pull = along * Math.max(u.spill, 1 - smoothstep(u.outer, u.clean, d));
  const [r, g, b] = yCbCrToRgb(y, cb - pull * u.dir[0], cr - pull * u.dir[1]);
  const c = (x: number) => Math.min(1, Math.max(0, x));
  return [c(r), c(g), c(b), alpha];
}

/* ── Rules and wording ───────────────────────────────────────────────────── */

export const NO_ALPHA = "This browser can't encode transparent video — use Chrome or Edge.";
export const NO_WEBGL = "This browser can't run WebGL, which the key needs to draw.";
export const NEEDS_WEBM_VP9 = "Transparent video needs WebM with VP9 — pick them under output.";
export const ALPHA_PLAYBACK_NOTE = "Transparent in Chrome/Firefox; Safari shows it opaque.";

export const CHECKING_ALPHA = "Checking whether this browser can encode transparent video.";

/** What a keyed export needs from the output: WebM, VP9. */
export const KEYED_OUTPUT = { container: "webm", codec: "vp9" } as const;

/**
 * The edit with the key switched on or off. Switching it on moves the
 * output to WebM/VP9 in the same step, since transparency survives nowhere
 * else; switching it off leaves the output where it is.
 */
export function withKey<E extends { container: string; codec: string; key: KeySettings }>(edit: E, enabled: boolean): E {
  return { ...edit, key: { ...edit.key, enabled }, ...(enabled ? KEYED_OUTPUT : {}) };
}

/**
 * Why a keyed video export can't go, or null. Checked before the general
 * blocker so the reason names the key, not the codec. Null when the key is
 * off, the output is audio, or the codec probe hasn't answered (the general
 * blocker says it's checking).
 *
 * `alpha` is the alpha probe (`framesKeepAlpha`, run in the browser): null
 * while it runs. Mediabunny encodes VP9 alpha as a second stream split from
 * each frame's alpha plane, and silently drops it for a frame whose format
 * has none — so a browser whose canvas frames lose their alpha would export
 * an opaque file without a word. That is what the probe catches.
 */
export function keyBlocker(
  edit: { output: "video" | "audio"; container: string; codec: string; key: KeySettings },
  env: { vp9: { ok: boolean } | null; webgl: boolean; alpha: boolean | null },
): string | null {
  if (!edit.key.enabled || edit.output !== "video") return null;
  if (!env.webgl) return NO_WEBGL;
  if (edit.container !== KEYED_OUTPUT.container || edit.codec !== KEYED_OUTPUT.codec) return NEEDS_WEBM_VP9;
  if (!env.vp9) return null;
  if (!env.vp9.ok || env.alpha === false) return NO_ALPHA;
  if (env.alpha === null) return CHECKING_ALPHA;
  return null;
}

/**
 * The alpha probe's verdict on one `VideoFrame` made from a canvas that is
 * half opaque, half clear: its pixel format must carry alpha (`RGBA`,
 * `BGRA`, `I420A`…), and when the browser could read it back as RGBA the
 * samples must hold both a clear and an opaque pixel. `rgba` is null when
 * the read-back isn't supported; the format then decides alone.
 */
export function framesKeepAlpha(format: string | null, rgba: Uint8Array | null): boolean {
  if (!format || !format.includes("A")) return false;
  if (!rgba) return true;
  let clear = false;
  let opaque = false;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i]! < 16) clear = true;
    else if (rgba[i]! > 239) opaque = true;
  }
  return clear && opaque;
}

/** Why the PNG sequence can't be made, or null. It needs the shader and a decoder, no encoder. */
export function sequenceBlocker(env: { webgl: boolean; videoDecoder: boolean | null }): string | null {
  if (!env.webgl) return NO_WEBGL;
  if (env.videoDecoder === false)
    return "This browser can't decode video with WebCodecs, so it can't read frames out of the file.";
  return null;
}

/** Normalise anything that claims to be key settings (a restored or sent object) into valid ones. */
export function normaliseKey(value: Partial<KeySettings> | null | undefined): KeySettings {
  const v = value ?? {};
  const num = (x: unknown, d: number) =>
    typeof x === "number" && Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : d;
  const rgb = typeof v.color === "string" ? parseHex(v.color) : null;
  return {
    enabled: v.enabled === true,
    color: rgb ? toHex(rgb) : DEFAULT_KEY.color,
    tolerance: num(v.tolerance, DEFAULT_KEY.tolerance),
    softness: num(v.softness, DEFAULT_KEY.softness),
    spill: num(v.spill, DEFAULT_KEY.spill),
  };
}

/* ── PNG sequence ────────────────────────────────────────────────────────── */

/**
 * Source timestamps (seconds) to take for a sequence at `fps` output frames
 * per second: the trim, walked at `speed / fps` source seconds per frame.
 */
export function sequenceTimes(startSec: number, endSec: number, fps: number, speed: number): number[] {
  const step = speed / fps;
  if (!(step > 0) || !(endSec > startSec)) return [];
  const n = Math.max(1, Math.floor((endSec - startSec) / step + 1e-9));
  return Array.from({ length: n }, (_, i) => startSec + i * step);
}

/** `clip-00001.png`, padded so the files sort in order in any file manager. Unicode stems stay. */
export function frameName(stem: string, index: number, total: number): string {
  const width = Math.max(5, String(Math.max(1, total)).length);
  return `${stem}-${String(index + 1).padStart(width, "0")}.png`;
}

/** The zip's name: the source's stem, Unicode kept. */
export function sequenceZipName(sourceName: string): string {
  return `${fileStem(sourceName, "video")}-png.zip`;
}
