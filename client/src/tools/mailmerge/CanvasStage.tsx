import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { MergeDoc, MergeRow, TextLayer } from "@tools/shared";
import { cn } from "@/lib/cn";
import { ensureDocFonts, useFontEpoch } from "./fonts";
import { paint } from "./render";

type Guides = { x: boolean; y: boolean };

const SNAP_PX = 6;

/**
 * The stage. One canvas painted by the shared renderer — exactly the code the
 * server runs — with a thin interaction overlay on top of it. The overlay only
 * ever moves and resizes boxes; nothing about the pixels lives here.
 */
export function CanvasStage({
  doc,
  row,
  base,
  selectedId,
  onSelect,
  onPreview,
  onSnapshot,
  mode,
  own = false,
}: {
  /** The design-mode switch, set in the caption line beside the readout. */
  mode?: ReactNode;
  /** One row's own layout is being edited: the frame says so. */
  own?: boolean;
  doc: MergeDoc;
  row: MergeRow | null;
  base: HTMLImageElement | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPreview: (id: string, patch: Partial<TextLayer>) => void;
  onSnapshot: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const [guides, setGuides] = useState<Guides>({ x: false, y: false });

  // Fit the document into whatever room the stage area has — measured on the
  // box the artwork actually gets, never the one the readout shares.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width === 0) return;
      setScale(Math.min(width / doc.canvas.width, height / doc.canvas.height, 2));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [doc.canvas.width, doc.canvas.height]);

  // Paint now, then again whenever a font file lands: canvas never waits for
  // a face, so the first paint of new text can be in the fallback.
  const fontEpoch = useFontEpoch();
  useEffect(() => {
    if (canvas.current) paint(canvas.current, doc, row, base);
  }, [doc, row, base, fontEpoch]);

  // Ask for the faces this row needs by name — a Thai subset the page has not
  // used yet is only fetched when something requests it. The epoch above does
  // the repaint once it arrives.
  useEffect(() => {
    void ensureDocFonts(doc, [row]);
  }, [doc, row]);

  const drag = useRef<{ id: string; mode: "move" | "resize"; startX: number; startY: number; layer: TextLayer } | null>(
    null,
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent, layer: TextLayer, mode: "move" | "resize") => {
      if (layer.locked) return;
      event.stopPropagation();
      event.preventDefault();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      onSelect(layer.id);
      onSnapshot();
      drag.current = { id: layer.id, mode, startX: event.clientX, startY: event.clientY, layer };
    },
    [onSelect, onSnapshot],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      const dx = (event.clientX - state.startX) / scale;
      const dy = (event.clientY - state.startY) / scale;

      if (state.mode === "resize") {
        onPreview(state.id, {
          width: Math.max(24, Math.round(state.layer.width + dx)),
          height: Math.max(24, Math.round(state.layer.height + dy)),
        });
        return;
      }

      let x = Math.round(state.layer.x + dx);
      let y = Math.round(state.layer.y + dy);
      const tolerance = SNAP_PX / scale;

      const centeredX = Math.round((doc.canvas.width - state.layer.width) / 2);
      const centeredY = Math.round((doc.canvas.height - state.layer.height) / 2);
      const snapX = Math.abs(x - centeredX) < tolerance;
      const snapY = Math.abs(y - centeredY) < tolerance;
      if (snapX) x = centeredX;
      if (snapY) y = centeredY;

      setGuides({ x: snapX, y: snapY });
      onPreview(state.id, { x, y });
    },
    [doc.canvas.height, doc.canvas.width, onPreview, scale],
  );

  const endDrag = useCallback(() => {
    drag.current = null;
    setGuides({ x: false, y: false });
  }, []);

  const w = doc.canvas.width * scale;
  const h = doc.canvas.height * scale;

  return (
    // Pinned above the panes on a phone, so it is short there and generous
    // once there is a column of its own.
    <div className="flex h-[min(38vh,300px)] flex-col gap-2 md:h-[min(54vh,540px)] lg:h-full lg:min-h-0">
      <div ref={wrap} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div
          className={cn(
            "checkers relative rounded-sm border transition-colors duration-200",
            // The frame itself turns periwinkle — the stage clips anything drawn outside it.
            own ? "border-indigo" : "border-hairline",
          )}
          style={{ width: w, height: h }}
          onPointerDown={() => onSelect(null)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <canvas ref={canvas} className="absolute inset-0 h-full w-full" style={{ width: w, height: h }} />

          {guides.x ? (
            <div className="bg-indigo pointer-events-none absolute inset-y-0 left-1/2 w-px opacity-60" />
          ) : null}
          {guides.y ? (
            <div className="bg-indigo pointer-events-none absolute inset-x-0 top-1/2 h-px opacity-60" />
          ) : null}

          {doc.layers.map((layer) =>
            layer.visible ? (
              <div
                key={layer.id}
                role="button"
                tabIndex={0}
                aria-label={layer.name}
                onPointerDown={(e) => onPointerDown(e, layer, "move")}
                className={cn(
                  "absolute border transition-colors duration-150",
                  layer.locked ? "cursor-not-allowed" : "cursor-move",
                  layer.id === selectedId ? "border-indigo" : "hover:border-wash border-transparent",
                )}
                style={{
                  left: layer.x * scale,
                  top: layer.y * scale,
                  width: layer.width * scale,
                  height: layer.height * scale,
                  transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
                }}
              >
                {layer.id === selectedId && !layer.locked ? (
                  <span
                    onPointerDown={(e) => onPointerDown(e, layer, "resize")}
                    className="border-indigo bg-indigo absolute -bottom-1 -right-1 size-2.5 cursor-se-resize rounded-[1px] border [@media(pointer:coarse)]:-bottom-2 [@media(pointer:coarse)]:-right-2 [@media(pointer:coarse)]:size-4"
                    aria-hidden
                  />
                ) : null}
              </div>
            ) : null,
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3">
        {mode}
        <span className="text-meta text-micro font-mono uppercase tabular-nums">
          {doc.canvas.width}×{doc.canvas.height} · {Math.round(scale * 100)}%
        </span>
      </div>
    </div>
  );
}
