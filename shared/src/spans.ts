/* ───────────────────────────────────────────────────────────────────────────
   Inline colour runs, as the editor works on them.

   `[[#FFE19B]]NANO[[/]]` paints that run in its own colour while inheriting
   every other property of the layer (see `render.ts`, which draws them). This
   file is the other half: finding the runs in a piece of text, and the four
   edits the UI offers — colour a selection, recolour a run, remove a run's
   colour, and read the run under the caret.

   Pure string arithmetic, so it lives under `bun test` as it is. Every edit
   returns the new text with the selection to restore, because the caller is a
   textarea and a change that loses the cursor is a change that fights back.
   ─────────────────────────────────────────────────────────────────────────── */

/** An opening `[[#rgb]]`/`[[#rrggbb]]`/`[[#rrggbbaa]]` marker, or the closing `[[/]]`. */
export const SPAN = /\[\[(#[0-9a-fA-F]{3,8}|\/)\]\]/g;

export type Span = {
  color: string;
  /** The whole run, markers included. */
  start: number;
  end: number;
  /** The text between the markers. */
  innerStart: number;
  innerEnd: number;
  text: string;
  /** 0 for a run at the top level; deeper for one inside another. */
  depth: number;
  /** No `[[/]]` of its own: it runs to the end of the text. */
  unclosed: boolean;
};

export type Edit = { text: string; selectionStart: number; selectionEnd: number };

/**
 * Every coloured run, in the order they open. Nesting is kept — the renderer
 * holds a stack, so an inner run wins for as long as it lasts — and a marker
 * left unclosed runs to the end rather than being dropped.
 */
export function findSpans(text: string): Span[] {
  type Open = { color: string; start: number; innerStart: number; depth: number };
  const open: Open[] = [];
  const out: Span[] = [];

  for (const match of text.matchAll(new RegExp(SPAN.source, "g"))) {
    const at = match.index;
    const after = at + match[0].length;
    if (match[1] === "/") {
      const last = open.pop();
      if (!last) continue; // A stray `[[/]]` closes nothing; the renderer ignores it too.
      out.push({
        color: last.color,
        start: last.start,
        end: after,
        innerStart: last.innerStart,
        innerEnd: at,
        text: text.slice(last.innerStart, at),
        depth: last.depth,
        unclosed: false,
      });
    } else {
      open.push({ color: match[1]!, start: at, innerStart: after, depth: open.length });
    }
  }

  for (const last of open) {
    out.push({
      color: last.color,
      start: last.start,
      end: text.length,
      innerStart: last.innerStart,
      innerEnd: text.length,
      text: text.slice(last.innerStart),
      depth: last.depth,
      unclosed: true,
    });
  }

  return out.sort((a, b) => a.start - b.start || a.depth - b.depth);
}

/**
 * The run the caret or selection sits in — the innermost one, since that is
 * the colour on screen there. Inside runs from the opening marker to the end
 * of the run's own text: a caret right before `[[/]]` is still in the run,
 * because what is typed there is coloured, and one just after it is not.
 */
export function spanAt(text: string, selectionStart: number, selectionEnd = selectionStart): Span | null {
  const holding = findSpans(text).filter((s) => selectionStart >= s.start && selectionEnd <= s.innerEnd);
  return holding.length === 0 ? null : holding.reduce((a, b) => (b.depth >= a.depth ? b : a));
}

/**
 * Wrap the selection in a colour. An empty selection colours nothing, so it
 * inserts the pair and puts the caret between the markers, ready to type.
 * A selection that already sits inside a run nests inside it, which is what
 * the renderer draws.
 */
export function colourSelection(text: string, selectionStart: number, selectionEnd: number, color: string): Edit {
  const [from, to] = selectionStart <= selectionEnd ? [selectionStart, selectionEnd] : [selectionEnd, selectionStart];
  const open = `[[${normalise(color)}]]`;
  const close = "[[/]]";
  const inner = text.slice(from, to);
  return {
    text: `${text.slice(0, from)}${open}${inner}${close}${text.slice(to)}`,
    selectionStart: from + open.length,
    selectionEnd: from + open.length + inner.length,
  };
}

/** A run's colour, changed in place. The text and the selection keep their length. */
export function recolour(text: string, span: Span, color: string): Edit {
  const open = `[[${normalise(color)}]]`;
  const shift = open.length - (span.innerStart - span.start);
  return {
    text: `${text.slice(0, span.start)}${open}${text.slice(span.innerStart)}`,
    selectionStart: span.innerStart + shift,
    selectionEnd: span.innerEnd + shift,
  };
}

/** Take a run's colour off, keeping its text. The words stay selected. */
export function clearSpan(text: string, span: Span): Edit {
  const inner = text.slice(span.innerStart, span.innerEnd);
  return {
    text: `${text.slice(0, span.start)}${inner}${text.slice(span.end)}`,
    selectionStart: span.start,
    selectionEnd: span.start + inner.length,
  };
}

/** `#abc` → `#AABBCC`; anything unreadable falls back to black rather than writing a broken marker. */
export function normalise(color: string): string {
  const hex = color.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3,4}$/.test(hex)) return `#${[...hex].map((c) => c + c).join("").toUpperCase()}`;
  if (/^[0-9a-fA-F]{6}$/.test(hex) || /^[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.toUpperCase()}`;
  return "#000000";
}
