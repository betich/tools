import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiChevronLeft, FiChevronRight, FiRotateCcw, FiTrash2, FiX } from "react-icons/fi";
import type { MergeRow } from "@tools/shared";
import { Button, IconButton, TextButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { pad } from "@/lib/format";

/**
 * One row, edited in place. It floats beside the data pane — over the edge of
 * the stage, so the poster it is changing stays in view — and every keystroke
 * is drawn on the canvas as a draft before anything is committed.
 *
 * ↵ applies, shift-↵ breaks the line (a long name often wants one), escape
 * discards. A click outside keeps what you typed: the edit timeline is the
 * safety net, so the popover never throws work away on a stray click.
 *
 * Below md it is a sheet across the foot of the screen; the pinned stage above
 * it still shows the draft.
 */
export function RowEditor({
  fields,
  initial,
  index,
  total,
  focusField,
  anchor,
  onDraft,
  onApply,
  onStep,
  onDelete,
  onClose,
}: {
  fields: string[];
  initial: MergeRow;
  /** null while adding a row that does not exist yet. */
  index: number | null;
  total: number;
  focusField?: string;
  anchor: HTMLElement | null;
  onDraft: (values: MergeRow) => void;
  onApply: (values: MergeRow) => void;
  /** Keep the draft and move to the neighbouring row. */
  onStep: (values: MergeRow, direction: -1 | 1) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<MergeRow>(() => ({ ...initial }));
  const [armed, setArmed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | "sheet" | null>(null);
  const adding = index === null;
  const dirty = fields.some((f) => (values[f] ?? "") !== (initial[f] ?? ""));
  const blank = fields.every((f) => !(values[f] ?? "").trim());

  // Latest values for listeners that are bound once.
  const latest = useRef({ values, dirty, blank });
  latest.current = { values, dirty, blank };

  const set = (field: string, value: string) => {
    const next = { ...values, [field]: value };
    setValues(next);
    onDraft(next);
  };

  const apply = useCallback(() => {
    const { values, dirty, blank } = latest.current;
    if (adding ? blank : !dirty) onClose();
    else onApply(values);
  }, [adding, onApply, onClose]);

  // ── placement ─────────────────────────────────────────────────────────────
  const position = useCallback(() => {
    const el = box.current;
    if (!el || !anchor) return;
    if (!window.matchMedia("(min-width: 768px)").matches) return setPlace("sheet");
    const a = anchor.getBoundingClientRect();
    const pane = (anchor.closest("[data-pane]") ?? anchor).getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 14;
    // Beside the pane when the stage has room for it, otherwise under the anchor.
    let left = pane.right + gap;
    let top = a.top - 12;
    if (left + w > window.innerWidth - 16) {
      left = Math.min(Math.max(16, a.left), window.innerWidth - w - 16);
      top = a.bottom + 10;
    }
    const floor = window.innerHeight - h - 88; // the rail lives down there
    setPlace({ left, top: Math.max(64, Math.min(top, floor)) });
  }, [anchor]);

  useLayoutEffect(position, [position]);

  useEffect(() => {
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [position]);

  // ── dismissal ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target) || anchor?.contains(target)) return;
      apply();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    // Bound on the next frame so the click that opened the popover does not close it.
    const id = requestAnimationFrame(() => document.addEventListener("pointerdown", onDown));
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, apply, onClose]);

  // Focus the value that was clicked once the popover is placed (a hidden
  // element cannot take focus); hand focus back to the anchor on the way out.
  const placed = place !== null;
  useEffect(() => {
    if (!placed) return;
    const target =
      box.current?.querySelector<HTMLTextAreaElement>(`[data-field="${CSS.escape(focusField ?? fields[0] ?? "")}"]`) ??
      box.current?.querySelector<HTMLTextAreaElement>("textarea");
    target?.focus();
    target?.select();
  }, [placed, fields, focusField]);

  useEffect(() => () => anchor?.focus?.({ preventScroll: true }), [anchor]);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);

  const title = adding ? `new row · ${pad(total + 1)}` : `row ${pad(index + 1)} / ${pad(total)}`;

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={adding ? "new row" : `edit row ${index + 1}`}
      className={cn(
        "animate-menu-in border-wash bg-panel-high fixed z-[60] flex flex-col border",
        place === "sheet"
          ? "inset-x-3 bottom-3 max-h-[min(56dvh,30rem)] rounded-card"
          : "max-h-[calc(100dvh-10rem)] w-[21rem] rounded-card",
        // Measured before it is shown, so it never flashes in the wrong place.
        place === null && "invisible",
      )}
      style={{
        boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)",
        ...(place && place !== "sheet" ? { left: place.left, top: place.top } : null),
      }}
    >
      <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-3">
        <span className="text-ink font-mono text-micro font-bold uppercase tabular-nums">{title}</span>
        <span className="flex items-center gap-3">
          {!adding ? (
            <>
              <IconButton label="apply and go to previous row" onClick={() => onStep(values, -1)} disabled={total < 2}>
                <FiChevronLeft className="size-4" />
              </IconButton>
              <IconButton
                label="apply and go to next row"
                data-tip-pos="top-right"
                onClick={() => onStep(values, 1)}
                disabled={total < 2}
              >
                <FiChevronRight className="size-4" />
              </IconButton>
              <span className="bg-wash h-3.5 w-px" aria-hidden />
            </>
          ) : null}
          <IconButton label="discard" data-tip-pos="top-right" onClick={onClose}>
            <FiX className="size-4" />
          </IconButton>
        </span>
      </header>

      <div className="border-hairline-faint border-t" />

      <form
        className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        {fields.map((field) => {
          const was = initial[field] ?? "";
          const now = values[field] ?? "";
          const changed = !adding && now !== was;
          return (
            <div key={field} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor={`row-field-${field}`}
                  className={cn(
                    "font-mono text-micro uppercase transition-colors duration-200",
                    changed ? "text-indigo" : "text-meta",
                  )}
                >
                  {field}
                </label>
                {changed ? (
                  <IconButton label="put back" data-tip-pos="top-right" onClick={() => set(field, was)}>
                    <FiRotateCcw className="size-3" />
                  </IconButton>
                ) : null}
              </div>
              <GrowingField
                id={`row-field-${field}`}
                field={field}
                value={now}
                changed={changed}
                onChange={(v) => set(field, v)}
                onSubmit={apply}
              />
              {changed ? (
                <p className="text-meta flex min-w-0 items-baseline gap-2 font-mono text-micro">
                  <span className="shrink-0 uppercase">was</span>
                  <span className="min-w-0 truncate tracking-normal line-through decoration-[rgba(246,245,255,0.34)]">
                    {was || "empty"}
                  </span>
                </p>
              ) : null}
            </div>
          );
        })}
      </form>

      <div className="border-hairline-faint border-t" />

      <footer className="flex items-center justify-between gap-3 px-4 py-3">
        {adding ? (
          <span className="text-meta hidden font-mono text-micro uppercase sm:inline">↵ adds · esc discards</span>
        ) : (
          <TextButton onClick={() => (armed ? onDelete() : setArmed(true))} className={cn("flex items-center gap-1.5", armed && "text-indigo")}>
            <FiTrash2 className="size-3" aria-hidden />
            {armed ? "delete for good" : "delete row"}
          </TextButton>
        )}
        <Button onClick={apply} disabled={adding ? blank : !dirty} className="h-8 px-3.5">
          {adding ? "add row" : "apply"}
        </Button>
      </footer>
    </div>,
    document.body,
  );
}

/** A one-line field that grows when you break the line. */
function GrowingField({
  id,
  field,
  value,
  changed,
  onChange,
  onSubmit,
}: {
  id: string;
  field: string;
  value: string;
  changed: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      id={id}
      data-field={field}
      rows={1}
      value={value}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onSubmit();
        }
      }}
      className={cn(
        "text-ink w-full resize-none overflow-hidden rounded-xs border bg-control px-2.5 py-2 font-mono text-small leading-snug tracking-normal",
        "transition-colors duration-200 hover:border-edge focus:bg-surface-high focus:outline-none",
        changed ? "border-indigo/60 focus:border-indigo" : "border-wash focus:border-indigo",
      )}
    />
  );
}
