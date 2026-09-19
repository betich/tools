import { memo, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** What a thumbnail is asked for: a frame by id (frames mode) or a moment of the clip (clip mode). */
export type ThumbRequest = { kind: "frame"; id: string; index: number } | { kind: "time"; ms: number };

/** A picture the timeline can draw: an object/data URL, or a bitmap straight from a worker. */
export type ThumbSource = string | ImageBitmap;

/**
 * Supplies thumbnails. The timeline never decodes anything: it asks only for
 * tiles on screen, once each, and aborts a request whose tile scrolls away
 * before it lands. The provider is expected to do its work off the main
 * thread (a worker, `createImageBitmap`, a video seeked in a worker) and
 * owns the lifetime of what it returns — the timeline never revokes a URL or
 * closes a bitmap. Resolve `null` for "no picture"; the tile stays blank.
 */
export type ThumbnailProvider = (
  request: ThumbRequest,
  size: { width: number; height: number },
  signal: AbortSignal,
) => Promise<ThumbSource | null>;

/** Per-timeline memory of thumbnails already fetched, keyed by frame id or quantised time. */
export class ThumbCache {
  private map = new Map<string, ThumbSource | null>();
  constructor(private readonly limit = 800) {}

  get(key: string): ThumbSource | null | undefined {
    return this.map.get(key);
  }

  put(key: string, value: ThumbSource | null): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

export function thumbKey(req: ThumbRequest): string {
  return req.kind === "frame" ? `f:${req.id}` : `t:${Math.round(req.ms)}`;
}

/** Wait this long before asking, so tiles that fly past during a fast scroll never ask at all. */
const SETTLE_MS = 80;

/**
 * One thumbnail. Fills its box; blank (the tile's own fill shows) until the
 * picture arrives.
 */
export const Thumb = memo(function Thumb({
  request,
  cache,
  provider,
  width,
  height,
  className,
}: {
  request: ThumbRequest;
  cache: ThumbCache;
  provider: ThumbnailProvider;
  width: number;
  height: number;
  className?: string;
}) {
  const key = thumbKey(request);
  const [source, setSource] = useState<ThumbSource | null | undefined>(() => cache.get(key));
  // The request object is rebuilt by the parent on every render; only its key matters.
  const reqRef = useRef(request);
  reqRef.current = request;

  useEffect(() => {
    const hit = cache.get(key);
    if (hit !== undefined) {
      setSource(hit);
      return;
    }
    setSource(undefined);
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      provider(reqRef.current, { width, height }, ctrl.signal).then(
        (src) => {
          if (ctrl.signal.aborted) return;
          cache.put(key, src);
          setSource(src);
        },
        () => {
          // A failed thumbnail is a blank tile, not an error the user must read.
        },
      );
    }, SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
    // Size is fixed per timeline; a new provider arrives with a new cache.
  }, [key, cache, provider]);

  if (source == null) return null;
  if (typeof source === "string") {
    return (
      <img
        src={source}
        alt=""
        draggable={false}
        className={cn("pointer-events-none size-full select-none object-cover", className)}
      />
    );
  }
  return <BitmapCanvas bitmap={source} className={className} />;
});

function BitmapCanvas({ bitmap, className }: { bitmap: ImageBitmap; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    c.width = bitmap.width;
    c.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return <canvas ref={ref} className={cn("pointer-events-none size-full object-cover", className)} />;
}
