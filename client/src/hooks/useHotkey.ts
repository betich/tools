import { useEffect } from "react";

type Options = { enabled?: boolean; allowInInput?: boolean };

/**
 * Bind a key without stealing it from whatever the user is typing into.
 * `key` is matched case-insensitively; prefix with `mod+` for ctrl/cmd.
 */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void, options: Options = {}): void {
  const { enabled = true, allowInInput = false } = options;

  useEffect(() => {
    if (!enabled) return;
    const wantsMod = key.startsWith("mod+");
    const bare = wantsMod ? key.slice(4) : key;

    const onKey = (e: KeyboardEvent) => {
      if (!allowInInput) {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (wantsMod !== mod) return;
      if (e.key.toLowerCase() !== bare.toLowerCase()) return;
      handler(e);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, handler, enabled, allowInInput]);
}
