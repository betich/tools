import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
import { ladder } from "@/tools/media2media/gif/encode/target";
import { describeOptions, FORMATS, DEFAULT_OPTIONS, type EncodeOptions, type RawAnimation } from "@/tools/media2media/gif/encode/types";
import { encodeWebp, loadWebpAnim, timeline, webpConfig } from "@/tools/media2media/gif/encode/webp";
import type { WebpAnimModule } from "@/vendor/webp-anim/webp_anim.js";

/* ── A RIFF/WebP reader, just enough to check what the encoder wrote ─── */

type Anmf = { x: number; y: number; width: number; height: number; duration: number; blend: boolean; dispose: boolean; chunks: string[] };
type WebpInfo = { width: number; height: number; flags: number; loop: number; bgcolor: number; frames: Anmf[] };

const fourcc = (b: Uint8Array, i: number) => String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
const u16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32 = (b: Uint8Array, i: number) => (u24(b, i) | (b[i + 3]! << 24)) >>> 0;

function chunks(b: Uint8Array, from: number, to: number): { type: string; at: number; size: number }[] {
  const out = [];
  for (let i = from; i + 8 <= to; ) {
    const size = u32(b, i + 4);
    out.push({ type: fourcc(b, i), at: i + 8, size });
    i += 8 + size + (size & 1);
  }
  return out;
}

function readWebp(b: Uint8Array): WebpInfo {
  expect(fourcc(b, 0)).toBe("RIFF");
  expect(fourcc(b, 8)).toBe("WEBP");
  expect(u32(b, 4) + 8).toBe(b.length);
  const top = chunks(b, 12, b.length);
  const vp8x = top.find((c) => c.type === "VP8X")!;
  const anim = top.find((c) => c.type === "ANIM")!;
  expect(vp8x).toBeDefined();
  expect(anim).toBeDefined();
  const frames = top
    .filter((c) => c.type === "ANMF")
    .map((c) => ({
      x: u24(b, c.at) * 2,
      y: u24(b, c.at + 3) * 2,
      width: u24(b, c.at + 6) + 1,
      height: u24(b, c.at + 9) + 1,
      duration: u24(b, c.at + 12),
      blend: (b[c.at + 15]! & 2) === 0,
      dispose: (b[c.at + 15]! & 1) === 1,
      chunks: chunks(b, c.at + 16, c.at + c.size).map((s) => s.type),
    }));
  return {
    flags: b[vp8x.at]!,
    width: u24(b, vp8x.at + 4) + 1,
    height: u24(b, vp8x.at + 7) + 1,
    bgcolor: u32(b, anim.at),
    loop: u16(b, anim.at + 4),
    frames,
  };
}

const ALPHA_FLAG = 0x10;
const ANIMATION_FLAG = 0x02;

/* ── Fixtures ───────────────────────────────────────────────────────────── */

const W = 40;
const H = 30;

/** A dot moving across a see-through canvas, with a half-transparent band. */
const moving = (n: number) =>
  Array.from({ length: n }, (_, k) => {
    const out = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const dot = (x - (6 + k * 7)) ** 2 + (y - 15) ** 2 < 25;
        if (dot) out.set([230, 40, 20, 255], i);
        else if (y >= 24) out.set([20, 80, 200, 128], i);
      }
    return out;
  });

const anim = (frames: Uint8Array[], plays: number, delays: number[]): RawAnimation => ({
  width: W,
  height: H,
  plays,
  frames,
  delays,
});

const opts = (patch: Partial<EncodeOptions> = {}) => FORMATS.webp.resolve({ ...DEFAULT_OPTIONS, ...patch });

let m: WebpAnimModule;
beforeAll(async () => {
  const wasm = readFileSync(join(import.meta.dir, "../src/vendor/webp-anim/webp_anim.wasm"));
  m = await loadWebpAnim({ wasmBinary: wasm });
});

/* ── Pure logic ─────────────────────────────────────────────────────────── */

describe("webp timeline", () => {
  test("starts accumulate and the end is the last frame's own delay past its start", () => {
    expect(timeline([100, 250, 40])).toEqual({ starts: [0, 100, 350], end: 390 });
  });
  test("every frame lasts at least 1 ms, whole ms, at most WebP's 24 bits", () => {
    expect(timeline([0, 2.6, Number.NaN, 1e9])).toEqual({ starts: [0, 1, 4, 5], end: 5 + 0xffffff });
  });
});

describe("webp options", () => {
  test("quality 100 is lossless; below, quality is libwebp's", () => {
    expect(webpConfig(opts({ quality: 100 }))).toMatchObject({ lossless: true });
    expect(webpConfig(opts({ quality: 62 }))).toEqual({ lossless: false, quality: 62, method: 4 });
  });
  test("colours and dithering are dimmed with a reason; quality and tolerance work", () => {
    const { controls, dithers } = FORMATS.webp;
    expect(controls.quality).toBe(true);
    expect(controls.tolerance).toBe(true);
    expect(typeof controls.colours).toBe("string");
    expect(typeof controls.dither).toBe("string");
    expect(dithers(opts()).off).toBe(true);
    expect(typeof dithers(opts()).diffusion).toBe("string");
    expect(opts({ colours: 64, dither: "ordered" })).toMatchObject({ colours: 0, dither: "off" });
  });
  test("the target ladder lowers quality, then tolerance", () => {
    const rungs = ladder("webp", opts({ quality: 100 }));
    expect(rungs[0]!.quality).toBe(100);
    expect(rungs[1]!.quality).toBe(99);
    expect(rungs.at(-1)).toMatchObject({ quality: 1, tolerance: 64 });
    for (let i = 1; i < rungs.length; i++) {
      const [a, b] = [rungs[i - 1]!, rungs[i]!];
      expect(b.quality <= a.quality && b.tolerance >= a.tolerance).toBe(true);
    }
    expect(describeOptions("webp", rungs[0]!)).toBe("lossless");
    expect(describeOptions("webp", { ...rungs[1]!, tolerance: 6 })).toBe("quality 99 · tolerance 6");
  });
});

/* ── The real encoder ───────────────────────────────────────────────────── */

describe("webp encode", () => {
  test("a transparent sequence: alpha flag, loop count, every frame's own duration", () => {
    const out = encodeWebp(m, anim(moving(3), 3, [100, 250, 40]), opts({ quality: 80 }));
    const info = readWebp(out);
    expect(info.width).toBe(W);
    expect(info.height).toBe(H);
    expect(info.flags & ANIMATION_FLAG).toBe(ANIMATION_FLAG);
    expect(info.flags & ALPHA_FLAG).toBe(ALPHA_FLAG);
    expect(info.loop).toBe(3);
    expect(info.bgcolor).toBe(0);
    // The last frame keeps its own 40 ms, not an average of the others.
    expect(info.frames.map((f) => f.duration)).toEqual([100, 250, 40]);
    // Lossy frames carry their alpha in an ALPH chunk.
    expect(info.frames[0]!.chunks).toEqual(["ALPH", "VP8 "]);
  });

  test("lossless, forever, and a single frame", () => {
    const loop = readWebp(encodeWebp(m, anim(moving(2), 0, [70, 70]), opts({ quality: 100 })));
    expect(loop.loop).toBe(0);
    expect(loop.frames.every((f) => f.chunks.includes("VP8L"))).toBe(true);

    const once = readWebp(encodeWebp(m, anim(moving(2), 1, [500, 20]), opts({ quality: 90 })));
    expect(once.loop).toBe(1);
    expect(once.frames.map((f) => f.duration)).toEqual([500, 20]);
  });

  test("a single frame is written as a still WebP, alpha kept", () => {
    const out = encodeWebp(m, anim(moving(1), 0, [500]), opts({ quality: 90 }));
    const top = chunks(out, 12, out.length).map((c) => c.type);
    expect(top).not.toContain("ANIM");
    expect(top).toContain("ALPH");
  });

  test("later frames hold only the rectangle that changed", () => {
    const info = readWebp(encodeWebp(m, anim(moving(2), 0, [100, 100]), opts({ quality: 100 })));
    // Frame 1 is cropped to what isn't see-through (the canvas starts clear); frame 2 to what moved.
    const [a, b] = info.frames as [Anmf, Anmf];
    expect(a).toMatchObject({ x: 0, y: 10, width: W, height: H - 10 });
    expect(b.width * b.height).toBeLessThan(a.width * a.height);
    expect(b.y + b.height).toBeLessThanOrEqual(22);
  });

  test("lower quality makes a smaller file", () => {
    const hi = encodeWebp(m, anim(moving(4), 0, [80, 80, 80, 80]), opts({ quality: 95 })).length;
    const lo = encodeWebp(m, anim(moving(4), 0, [80, 80, 80, 80]), opts({ quality: 10 })).length;
    expect(lo).toBeLessThan(hi);
  });

  test("a wrong-sized frame is refused in words, and the encoder stays usable", () => {
    expect(() => encodeWebp(m, anim([new Uint8Array(8)], 0, [100]), opts())).toThrow(/not 40 × 30/);
    expect(readWebp(encodeWebp(m, anim(moving(2), 0, [50, 50]), opts())).frames).toHaveLength(2);
  });

  test("a canvas past WebP's limit is refused in words", () => {
    const big: RawAnimation = { width: 20000, height: 1, plays: 0, frames: [new Uint8Array(0)], delays: [100] };
    expect(() => encodeWebp(m, big, opts())).toThrow(/16383/);
  });
});
