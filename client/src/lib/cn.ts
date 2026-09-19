import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The theme's type ramp, so the merge knows `text-micro` is a size and
 * `text-meta` a colour — left to guess, it files every unknown `text-*` as a
 * colour and a later `text-ink` quietly deletes the size.
 */
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["hero", "display", "headline", "title", "body", "small", "micro"] } },
});

/** The one class-joining helper. Every component takes `className` and ends with it. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
