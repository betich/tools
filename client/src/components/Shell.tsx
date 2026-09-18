import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TabRail, TopBar } from "./Chrome";

/** Ground, one bloom of light, and the console chrome around the work. */
export function Shell({ children, width = "default" }: { children: ReactNode; width?: "default" | "page" | "wide" }) {
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
