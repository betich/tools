import { describe, expect, test } from "bun:test";
import { DEFAULT_MERGE_ITEM, imageDpi, pageLayout, PAPER_SIZES, toPdfRect, type MergeItemOptions } from "../src/pageLayout";

const paper = (o: Partial<MergeItemOptions> = {}): MergeItemOptions => ({ ...DEFAULT_MERGE_ITEM, mode: "paper", ...o });
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe("image mode", () => {
  test("uses the file's dpi", () => {
    const l = pageLayout({ width: 2480, height: 3508, dpi: { x: 300, y: 300 } }, DEFAULT_MERGE_ITEM);
    close(l.width, 595.2);
    close(l.height, 841.92);
    expect(l.image).toEqual({ x: 0, y: 0, width: l.width, height: l.height });
    expect(l.clip).toBeNull();
  });
  test("falls back to 96 dpi, and for implausible values", () => {
    for (const dpi of [null, { x: 1, y: 1 }]) {
      const l = pageLayout({ width: 960, height: 480, dpi }, DEFAULT_MERGE_ITEM);
      close(l.width, 720);
      close(l.height, 360);
    }
  });
});

describe("paper mode", () => {
  const img = { width: 2000, height: 1000, dpi: null };
  test("auto orientation follows the image", () => {
    const l = pageLayout(img, paper());
    expect(l.width).toBe(PAPER_SIZES.a4.height);
    expect(l.height).toBe(PAPER_SIZES.a4.width);
    const p = pageLayout(img, paper({ orientation: "portrait" }));
    expect(p.width).toBe(PAPER_SIZES.a4.width);
  });
  test("contain centres inside the margin", () => {
    const l = pageLayout(img, paper({ paper: "letter", orientation: "portrait", margin: 36, marginUnit: "pt" }));
    close(l.image.x, 36);
    close(l.image.width, 540);
    close(l.image.height, 270);
    close(l.image.y, (792 - 270) / 2);
    expect(l.clip).toBeNull();
  });
  test("cover overhangs and clips to the box", () => {
    const l = pageLayout(img, paper({ paper: "letter", orientation: "portrait", fit: "cover", margin: 10, marginUnit: "mm" }));
    const m = (10 * 72) / 25.4;
    expect(l.clip).not.toBeNull();
    close(l.clip!.x, m);
    close(l.image.height, 792 - 2 * m);
    close(l.image.width, (792 - 2 * m) * 2);
    close(l.image.x + l.image.width / 2, 306);
  });
  test("fill stretches to the box", () => {
    const l = pageLayout(img, paper({ fit: "fill", orientation: "portrait" }));
    expect(l.image).toEqual({ x: 0, y: 0, width: PAPER_SIZES.a4.width, height: PAPER_SIZES.a4.height });
  });
  test("a margin bigger than the page leaves a sliver, not a negative box", () => {
    const l = pageLayout(img, paper({ margin: 5000, marginUnit: "mm", fit: "fill" }));
    expect(l.image.width).toBeGreaterThan(0);
    expect(l.image.height).toBeGreaterThan(0);
  });
  test("toPdfRect flips y", () => {
    expect(toPdfRect({ height: 100 }, { x: 5, y: 10, width: 20, height: 30 })).toEqual({ x: 5, y: 60, width: 20, height: 30 });
  });
});

describe("imageDpi", () => {
  test("png pHYs", () => {
    const b = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, ...new Array(17).fill(0),
      0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73, 0, 0, 0x2e, 0x23, 0, 0, 0x2e, 0x23, 1, 0, 0, 0, 0]);
    const d = imageDpi(b)!;
    expect(Math.round(d.x)).toBe(300);
  });
  test("jpeg jfif", () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, 0, 72, 0, 150, 0, 0, 0xff, 0xda]);
    expect(imageDpi(b)).toEqual({ x: 72, y: 150 });
  });
  test("jpeg exif beats jfif and follows orientation", () => {
    // Big-endian TIFF: IFD0 at 8 with 4 entries; rationals after it.
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 4,
      0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0,
      0x01, 0x1a, 0, 5, 0, 0, 0, 1, 0, 0, 0, 62,
      0x01, 0x1b, 0, 5, 0, 0, 0, 1, 0, 0, 0, 70,
      0x01, 0x28, 0, 3, 0, 0, 0, 1, 0, 2, 0, 0,
      0, 0, 0, 0,
      0, 0, 1, 44, 0, 0, 0, 1,
      0, 0, 0, 200, 0, 0, 0, 1];
    const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, 0, 72, 0, 72, 0, 0,
      0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xda]);
    expect(imageDpi(b)).toEqual({ x: 200, y: 300 });
  });
  test("unknown or aspect-only is null", () => {
    expect(imageDpi(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(imageDpi(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xda]))).toBeNull();
  });
});
