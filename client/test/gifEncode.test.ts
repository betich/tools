import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
import { init as initGifski } from "gifski-wasm";
import UPNG from "upng-js";
import { apng, buildPalette } from "@/tools/media2media/gif/encode/apng";
import { changedRect, stabilise } from "@/tools/media2media/gif/encode/diff";
import { gifski } from "@/tools/media2media/gif/encode/gifski";
import {
  apngCrcValid,
  findNetscapeBlock,
  readApngPlays,
  readGifRepeat,
  setApngPlays,
  setGifRepeat,
} from "@/tools/media2media/gif/encode/loop";
import { makeNearest, remap } from "@/tools/media2media/gif/encode/palette";
import { CLOSE_ENOUGH, fitReport, ladder, searchToFit } from "@/tools/media2media/gif/encode/target";
import { DEFAULT_OPTIONS, FORMATS, type EncodeOptions, type RawAnimation } from "@/tools/media2media/gif/encode/types";

/* ── Fixtures ───────────────────────────────────────────────────────────── */

const W = 32;
const H = 24;

function frame(fill: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [r, g, b, a] = fill(x, y);
      out.set([r, g, b, a], (y * W + x) * 4);
    }
  return out;
}

/** A dot moving across a gradient, the left quarter see-through. */
const moving = (n: number) =>
  Array.from({ length: n }, (_, k) =>
    frame((x, y) => {
      const dot = Math.hypot(x - 4 - k * 6, y - 12) < 4;
      return dot ? [255, 40, 40, 255] : [x * 8, y * 10, 128, x < 8 ? 0 : 255];
    }),
  );

const anim = (frames: Uint8Array[], plays: number, delays = frames.map((_, i) => 100 + i * 30)): RawAnimation => ({
  width: W,
  height: H,
  plays,
  frames,
  delays,
});

const opts = (patch: Partial<EncodeOptions> = {}): EncodeOptions => ({ ...DEFAULT_OPTIONS, ...patch });

/** Every GIF graphic-control delay, in centiseconds. */
function gifDelays(gif: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 7 < gif.length; i++)
    if (gif[i] === 0x21 && gif[i + 1] === 0xf9 && gif[i + 2] === 4) out.push(gif[i + 4]! | (gif[i + 5]! << 8));
  return out;
}

beforeAll(async () => {
  const pkg = dirname(createRequire(import.meta.url).resolve("gifski-wasm"));
  await initGifski(readFileSync(join(pkg, "../pkg/gifski_wasm_bg.wasm")));
});

/* ── Loop counts ────────────────────────────────────────────────────────── */

describe("gif loop count", () => {
  test("gifski writes the delays, and forever unless told to play once", async () => {
    const gif = await gifski(anim(moving(3), 0, [100, 250, 40]), FORMATS.gif.resolve(opts()));
    expect(String.fromCharCode(...gif.slice(0, 6))).toBe("GIF89a");
    expect(gifDelays(gif)).toEqual([10, 25, 4]);
    expect(readGifRepeat(gif)).toBe(0);

    const once = await gifski(anim(moving(3), 1), FORMATS.gif.resolve(opts()));
    expect(findNetscapeBlock(once)).toBe(-1);
  });

  test("a finite count is patched in: plays 3 stores 2 repeats", async () => {
    const gif = await gifski(anim(moving(3), 3), FORMATS.gif.resolve(opts()));
    expect(readGifRepeat(gif)).toBe(2);
  });

  test("the patch refuses a GIF with no loop block rather than writing blind", () => {
    expect(() => setGifRepeat(new Uint8Array(64), 2)).toThrow();
  });

  test("a single frame still encodes", async () => {
    const gif = await gifski(anim(moving(1), 0), FORMATS.gif.resolve(opts()));
    expect(gif.length).toBeGreaterThan(0);
  });
});

describe("apng loop count", () => {
  test("UPNG writes forever; the patch sets num_plays and a valid CRC", () => {
    const frames = moving(3);
    const png = new Uint8Array(
      UPNG.encode(
        frames.map((f) => f.slice().buffer),
        W,
        H,
        0,
        [100, 100, 100],
      ),
    );
    expect(readApngPlays(png)).toBe(0);
    expect(apngCrcValid(png)).toBe(true);
    setApngPlays(png, 4);
    expect(readApngPlays(png)).toBe(4);
    expect(apngCrcValid(png)).toBe(true);
    // UPNG reads it back as a four-play animation.
    expect(UPNG.decode(png.buffer as ArrayBuffer).tabs.acTL?.num_plays).toBe(4);
  });

  test("a still PNG is left alone", () => {
    const png = new Uint8Array(UPNG.encode([moving(1)[0]!.buffer as ArrayBuffer], W, H, 0));
    const before = png.slice();
    expect(setApngPlays(png, 3)).toEqual(before);
  });

  test("the apng encoder keeps delays, alpha and the count", async () => {
    const png = await apng(anim(moving(3), 2, [100, 250, 40]), FORMATS.apng.resolve(opts()));
    const img = UPNG.decode(png.buffer as ArrayBuffer);
    expect(img.frames.map((f) => f.delay)).toEqual([100, 250, 40]);
    expect(img.tabs.acTL?.num_plays).toBe(2);
    const first = new Uint8Array(UPNG.toRGBA8(img)[0]!);
    expect(first[3]).toBe(0); // left edge is see-through
    expect(first[(12 * W + 20) * 4 + 3]).toBe(255);
  });

  test("with a palette it is indexed, and smaller", async () => {
    // Photo-like: a gradient with grain, big enough that the palette's own bytes don't matter.
    const [w, h] = [128, 96];
    let seed = 7;
    const grain = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 24) - 12;
    const photo = () =>
      Array.from({ length: 3 }, (_, k) => {
        const f = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++)
          f.set([(i % w) * 2 + grain(), (i / w) * 2 + k * 9 + grain(), 90 + grain(), 255], i * 4);
        return f;
      });
    const big = (frames: Uint8Array[]): RawAnimation => ({
      width: w,
      height: h,
      plays: 0,
      frames,
      delays: [100, 100, 100],
    });
    const full = await apng(big(photo()), FORMATS.apng.resolve(opts({ colours: 0 })));
    seed = 7;
    const cut = await apng(big(photo()), FORMATS.apng.resolve(opts({ colours: 16, dither: "off" })));
    expect(UPNG.decode(cut.buffer as ArrayBuffer).ctype).toBe(3);
    expect(cut.length).toBeLessThan(full.length);
  });
});

/* ── Frame diff ─────────────────────────────────────────────────────────── */

describe("frame diff", () => {
  test("changedRect bounds the pixels that differ", () => {
    const [a, b] = [
      frame(() => [0, 0, 0, 255]),
      frame((x, y) => (x >= 3 && x <= 5 && y === 7 ? [9, 0, 0, 255] : [0, 0, 0, 255])),
    ];
    expect(changedRect(a, b, W, H)).toEqual({ x: 3, y: 7, width: 3, height: 1 });
    expect(changedRect(a, a.slice(), W, H)).toBeNull();
  });

  test("tolerance settles small changes onto what is on screen", () => {
    const base = frame(() => [100, 100, 100, 255]);
    const noisy = frame((x) => (x === 0 ? [103, 99, 100, 255] : x === 1 ? [140, 100, 100, 255] : [100, 100, 100, 255]));
    const frames = [base, noisy];
    const stats = stabilise(frames, 4);
    expect(Array.from(frames[1]!.slice(0, 4))).toEqual([100, 100, 100, 255]);
    expect(Array.from(frames[1]!.slice(4, 8))).toEqual([140, 100, 100, 255]);
    expect(stats.changedShare).toBeCloseTo(1 / W); // one column of H pixels
  });

  test("tolerance 0 changes nothing but see-through pixels", () => {
    const a = frame(() => [1, 2, 3, 0]);
    const b = frame(() => [9, 9, 9, 0]);
    stabilise([a, b], 0);
    expect(Array.from(b.slice(0, 4))).toEqual([1, 2, 3, 0]);
  });

  test("a slow fade still lands: drift is bounded by the tolerance", () => {
    const frames = Array.from({ length: 10 }, (_, k) => frame(() => [100 + k * 2, 0, 0, 255]));
    stabilise(frames, 5);
    for (let k = 0; k < frames.length; k++) expect(Math.abs(frames[k]![0]! - (100 + k * 2))).toBeLessThanOrEqual(5);
  });
});

/* ── Palette and dithering ──────────────────────────────────────────────── */

describe("palette", () => {
  const bw = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255]);

  test("buildPalette keeps transparent black first and stays within the count", () => {
    const p = buildPalette(moving(3), 8);
    expect(Array.from(p.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(p.length / 4).toBeLessThanOrEqual(8);
  });

  test("every mode writes palette colours only", () => {
    for (const mode of ["off", "ordered", "diffusion"] as const) {
      const f = frame((x, y) => [x * 8, y * 10, 60, 255]);
      remap(f, W, H, bw, mode);
      for (let i = 0; i < f.length; i += 4) expect([0, 255]).toContain(f[i]!);
    }
  });

  test("dithering a mid grey to black and white keeps its average; off does not", () => {
    const mean = (mode: "off" | "ordered" | "diffusion") => {
      const f = frame(() => [128, 128, 128, 255]);
      remap(f, W, H, bw, mode);
      let sum = 0;
      for (let i = 0; i < f.length; i += 4) sum += f[i]!;
      return sum / (W * H);
    };
    expect(Math.abs(mean("ordered") - 128)).toBeLessThan(20);
    expect(Math.abs(mean("diffusion") - 128)).toBeLessThan(20);
    expect([0, 255]).toContain(mean("off"));
  });

  test("ordered dithering is the same pattern on every frame", () => {
    const a = frame(() => [90, 90, 90, 255]);
    const b = a.slice();
    remap(a, W, H, bw, "ordered");
    remap(b, W, H, bw, "ordered");
    expect(changedRect(a, b, W, H)).toBeNull();
  });

  test("nearest picks the transparent entry for see-through pixels", () => {
    expect(makeNearest(bw)(200, 10, 10, 0)).toBe(0);
  });
});

/* ── Capabilities ───────────────────────────────────────────────────────── */

describe("formats", () => {
  test("gifski's dithering is its own; the others are dimmed with a reason", () => {
    const d = FORMATS.gif.dithers(opts());
    expect(d.diffusion).toBe(true);
    expect(typeof d.off).toBe("string");
    expect(FORMATS.gif.resolve(opts({ dither: "off" })).dither).toBe("diffusion");
  });

  test("apng dithers only against a palette", () => {
    expect(typeof FORMATS.apng.dithers(opts({ colours: 0 })).ordered).toBe("string");
    expect(FORMATS.apng.dithers(opts({ colours: 64 })).ordered).toBe(true);
    expect(FORMATS.apng.resolve(opts({ colours: 0, dither: "ordered" })).dither).toBe("off");
    expect(typeof FORMATS.apng.controls.quality).toBe("string");
  });
});

/* ── Target size ────────────────────────────────────────────────────────── */

describe("ladder", () => {
  test("starts at the user's settings and only ever gets smaller", () => {
    for (const [format, start] of [
      ["gif", opts({ quality: 80 })],
      ["apng", opts({ colours: 0 })],
      ["apng", opts({ colours: 64, dither: "ordered" })],
    ] as const) {
      const rungs = ladder(format, start);
      expect(rungs[0]).toEqual(FORMATS[format].resolve({ ...start, targetBytes: null }));
      for (let i = 1; i < rungs.length; i++) {
        const [a, b] = [rungs[i - 1]!, rungs[i]!];
        expect(b.quality <= a.quality && b.tolerance >= a.tolerance).toBe(true);
        expect(b.colours === 0 ? a.colours === 0 : a.colours === 0 || b.colours <= a.colours).toBe(true);
        expect(b).not.toEqual(a);
      }
      expect(rungs.length).toBeGreaterThan(20);
    }
  });

  test("apng from full colour moves to a palette with the chosen dithering", () => {
    const rungs = ladder("apng", opts({ colours: 0, dither: "ordered" }));
    expect(rungs[0]).toMatchObject({ colours: 0, dither: "off" });
    expect(rungs[1]).toMatchObject({ colours: 256, dither: "ordered" });
  });

  test("gif lowers quality before it raises tolerance, and ends at the floor", () => {
    const rungs = ladder("gif", opts({ quality: 90 }));
    expect(rungs[1]).toMatchObject({ quality: 89, tolerance: 0 });
    expect(rungs.at(-1)).toMatchObject({ quality: 1, tolerance: 64 });
  });
});

describe("searchToFit", () => {
  /** A made-up encoder: each rung 2% smaller than the last. */
  const sizes = (n: number, top: number) => Array.from({ length: n }, (_, i) => Math.round(top * 0.98 ** i));

  test("already under: one try, the user's settings", async () => {
    const r = await searchToFit(sizes(100, 1000), 2000, async (s) => s);
    expect(r).toMatchObject({ index: 0, reached: true });
    expect(r.tries.length).toBe(1);
  });

  test("finds the first rung that fits, within a few percent", async () => {
    const s = sizes(150, 10_000);
    const target = 4_000;
    const r = await searchToFit(s, target, async (v) => v);
    const first = s.findIndex((v) => v <= target);
    expect(r.index).toBe(first);
    expect(r.reached).toBe(true);
    expect((target - r.bytes) / target).toBeLessThan(CLOSE_ENOUGH);
    expect(r.tries.length).toBeLessThanOrEqual(12);
  });

  test("unreachable: the smallest result and the gap", async () => {
    const s = sizes(50, 10_000);
    const r = await searchToFit(s, 100, async (v) => v);
    expect(r).toMatchObject({ index: 49, reached: false });
    expect(r.tries.length).toBe(2);
    const report = fitReport("gif", ladder("gif", opts()).slice(0, 50), r, 100);
    expect(report.gap).toMatch(/^reached .* of 100 B/);
  });

  test("a coarse ladder says why it landed well under", async () => {
    const s = [10_000, 5_000, 1_000];
    const rungs = [opts({ colours: 0 }), opts({ colours: 256 }), opts({ colours: 16 })];
    const r = await searchToFit(s, 4_000, async (v) => v);
    expect(r).toMatchObject({ index: 2, reached: true, nextUp: { index: 1, bytes: 5_000 } });
    const report = fitReport("apng", rungs, r, 4_000);
    expect(report.close).toBe(false);
    expect(report.gap).toContain("the next step up, 256 colours, came to 4.9 KB");
  });

  test("an uneven ladder still returns the best-looking rung that fit", async () => {
    const s = [900, 700, 400, 650, 300, 200];
    const r = await searchToFit(s, 500, async (v) => v);
    expect(r.reached).toBe(true);
    expect(s[r.index]).toBeLessThanOrEqual(500);
  });
});

describe("end to end: gif to a target", () => {
  test("gifski at falling quality lands under a reachable target", async () => {
    const frames = moving(5);
    const rungs = ladder("gif", opts({ quality: 100 }));
    const measure = async (o: EncodeOptions) => {
      const copy = frames.map((f) => f.slice());
      stabilise(copy, o.tolerance);
      return (await gifski(anim(copy, 0), o)).length;
    };
    const top = await measure(rungs[0]!);
    const target = Math.round(top * 0.7);
    const r = await searchToFit(rungs, target, (o) => measure(o));
    expect(r.reached).toBe(true);
    expect(r.bytes).toBeLessThanOrEqual(target);
  });
});
