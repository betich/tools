import { describe, expect, test } from "bun:test";
import { commitTo, previewTo, redoOf, snapshotOf, startHistory, undoOf } from "../src/hooks/useHistory";

describe("history", () => {
  test("commit records the value before; undo and redo walk it", () => {
    let h = startHistory(1);
    h = commitTo(h, 2);
    h = commitTo(h, (n) => n + 1);
    expect(h.present).toBe(3);
    h = undoOf(h);
    expect(h.present).toBe(2);
    h = undoOf(h);
    expect(h.present).toBe(1);
    expect(undoOf(h)).toBe(h);
    h = redoOf(h);
    h = redoOf(h);
    expect(h.present).toBe(3);
    expect(redoOf(h)).toBe(h);
  });

  test("an edit that changes nothing is no step", () => {
    const h = startHistory({ a: 1 });
    expect(commitTo(h, (x) => x)).toBe(h);
    expect(commitTo(startHistory<null>(null), null).past).toHaveLength(0);
  });

  test("a new edit drops the redo branch", () => {
    let h = commitTo(commitTo(startHistory(1), 2), 3);
    h = undoOf(h);
    h = commitTo(h, 9);
    expect(h.future).toHaveLength(0);
    expect(undoOf(h).present).toBe(2);
  });

  test("a gesture: snapshot once, preview every frame, one undo back to the start", () => {
    let h = startHistory(0);
    h = snapshotOf(h);
    for (let x = 1; x <= 30; x++) h = previewTo(h, x);
    expect(h.present).toBe(30);
    expect(h.past).toEqual([0]);
    expect(undoOf(h).present).toBe(0);
  });

  test("history is capped", () => {
    let h = startHistory(0);
    for (let x = 1; x <= 10; x++) h = commitTo(h, x, 4);
    expect(h.past).toEqual([6, 7, 8, 9]);
  });

  test("steps are pure: running one twice (StrictMode) records once", () => {
    const h = startHistory(1);
    const once = commitTo(h, 2);
    const twice = commitTo(h, 2);
    expect(once).toEqual(twice);
    expect(h.past).toHaveLength(0);
  });
});
