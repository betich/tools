import { describe, expect, test } from "bun:test";
import { clearSpan, colourSelection, findSpans, normalise, recolour, spanAt } from "../src/spans";
import { stripSpans } from "../src/render";

const LINE = "Intania 90 [[#FFE19B]]NANO[[/]]";

describe("findSpans", () => {
  test("reads a run and where its text sits", () => {
    const [span, ...rest] = findSpans(LINE);
    expect(rest).toHaveLength(0);
    expect(span).toMatchObject({ color: "#FFE19B", text: "NANO", unclosed: false, depth: 0 });
    expect(LINE.slice(span!.innerStart, span!.innerEnd)).toBe("NANO");
    expect(LINE.slice(span!.start, span!.end)).toBe("[[#FFE19B]]NANO[[/]]");
  });

  test("keeps nesting, innermost deepest", () => {
    const spans = findSpans("[[#111111]]a[[#222222]]b[[/]]c[[/]]");
    expect(spans.map((s) => [s.color, s.text, s.depth])).toEqual([
      ["#111111", "a[[#222222]]b[[/]]c", 0],
      ["#222222", "b", 1],
    ]);
  });

  test("an unclosed marker runs to the end", () => {
    const [span] = findSpans("plain [[#FF0000]]red to the end");
    expect(span).toMatchObject({ text: "red to the end", unclosed: true });
  });

  test("a stray closer is ignored, as the renderer ignores it", () => {
    expect(findSpans("no colour [[/]] here")).toEqual([]);
  });
});

describe("spanAt", () => {
  test("finds the run under the caret and nothing outside it", () => {
    expect(spanAt(LINE, LINE.indexOf("NANO") + 2)?.text).toBe("NANO");
    expect(spanAt(LINE, 3)).toBeNull();
  });

  test("picks the innermost run", () => {
    const text = "[[#111111]]a[[#222222]]b[[/]]c[[/]]";
    expect(spanAt(text, text.indexOf("b"))?.color).toBe("#222222");
    expect(spanAt(text, text.indexOf("c"))?.color).toBe("#111111");
  });
});

describe("edits", () => {
  test("colouring a selection wraps it and keeps it selected", () => {
    const text = "Intania 90 NANO";
    const from = text.indexOf("NANO");
    const edit = colourSelection(text, from, text.length, "#ffe19b");
    expect(edit.text).toBe(LINE);
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe("NANO");
  });

  test("colouring nothing leaves a pair to type into", () => {
    const edit = colourSelection("ab", 1, 1, "#FFFFFF");
    expect(edit.text).toBe("a[[#FFFFFF]][[/]]b");
    expect(edit.selectionStart).toBe(edit.selectionEnd);
    expect(edit.text.slice(0, edit.selectionStart)).toBe("a[[#FFFFFF]]");
  });

  test("recolouring keeps the words selected", () => {
    const span = findSpans(LINE)[0]!;
    const edit = recolour(LINE, span, "#0f0");
    expect(edit.text).toBe("Intania 90 [[#00FF00]]NANO[[/]]");
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe("NANO");
  });

  test("clearing takes both markers and keeps the text", () => {
    const edit = clearSpan(LINE, findSpans(LINE)[0]!);
    expect(edit.text).toBe("Intania 90 NANO");
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe("NANO");
  });

  test("an edit is something the renderer can read back", () => {
    const edit = colourSelection("one two", 4, 7, "#abc");
    expect(findSpans(edit.text)[0]).toMatchObject({ color: "#AABBCC", text: "two" });
    expect(stripSpans(edit.text)).toBe("one two");
  });
});

describe("normalise", () => {
  test("expands short hex, upper-cases, and refuses nonsense", () => {
    expect(normalise("#abc")).toBe("#AABBCC");
    expect(normalise("ffe19b")).toBe("#FFE19B");
    expect(normalise("#FFE19B80")).toBe("#FFE19B80");
    expect(normalise("rebeccapurple")).toBe("#000000");
  });
});
