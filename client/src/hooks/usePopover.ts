import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type PopoverAt = { left: number; top?: number; bottom?: number; maxHeight: number; width?: number };

/**
 * A panel that hangs off a trigger: placed in the viewport (so a scrolling
 * pane can't clip it), flipped above when there is more room there, and
 * closed by escape, a click outside, or the pane scrolling away under it.
 *
 * The panel is portalled by the caller — this only says where to put it.
 */
export function usePopover<T extends HTMLElement = HTMLButtonElement>({
  width,
  minHeight = 240,
  align = "start",
}: { width?: number; minHeight?: number; align?: "start" | "end" } = {}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<PopoverAt | null>(null);
  const trigger = useRef<T>(null);
  const panel = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const w = width ?? r.width;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, align === "end" ? r.right - w : r.left));
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    if (below >= minHeight || below >= above) setAt({ left, top: r.bottom + 6, width: w, maxHeight: below });
    else setAt({ left, bottom: window.innerHeight - r.top + 6, width: w, maxHeight: above });
  }, [width, minHeight, align]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const onScroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) place();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return { open, setOpen, trigger, panel, at };
}
