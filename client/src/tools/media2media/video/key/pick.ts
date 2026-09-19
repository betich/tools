import type { Rgb } from "./settings";

let scratch: HTMLCanvasElement | null = null;

/**
 * The eyedropper: the colour of the *source* picture (before any key) at a
 * point, averaged over a small square so one noisy pixel doesn't decide it.
 *
 * `fx`, `fy` are fractions (0–1) of the rotated frame; `rotate` is the
 * clockwise turn the preview applies. Returns 0–1 channels, or null when
 * there is no picture to read (or the browser won't let it be read).
 */
export function sampleColor(
  img: CanvasImageSource,
  source: { width: number; height: number },
  rotate: number,
  fx: number,
  fy: number,
  radius = 3,
): Rgb | null {
  const turned = rotate % 180 !== 0;
  const W = turned ? source.height : source.width;
  const H = turned ? source.width : source.height;
  if (!(W > 0 && H > 0)) return null;
  // Work at up to 960 px on the long side: plenty to aim with, cheap to draw.
  const k = Math.min(1, 960 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k));
  const h = Math.max(1, Math.round(H * k));
  scratch ??= document.createElement("canvas");
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const sw = source.width * k;
  const sh = source.height * k;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();

  const cx = Math.round(Math.min(1, Math.max(0, fx)) * (w - 1));
  const cy = Math.round(Math.min(1, Math.max(0, fy)) * (h - 1));
  const x0 = Math.max(0, cx - radius);
  const y0 = Math.max(0, cy - radius);
  const x1 = Math.min(w, cx + radius + 1);
  const y1 = Math.min(h, cy + radius + 1);
  try {
    const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    let r = 0;
    let g = 0;
    let b = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
    }
    return n ? [r / n / 255, g / n / 255, b / n / 255] : null;
  } catch {
    return null;
  }
}
