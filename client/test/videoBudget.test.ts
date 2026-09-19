import { describe, expect, test } from "bun:test";
import { Quality } from "mediabunny";
import {
  BPP_FLOOR,
  HEADROOM,
  MIN_VIDEO_BITRATE,
  audioBitrate,
  bitsPerPixel,
  budgetFor,
  containerOverhead,
  correctedBitrate,
  formatBitrate,
  formatOff,
  outcome,
  planBudget,
  suggestHeight,
  type Budget,
  type BudgetInput,
} from "../src/tools/media2media/video/budget";
import { planConversion } from "../src/tools/media2media/video/plan";
import { defaultEdit, type SourceInfo } from "../src/tools/media2media/video/settings";
import { parseSize } from "../src/lib/format";

const MB = 1024 * 1024;

/** A 3-minute 1080p30 clip with AAC sound — about 200 MB off a phone. */
const CLIP: BudgetInput = {
  targetBytes: 25 * MB,
  durationMs: 180_000,
  size: { width: 1920, height: 1080 },
  fps: 30,
  codec: "avc",
  container: "mp4",
  audio: { codec: "aac", sampleRate: 48_000 },
  framedHeight: 1080,
};

function ok(b: ReturnType<typeof planBudget>): Budget {
  if (!b.ok) throw new Error(b.reason);
  return b;
}

/** What a file made exactly at the budget would weigh. */
function predicted(b: Budget, durationMs: number, videoBitrate = b.videoBitrate): number {
  const s = durationMs / 1000;
  return (videoBitrate * s) / 8 + ((b.audio?.bitrate ?? 0) * s) / 8 + b.overheadBytes;
}

describe("planBudget", () => {
  test("200 MB clip → 25 MB: the parts add up to the target less the headroom", () => {
    const b = ok(planBudget(CLIP));
    const bytes = predicted(b, CLIP.durationMs);
    expect(bytes).toBeLessThanOrEqual(CLIP.targetBytes);
    expect(Math.abs(bytes / CLIP.targetBytes - 1)).toBeLessThan(0.05);
    expect(bytes / CLIP.targetBytes).toBeCloseTo(1 - HEADROOM, 3);
    expect(b.audio).toEqual({ codec: "aac", bitrate: 128_000 });
    // ~1.0 Mbps for 1080p30 H.264 is thin; 720p isn't quite enough either, 480p is.
    expect(b.videoBitrate).toBeGreaterThan(900_000);
    expect(b.videoBitrate).toBeLessThan(1_100_000);
    expect(b.thin).toBe(true);
    expect(b.suggestHeight).toBe(480);
  });

  test("a roomy target is not thin and suggests nothing", () => {
    const b = ok(planBudget({ ...CLIP, targetBytes: 150 * MB }));
    expect(b.thin).toBe(false);
    expect(b.suggestHeight).toBeNull();
  });

  test("silent output gives the whole budget to the picture", () => {
    const withSound = ok(planBudget(CLIP));
    const silent = ok(planBudget({ ...CLIP, audio: null }));
    expect(silent.audio).toBeNull();
    expect(silent.videoBitrate).toBeGreaterThan(withSound.videoBitrate + 128_000 - 2_000);
  });

  test("tight budgets step the audio down a rung", () => {
    // 10 MB for 3 minutes: ~450 kbps total, so AAC drops to 96k and Opus further.
    expect(ok(planBudget({ ...CLIP, targetBytes: 10 * MB })).audio?.bitrate).toBe(96_000);
    const opus = ok(
      planBudget({
        ...CLIP,
        container: "webm",
        codec: "vp9",
        targetBytes: 10 * MB,
        audio: { codec: "opus", sampleRate: 48_000 },
      }),
    );
    expect(opus.audio?.bitrate).toBe(64_000);
  });

  test("a target too small for the length is refused, with the least that would do", () => {
    const b = planBudget({ ...CLIP, targetBytes: 2 * MB });
    expect(b.ok).toBe(false);
    if (!b.ok)
      expect(b.reason).toMatch(
        /too small for 3 min 00 s of video — it needs at least \d+(\.\d)? MB\. Trim it, mute it or aim higher\./,
      );
  });

  test("the least it asks for is really enough", () => {
    const refused = planBudget({ ...CLIP, targetBytes: 2 * MB });
    if (refused.ok) throw new Error("expected a refusal");
    const least = Number(/at least ([\d.]+) MB/.exec(refused.reason)![1]) * MB;
    expect(ok(planBudget({ ...CLIP, targetBytes: least * 1.05 })).videoBitrate).toBeGreaterThanOrEqual(
      MIN_VIDEO_BITRATE,
    );
  });

  test("nothing to encode is refused", () => {
    expect(planBudget({ ...CLIP, durationMs: 0 }).ok).toBe(false);
    expect(planBudget({ ...CLIP, targetBytes: 0 }).ok).toBe(false);
  });

  test("an unknown frame rate counts as 30", () => {
    const known = ok(planBudget(CLIP));
    const unknown = ok(planBudget({ ...CLIP, fps: null }));
    expect(unknown.bitsPerPixel).toBeCloseTo(known.bitsPerPixel, 6);
  });
});

describe("pieces", () => {
  test("bits per pixel", () => {
    expect(bitsPerPixel(6_220_800, { width: 1920, height: 1080 }, 30)).toBeCloseTo(0.1, 6);
    expect(bitsPerPixel(1, { width: 0, height: 0 }, 30)).toBe(0);
  });

  test("newer codecs make do with fewer bits", () => {
    expect(BPP_FLOOR.av1).toBeLessThan(BPP_FLOOR.vp9);
    expect(BPP_FLOOR.hevc).toBeLessThan(BPP_FLOOR.avc);
  });

  test("container overhead grows with packets and stays a small share", () => {
    const mp4 = containerOverhead("mp4", 180, 30, { codec: "aac", sampleRate: 48_000 });
    expect(mp4).toBeGreaterThan(containerOverhead("mp4", 180, 30, null));
    expect(mp4 / (25 * MB)).toBeLessThan(0.01);
    expect(containerOverhead("webm", 180, 30, null)).toBeGreaterThan(containerOverhead("mp4", 180, 30, null));
  });

  test("audio ladder", () => {
    expect(audioBitrate("aac", 5_000_000)).toBe(128_000);
    expect(audioBitrate("aac", 100_000)).toBe(96_000);
    expect(audioBitrate("opus", 5_000_000)).toBe(96_000);
    expect(audioBitrate("opus", 100_000)).toBe(32_000);
    expect(audioBitrate("mystery", 5_000_000)).toBe(96_000);
  });

  test("suggested height: the largest that clears the floor, else the smallest, never upward", () => {
    // 1.5 Mbps at 30 fps: 720p gives 0.054 bpp, over H.264's floor.
    expect(suggestHeight(1_500_000, { width: 1920, height: 1080 }, 30, BPP_FLOOR.avc, 1080)).toBe(720);
    expect(suggestHeight(100_000, { width: 1920, height: 1080 }, 30, BPP_FLOOR.avc, 1080)).toBe(360);
    expect(suggestHeight(100_000, { width: 640, height: 360 }, 30, BPP_FLOOR.avc, 360)).toBeNull();
    // Already resized to 720p: only heights below it.
    expect(suggestHeight(100_000, { width: 1280, height: 720 }, 30, BPP_FLOOR.avc, 1080)).toBe(360);
  });
});

describe("after the export", () => {
  const b = ok(planBudget(CLIP));

  test("on or under target: nothing to retry", () => {
    expect(correctedBitrate(b, CLIP.durationMs, CLIP.targetBytes, CLIP.targetBytes)).toBeNull();
    expect(correctedBitrate(b, CLIP.durationMs, CLIP.targetBytes, 20 * MB)).toBeNull();
  });

  test("an encoder that overshoots by 10% lands under on the retry", () => {
    // The first pass: the picture takes 10% more than asked.
    const s = CLIP.durationMs / 1000;
    const overshoot = 1.1;
    const first = predicted(b, CLIP.durationMs, b.videoBitrate * overshoot);
    expect(first).toBeGreaterThan(CLIP.targetBytes);
    const next = correctedBitrate(b, CLIP.durationMs, CLIP.targetBytes, first)!;
    expect(next).toBeLessThan(b.videoBitrate);
    // Same encoder, same habit, corrected rate.
    const second = (next * overshoot * s) / 8 + ((b.audio?.bitrate ?? 0) * s) / 8 + b.overheadBytes;
    expect(second).toBeLessThanOrEqual(CLIP.targetBytes);
    expect(Math.abs(second / CLIP.targetBytes - 1)).toBeLessThan(0.05);
  });

  test("never backs off by more than half in one go", () => {
    const next = correctedBitrate(b, CLIP.durationMs, CLIP.targetBytes, 200 * MB)!;
    expect(next).toBe(Math.floor(b.videoBitrate * 0.5));
  });

  test("outcome reads as signed distance from the target", () => {
    const o = outcome(25 * MB, 26 * MB);
    expect(o.over).toBe(true);
    expect(o.off).toBeCloseTo(0.04, 6);
    expect(formatOff(o.off)).toBe("+4%");
    expect(formatOff(outcome(25 * MB, 24.25 * MB).off)).toBe("−3%");
    expect(formatOff(0)).toBe("0%");
  });

  test("bitrate wording", () => {
    expect(formatBitrate(2_450_000)).toBe("2.5 Mbps");
    expect(formatBitrate(850_400)).toBe("850 kbps");
  });
});

describe("from the edit", () => {
  const SOURCE: SourceInfo = {
    width: 1920,
    height: 1080,
    duration: 180_000,
    start: 0,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
    videoCodec: "avc",
    audioCodec: "aac",
    audioSampleRate: 48_000,
    videoDecodable: true,
  };
  const AUDIO = { mp4: "aac", webm: "opus" } as const;

  test("no size named, or not making a video: no budget", () => {
    expect(budgetFor(defaultEdit(SOURCE), SOURCE, AUDIO, null)).toBeNull();
    expect(budgetFor({ ...defaultEdit(SOURCE), output: "audio" }, SOURCE, AUDIO, 25 * MB)).toBeNull();
  });

  test("follows trim, speed, mute and the container's audio", () => {
    const edit = defaultEdit(SOURCE);
    const whole = ok(budgetFor(edit, SOURCE, AUDIO, 25 * MB)!);
    const half = ok(budgetFor({ ...edit, trim: { in: 0, out: 90_000 } }, SOURCE, AUDIO, 25 * MB)!);
    expect(half.videoBitrate).toBeGreaterThan(whole.videoBitrate * 1.9);
    const fast = ok(budgetFor({ ...edit, speed: 2 }, SOURCE, AUDIO, 25 * MB)!);
    expect(fast.videoBitrate).toBeCloseTo(half.videoBitrate, -4);
    expect(ok(budgetFor({ ...edit, mute: true }, SOURCE, AUDIO, 25 * MB)!).audio).toBeNull();
    expect(ok(budgetFor(edit, SOURCE, { mp4: null, webm: null }, 25 * MB)!).audio).toBeNull();
    expect(ok(budgetFor({ ...edit, container: "webm", codec: "vp9" }, SOURCE, AUDIO, 25 * MB)!).audio?.codec).toBe(
      "opus",
    );
  });

  test("the plan carries the bitrate, its mode and the fixed audio", () => {
    const edit = defaultEdit(SOURCE);
    const b = ok(budgetFor(edit, SOURCE, AUDIO, 25 * MB)!);
    const plan = planConversion(edit, SOURCE, {
      videoBitrate: b.videoBitrate,
      bitrateMode: "constant",
      audio: b.audio,
    });
    expect(plan.video.quality).toEqual(new Quality({ bitrate: b.videoBitrate, bitrateMode: "constant" }));
    const audio = plan.audio({ sampleRate: 48_000 });
    expect(audio.codec).toBe("aac");
    expect(audio.quality).toEqual(new Quality({ bitrate: 128_000 }));
    // Without a target the audio is left to copy.
    expect(planConversion(edit, SOURCE).audio({ sampleRate: 48_000 }).quality).toBeUndefined();
  });
});

describe("parseSize", () => {
  test("bare numbers are MB; units and commas are read", () => {
    expect(parseSize("25")).toBe(25 * MB);
    expect(parseSize("8,5")).toBe(Math.round(8.5 * MB));
    expect(parseSize("800 kb")).toBe(800 * 1024);
    expect(parseSize("")).toBeNull();
    expect(parseSize("lots")).toBeUndefined();
  });
});
