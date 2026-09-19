import { describe, expect, test } from "bun:test";
import {
  defaultBatch,
  optionsKey,
  overriddenFields,
  resolveOptions,
  setOverride,
} from "../src/tools/media2media/batch";
import { fileStem, outputName, outputStem, uniqueNames } from "../src/tools/media2media/names";

describe("filenames", () => {
  test("swap the extension and keep Unicode", () => {
    expect(outputName("IMG_0042.HEIC", "webp")).toBe("IMG_0042.webp");
    expect(outputName("ทะเล หัวหิน.jpeg", "avif")).toBe("ทะเล-หัวหิน.avif");
    expect(outputName("東京 (2).png", "jpg")).toBe("東京-2.jpg");
    expect(outputName("café.tar.gz", "png")).toBe("café-tar.png");
  });

  test("macOS-decomposed names come out composed", () => {
    expect(outputStem("café.jpg")).toBe("café");
  });

  test("a name with nothing left falls back to a numbered stem", () => {
    expect(outputStem("!!!.jpg", 6)).toBe("image-007");
    expect(outputStem(".heic", 0)).toBe("image-001");
  });

  test("duplicates inside one zip get numbered, case-insensitively", () => {
    expect(uniqueNames(["a.webp", "A.webp", "a.webp", "a-2.webp", "b.webp"])).toEqual([
      "a.webp",
      "A-2.webp",
      "a-3.webp",
      "a-2-2.webp",
      "b.webp",
    ]);
  });
});

describe("per-file overrides", () => {
  test("a file with no override follows the batch", () => {
    const o = resolveOptions({ ...defaultBatch, format: "avif", quality: 60, maxEdge: 2048 }, undefined);
    expect(o).toMatchObject({ format: "avif", quality: 60, maxEdge: 2048, metadata: "no-location" });
  });

  test("an overridden field wins, the rest still follow the batch", () => {
    const override = setOverride(undefined, "format", "png");
    const a = resolveOptions({ ...defaultBatch, quality: 50 }, override);
    const b = resolveOptions({ ...defaultBatch, quality: 90 }, override);
    expect([a.format, a.quality]).toEqual(["png", 50]);
    expect([b.format, b.quality]).toEqual(["png", 90]);
  });

  test("clearing the last field drops the override entirely", () => {
    let o = setOverride(undefined, "quality", 40);
    o = setOverride(o, "maxEdge", 1024);
    expect(overriddenFields(o).sort()).toEqual(["maxEdge", "quality"]);
    o = setOverride(o, "quality", undefined);
    o = setOverride(o, "maxEdge", undefined);
    expect(o).toBeUndefined();
    expect(overriddenFields(o)).toEqual([]);
  });

  test("metadata is batch-wide: location only when both toggles say so", () => {
    expect(resolveOptions({ ...defaultBatch, keepExif: false, keepLocation: true }, undefined).metadata).toBe("none");
    expect(resolveOptions({ ...defaultBatch, keepExif: true, keepLocation: false }, undefined).metadata).toBe(
      "no-location",
    );
    expect(resolveOptions({ ...defaultBatch, keepExif: true, keepLocation: true }, undefined).metadata).toBe("all");
  });

  test("values are clamped, and the key changes when the result would", () => {
    const o = resolveOptions({ ...defaultBatch, quality: 140, maxEdge: -5 }, undefined);
    expect([o.quality, o.maxEdge]).toEqual([100, 0]);
    const a = optionsKey(resolveOptions(defaultBatch, undefined));
    expect(optionsKey(resolveOptions(defaultBatch, {}))).toBe(a);
    expect(optionsKey(resolveOptions({ ...defaultBatch, keepLocation: true }, undefined))).not.toBe(a);
  });
});

describe("fileStem", () => {
  test("drops the extension only; Unicode and spaces stay", () => {
    expect(fileStem("งานวันเกิด 2026.mov", "video")).toBe("งานวันเกิด 2026");
    expect(fileStem("archive.tar.gz", "x")).toBe("archive.tar");
    expect(fileStem("noext", "x")).toBe("noext");
    expect(fileStem(".mov", "video")).toBe(".mov");
    expect(fileStem("  .mp4", "video")).toBe("video");
  });
  test("NFC, so a decomposed macOS name matches a typed one", () => {
    expect(fileStem("café.mov", "video")).toBe("café");
  });
});
