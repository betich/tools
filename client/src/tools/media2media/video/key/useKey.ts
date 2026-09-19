import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FrameHook } from "../frameHook";
import type { Capabilities } from "../probe";
import type { VideoEdit } from "../settings";
import { probeAlpha } from "./alphaProbe";
import { createKeyer, webglAvailable, type Keyer } from "./keyer";
import { keyBlocker, toHex, type Rgb } from "./settings";

/**
 * The tab's side of the key: the live hook (one GL context for the life of
 * the editor, a new hook whenever the settings change so the preview
 * repaints), the eyedropper's on/off, and the alpha probe — asked the first
 * time the key is switched on, null until it answers.
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

  const [alpha, setAlpha] = useState<boolean | null>(null);
  useEffect(() => {
    if (!on || alpha !== null) return;
    let live = true;
    void probeAlpha().then((ok) => live && setAlpha(ok));
    return () => {
      live = false;
    };
  }, [on, alpha]);

  const pick = useCallback(
    (rgb: Rgb) => {
      commit((prev) => ({ ...prev, key: { ...prev.key, color: toHex(rgb) } }));
      setPicking(false);
    },
    [commit],
  );

  return { frameHook, picking, setPicking, onPick: picking ? pick : null, alpha };
}

/** The key's reason the export can't go, from what the probes found. */
export function keyExportBlocker(edit: VideoEdit, caps: Capabilities | null, alpha: boolean | null): string | null {
  return keyBlocker(edit, {
    vp9: caps ? caps.codecs.vp9 : null,
    webgl: webglAvailable(),
    alpha,
  });
}
