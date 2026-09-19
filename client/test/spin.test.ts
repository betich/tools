import { describe, expect, test } from "bun:test";
import {
  cameraDistance,
  coinReach,
  defaultSpin,
  ease,
  faceAt,
  frameCount,
  imageBox,
  MAX_FRAMES,
  projectColumn,
  scaleLayout,
  spinAngles,
  spinBytes,
  spinFrameName,
  spinLayout,
  unprojectColumn,
} from "@/tools/media2media/gif/sources/spin";

describe("frameCount", () => {
  test("by count is the count, clamped", () => {
    expect(frameCount({ by: "count", count: 36, step: 1 })).toBe(36);
    expect(frameCount({ by: "count", count: 1, step: 1 })).toBe(2);
    expect(frameCount({ by: "count", count: 5000, step: 1 })).toBe(MAX_FRAMES);
  });

  test("by step rounds to a whole number of frames per turn", () => {
    expect(frameCount({ by: "step", count: 0, step: 10 })).toBe(36);
    expect(frameCount({ by: "step", count: 0, step: 7 })).toBe(51); // 360/7 = 51.4
    expect(frameCount({ by: "step", count: 0, step: 0 })).toBe(MAX_FRAMES);
    expect(frameCount({ by: "step", count: 0, step: 400 })).toBe(2);
  });
});

describe("ease", () => {
  test("linear is the identity", () => {
    for (const t of [0, 0.25, 0.5, 1]) expect(ease(t, "linear")).toBe(t);
  });

  test("ease-in-out keeps the ends and the middle, and is symmetric", () => {
    expect(ease(0, "ease-in-out")).toBe(0);
    expect(ease(1, "ease-in-out")).toBeCloseTo(1, 12);
    expect(ease(0.5, "ease-in-out")).toBeCloseTo(0.5, 12);
    for (const t of [0.1, 0.2, 0.3, 0.4]) {
      expect(ease(t, "ease-in-out") + ease(1 - t, "ease-in-out")).toBeCloseTo(1, 12);
      expect(ease(t, "ease-in-out")).toBeLessThan(t); // slow out of the start
    }
  });
});

describe("spinAngles", () => {
  test("frame i is at i·360/N and never reaches 360", () => {
    const a = spinAngles(36, "linear", 1);
    expect(a).toHaveLength(36);
    a.forEach((angle, i) => expect(angle).toBeCloseTo((i * 360) / 36, 10));
    expect(a[0]).toBe(0);
    expect(Math.max(...a)).toBeLessThan(360);
    // The step from the last frame back round to the first is one ordinary step.
    expect(360 - a[35]!).toBeCloseTo(10, 10);
  });

  test("the other direction mirrors the angles, with no -0", () => {
    const a = spinAngles(4, "linear", -1);
    expect(a).toEqual([0, -90, -180, -270]);
    expect(Object.is(a[0], -0)).toBe(false);
  });

  test("eased turns start at 0, rise strictly, stay short of 360 and linger at the join", () => {
    const a = spinAngles(24, "ease-in-out", 1);
    expect(a[0]).toBe(0);
    for (let i = 1; i < a.length; i++) expect(a[i]!).toBeGreaterThan(a[i - 1]!);
    expect(a.at(-1)!).toBeLessThan(360);
    const first = a[1]! - a[0]!;
    const middle = a[12]! - a[11]!;
    const join = 360 - a.at(-1)!;
    expect(first).toBeLessThan(middle);
    expect(join).toBeCloseTo(first, 10); // symmetric about the join
  });

  test("no two frames are the same angle mod 360", () => {
    for (const easing of ["linear", "ease-in-out"] as const) {
      const a = spinAngles(60, easing, 1).map((x) => ((x % 360) + 360) % 360);
      expect(new Set(a.map((x) => x.toFixed(6))).size).toBe(60);
    }
  });
});

describe("layout", () => {
  test("imageBox puts the longest edge at the asked size", () => {
    expect(imageBox({ width: 1000, height: 500 }, 400)).toEqual({ width: 400, height: 200 });
    expect(imageBox({ width: 300, height: 600 }, 600)).toEqual({ width: 300, height: 600 });
  });

  test("a flat turn with room is a square on the diagonal, centred on whole pixels", () => {
    const l = spinLayout(
      { width: 300, height: 400 },
      { ...defaultSpin(), kind: "flat", edge: 400, room: true, padding: 0 },
    );
    expect(l.width).toBe(l.height);
    expect(l.width).toBeGreaterThanOrEqual(500);
    expect(l.width - 500).toBeLessThanOrEqual(1);
    expect((l.width - l.imageWidth) % 2).toBe(0);
    expect((l.height - l.imageHeight) % 2).toBe(0);
  });

  test("without room the canvas is the image, plus padding on every side", () => {
    const l = spinLayout(
      { width: 300, height: 400 },
      { ...defaultSpin(), kind: "flat", edge: 400, room: false, padding: 12 },
    );
    expect([l.width, l.height]).toEqual([324, 424]);
  });

  test("a coin without perspective needs exactly the image", () => {
    const l = spinLayout(
      { width: 200, height: 100 },
      { ...defaultSpin(), kind: "coin", edge: 200, room: true, padding: 0, perspective: 0 },
    );
    expect([l.width, l.height]).toEqual([200, 100]);
    expect(l.distance).toBe(Infinity);
  });

  test("a coin with perspective gets room for the near edge swelling", () => {
    const l = spinLayout(
      { width: 200, height: 100 },
      { ...defaultSpin(), kind: "coin", edge: 200, room: true, padding: 0, perspective: 1 },
    );
    expect(l.height).toBeGreaterThan(100);
    expect(l.width).toBeGreaterThanOrEqual(200);
    // Every projected edge over a turn fits in the canvas.
    for (let deg = 0; deg < 360; deg += 0.5) {
      const theta = (deg * Math.PI) / 180;
      for (const u of [-100, 100]) {
        const p = projectColumn(u, theta, l.distance);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(l.width / 2 + 1e-6);
        expect(50 * p.scale).toBeLessThanOrEqual(l.height / 2 + 1e-6);
      }
    }
  });

  test("stronger perspective is a closer camera, and never inside the sweep", () => {
    expect(cameraDistance(100, 0)).toBe(Infinity);
    expect(cameraDistance(100, 1)).toBeLessThan(cameraDistance(100, 0.5));
    expect(cameraDistance(100, 1)).toBeGreaterThan(50);
  });

  test("coinReach is the image at infinity", () => {
    const r = coinReach(200, 100, Infinity);
    expect(r.x).toBeCloseTo(100, 6);
    expect(r.y).toBe(50);
  });

  test("scaleLayout scales every length", () => {
    const l = spinLayout({ width: 400, height: 200 }, { ...defaultSpin(), kind: "coin", edge: 400, perspective: 0.5 });
    const s = scaleLayout(l, 0.5);
    expect(s.imageWidth).toBe(200);
    expect(s.distance).toBeCloseTo(l.distance / 2, 10);
    expect(Math.abs(s.width - l.width / 2)).toBeLessThanOrEqual(0.5);
  });
});

describe("coin projection", () => {
  test("unproject undoes project", () => {
    for (const d of [Infinity, 300, 125]) {
      for (const deg of [0, 20, 80, 100, 170, 200, 300]) {
        const theta = (deg * Math.PI) / 180;
        for (const u of [-50, -10, 0, 33, 50]) {
          const { x } = projectColumn(u, theta, d);
          expect(unprojectColumn(x, theta, d)!).toBeCloseTo(u, 6);
        }
      }
    }
  });

  test("face-on is the image, edge-on has no width", () => {
    expect(projectColumn(50, 0, 300)).toEqual({ x: 50, scale: 1 });
    expect(Math.abs(projectColumn(50, Math.PI / 2, Infinity).x)).toBeLessThan(1e-9);
    expect(unprojectColumn(10, Math.PI / 2, Infinity)).toBeNull();
  });

  test("the back shows from past 90° to before 270°", () => {
    expect(faceAt(0)).toBe("front");
    expect(faceAt(89)).toBe("front");
    expect(faceAt(91)).toBe("back");
    expect(faceAt(269)).toBe("back");
    expect(faceAt(271)).toBe("front");
    expect(faceAt(-120)).toBe("back");
  });
});

test("spinFrameName wraps negative angles and pads", () => {
  expect(spinFrameName(0)).toBe("spin 000°");
  expect(spinFrameName(10)).toBe("spin 010°");
  expect(spinFrameName(-90)).toBe("spin 270°");
  expect(spinFrameName(7.06)).toBe("spin 007.1°");
  expect(spinFrameName(359.99)).toBe("spin 000°");
});

test("spinBytes is RGBA for every frame", () => {
  expect(spinBytes({ width: 100, height: 50 }, 36)).toBe(100 * 50 * 4 * 36);
});
