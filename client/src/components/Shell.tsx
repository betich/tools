import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TabRail, TopBar } from "./Chrome";

/**
 * Ground, one bloom of light, and the console chrome around the work.
 *
 * `workspace` is for an editor: from a laptop up it takes exactly the viewport
 * between the top bar and the rail, and the page itself never scrolls — the
 * panes inside it do. Below that it is an ordinary scrolling page, because a
 * phone editor is a column, not a room.
 */
export function Shell({
  children,
  width = "default",
}: {
  children: ReactNode;
  width?: "default" | "page" | "wide" | "workspace";
}) {
  if (width === "workspace") {
    return (
      <div className="relative flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
        <div className="bloom" aria-hidden />

        <div className="relative z-10 flex min-h-dvh flex-col lg:h-full lg:min-h-0">
          <TopBar />
          <main className="flex-1 px-5 pt-5 pb-36 sm:px-8 lg:flex lg:min-h-0 lg:flex-col lg:px-0 lg:pt-0 lg:pb-0">
            {children}
          </main>
          {/* In the room the rail is part of the floor plan, not laid over it. */}
          <TabRail inFlow />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="bloom" aria-hidden />

      <div className="relative z-10 flex min-h-dvh flex-col">
        <TopBar />
        <main className="flex-1 px-5 pt-10 pb-36 sm:px-8 sm:pt-14 md:px-12">
          <div className={cn("mx-auto", width === "wide" ? "max-w-[1600px]" : width === "page" ? "max-w-6xl" : "max-w-3xl")}>
            {children}
          </div>
        </main>
      </div>

      <TabRail />
    </div>
  );
}

/**
 * Page heading. The title is the whole label — no kicker above it, and the
 * note sits under it where a reader arrives at it second.
 */
export function PageHead({ title, note, actions }: { title: string; note?: string; actions?: ReactNode }) {
  return (
    <header className="mb-10 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="text-ink font-mono text-title font-bold uppercase">{title}</h1>
        {note ? <p className="text-label max-w-xl font-sans text-body normal-case">{note}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-5">{actions}</div> : null}
    </header>
  );
}
