import { describe, expect, test } from "bun:test";
import {
  foldDropped,
  gifDelays,
  gifFrameCount,
  gifFrameName,
  gifSampleTimes,
  gifSize,
  gifWidthChoices,
  MAX_SEND_BYTES,
  MAX_SEND_FRAMES,
  sendBytes,
  sendProblem,
} from "@/tools/media2media/video/toGif";

const clip = (inMs: number, outMs: number, speed = 1) => ({ trim: { in: inMs, out: outMs }, speed });
const hd = { width: 1920, height: 1080 };

describe("gifFrameCount", () => {
  test("one frame per 1/fps of the trimmed clip", () => {
    expect(gifFrameCount(clip(0, 3000), 15)).toBe(45);
    expect(gifFrameCount(clip(1000, 4000), 10)).toBe(30);
  });

  test("a part-frame at the end rounds up; float dust doesn't", () => {
    expect(gifFrameCount(clip(0, 1010), 10)).toBe(11);
    expect(gifFrameCount(clip(0, 1000.0000001), 30)).toBe(30);
  });

  test("speed shortens the output, so fewer frames", () => {
    expect(gifFrameCount(clip(0, 4000, 2), 10)).toBe(20);
    expect(gifFrameCount(clip(0, 1000, 0.5), 10)).toBe(20);
  });

  test("never none", () => {
    expect(gifFrameCount(clip(0, 0), 15)).toBe(1);
    expect(gifFrameCount(clip(0, 3000), 0)).toBe(1);
  });
});

describe("gifSampleTimes", () => {
  test("start at the trim's in and step by 1/fps", () => {
    expect(gifSampleTimes(clip(500, 1000), 10)).toEqual([500, 600, 700, 800, 900]);
  });

  test("speed steps further through the source", () => {
    expect(gifSampleTimes(clip(0, 1000, 2), 10)).toEqual([0, 200, 400, 600, 800]);
  });

  test("stay inside the trim", () => {
    const t = gifSampleTimes(clip(0, 1010), 10);
    expect(t.length).toBe(11);
    expect(t.at(-1)).toBe(1000);
    expect(Math.max(...t)).toBeLessThan(1010);
  });
});

describe("gifDelays", () => {
  test("whole centiseconds that add up to the clip", () => {
    const d = gifDelays(45, 15, 3000);
    expect(d.every((x) => x % 10 === 0)).toBe(true);
    expect(d.reduce((a, b) => a + b, 0)).toBe(3000);
    expect(d.slice(0, 3)).toEqual([70, 60, 70]);
  });

  test("exact rates stay exact", () => {
    expect(gifDelays(10, 10, 1000)).toEqual(Array(10).fill(100));
  });

  test("the last frame runs to the clip's end", () => {
    expect(gifDelays(11, 10, 1040)).toEqual([...Array(10).fill(100), 40]);
  });

  test("never under the 20 ms floor", () => {
    expect(gifDelays(11, 10, 1001).at(-1)).toBe(20);
    expect(gifDelays(0, 10, 1000)).toEqual([]);
  });
});

describe("foldDropped", () => {
  const f = () => ({ delay: 0 });

  test("a dropped frame's time goes to the one before", () => {
    const out = foldDropped([f(), null, f()], [100, 100, 100]);
    expect(out.map((x) => x.delay)).toEqual([200, 100]);
  });

  test("drops at the start go to the first kept", () => {
    const out = foldDropped([null, null, f()], [100, 100, 100]);
    expect(out.map((x) => x.delay)).toEqual([300]);
  });

  test("all dropped is nothing", () => {
    expect(foldDropped([null, null], [100, 100])).toEqual([]);
  });
});

describe("gifSize", () => {
  test("the framed picture at the chosen width, shape kept", () => {
    expect(gifSize({ rotate: 0, crop: null }, hd, 480)).toEqual({ width: 480, height: 270 });
  });

  test("never scales up; null keeps the framed width", () => {
    expect(gifSize({ rotate: 0, crop: null }, hd, 4000)).toEqual(hd);
    expect(gifSize({ rotate: 0, crop: null }, { width: 640, height: 360 }, null)).toEqual({ width: 640, height: 360 });
  });

  test("rotate and crop set the shape", () => {
    expect(gifSize({ rotate: 90, crop: null }, hd, 540)).toEqual({ width: 540, height: 960 });
    expect(gifSize({ rotate: 0, crop: { left: 0, top: 0, width: 1000, height: 1000 } }, hd, 480)).toEqual({
      width: 480,
      height: 480,
    });
  });

  test("a tall frame stays within the GIF tab's longest edge", () => {
    const s = gifSize({ rotate: 90, crop: null }, { width: 7680, height: 4320 }, null);
    expect(Math.max(s.width, s.height)).toBe(4096);
  });
});

describe("gifWidthChoices", () => {
  test("only presets narrower than the frame", () => {
    expect(gifWidthChoices(700)).toEqual([640, 480, 320, 240]);
    expect(gifWidthChoices(200)).toEqual([]);
  });
});

describe("memory guard", () => {
  test("bytes are RGBA", () => {
    expect(sendBytes({ width: 480, height: 270 }, 45)).toBe(480 * 270 * 4 * 45);
  });

  test("a short clip passes", () => {
    expect(sendProblem({ width: 480, height: 270 }, 45)).toBeNull();
  });

  test("too many frames says so", () => {
    expect(sendProblem({ width: 16, height: 16 }, MAX_SEND_FRAMES + 1)).toContain("frame rate");
  });

  test("too many pixels says so", () => {
    const side = Math.ceil(Math.sqrt(MAX_SEND_BYTES / 4 / 100)) + 1;
    expect(sendProblem({ width: side, height: side }, 100)).toContain("more than the page can hold");
  });
});

test("frame names keep the file's own name, Unicode and all", () => {
  expect(gifFrameName("คลิป.mp4", 6, 45)).toBe("คลิป 07");
  expect(gifFrameName(".mp4", 0, 5)).toBe(".mp4 1");
});
