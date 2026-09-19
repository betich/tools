import type { ReactNode } from "react";
import { FiArrowDown, FiArrowRight } from "react-icons/fi";
import { cn } from "@/lib/cn";

/* ───────────────────────────────────────────────────────────────────────────
   The bench: the shape the image and video tabs share. What you brought on
   the left, the machine in the middle, what you take away on the right —
   three columns from a laptop up, stacked in that order below it.
   ─────────────────────────────────────────────────────────────────────────── */

/** The three columns. The sides stretch to the row, so the pipe always meets them. */
export function Bench({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_17rem_minmax(0,1fr)] xl:gap-8",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The middle column. From a laptop up it stays in view while the sides scroll past. */
export function Machine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-20 lg:self-start">
      {children}
    </section>
  );
}

/** A side of the bench: ink over the ground, a hairline, and a header that says what it holds. */
export function Panel({
  title,
  count,
  aside,
  label,
  className,
  children,
}: {
  title: string;
  count: ReactNode;
  aside?: ReactNode;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn("border-wash rounded-card bg-surface flex min-w-0 flex-col border", className)}
    >
      <header className="border-hairline-faint flex min-h-14 items-center gap-3 border-b px-5">
        <h2 className="text-ink text-title shrink-0 font-mono font-bold uppercase">{title}</h2>
        <span className="text-meta text-micro min-w-0 truncate font-mono uppercase tabular-nums">{count}</span>
        <span className="ml-auto flex shrink-0 items-center">{aside}</span>
      </header>
      <div className="flex flex-1 flex-col gap-5 p-5">{children}</div>
    </section>
  );
}

/** The block above each list. One height on both sides, so every output row sits across from its source. */
export const headBlock = "flex flex-col justify-end gap-4 lg:min-h-[7.25rem]";

/**
 * The one action, on a pipe: a hairline from the input panel into the button
 * and on out to the output — edge grey at rest, the live colour while it runs.
 * The line under it is the button's own status, read politely.
 */
export function Pipe({
  live,
  status,
  statusId,
  children,
}: {
  live: boolean;
  status: ReactNode;
  statusId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "relative",
          "lg:before:absolute lg:before:right-full lg:before:top-1/2 lg:before:h-px lg:before:w-6 xl:before:w-8",
          "lg:after:absolute lg:after:left-full lg:after:top-1/2 lg:after:h-px lg:after:w-6 xl:after:w-8",
          live ? "lg:before:bg-signal lg:after:bg-signal" : "lg:before:bg-edge lg:after:bg-edge",
        )}
      >
        {children}
      </div>
      <p id={statusId} className="text-meta text-micro text-center font-mono uppercase" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

/** A button's fill while its job runs: the live colour, as far as the job has got. */
export function RunFill({ share }: { share: number }) {
  return (
    <span
      className="bg-signal/35 absolute inset-y-0 left-0 transition-[width] duration-300 ease-out"
      style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }}
      aria-hidden
    />
  );
}

/** The way the work flows: down the column on a phone, across the bench from a laptop up. */
export function FlowArrow({ className }: { className?: string }) {
  return (
    <>
      <FiArrowDown className={cn("size-4 shrink-0 lg:hidden", className)} aria-hidden />
      <FiArrowRight className={cn("hidden size-4 shrink-0 lg:block", className)} aria-hidden />
    </>
  );
}
