import { useCallback, useEffect, useRef } from "react";
import { CodecPool } from "@/lib/codecs";

/**
 * A codec pool for one component, started on first use (the workers and
 * their WASM load only when something is decoded or encoded) and disposed on
 * unmount. Returns a stable getter.
 *
 * Declare it after any effect whose cleanup should run first (aborting the
 * component's own jobs, say): unmount cleanups run in declaration order.
 */
export function useCodecPool(size?: number): () => CodecPool {
  const pool = useRef<CodecPool | null>(null);
  useEffect(
    () => () => {
      pool.current?.dispose();
      pool.current = null;
    },
    [],
  );
  return useCallback(() => (pool.current ??= new CodecPool(size)), [size]);
}
