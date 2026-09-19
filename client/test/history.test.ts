import { describe, expect, test } from "bun:test";
import { History } from "../src/lib/history";

describe("history", () => {
  test("set records a step; undo and redo walk it", () => {
    const h = new History(1);
    h.set(2);
    h.set(3);
    expect(h.undo()).toBe(true);
    expect(h.present).toBe(2);
    expect(h.redo()).toBe(true);
    expect(h.present).toBe(3);
    expect(h.redo()).toBe(false);
  });

  test("a gesture is one step, however many previews", () => {
    const h = new History(0);
    h.snapshot();
    for (let i = 1; i <= 60; i++) h.preview(i);
    expect(h.present).toBe(60);
    h.undo();
    expect(h.present).toBe(0);
    expect(h.canUndo).toBe(false);
  });

  test("a gesture that changes nothing leaves no step", () => {
    const h = new History("a");
    h.snapshot();
    h.preview("a");
    expect(h.canUndo).toBe(false);
  });

  test("preview without a snapshot writes through", () => {
    const h = new History(0);
    h.preview(5);
    expect(h.present).toBe(5);
    expect(h.canUndo).toBe(false);
  });

  test("a new step clears redo", () => {
    const h = new History(0);
    h.set(1);
    h.undo();
    h.set(2);
    expect(h.canRedo).toBe(false);
  });

  test("setting the same value is not a step", () => {
    const h = new History(0);
    h.set(0);
    expect(h.canUndo).toBe(false);
  });

  test("the oldest steps fall off past the limit", () => {
    const h = new History(0, 3);
    for (let i = 1; i <= 5; i++) h.set(i);
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(3);
    expect(h.present).toBe(2);
  });

  test("reset forgets everything", () => {
    const h = new History(0);
    h.set(1);
    h.reset(9);
    expect(h.present).toBe(9);
    expect(h.canUndo || h.canRedo).toBe(false);
  });
});
