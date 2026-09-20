import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FiDroplet, FiHelpCircle, FiX } from "react-icons/fi";
import { clearSpan, colourSelection, findSpans, normalise, recolour, spanAt, type Span } from "@tools/shared";
import { Button, Chip, ColorInput, Field, IconButton, Prose, TextButton } from "@/components/ui";
import { usePopover } from "@/hooks/usePopover";
import { cn } from "@/lib/cn";

/** A run with no text yet reads as nothing at all, so the strip says what it is instead. */
const EMPTY_RUN = "empty";

/**
 * The layer's text, and the two things it can carry: column tokens and
 * inline colour runs. Both are still written into the text as they always
 * were — `<name>`, `[[#FFE19B]]NANO[[/]]` — because that is what the renderer
 * reads and what a shared project holds. What is new is that you never have
 * to type them: select the words and press COLOUR, press a column to drop it
 * at the caret, and every run in the text is listed underneath as a swatch
 * you can recolour or take off.
 */
export function TextContent({
  text,
  fields,
  palette,
  onChange,
  onPreview,
  onSnapshot,
}: {
  text: string;
  fields: string[];
  /** The colours this layer already wears, offered beside the picker. */
  palette: string[];
  /** A committed edit: its own undo step. */
  onChange: (text: string) => void;
  /** Mid-gesture, as a colour is dragged: no step of its own. */
  onPreview: (text: string) => void;
  onSnapshot: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const docs = usePopover<HTMLButtonElement>({ width: 340, minHeight: 280 });

  const spans = findSpans(text);
  const current = spanAt(text, selection.start, selection.end);
  const hasSelection = selection.end > selection.start;

  const readSelection = useCallback(() => {
    const el = area.current;
    if (el) setSelection({ start: el.selectionStart, end: el.selectionEnd });
  }, []);

  /**
   * The field's own `select` event misses a drag that ends outside the box and
   * a caret moved by the browser itself, so the document's own account of the
   * selection is the one we follow while the field has focus.
   */
  useEffect(() => {
    const onChangeSelection = () => {
      if (document.activeElement === area.current) readSelection();
    };
    document.addEventListener("selectionchange", onChangeSelection);
    return () => document.removeEventListener("selectionchange", onChangeSelection);
  }, [readSelection]);

  /** Put the text back with the caret where the edit left it, not at the end. */
  const apply = useCallback(
    (next: { text: string; selectionStart: number; selectionEnd: number }, commit = true) => {
      // Moving the selection is not an edit: leave the document (and the save
      // state) alone unless the text itself changed.
      if (next.text !== text) (commit ? onChange : onPreview)(next.text);
      setSelection({ start: next.selectionStart, end: next.selectionEnd });
      requestAnimationFrame(() => {
        const el = area.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(next.selectionStart, next.selectionEnd);
      });
    },
    [text, onChange, onPreview],
  );

  const insertField = (field: string) => {
    const token = `<${field}>`;
    const from = selection.start;
    const to = selection.end;
    apply({
      text: `${text.slice(0, from)}${token}${text.slice(to)}`,
      selectionStart: from + token.length,
      selectionEnd: from + token.length,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="text"
        hint="wrap a column name in angle brackets to merge it"
        action={
          /* No tooltip: the panel it opens is the explanation, and a tip that
             stays up after the press would sit on the section's heading. */
          <button
            ref={docs.trigger}
            type="button"
            aria-label="what text can carry"
            aria-expanded={docs.open}
            onClick={(e) => {
              e.preventDefault();
              docs.setOpen((v) => !v);
            }}
            className={cn(
              "hover:text-indigo focus-visible:outline-indigo inline-flex cursor-pointer items-center justify-center transition-colors duration-200 focus-visible:outline-1 focus-visible:outline-offset-2",
              docs.open ? "text-indigo" : "text-meta",
            )}
          >
            <FiHelpCircle className="size-3.5" />
          </button>
        }
      >
        <textarea
          ref={area}
          value={text}
          onChange={(e) => {
            onChange(e.target.value);
            setSelection({ start: e.target.selectionStart, end: e.target.selectionEnd });
          }}
          onSelect={readSelection}
          onKeyUp={readSelection}
          onClick={readSelection}
          onFocus={readSelection}
          rows={3}
          spellCheck={false}
          className="border-wash text-ink hover:border-edge focus:border-indigo rounded-xs bg-control text-small w-full resize-y border px-2.5 py-2 font-mono tracking-normal transition-colors duration-200 focus:outline-none"
        />
      </Field>

      <ColourBar
        text={text}
        current={current}
        hasSelection={hasSelection}
        selection={selection}
        palette={palette}
        onApply={apply}
        onSnapshot={onSnapshot}
      />

      {spans.length > 0 ? (
        <SpanStrip text={text} spans={spans} current={current} onApply={apply} onSnapshot={onSnapshot} />
      ) : null}

      {fields.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {fields.map((field) => (
            <Chip key={field} as="button" onClick={() => insertField(field)}>
              &lt;{field}&gt;
            </Chip>
          ))}
        </div>
      ) : null}

      {docs.open && docs.at
        ? createPortal(
            <div
              ref={docs.panel}
              role="dialog"
              aria-label="what text can carry"
              className="animate-menu-in border-wash bg-panel-high rounded-card fixed z-[70] overflow-y-auto overscroll-contain border p-5"
              style={{ ...docs.at, boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)" }}
            >
              <SyntaxDocs onClose={() => docs.setOpen(false)} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/* ── colouring ─────────────────────────────────────────────────────────────── */

type Apply = (edit: { text: string; selectionStart: number; selectionEnd: number }, commit?: boolean) => void;

/**
 * The one action the text field gains, in the three states it has: colour
 * what is selected, change the run the caret is in, or — with neither — say
 * what to do to get there.
 */
function ColourBar({
  text,
  current,
  hasSelection,
  selection,
  palette,
  onApply,
  onSnapshot,
}: {
  text: string;
  current: Span | null;
  hasSelection: boolean;
  selection: { start: number; end: number };
  /** Colours already in this layer — the ones most likely wanted again. */
  palette: string[];
  onApply: Apply;
  onSnapshot: () => void;
}) {
  const picker = usePopover<HTMLButtonElement>({ width: 232, minHeight: 150 });
  const colour = current?.color ?? palette[0] ?? "#FFFFFF";

  const change = (value: string, commit: boolean) => {
    const hex = normalise(value);
    if (current) onApply(recolour(text, current, hex), commit);
    else onApply(colourSelection(text, selection.start, selection.end, hex), commit);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button
        ref={picker.trigger}
        size="sm"
        variant={current ? "ghost" : "outline"}
        aria-expanded={picker.open}
        onClick={() => {
          // A fresh run is one step; the picker then previews inside it.
          if (!current) {
            onSnapshot();
            change(colour, true);
          }
          picker.setOpen((v) => !v);
        }}
      >
        {current ? (
          <>
            <Swatch colour={current.color} />
            {current.color}
          </>
        ) : (
          <>
            <FiDroplet className="size-3" aria-hidden />
            {hasSelection ? "colour these words" : "start a colour"}
          </>
        )}
      </Button>

      {current ? (
        <TextButton onClick={() => onApply(clearSpan(text, current))}>take the colour off</TextButton>
      ) : (
        <span className="text-meta text-micro font-mono uppercase">
          {hasSelection ? "or press to pick the colour" : "or select words first"}
        </span>
      )}

      {picker.open && picker.at
        ? createPortal(
            <div
              ref={picker.panel}
              role="dialog"
              aria-label="run colour"
              className="animate-menu-in border-wash bg-panel-high rounded-card fixed z-[70] flex flex-col gap-3 border p-3"
              style={{ ...picker.at, boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)" }}
            >
              <div onFocusCapture={onSnapshot} onPointerDownCapture={onSnapshot}>
                <ColorInput value={colour} onChange={(v) => change(v, false)} />
              </div>
              {palette.length > 0 ? (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="colours already in this layer">
                  {palette.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      data-tip={c}
                      onClick={() => {
                        onSnapshot();
                        change(c, true);
                      }}
                      className="tooltip border-wash hover:border-indigo size-6 cursor-pointer rounded-full border transition-colors duration-200"
                      style={{ background: c }}
                    />
                  ))}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function Swatch({ colour, className }: { colour: string; className?: string }) {
  return (
    <span
      className={cn("border-hairline size-3 shrink-0 rounded-full border", className)}
      style={{ background: colour }}
      aria-hidden
    />
  );
}

/**
 * Every coloured run in the text, in the order they appear: the colour, the
 * words it holds, and the way out. Pressing one selects those words in the
 * field, so the strip is also a way to find a run in a long line.
 */
function SpanStrip({
  text,
  spans,
  current,
  onApply,
  onSnapshot,
}: {
  text: string;
  spans: Span[];
  current: Span | null;
  onApply: Apply;
  onSnapshot: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="coloured runs">
      <span className="text-meta text-micro font-mono uppercase">
        coloured runs <span className="tabular-nums tracking-normal">{spans.length}</span>
      </span>
      <ul className="flex flex-col">
        {spans.map((span) => {
          const chosen = current?.start === span.start && current?.depth === span.depth;
          return (
            <li key={`${span.start}:${span.depth}`} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onApply({ text, selectionStart: span.innerStart, selectionEnd: span.innerEnd }, false)}
                className={cn(
                  "rounded-xs flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1.5 py-1 text-left transition-colors duration-200",
                  chosen ? "bg-surface-high text-ink" : "text-label hover:bg-hover-wash hover:text-indigo",
                )}
              >
                <Swatch colour={span.color} />
                <span className="text-micro min-w-0 flex-1 truncate font-mono tracking-normal">
                  {span.text.trim() || <span className="text-meta uppercase">{EMPTY_RUN}</span>}
                </span>
                <span className="text-meta text-micro shrink-0 font-mono tracking-normal">{span.color}</span>
                {span.unclosed ? (
                  <span className="text-meta text-micro shrink-0 font-mono uppercase">· to the end</span>
                ) : null}
              </button>
              <IconButton
                label={`take the colour off ${span.text.trim() || EMPTY_RUN}`}
                data-tip-pos="top-right"
                onClick={() => {
                  onSnapshot();
                  onApply(clearSpan(text, span));
                }}
              >
                <FiX className="size-3.5" />
              </IconButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── docs ──────────────────────────────────────────────────────────────────── */

/**
 * What a line of text can carry, in the order a person meets it. Short
 * enough to read standing up: two ideas, each with the thing itself drawn as
 * it will look, and the rule that catches people out underneath.
 */
export function SyntaxDocs({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-ink text-micro font-mono uppercase">what text can carry</h2>
        {onClose ? (
          <IconButton label="close" data-tip-pos="top-right" onClick={onClose}>
            <FiX className="size-3.5" />
          </IconButton>
        ) : null}
      </div>

      <DocsPart title="a column" sample="hello <name>">
        <Prose>Wrap a column's name in angle brackets and every row puts its own value there.</Prose>
      </DocsPart>

      <DocsPart title="a colour" sample="intania 90 [[#FFE19B]]nano[[/]]">
        <Prose>
          Select the words, press <b className="text-ink font-normal">colour these words</b>, and they take their own
          colour while keeping the layer's font, size and alignment. One line, two colours, still centred as one.
        </Prose>
      </DocsPart>

      <ul className="text-label text-body flex flex-col gap-2 font-sans normal-case">
        <li>A colour inside another wins for as long as it lasts.</li>
        <li>
          Eight digits carry transparency: <Code>#FFE19B80</Code> is half see-through.
        </li>
        <li>Changing case leaves the markers alone, so an upper-case line keeps its colours.</li>
        <li>Markers never reach the picture: they are instructions, not letters.</li>
      </ul>
    </div>
  );
}

function DocsPart({ title, sample, children }: { title: string; sample: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-meta text-micro font-mono uppercase">{title}</h3>
      <p className="bg-surface rounded-xs text-micro break-words px-2.5 py-2 font-mono leading-relaxed tracking-normal">
        <Marked text={sample} />
      </p>
      {children}
    </section>
  );
}

/**
 * The sample as the renderer would read it: markers in the hairline grey of
 * something that is not a letter, tokens in periwinkle, and a coloured run
 * actually wearing its colour.
 */
function Marked({ text }: { text: string }) {
  const spans = findSpans(text);
  const out: ReactNode[] = [];
  let at = 0;

  const plain = (chunk: string, key: string) => {
    for (const part of chunk.split(/(<[^<>]+>)/)) {
      if (!part) continue;
      out.push(
        part.startsWith("<") && part.endsWith(">") ? (
          <span key={`${key}:${out.length}`} className="text-indigo">
            {part}
          </span>
        ) : (
          <span key={`${key}:${out.length}`} className="text-label">
            {part}
          </span>
        ),
      );
    }
  };

  for (const span of spans) {
    plain(text.slice(at, span.start), `p${span.start}`);
    out.push(
      <span key={`m${span.start}`} className="text-wash">
        {text.slice(span.start, span.innerStart)}
      </span>,
      <span key={`i${span.start}`} style={{ color: span.color }}>
        {span.text}
      </span>,
      <span key={`c${span.start}`} className="text-wash">
        {text.slice(span.innerEnd, span.end)}
      </span>,
    );
    at = span.end;
  }
  plain(text.slice(at), "tail");
  return <>{out}</>;
}

function Code({ children }: { children: ReactNode }) {
  return <span className="text-ink text-micro font-mono tracking-normal">{children}</span>;
}
