import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FiArrowLeft, FiChevronUp } from "react-icons/fi";
import { NavLink, useLocation } from "react-router-dom";
import { useServerStatus } from "@/hooks/useServerStatus";
import { cn } from "@/lib/cn";
import { registry } from "@/tools/registry";

/**
 * The console chrome: a hairline bar at the top carrying the wordmark and the
 * live state, and a rail pinned to the bottom carrying the index and every tool.
 * Navigation is always within reach and never scrolls away — the page is an
 * instrument, not a document.
 */

export function TopBar() {
  const status = useServerStatus();

  return (
    <header className="border-wash bg-paper/75 sticky top-0 z-40 flex items-center justify-between gap-4 border-b px-5 py-3.5 backdrop-blur-xl sm:px-8">
      <NavLink
        to="/"
        className="text-ink hover:text-indigo font-mono text-label font-bold uppercase transition-colors duration-200"
        style={{ letterSpacing: "0.32em" }}
      >
        tools
      </NavLink>

      <span
        className="tooltip text-meta flex items-center gap-2 font-mono text-meta uppercase"
        data-tip-pos="top-right"
        data-tip={
          status === "online"
            ? "api reachable — save, share and batch render available"
            : status === "offline"
              ? "api unreachable — squoosh and mail merge still run in this browser; the pdf tools wait for it"
              : "checking api"
        }
      >
        <span
          className={cn(
            "inline-block size-1.5 rounded-full",
            status === "online" ? "bg-signal animate-signal" : status === "checking" ? "bg-meta" : "bg-hairline",
          )}
        />
        {status === "online" ? "api live" : status === "offline" ? "api offline" : "api"}
      </span>
    </header>
  );
}

/**
 * The index and each tool, equal weight, pinned to the floor of the screen. `inFlow`
 * lets a full-height workspace lay it out as its last row from a laptop up, so
 * the room ends where the rail begins instead of running underneath it.
 *
 * A phone cannot hold five cells and a signature under the work without the
 * chrome becoming the loudest thing on screen, so below `md` the rail is two
 * cells — the way back, and where you are — and the signature moves into the
 * page (`Colophon`). The second cell opens the other tools, so the next one is
 * still two taps away. The index needs neither: its doors are the navigation.
 */
export function TabRail({ inFlow = false }: { inFlow?: boolean }) {
  const { pathname } = useLocation();
  const home = pathname === "/";

  return (
    <div
      className={cn(
        "border-wash bg-paper/85 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xl",
        home && "max-md:hidden",
        inFlow && "lg:static lg:shrink-0",
      )}
    >
      <nav
        aria-label="tools"
        className="grid max-md:hidden"
        style={{ gridTemplateColumns: `repeat(${registry.length + 1}, minmax(0, 1fr))` }}
      >
        <RailTab to="/" end>
          index
        </RailTab>
        {registry.map((tool) => (
          <RailTab key={tool.id} to={tool.href}>
            {tool.name}
          </RailTab>
        ))}
      </nav>

      {home ? null : <PhoneRail pathname={pathname} />}

      <Colophon className="border-hairline-faint border-t max-md:hidden" />
    </div>
  );
}

/** The signature: in the rail from a tablet up, at the foot of the page below that. */
export function Colophon({ className }: { className?: string }) {
  return (
    <p className={cn("text-meta px-4 py-2 text-center font-mono text-meta uppercase", className)}>
      made with{" "}
      <span className="text-signal" aria-label="love">
        &lt;3
      </span>{" "}
      by{" "}
      <a
        href="https://betich.me"
        className="hover:text-indigo underline decoration-wash underline-offset-4 transition-colors duration-200"
      >
        betich.me
      </a>
      {/* AGPL-3.0: the PDF engines oblige the service to offer its source to whoever uses it. */}
      <span aria-hidden> · </span>
      <a
        href="https://github.com/betich/tools"
        className="hover:text-indigo underline decoration-wash underline-offset-4 transition-colors duration-200"
      >
        source
      </a>
    </p>
  );
}

/**
 * The phone's rail: back to the index, and the tool you are in. Pressing the
 * tool lifts a menu of the others off the rail, in the popovers' own surface;
 * escape, a tap elsewhere, or arriving somewhere puts it away.
 */
function PhoneRail({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const here = registry.find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`));

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const menu = box.current?.querySelector("nav");
    (menu?.querySelector<HTMLElement>("[aria-current=page]") ?? menu?.querySelector<HTMLElement>("a"))?.focus();
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cell = "flex h-[46px] items-center gap-2 font-mono text-meta uppercase transition-colors duration-200";

  return (
    <div ref={box} className="relative grid grid-cols-2 pb-[env(safe-area-inset-bottom)] md:hidden">
      {open ? (
        <nav
          id={menuId}
          aria-label="tools"
          className="animate-menu-in border-wash bg-panel-high rounded-card absolute inset-x-4 bottom-full mb-3 flex flex-col gap-0.5 border p-2"
          style={{ boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)" }}
        >
          {registry.map((tool) => (
            <NavLink
              key={tool.id}
              to={tool.href}
              className={({ isActive }) =>
                cn(
                  "flex items-baseline justify-between gap-4 rounded-xs px-3 py-3 transition-colors duration-200",
                  isActive ? "bg-surface-high text-ink" : "text-label hover:bg-hover-wash hover:text-indigo",
                )
              }
            >
              <span className="font-mono text-label uppercase">{tool.name}</span>
              <span className="text-meta truncate font-mono text-meta uppercase">{tool.tagline}</span>
            </NavLink>
          ))}
        </nav>
      ) : null}

      <NavLink to="/" className={cn(cell, "text-meta hover:text-indigo justify-center")}>
        <FiArrowLeft className="size-3" aria-hidden />
        index
      </NavLink>

      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(cell, "bg-surface-high text-ink relative cursor-pointer justify-center", open && "text-indigo")}
      >
        <span className="bg-indigo absolute inset-x-0 top-0 h-px" aria-hidden />
        <span className="truncate">{here?.name ?? "tools"}</span>
        <FiChevronUp className={cn("size-3 shrink-0 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
    </div>
  );
}

function RailTab({ to, end, children }: { to: string; end?: boolean; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "relative py-4 text-center font-mono text-meta uppercase transition-colors duration-200",
          isActive ? "text-ink bg-surface-high" : "text-meta hover:text-indigo hover:bg-hover-wash",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? <span className="bg-indigo absolute inset-x-0 top-0 h-px" aria-hidden /> : null}
          {children}
        </>
      )}
    </NavLink>
  );
}
