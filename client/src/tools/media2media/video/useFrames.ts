import { useCallback, useEffect, useRef } from "react";
import type { ThumbnailProvider } from "@/components/timeline";
import type { FramesRequest, FramesResponse } from "./frames.worker";

export type Frames = {
  /** For the timeline: tiles in clip mode, decoded in the worker. */
  thumbnails: ThumbnailProvider;
  /**
   * One frame at `ms`, contain-fitted to the box. The caller owns the bitmap
   * and closes it. Resolves null when aborted or undecodable.
   */
  frame: (ms: number, size: { width: number; height: number }, signal?: AbortSignal) => Promise<ImageBitmap | null>;
};

/**
 * The worker that pulls pictures out of `file`. One per file; every bitmap
 * handed to the timeline is kept here and closed when the file changes,
 * since the timeline never closes what it's given.
 */
export function useFrames(file: File | null): Frames {
  const worker = useRef<Worker | null>(null);
  const waiting = useRef(new Map<number, (b: ImageBitmap | null) => void>());
  const given = useRef<ImageBitmap[]>([]);

  useEffect(() => {
    if (!file) return;
    const w = new Worker(new URL("./frames.worker.ts", import.meta.url), { type: "module" });
    const pending = waiting.current;
    w.onmessage = (e: MessageEvent<FramesResponse>) => {
      const done = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (done) done(e.data.bitmap);
      else e.data.bitmap?.close();
    };
    w.postMessage({ type: "open", file } satisfies FramesRequest);
    worker.current = w;
    const owned = given.current;
    return () => {
      w.terminate();
      worker.current = null;
      for (const done of pending.values()) done(null);
      pending.clear();
      for (const b of owned) b.close();
      owned.length = 0;
    };
  }, [file]);

  const ask = useCallback(
    (ms: number, size: { width: number; height: number }, fit: "cover" | "contain", signal?: AbortSignal) =>
      new Promise<ImageBitmap | null>((resolve) => {
        const w = worker.current;
        if (!w || signal?.aborted) return resolve(null);
        const id = nextId++;
        const scale = Math.min(2, window.devicePixelRatio || 1);
        waiting.current.set(id, resolve);
        signal?.addEventListener(
          "abort",
          () => {
            if (!waiting.current.has(id)) return;
            // Late answers are closed by onmessage, which no longer finds a waiter.
            waiting.current.delete(id);
            w.postMessage({ type: "cancel", id } satisfies FramesRequest);
            resolve(null);
          },
          { once: true },
        );
        w.postMessage({
          type: "frame",
          id,
          ms,
          width: Math.max(2, Math.round(size.width * scale)),
          height: Math.max(2, Math.round(size.height * scale)),
          fit,
        } satisfies FramesRequest);
      }),
    [],
  );

  const thumbnails = useCallback<ThumbnailProvider>(
    async (req, size, signal) => {
      if (req.kind !== "time") return null;
      const bitmap = await ask(req.ms, size, "cover", signal);
      if (bitmap) given.current.push(bitmap);
      return bitmap;
    },
    // A new file must bring a new provider, so the timeline drops its cache.
    [ask, file],
  );

  const frame = useCallback<Frames["frame"]>((ms, size, signal) => ask(ms, size, "contain", signal), [ask]);

  return { thumbnails, frame };
}

let nextId = 1;
