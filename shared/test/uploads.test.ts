import { describe, expect, test } from "bun:test";
import { readPageCount, storePageCount, type PageCountState } from "../src/uploads";

describe("the stored page count", () => {
  test("round-trips every state", () => {
    const states: PageCountState[] = [{ state: "uncounted" }, { state: "counted", pages: 7 }, { state: "locked" }, { state: "unreadable" }];
    for (const c of states) expect(readPageCount(storePageCount(c))).toEqual(c);
  });

  test("the column's values", () => {
    expect(storePageCount({ state: "uncounted" })).toBeNull();
    expect(storePageCount({ state: "locked" })).toBe(-1);
    expect(storePageCount({ state: "unreadable" })).toBe(0);
    expect(readPageCount(undefined)).toEqual({ state: "uncounted" });
    expect(readPageCount(-7)).toEqual({ state: "uncounted" });
  });
});
