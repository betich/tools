import { describe, expect, test } from "bun:test";
import {
  canvasSize,
  clampPlays,
  emptyDoc,
  fitRect,
  MAX_EDGE,
  naturalCompare,
  playDuration,
  playList,
  playOrder,
  repeatCount,
  resize,
  sortNaturally,
  timelineTime,
  withFrames,
  type GifFrame,
} from "../src/tools/media2media/gif/model";

const frame = (id: string, delay = 100, width = 640, height = 360): GifFrame => ({ id, delay, name: `${id}.png`, width, height });

describe("natural order", () => {
  test("numbers compare as numbers", () => {
    const names = ["frame-10.png", "frame-2.png", "frame-1.png", "frame-100.png", "frame-20.png"];
    expect(sortNaturally(names, (n) => n)).toEqual([
      "frame-1.png",
      "frame-2.png",
      "frame-10.png",
      "frame-20.png",
      "frame-100.png",
    ]);
  });
  test("zero-padded and plain mix, case ignored", () => {
    expect(sortNaturally(["B_03", "a_2", "A_010", "b_1"], (n) => n)).toEqual(["a_2", "A_010", "b_1", "B_03"]);
  });
  test("folders sort before their contents' numbers", () => {
    expect(sortNaturally(["shot2/0001.png", "shot10/0001.png", "shot2/0010.png"], (n) => n)).toEqual([
      "shot2/0001.png",
      "shot2/0010.png",
      "shot10/0001.png",
    ]);
  });
  test("Thai names sort too, and exact ties are stable", () => {
    expect(sortNaturally(["ภาพ 10", "ภาพ 9"], (n) => n)).toEqual(["ภาพ 9", "ภาพ 10"]);
    expect(naturalCompare("a", "a")).toBe(0);
    expect(Math.sign(naturalCompare("a", "A"))).not.toBe(0);
  });
});

describe("ping-pong", () => {
  test("there and back without repeating the ends", () => {
    expect(playOrder(4, true)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(playOrder(3, true)).toEqual([0, 1, 2, 1]);
    expect(playOrder(4, false)).toEqual([0, 1, 2, 3]);
  });
  test("two frames or fewer have nothing to bounce", () => {
    expect(playOrder(2, true)).toEqual([0, 1]);
    expect(playOrder(1, true)).toEqual([0]);
    expect(playOrder(0, true)).toEqual([]);
  });
  test("the play list carries each frame's own delay", () => {
    const doc = { frames: [frame("a", 40), frame("b", 80), frame("c", 120)], pingPong: true };
    expect(playList(doc).map((f) => f.id)).toEqual(["a", "b", "c", "b"]);
    expect(playDuration(doc)).toBe(40 + 80 + 120 + 80);
    expect(playDuration({ ...doc, pingPong: false })).toBe(240);
  });
  test("36 frames of a render play at their delays", () => {
    const frames = Array.from({ length: 36 }, (_, i) => frame(`f${i}`, 40));
    expect(playDuration({ frames, pingPong: false })).toBe(1440);
    expect(playDuration({ frames, pingPong: true })).toBe(40 * 70);
  });
});

describe("played time on the timeline", () => {
  const frames = [frame("a", 100), frame("b", 50), frame("c", 200)];
  const order = playOrder(3, true); // a b c b

  test("the forward pass is the timeline's own time", () => {
    expect(timelineTime(frames, order, 0)).toBe(0);
    expect(timelineTime(frames, order, 120)).toBe(120);
    expect(timelineTime(frames, order, 349)).toBe(349);
  });
  test("the way back lands on the same frame, same distance in", () => {
    // Played: a 0–100, b 100–150, c 150–350, b 350–400.
    expect(timelineTime(frames, order, 360)).toBe(110);
  });
  test("past the end holds the last played frame", () => {
    expect(timelineTime(frames, order, 10_000)).toBe(150);
    expect(timelineTime([], [], 50)).toBe(0);
  });
});

describe("canvas size", () => {
  test("follows the first frame until one is chosen", () => {
    const doc = { ...emptyDoc(), frames: [frame("a", 100, 800, 600), frame("b", 100, 100, 100)] };
    expect(canvasSize(doc)).toEqual({ width: 800, height: 600 });
    expect(canvasSize({ ...doc, frames: [...doc.frames].reverse() })).toEqual({ width: 100, height: 100 });
    expect(canvasSize({ ...doc, size: { width: 320, height: 240 } })).toEqual({ width: 320, height: 240 });
    expect(canvasSize(emptyDoc())).toEqual({ width: 0, height: 0 });
  });
  test("a huge first frame is shrunk to the edge limit, keeping its shape", () => {
    const doc = { ...emptyDoc(), frames: [frame("a", 100, MAX_EDGE * 2, MAX_EDGE)] };
    expect(canvasSize(doc)).toEqual({ width: MAX_EDGE, height: MAX_EDGE / 2 });
  });
  test("typing one edge moves the other when the shape is kept", () => {
    const size = { width: 640, height: 360 };
    expect(resize(size, "width", 320, true, 16 / 9)).toEqual({ width: 320, height: 180 });
    expect(resize(size, "height", 720, true, 16 / 9)).toEqual({ width: 1280, height: 720 });
    expect(resize(size, "width", 320, false, 16 / 9)).toEqual({ width: 320, height: 360 });
  });
  test("sizes stay whole, positive and under the limit", () => {
    const size = { width: 640, height: 360 };
    expect(resize(size, "width", 0, false, 1)).toEqual({ width: 1, height: 360 });
    expect(resize(size, "width", 99.6, false, 1).width).toBe(100);
    expect(resize(size, "height", MAX_EDGE, true, 4)).toEqual({ width: MAX_EDGE, height: MAX_EDGE / 4 });
  });
});

describe("fit", () => {
  const canvas = { width: 400, height: 200 };
  test("contain letterboxes, centred", () => {
    expect(fitRect({ width: 100, height: 100 }, canvas, "contain")).toEqual({ x: 100, y: 0, width: 200, height: 200 });
  });
  test("cover fills and spills evenly", () => {
    expect(fitRect({ width: 100, height: 100 }, canvas, "cover")).toEqual({ x: 0, y: -100, width: 400, height: 400 });
  });
  test("a frame the canvas's size is drawn as is", () => {
    expect(fitRect(canvas, canvas, "contain")).toEqual({ x: 0, y: 0, width: 400, height: 200 });
  });
});

describe("loops", () => {
  test("plays become GIF repeats", () => {
    expect(repeatCount(0)).toBe(0);
    expect(repeatCount(1)).toBeNull();
    expect(repeatCount(3)).toBe(2);
  });
  test("plays are clamped whole", () => {
    expect(clampPlays(-2)).toBe(0);
    expect(clampPlays(2.4)).toBe(2);
    expect(clampPlays(NaN)).toBe(0);
    expect(clampPlays(1e9)).toBe(999);
  });
});

describe("adding frames", () => {
  test("append keeps the chosen size; replace drops it", () => {
    const doc = { ...emptyDoc(), frames: [frame("a")], size: { width: 10, height: 10 } };
    expect(withFrames(doc, [frame("b")], "append")).toMatchObject({ size: { width: 10, height: 10 } });
    expect(withFrames(doc, [frame("b")], "append").frames.map((f) => f.id)).toEqual(["a", "b"]);
    const replaced = withFrames(doc, [frame("c")], "replace");
    expect(replaced.frames.map((f) => f.id)).toEqual(["c"]);
    expect(replaced.size).toBeNull();
  });
});
