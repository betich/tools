import { describe, expect, test } from "bun:test";
import { Quality } from "mediabunny";
import { planConversion, speedResampleRate, videoQuality } from "../src/tools/media2media/video/plan";
import {
  centredCrop,
  clampCrop,
  defaultEdit,
  editSummary,
  heightChoices,
  moveCrop,
  outputDuration,
  outputFrameCount,
  outputName,
  outputSize,
  resizeCrop,
  rotatedSize,
  type SourceInfo,
  type VideoEdit,
} from "../src/tools/media2media/video/settings";

const SOURCE: SourceInfo = {
  width: 1920,
  height: 1080,
  duration: 60_000,
  start: 0,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  videoCodec: "avc",
  audioCodec: "aac",
  audioSampleRate: 48_000,
  videoDecodable: true,
};

const edit = (patch: Partial<VideoEdit> = {}): VideoEdit => ({ ...defaultEdit(SOURCE), ...patch });

describe("geometry", () => {
  test("rotation swaps sides at 90 and 270", () => {
    expect(rotatedSize(SOURCE, 0)).toEqual({ width: 1920, height: 1080 });
    expect(rotatedSize(SOURCE, 90)).toEqual({ width: 1080, height: 1920 });
    expect(rotatedSize(SOURCE, 180)).toEqual({ width: 1920, height: 1080 });
    expect(rotatedSize(SOURCE, 270)).toEqual({ width: 1080, height: 1920 });
  });

  test("a crop is pulled inside the frame with even sides", () => {
    expect(clampCrop({ left: -40, top: 1000, width: 301, height: 199 }, SOURCE)).toEqual({
      left: 0,
      top: 1080 - 198,
      width: 300,
      height: 198,
    });
    expect(clampCrop({ left: 0, top: 0, width: 4000, height: 4000 }, SOURCE)).toEqual({
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
    });
  });

  test("a centred crop is the largest of its ratio", () => {
    expect(centredCrop(SOURCE, 1)).toEqual({ left: 420, top: 0, width: 1080, height: 1080 });
    const tall = centredCrop(SOURCE, 9 / 16);
    expect(tall.height).toBe(1080);
    expect(tall.width).toBe(606);
  });

  test("moving stops at the edges", () => {
    const c = { left: 100, top: 100, width: 400, height: 300 };
    expect(moveCrop(c, -500, 50, SOURCE)).toEqual({ left: 0, top: 150, width: 400, height: 300 });
    expect(moveCrop(c, 5000, 5000, SOURCE)).toEqual({ left: 1520, top: 780, width: 400, height: 300 });
  });

  test("resizing keeps the opposite corner and the ratio", () => {
    const c = { left: 100, top: 100, width: 400, height: 400 };
    const se = resizeCrop(c, "se", 100, 0, SOURCE, 1);
    expect(se).toEqual({ left: 100, top: 100, width: 500, height: 500 });
    const nw = resizeCrop(c, "nw", 50, 50, SOURCE, null);
    expect(nw).toEqual({ left: 150, top: 150, width: 350, height: 350 });
    // Dragged past the frame edge, it stops there.
    const big = resizeCrop(c, "nw", -1000, -1000, SOURCE, null);
    expect(big).toEqual({ left: 0, top: 0, width: 500, height: 500 });
    // Never inverted, never under the minimum.
    expect(resizeCrop(c, "se", -1000, -1000, SOURCE, null).width).toBe(16);
  });

  test("output size follows rotate, crop and height, even, never up", () => {
    expect(outputSize(edit(), SOURCE)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize(edit({ height: 720 }), SOURCE)).toEqual({ width: 1280, height: 720 });
    expect(outputSize(edit({ height: 2160 }), SOURCE)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize(edit({ rotate: 90, height: 720 }), SOURCE)).toEqual({ width: 404, height: 720 });
    expect(outputSize(edit({ crop: { left: 0, top: 0, width: 1080, height: 1080 }, height: 480 }), SOURCE)).toEqual({
      width: 480,
      height: 480,
    });
    // Odd sources round down to even, never past the frame.
    expect(outputSize(edit(), { width: 1919, height: 1079 })).toEqual({ width: 1918, height: 1078 });
  });

  test("only smaller heights are offered", () => {
    expect(heightChoices(1080)).toEqual([720, 480, 360]);
  });
});

describe("time", () => {
  test("length is the trim over the speed", () => {
    expect(outputDuration(edit({ trim: { in: 10_000, out: 40_000 }, speed: 2 }))).toBe(15_000);
    expect(outputDuration(edit({ trim: { in: 0, out: 10_000 }, speed: 0.5 }))).toBe(20_000);
  });

  test("frame count uses the target rate, or the source's sped up", () => {
    expect(outputFrameCount(edit({ trim: { in: 0, out: 10_000 } }), SOURCE)).toBe(300);
    expect(outputFrameCount(edit({ trim: { in: 0, out: 10_000 }, speed: 2 }), SOURCE)).toBe(300);
    expect(outputFrameCount(edit({ trim: { in: 0, out: 10_000 }, fps: 24 }), SOURCE)).toBe(240);
    expect(outputFrameCount(edit(), { fps: null })).toBeNull();
  });
});

describe("names", () => {
  test("keeps Unicode and swaps the extension", () => {
    expect(outputName("งานวันเกิด 2026.mov", edit())).toBe("งานวันเกิด 2026.mp4");
    expect(outputName("clip.MP4", edit())).toBe("clip-edit.mp4");
    expect(outputName("clip.mkv", edit({ container: "webm" }))).toBe("clip.webm");
    expect(outputName("clip.mkv", edit({ output: "audio", audioOutput: "wav" }))).toBe("clip.wav");
    expect(outputName(".mov", edit())).toBe(".mov.mp4");
  });

  test("summary lists only what changes", () => {
    expect(editSummary(edit(), SOURCE)).toEqual([]);
    expect(editSummary(edit({ trim: { in: 1000, out: 60_000 }, speed: 2, height: 720, mute: true }), SOURCE)).toEqual([
      "trim",
      "720p",
      "2×",
      "mute",
    ]);
  });
});

describe("plan", () => {
  test("a plain transcode sets codec and quality and nothing else", () => {
    const p = planConversion(edit({ container: "webm", codec: "vp9" }), SOURCE);
    expect(p.format).toBe("webm");
    expect(p.trim).toBeUndefined();
    expect(p.retime).toBeNull();
    expect(p.video.codec).toBe("vp9");
    expect(p.video.quality).toBeInstanceOf(Quality);
    expect(p.video.width).toBeUndefined();
    expect(p.video.rotate).toBeUndefined();
    expect(p.video.crop).toBeUndefined();
    expect(p.video.frameRate).toBeUndefined();
    expect(p.audio({ sampleRate: 48_000 })).toEqual({});
    expect(p.copy).toEqual({ mode: "preferred", boundaryTolerance: 0 });
  });

  test("trim goes over in seconds, in the file's own time", () => {
    expect(planConversion(edit({ trim: { in: 1500, out: 30_000 } }), SOURCE).trim).toEqual({ start: 1.5, end: 30 });
    const late = { ...SOURCE, start: 1.4 };
    expect(planConversion(edit({ trim: { in: 1000, out: 2000 } }), late).trim).toEqual({ start: 2.4, end: 3.4 });
  });

  test("rotate, crop, resize and fps map to Mediabunny's options", () => {
    const p = planConversion(
      edit({ rotate: 90, crop: { left: 0, top: 420, width: 1080, height: 1080 }, height: 720, fps: 24 }),
      SOURCE,
    );
    expect(p.video.rotate).toBe(90);
    expect(p.video.crop).toEqual({ left: 0, top: 420, width: 1080, height: 1080 });
    expect(p.video.width).toBe(720);
    expect(p.video.height).toBe(720);
    expect(p.video.fit).toBe("fill");
    expect(p.video.frameRate).toBe(24);
    expect(p.size).toEqual({ width: 720, height: 720 });
    expect(p.video.processedWidth).toBe(720);
  });

  test("a speed change moves fps into the pipeline and resamples audio", () => {
    const p = planConversion(edit({ speed: 2, fps: 30 }), SOURCE);
    expect(p.retime).toEqual({ speed: 2, fps: 30 });
    // Mediabunny's frameRate would snap before `process` runs.
    expect(p.video.frameRate).toBeUndefined();
    expect(p.audio({ sampleRate: 48_000 })).toEqual({ sampleRate: 24_000, processedSampleRate: 48_000 });
  });

  test("mute drops audio; audio-only drops video and picks the codec", () => {
    expect(planConversion(edit({ mute: true }), SOURCE).audio({ sampleRate: 44_100 })).toEqual({ discard: true });
    const a = planConversion(edit({ output: "audio", audioOutput: "ogg", mute: true }), SOURCE);
    expect(a.format).toBe("ogg");
    expect(a.video).toEqual({ discard: true });
    expect(a.audio({ sampleRate: 44_100 })).toEqual({ codec: "opus" });
    expect(a.size).toBeNull();
  });

  test("an explicit bitrate beats the quality level", () => {
    const q = videoQuality({ quality: "low" }, 2_500_000.4) as unknown as { _bitrate: number };
    expect(q._bitrate).toBe(2_500_000);
    const level = videoQuality({ quality: "high" }, null) as unknown as { _bitrate?: number; _quality: unknown };
    expect(level._bitrate).toBeUndefined();
    expect(planConversion(edit(), SOURCE, { videoBitrate: 1e6 }).video.quality).toBeInstanceOf(Quality);
  });

  test("speed resample rate", () => {
    expect(speedResampleRate(48_000, 2)).toBe(24_000);
    expect(speedResampleRate(44_100, 0.5)).toBe(88_200);
    expect(speedResampleRate(44_100, 1.5)).toBe(29_400);
  });
});
