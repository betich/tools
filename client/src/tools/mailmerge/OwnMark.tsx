import { cn } from "@/lib/cn";

/**
 * The mark of a row with a layout of its own — Figma's instance diamond, drawn
 * at hairline weight. Hollow means "differs from the main design"; it is the
 * same periwinkle as a changed field in the row editor.
 */
export function OwnMark({ className, title = "has its own layout" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 10 10" className={cn("text-indigo size-2.5 shrink-0", className)} role="img" aria-label={title}>
      <path d="M5 1 9 5 5 9 1 5Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
