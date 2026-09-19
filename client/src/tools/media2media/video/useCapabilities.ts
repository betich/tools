import { useEffect, useState } from "react";
import { browserEnv, probe, type Capabilities, type ProbeEnv } from "./probe";

let env: Promise<ProbeEnv> | null = null;

/** If Mediabunny itself fails to load, nothing can be encoded — say so rather than hang. */
const NOTHING: ProbeEnv = {
  hasVideoEncoder: false,
  hasAudioEncoder: false,
  hasVideoDecoder: false,
  hasSavePicker: false,
  canEncodeVideo: async () => false,
  canEncodeAudio: async () => false,
};

/**
 * The probe, re-asked when the output size changes (hardware encoders take
 * some sizes and refuse others). Null until the first answer. Mediabunny
 * memoises each encoder question, so asking again is cheap.
 */
export function useCapabilities(size: { width: number; height: number } | null): Capabilities | null {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const w = size?.width ?? 0;
  const h = size?.height ?? 0;

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(
      () => {
        env ??= browserEnv();
        env
          .then((e) => probe(e, w && h ? { width: w, height: h } : null))
          .then((c) => {
            if (live) setCaps(c);
          })
          .catch(() => probe(NOTHING, null).then((c) => live && setCaps(c)));
      },
      caps ? 250 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // Re-ask only when the size does; `caps` just picks the debounce.
  }, [w, h]);

  return caps;
}
