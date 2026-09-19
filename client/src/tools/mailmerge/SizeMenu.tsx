import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiCheck, FiChevronDown } from "react-icons/fi";
import { cn } from "@/lib/cn";
import { ALL_SIZES, presetFor, SIZE_GROUPS, type SizePreset } from "./sizes";

/**
 * The document size as a dropdown, the way Figma offers frames: every preset
 * drawn as its own shape, named, with its pixels beside it. The panel is
 * portalled and fixed, because the pane it opens from scrolls and would clip it.
 */
export function SizeMenu({
  width,
  height,
  onPick,
}: {
  width: number;
  height: number;
  onPick: (size: { width: number; height: number }) => void;
}) {
  const current = presetFor(width, height);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(Math.max(r.width, 384), window.innerWidth - 24);
    const left = Math.min(r.left, window.innerWidth - w - 12);
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    // Open downward unless the room is clearly upward.
    if (below >= 320 || below >= above) setAt({ left, top: r.bottom + 6, width: w, maxHeight: below - 6 });
    else setAt({ left, bottom: window.innerHeight - r.top + 6, width: w, maxHeight: above - 6 });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const i = current ? ALL_SIZES.indexOf(current) : 0;
    setActive(i);
    requestAnimationFrame(() => panel.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "center" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    // The pane under the trigger scrolling would leave the panel floating
    // beside nothing; close instead of chasing it.
    const onScroll = (e: Event) => !panel.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const choose = (p: SizePreset) => {
    onPick({ width: p.width, height: p.height });
    setOpen(false);
    trigger.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    const n = ALL_SIZES.length;
    const move = (i: number) => {
      setActive(i);
      panel.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
    };
    if (e.key === "ArrowDown") (e.preventDefault(), move((active + 1) % n));
    else if (e.key === "ArrowUp") (e.preventDefault(), move((active - 1 + n) % n));
    else if (e.key === "Home") (e.preventDefault(), move(0));
    else if (e.key === "End") (e.preventDefault(), move(n - 1));
    else if (e.key === "Enter" || e.key === " ") (e.preventDefault(), choose(ALL_SIZES[active]!));
    else if (e.key === "Escape" || e.key === "Tab") setOpen(false);
  };

  let index = -1;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? "size-menu" : undefined}
        aria-activedescendant={open ? `size-${active}` : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKey}
        className={cn(
          "border-wash text-ink flex w-full cursor-pointer items-center gap-3 rounded-xs border bg-control px-2.5 py-2 text-left transition-colors duration-200",
          "hover:border-edge focus-visible:border-indigo focus-visible:bg-surface-high focus-visible:outline-none",
          open && "border-indigo bg-surface-high",
        )}
      >
        <Shape width={width} height={height} className="text-label" />
        <span className="min-w-0 flex-1 truncate font-mono text-label text-small uppercase">
          {current ? current.name : "custom"}
          {current ? <span className="text-meta"> · {current.ratio}</span> : null}
        </span>
        <FiChevronDown className={cn("text-meta size-3.5 shrink-0 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>

      {open && at
        ? createPortal(
            <div
              ref={panel}
              id="size-menu"
              role="listbox"
              aria-label="document size"
              className="animate-menu-in border-wash bg-panel-high rounded-card fixed z-[70] overflow-y-auto overscroll-contain border p-1.5"
              style={{ ...at, boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)" }}
            >
              {SIZE_GROUPS.map((group) => (
                <div key={group.title} role="group" aria-label={group.title} className="not-first:mt-1.5 not-first:border-hairline-faint not-first:border-t not-first:pt-1.5">
                  <p className="text-meta px-2.5 pt-1.5 pb-1 font-mono text-micro uppercase">{group.title}</p>
                  {group.presets.map((p) => {
                    index += 1;
                    const i = index;
                    const chosen = p === current;
                    return (
                      <div
                        key={i}
                        id={`size-${i}`}
                        data-i={i}
                        role="option"
                        aria-selected={chosen}
                        onMouseEnter={() => setActive(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(p)}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-xs px-2.5 py-1.5 transition-colors duration-100",
                          i === active ? "bg-hover-wash text-indigo" : chosen ? "text-ink" : "text-label",
                        )}
                      >
                        <Shape width={p.width} height={p.height} />
                        <span className="min-w-0 flex-1 truncate font-mono text-label text-small uppercase">
                          {p.name} <span className={cn(i === active ? "text-indigo/80" : "text-meta")}>· {p.ratio}</span>
                        </span>
                        <span className={cn("shrink-0 font-mono text-micro tabular-nums", i === active ? "text-indigo" : "text-meta")}>
                          {p.width}×{p.height}
                        </span>
                        <FiCheck className={cn("size-3 shrink-0", chosen ? "opacity-100" : "opacity-0")} aria-hidden />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** The frame itself, fitted into a 16px square at hairline weight — the ratio seen before it is read. */
function Shape({ width, height, className }: { width: number; height: number; className?: string }) {
  const s = 13 / Math.max(width, height);
  const w = Math.max(3, width * s);
  const h = Math.max(3, height * s);
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" className={cn("shrink-0", className)} aria-hidden>
      <rect x={(16 - w) / 2 + 0.5} y={(16 - h) / 2 + 0.5} width={w - 1} height={h - 1} rx={1} fill="none" stroke="currentColor" />
    </svg>
  );
}
