import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** The one class-joining helper. Every component takes `className` and ends with it. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
