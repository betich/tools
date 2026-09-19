import { describe, expect, test } from "bun:test";
import {
  advance,
  formatTick,
  formatTime,
  frameAt,
  frameStarts,
  gapAt,
  layoutFrames,
  moveFrames,
  moveTrimEdge,
  removeFrames,
  selectFrames,
  setDelays,
  sharedDelay,
  snapDelay,
  tickStep,
  timeToX,
  visibleRange,
  xToTime,
} from "../src/components/timeline/model";

const frames = (...delays: number[]) => delays.map((delay, i) => ({ id: `f${i}`, delay }));
const ids = (fs: readonly { id: string }[]) => fs.map((f) => f.id).join(",");

describe("delays", () => {
  test("snap to 10ms, never under 20", () => {
    expect(snapDelay(84)).toBe(80);
    expect(snapDelay(85)).toBe(90);
    expect(snapDelay(3)).toBe(20);
    expect(snapDelay(-50)).toBe(20);
    expect(snapDelay(NaN)).toBe(20);
    expect(snapDelay(10_000_000)).toBe(60_000);
  });
  test("starts and the frame at a time", () => {
    const s = frameStarts(frames(100, 50, 200));
    expect(s).toEqual([0, 100, 150, 350]);
    expect(frameAt(s, 0)).toBe(0);
    expect(frameAt(s, 99)).toBe(0);
    expect(frameAt(s, 100)).toBe(1);
    expect(frameAt(s, 349)).toBe(2);
    expect(frameAt(s, 1000)).toBe(2);
    expect(frameAt([0], 5)).toBe(0);
  });
});

describe("layout", () => {
  const l = layoutFrames(frames(100, 20, 200), 0.5, 28, 2);
  test("tiles follow delay with a minimum width", () => {
    expect(l.w).toEqual([50, 28, 100]);
    expect(l.x).toEqual([0, 52, 82, 184]);
    expect(l.width).toBe(182);
  });
  test("time and x round-trip through the uneven tiles", () => {
    for (const t of [0, 50, 100, 110, 120, 220, 320]) expect(xToTime(l, timeToX(l, t))).toBeCloseTo(t, 6);
    expect(timeToX(l, 110)).toBe(52 + 14);
  });
  test("visible range with overscan", () => {
    expect(visibleRange(l, 60, 90, 0)).toEqual([1, 2]);
    expect(visibleRange(l, 60, 90, 4)).toEqual([0, 2]);
    expect(visibleRange(layoutFrames([], 1, 28), 0, 100)).toEqual([0, -1]);
  });
  test("200 frames: only a screenful is visible", () => {
    const big = layoutFrames(frames(...Array.from({ length: 200 }, () => 80)), 0.5, 28, 2);
    const [a, b] = visibleRange(big, 4000, 5200, 4);
    expect(b - a).toBeLessThan(40);
  });
  test("drop gap is before the first tile whose middle is right of the pointer", () => {
    expect(gapAt(l, -10)).toBe(0);
    expect(gapAt(l, 24)).toBe(0);
    expect(gapAt(l, 26)).toBe(1);
    expect(gapAt(l, 1000)).toBe(3);
  });
});

describe("frame edits", () => {
  const fs = frames(10, 20, 30, 40, 50);
  test("move one frame forward and back", () => {
    expect(ids(moveFrames(fs, new Set(["f0"]), 3))).toBe("f1,f2,f0,f3,f4");
    expect(ids(moveFrames(fs, new Set(["f4"]), 0))).toBe("f4,f0,f1,f2,f3");
    expect(ids(moveFrames(fs, new Set(["f1"]), 5))).toBe("f0,f2,f3,f4,f1");
  });
  test("a scattered selection moves as a block, in order", () => {
    expect(ids(moveFrames(fs, new Set(["f3", "f0"]), 2))).toBe("f1,f0,f3,f2,f4");
  });
  test("dropping in place returns the same array", () => {
    expect(moveFrames(fs, new Set(["f2"]), 2)).toBe(fs);
    expect(moveFrames(fs, new Set(["f2"]), 3)).toBe(fs);
    expect(moveFrames(fs, new Set(), 0)).toBe(fs);
  });
  test("remove", () => {
    expect(ids(removeFrames(fs, new Set(["f1", "f3"])))).toBe("f0,f2,f4");
    expect(removeFrames(fs, new Set(["nope"]))).toBe(fs);
  });
  test("set delays keeps untouched frames' identity", () => {
    const next = setDelays(fs, new Set(["f1", "f2"]), 90);
    expect(next.map((f) => f.delay)).toEqual([10, 90, 90, 40, 50]);
    expect(next[0]).toBe(fs[0]!);
    expect(setDelays(fs, new Set(["f1"]), 20)).toBe(fs);
    expect(sharedDelay(next, new Set(["f1", "f2"]))).toBe(90);
    expect(sharedDelay(next, new Set(["f0", "f1"]))).toBeNull();
    expect(sharedDelay(next, new Set())).toBeNull();
  });
  test("selection: replace, toggle, range", () => {
    const none = new Set<string>();
    expect([...selectFrames(fs, none, null, 2, "replace")]).toEqual(["f2"]);
    expect([...selectFrames(fs, new Set(["f2"]), 2, 4, "toggle")].sort()).toEqual(["f2", "f4"]);
    expect([...selectFrames(fs, new Set(["f2", "f4"]), 2, 4, "toggle")]).toEqual(["f2"]);
    expect([...selectFrames(fs, none, 3, 1, "range")]).toEqual(["f1", "f2", "f3"]);
    expect([...selectFrames(fs, none, null, 1, "range")]).toEqual(["f1"]);
  });
});

describe("clip", () => {
  const trim = { in: 1000, out: 5000 };
  test("edges stay in the clip and apart", () => {
    expect(moveTrimEdge(trim, "in", -50, 8000, 33)).toEqual({ in: 0, out: 5000 });
    expect(moveTrimEdge(trim, "in", 6000, 8000, 33)).toEqual({ in: 4967, out: 5000 });
    expect(moveTrimEdge(trim, "out", 9000, 8000, 33)).toEqual({ in: 1000, out: 8000 });
    expect(moveTrimEdge(trim, "out", 0, 8000, 33)).toEqual({ in: 1000, out: 1033 });
  });
});

describe("playback", () => {
  test("advances, loops, stops", () => {
    expect(advance(100, 16, 0, 1000, true)).toEqual({ time: 116, ended: false });
    expect(advance(990, 30, 0, 1000, true)).toEqual({ time: 20, ended: false });
    expect(advance(990, 30, 0, 1000, false)).toEqual({ time: 1000, ended: true });
    expect(advance(4990, 30, 1000, 5000, true)).toEqual({ time: 1020, ended: false });
    expect(advance(0, 16, 500, 900, true).time).toBe(500);
    expect(advance(0, 16, 0, 0, true).ended).toBe(true);
  });
});

describe("readouts", () => {
  test("time", () => {
    expect(formatTime(0)).toBe("00:00.00");
    expect(formatTime(1240)).toBe("00:01.24");
    expect(formatTime(134_000)).toBe("02:14.00");
    expect(formatTime(3_725_500)).toBe("1:02:05.50");
  });
  test("ticks", () => {
    expect(tickStep(0.5)).toBe(200);
    expect(tickStep(0.001)).toBe(120_000);
    expect(formatTick(500)).toBe("0.5s");
    expect(formatTick(2000)).toBe("2s");
    expect(formatTick(250)).toBe("0.25s");
    expect(formatTick(90_000)).toBe("1:30");
  });
});
