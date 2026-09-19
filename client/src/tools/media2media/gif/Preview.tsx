import { useEffect, useMemo, useRef } from "react";
import { frameAt, frameStarts } from "@/components/timeline/model";
import { cn } from "@/lib/cn";
import { paintFrame } from "./compose";
import type { FrameStore } from "./frames";
import { canvasSize, playList, type GifDoc } from "./model";

/**
 * The animation at its real timing, straight from the decoded frames — no
 * encoding, so a changed delay, fit or background shows on the next paint.
 * It draws through `paintFrame`, the same code the export uses. `time` is
 * in played time (ping-pong included).
 */
export function Preview({ doc, store, time, className }: { doc: GifDoc; store: FrameStore; time: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = canvasSize(doc);
  const list = useMemo(() => playList(doc), [doc]);
  const starts = useMemo(() => frameStarts(list), [list]);
  const frame = list[frameAt(starts, time)];

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || size.width === 0) return;
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    paintFrame(ctx, frame ? store.get(frame.id) : undefined, size, doc);
    // `doc` covers fit and background; size is derived from it.
  }, [frame, doc, store, size.width, size.height]);

  return (
    <div
      className={cn(
        "border-wash flex items-center justify-center overflow-hidden rounded-card border p-4 sm:p-6",
        "min-h-[240px]",
        className,
      )}
    >
      <canvas
        ref={ref}
        role="img"
        aria-label={frame ? `preview, ${frame.name}` : "preview"}
        className={cn("block max-h-[56vh] max-w-full", doc.background ? null : "checkers")}
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
      />
    </div>
  );
}
