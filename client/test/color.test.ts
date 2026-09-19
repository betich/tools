import { describe, expect, test } from "bun:test";
import { normaliseHex } from "../src/lib/color";

describe("normaliseHex", () => {
  test("a whole #rrggbb, lower-cased and trimmed", () => {
    expect(normaliseHex("#00B140")).toBe("#00b140");
    expect(normaliseHex("  #ffffff ")).toBe("#ffffff");
  });
  test("strict by default: no short form, no bare digits", () => {
    expect(normaliseHex("#abc")).toBeNull();
    expect(normaliseHex("ffffff")).toBeNull();
    expect(normaliseHex("#ffff")).toBeNull();
    expect(normaliseHex("#gggggg")).toBeNull();
    expect(normaliseHex("")).toBeNull();
  });
  test("short and bare when asked", () => {
    expect(normaliseHex("#aBc", { short: true })).toBe("#aabbcc");
    expect(normaliseHex("abc", { short: true })).toBeNull();
    expect(normaliseHex("abc", { short: true, bare: true })).toBe("#aabbcc");
    expect(normaliseHex("00ff00", { bare: true })).toBe("#00ff00");
  });
});
