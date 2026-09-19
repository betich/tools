import { useLayoutEffect, useState } from "react";

/**
 * An object URL for a blob, alive exactly as long as the blob is shown.
 *
 * Created and revoked in the same effect, so StrictMode's mount → unmount →
 * mount leaves a live URL rather than one revoked by the first cleanup. Until
 * the effect has run for the current blob (the first render after a change)
 * it returns null instead of the previous blob's URL; a layout effect, so
 * that render is never painted.
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [made, setMade] = useState<{ blob: Blob; url: string } | null>(null);

  useLayoutEffect(() => {
    if (!blob) {
      setMade(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setMade({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return blob && made?.blob === blob ? made.url : null;
}
