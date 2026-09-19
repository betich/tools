import { describe, expect, test } from "bun:test";
import { planConversion } from "../src/tools/media2media/video/plan";
import { defaultEdit, editSummary, type SourceInfo } from "../src/tools/media2media/video/settings";
import {
  DEFAULT_KEY,
  KEYED_OUTPUT,
  MAX_INNER,
  NEEDS_WEBM_VP9,
  NO_ALPHA,
  NO_WEBGL,
  CHECKING_ALPHA,
  frameName,
  framesKeepAlpha,
  withKey,
  keyBlocker,
  keyPixel,
  keyUniforms,
  normaliseKey,
  parseHex,
  rgbToYCbCr,
  sequenceBlocker,
  sequenceTimes,
  sequenceZipName,
  toHex,
  yCbCrToRgb,
  type KeySettings,
  type Rgb,
} from "../src/tools/media2media/video/key/settings";

const ON: KeySettings = { ...DEFAULT_KEY, enabled: true };
const u = keyUniforms(ON);
const hex = (h: string) => parseHex(h)!;

describe("colour", () => {
  test("hex parses both lengths and rejects the rest", () => {
    expect(parseHex("#00FF00")).toEqual([0, 1, 0]);
    expect(parseHex("0f0")).toEqual([0, 1, 0]);
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("green")).toBeNull();
    expect(toHex([0, 1, 0])).toBe("#00FF00");
    expect(toHex([0, 177, 64], true)).toBe("#00B140");
  });

  test("Y'CbCr round-trips", () => {
    for (const c of [
      [0.2, 0.7, 0.3],
      [1, 1, 1],
      [0, 0, 0],
      [0.9, 0.1, 0.5],
    ] as Rgb[]) {
      const [y, cb, cr] = rgbToYCbCr(c);
      yCbCrToRgb(y, cb, cr).forEach((v, i) => expect(v).toBeCloseTo(c[i]!, 6));
    }
  });

  test("grey has no chroma; green points down-left in CbCr", () => {
    const [, cb, cr] = rgbToYCbCr([0.5, 0.5, 0.5]);
    expect(Math.hypot(cb, cr)).toBeCloseTo(0, 9);
    const [, gcb, gcr] = rgbToYCbCr([0, 1, 0]);
    expect(gcb).toBeLessThan(0);
    expect(gcr).toBeLessThan(0);
  });
});

describe("uniforms", () => {
  test("the key's chroma and a unit direction", () => {
    const [, cb, cr] = rgbToYCbCr(hex(DEFAULT_KEY.color));
    expect(u.key[0]).toBeCloseTo(cb, 9);
    expect(u.key[1]).toBeCloseTo(cr, 9);
    expect(Math.hypot(u.dir[0], u.dir[1])).toBeCloseTo(1, 9);
  });

  test("the fringe band starts where the soft edge ends", () => {
    expect(u.clean).toBeGreaterThan(u.outer);
    const hard = keyUniforms({ ...ON, softness: 0 });
    expect(hard.clean - hard.outer).toBeGreaterThanOrEqual(0.08 - 1e-12);
  });

  test("tolerance and softness set the ramp; softness 0 still antialiases", () => {
    const a = keyUniforms({ ...ON, tolerance: 100, softness: 0 });
    expect(a.inner).toBeCloseTo(MAX_INNER, 9);
    expect(a.outer).toBeGreaterThan(a.inner);
    expect(a.outer - a.inner).toBeLessThan(0.01);
    const b = keyUniforms({ ...ON, tolerance: 0, softness: 50 });
    expect(b.inner).toBe(0);
    expect(b.outer).toBeCloseTo(0.15, 9);
  });

  test("out-of-range and junk values clamp; a bad colour falls back to the default", () => {
    const a = keyUniforms({ ...ON, tolerance: 400, spill: -3, color: "nope" });
    expect(a.inner).toBeCloseTo(MAX_INNER, 9);
    expect(a.spill).toBe(0);
    expect(a.key).toEqual(u.key);
  });

  test("a grey key has no spill direction", () => {
    expect(keyUniforms({ ...ON, color: "#808080" }).dir).toEqual([0, 0]);
  });
});

describe("keyPixel", () => {
  test("the screen goes transparent, lit or in shadow", () => {
    expect(keyPixel(hex("#00B140"), u)[3]).toBe(0);
    // Same hue, darker and a bit off: a shadow or a crease.
    expect(keyPixel(hex("#0A8A3A"), u)[3]).toBe(0);
    expect(keyPixel(hex("#20C050"), u)[3]).toBe(0);
  });

  test("the subject stays opaque", () => {
    for (const c of ["#E0AC8A", "#8D5524", "#FFFFFF", "#101010", "#C03030", "#2040C0", "#808080"]) {
      expect(keyPixel(hex(c), u)[3]).toBe(1);
    }
  });

  test("an edge pixel — part screen, part skin — is part transparent", () => {
    const skin = hex("#E0AC8A");
    const screen = hex("#00B140");
    const mix = skin.map((v, i) => 0.5 * v + 0.5 * screen[i]!) as Rgb;
    const a = keyPixel(mix, u)[3];
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });

  test("no green fringe: what stays of an edge pixel isn't greener than it is red or blue", () => {
    const skin = hex("#E0AC8A");
    const screen = hex("#00B140");
    for (let t = 0; t <= 1; t += 0.05) {
      const mix = skin.map((v, i) => (1 - t) * v + t * screen[i]!) as Rgb;
      const [r, g, b, a] = keyPixel(mix, u);
      if (a === 0) continue;
      // Within 2/255: the key's axis is a chroma direction, not exactly "G over max(R, B)".
      expect(g).toBeLessThanOrEqual(Math.max(r, b) + 2 / 255);
    }
  });

  test("spill: green bounce on a subject is pulled out, luma kept", () => {
    const tinted = hex("#B0C0A0"); // grey-ish shirt with green cast
    // A narrow key, so the shirt is well clear of the fringe band.
    const narrow = keyUniforms({ ...ON, tolerance: 10, softness: 10 });
    const off = keyPixel(tinted, { ...narrow, spill: 0 });
    const full = keyPixel(tinted, { ...narrow, spill: 1 });
    expect(off[3]).toBe(1);
    off.slice(0, 3).forEach((v, i) => expect(v).toBeCloseTo(tinted[i]!, 6));
    expect(full[1]).toBeLessThan(tinted[1]);
    expect(full[1]).toBeLessThanOrEqual(Math.max(full[0], full[2]) + 1e-6);
    const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    expect(lum(full)).toBeCloseTo(lum(tinted), 2);
  });

  test("spill leaves colours pointing away from the key alone", () => {
    const magenta = hex("#C040C0");
    const out = keyPixel(magenta, { ...u, spill: 1 });
    out.slice(0, 3).forEach((v, i) => expect(v).toBeCloseTo(magenta[i]!, 6));
  });

  test("a blue screen keys too", () => {
    const blue = keyUniforms({ ...ON, color: "#0047BB" });
    expect(keyPixel(hex("#0047BB"), blue)[3]).toBe(0);
    expect(keyPixel(hex("#00B140"), blue)[3]).toBe(1);
    expect(keyPixel(hex("#E0AC8A"), blue)[3]).toBe(1);
  });

  test("output is straight alpha, channels in range", () => {
    for (let i = 0; i < 200; i++) {
      const c: Rgb = [((i * 37) % 256) / 255, ((i * 91) % 256) / 255, ((i * 53) % 256) / 255];
      for (const v of keyPixel(c, { ...u, spill: 1 })) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("settings", () => {
  test("normaliseKey repairs whatever it's given", () => {
    expect(normaliseKey(null)).toEqual(DEFAULT_KEY);
    expect(normaliseKey({ enabled: true, color: "0f0", tolerance: 250, spill: Number.NaN })).toEqual({
      ...DEFAULT_KEY,
      enabled: true,
      color: "#00FF00",
      tolerance: 100,
    });
  });

  test("settings survive JSON — they travel to the GIF tab", () => {
    expect(normaliseKey(JSON.parse(JSON.stringify(ON)))).toEqual(ON);
  });
});

const SOURCE: SourceInfo = {
  width: 1920,
  height: 1080,
  duration: 10_000,
  start: 0,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  videoCodec: "avc",
  audioCodec: "aac",
  audioSampleRate: 48000,
  videoDecodable: true,
};

describe("the edit", () => {
  test("off by default; plan keeps alpha only when keyed", () => {
    const edit = defaultEdit(SOURCE);
    expect(edit.key.enabled).toBe(false);
    expect(planConversion(edit, SOURCE).video.alpha).toBeUndefined();
    const keyed = { ...edit, ...KEYED_OUTPUT, key: ON };
    expect(planConversion(keyed, SOURCE).video.alpha).toBe("keep");
    expect(planConversion(keyed, SOURCE).format).toBe("webm");
    expect(editSummary(keyed, SOURCE)).toContain("key");
  });
});

describe("blockers", () => {
  const edit = { ...defaultEdit(SOURCE), ...KEYED_OUTPUT, key: ON };
  const ok = { vp9: { ok: true }, webgl: true, alpha: true };

  test("nothing to say when the key is off or the output is audio", () => {
    expect(
      keyBlocker({ ...edit, key: DEFAULT_KEY, container: "mp4", codec: "avc" }, { ...ok, webgl: false }),
    ).toBeNull();
    expect(keyBlocker({ ...edit, output: "audio" }, { ...ok, webgl: false })).toBeNull();
  });

  test("in the order the user would fix them", () => {
    expect(keyBlocker(edit, ok)).toBeNull();
    expect(keyBlocker(edit, { ...ok, webgl: false })).toBe(NO_WEBGL);
    expect(keyBlocker({ ...edit, container: "mp4", codec: "avc" }, ok)).toBe(NEEDS_WEBM_VP9);
    expect(keyBlocker({ ...edit, codec: "av1" }, ok)).toBe(NEEDS_WEBM_VP9);
    expect(keyBlocker(edit, { ...ok, vp9: { ok: false } })).toBe(NO_ALPHA);
    expect(keyBlocker(edit, { ...ok, alpha: false })).toBe(NO_ALPHA);
    // Codec probe not back yet: the general blocker says it's checking.
    expect(keyBlocker(edit, { ...ok, vp9: null })).toBeNull();
    // Alpha probe not back yet: the key says so itself.
    expect(keyBlocker(edit, { ...ok, alpha: null })).toBe(CHECKING_ALPHA);
    expect(keyBlocker(edit, { ...ok, vp9: { ok: false }, alpha: null })).toBe(NO_ALPHA);
  });

  test("switching the key on moves the output to WebM/VP9, so it isn't blocked", () => {
    const plain = { ...defaultEdit(SOURCE), container: "mp4" as const, codec: "avc" as const };
    const keyed = withKey(plain, true);
    expect(keyed.key.enabled).toBe(true);
    expect(keyed.container).toBe("webm");
    expect(keyed.codec).toBe("vp9");
    expect(keyBlocker(keyed, ok)).toBeNull();
    // Off again: the output stays where it was put.
    const off = withKey(keyed, false);
    expect(off.key.enabled).toBe(false);
    expect(off.container).toBe("webm");
  });

  test("the alpha probe: the frame's format must carry alpha, and read back both clear and opaque", () => {
    const px = (...alphas: number[]) => new Uint8Array(alphas.flatMap((a) => [255, 255, 255, a]));
    expect(framesKeepAlpha("RGBA", px(255, 0))).toBe(true);
    expect(framesKeepAlpha("BGRA", null)).toBe(true);
    expect(framesKeepAlpha("I420A", null)).toBe(true);
    // Opaque formats: Mediabunny drops the alpha without a word.
    expect(framesKeepAlpha("RGBX", px(255, 0))).toBe(false);
    expect(framesKeepAlpha("I420", null)).toBe(false);
    expect(framesKeepAlpha(null, null)).toBe(false);
    // Claims alpha, but the clear half came back opaque (or the opaque half clear).
    expect(framesKeepAlpha("RGBA", px(255, 255))).toBe(false);
    expect(framesKeepAlpha("RGBA", px(0, 0))).toBe(false);
  });

  test("the alpha sentence is the one the issue asks for", () => {
    expect(NO_ALPHA).toBe("This browser can't encode transparent video — use Chrome or Edge.");
  });

  test("the PNG sequence needs WebGL and a decoder, not an encoder", () => {
    expect(sequenceBlocker({ webgl: true, videoDecoder: true })).toBeNull();
    expect(sequenceBlocker({ webgl: true, videoDecoder: null })).toBeNull();
    expect(sequenceBlocker({ webgl: false, videoDecoder: true })).toBe(NO_WEBGL);
    expect(sequenceBlocker({ webgl: true, videoDecoder: false })).not.toBeNull();
  });
});

describe("png sequence", () => {
  test("one timestamp per output frame across the trim", () => {
    const t = sequenceTimes(2, 3, 30, 1);
    expect(t.length).toBe(30);
    expect(t[0]).toBe(2);
    expect(t[29]).toBeCloseTo(2 + 29 / 30, 9);
  });

  test("speed walks the source faster at the same output rate", () => {
    expect(sequenceTimes(0, 4, 30, 2).length).toBe(60);
    expect(sequenceTimes(0, 1, 30, 0.5).length).toBe(60);
  });

  test("an empty trim gives nothing; a sliver gives one frame", () => {
    expect(sequenceTimes(1, 1, 30, 1)).toEqual([]);
    expect(sequenceTimes(1, 1.001, 30, 1)).toEqual([1]);
  });

  test("names sort, and Thai stays Thai", () => {
    expect(frameName("clip", 0, 120)).toBe("clip-00001.png");
    expect(frameName("clip", 119, 120)).toBe("clip-00120.png");
    expect(frameName("clip", 0, 250_000)).toBe("clip-000001.png");
    expect(frameName("วิดีโอ", 4, 10)).toBe("วิดีโอ-00005.png");
    expect(sequenceZipName("วิดีโอ สีเขียว.mov")).toBe("วิดีโอ สีเขียว-png.zip");
  });
});
