import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FrameHook } from "../frameHook";
import type { Capabilities } from "../probe";
import type { VideoEdit } from "../settings";
import { createKeyer, webglAvailable, type Keyer } from "./keyer";
import { keyBlocker, toHex, type Rgb } from "./settings";

/**
 * The tab's side of the key: the live hook (one GL context for the life of
 * the editor, a new hook whenever the settings change so the preview
 * repaints) and the eyedropper's on/off.
 */
export function useKey(edit: VideoEdit, commit: (next: (prev: VideoEdit) => VideoEdit) => void) {
  const [picking, setPicking] = useState(false);
  const keyer = useRef<Keyer | null>(null);
  useEffect(() => () => keyer.current?.dispose(), []);

  const on = edit.output === "video" && edit.key.enabled;
  const frameHook = useMemo<FrameHook | null>(() => {
    if (!on || !webglAvailable()) return null;
    keyer.current ??= createKeyer();
    return keyer.current.hookFor(edit.key);
  }, [on, edit.key]);

  useEffect(() => {
    if (!on) setPicking(false);
  }, [on]);

  const pick = useCallback(
    (rgb: Rgb) => {
      commit((prev) => ({ ...prev, key: { ...prev.key, color: toHex(rgb) } }));
      setPicking(false);
    },
    [commit],
  );

  return { frameHook, picking, setPicking, onPick: picking ? pick : null };
}

/** The key's reason the export can't go, from what the probe found. */
export function keyExportBlocker(edit: VideoEdit, caps: Capabilities | null): string | null {
  return keyBlocker(edit, {
    vp9: caps ? caps.codecs.vp9 : null,
    webgl: webglAvailable(),
    videoFrame: typeof VideoFrame !== "undefined",
  });
}
