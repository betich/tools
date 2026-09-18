import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useServerStatus } from "@/hooks/useServerStatus";
import { cn } from "@/lib/cn";
import { registry } from "@/tools/registry";

/**
 * The console chrome: a hairline bar at the top carrying the wordmark and the
 * live state, and a rail pinned to the bottom carrying the three destinations.
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
              ? "api unreachable — both tools still run in this browser"
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

/** Three destinations, equal weight, pinned to the floor of the screen. */
export function TabRail() {
  return (
    <div className="border-wash bg-paper/85 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xl">
      <nav aria-label="tools" className="grid grid-cols-3">
        <RailTab to="/" end>
          index
        </RailTab>
        {registry.map((tool) => (
          <RailTab key={tool.id} to={tool.href}>
            {tool.name}
          </RailTab>
        ))}
      </nav>

      <p className="border-hairline-faint text-meta border-t px-4 py-2 text-center font-mono text-meta uppercase">
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
      </p>
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
