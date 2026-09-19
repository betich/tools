import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { FrameHook } from "./frameHook";
import { sampleColor } from "./key/pick";
import type { Rgb } from "./key/settings";
import { moveCrop, resizeCrop, rotatedSize, type Corner, type Rect, type SourceInfo, type VideoEdit } from "./settings";

/** The stage never takes more than this share of the viewport's height. */
const MAX_VH = 0.56;

/**
 * The picture, as the export will frame it: rotated, with what the crop
 * leaves out covered by the ground at 70% (the same cover the timeline puts
 * over what the trim leaves out). The crop box is dragged to move and by
 * its corners to resize; each drag is one undo step.
 *
 * It draws from the page's <video> while the browser can play the file, and
 * from `still` (a frame decoded in the worker) when it can't. Either way the
 * cropped region passes through `frameHook` first, so a keyed or otherwise
 * processed preview comes from the same function as the export.
 */
export function Preview({
  source,
  edit,
  src,
  time,
  still,
  onVideo,
  onUnplayable,
  frameHook,
  cropAspect,
  onCrop,
  onGestureStart,
  onPick,
}: {
  source: SourceInfo;
  edit: VideoEdit;
  /** Object URL of the file, for the <video>. */
  src: string;
  /** Playhead, ms — repaints when it moves. */
  time: number;
  still: ImageBitmap | null;
  onVideo: (video: HTMLVideoElement | null) => void;
  /** The browser can't play this file (no <video> support for the container or codec). */
  onUnplayable: () => void;
  frameHook?: FrameHook | null;
  cropAspect: number | null;
  onCrop: (crop: Rect, kind: "commit" | "preview") => void;
  onGestureStart: () => void;
  /** Eyedropper on: a click reads the source colour there (before any hook). */
  onPick?: ((rgb: Rgb) => void) | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);

  const frame = rotatedSize(source, edit.rotate);
  const scale =
    frame.width > 0 && boxWidth > 0
      ? Math.min(boxWidth / frame.width, (window.innerHeight * MAX_VH) / frame.height)
      : 0;
  const cssW = Math.round(frame.width * scale);
  const cssH = Math.round(frame.height * scale);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setBoxWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Painting. The hook may be async; while it works, newer paints wait and
  // only the latest one runs after it.
  const busy = useRef(false);
  const again = useRef(false);
  const latest = useRef({ edit, still, frameHook, scale, time });
  latest.current = { edit, still, frameHook, scale, time };

  const paint = useCallback(async () => {
    const c = canvas.current;
    if (!c) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    const { edit: e, still: s, frameHook: hook, scale: k, time: t } = latest.current;
    const v = video.current;
    const img: CanvasImageSource | null = s ?? (v && v.readyState >= 2 && v.videoWidth > 0 ? v : null);
    const ctx = c.getContext("2d");
    if (!ctx || k <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rotatedSize(source, e.rotate).width * k * dpr));
    const h = Math.max(1, Math.round(rotatedSize(source, e.rotate).height * k * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    if (!img) return;

    // The source, rotated into the output's orientation.
    const px = k * dpr;
    const sw = source.width * px;
    const sh = source.height * px;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((e.rotate * Math.PI) / 180);
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();

    if (!hook) return;
    const region = e.crop
      ? { x: e.crop.left * px, y: e.crop.top * px, w: e.crop.width * px, h: e.crop.height * px }
      : { x: 0, y: 0, w, h };
    const work = workCanvas(Math.max(1, Math.round(region.w)), Math.max(1, Math.round(region.h)));
    const wctx = work.getContext("2d");
    if (!wctx) return;
    wctx.clearRect(0, 0, work.width, work.height);
    wctx.drawImage(c, region.x, region.y, region.w, region.h, 0, 0, work.width, work.height);
    busy.current = true;
    try {
      const out = await hook(work, { width: work.width, height: work.height, time: t / 1000, purpose: "preview" });
      ctx.clearRect(region.x, region.y, region.w, region.h);
      if (out) ctx.drawImage(out, region.x, region.y, region.w, region.h);
    } catch {
      // A hook that throws leaves the plain frame; the export will say what went wrong.
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void paint();
      }
    }
  }, [source]);

  useEffect(() => {
    void paint();
  }, [paint, time, still, edit.rotate, edit.crop, frameHook, scale]);

  const setVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      video.current = el;
      onVideo(el);
    },
    [onVideo],
  );

  return (
    <div ref={box} className="flex w-full justify-center">
      <div
        className={cn(
          "border-hairline-faint relative overflow-hidden rounded-sm border",
          source.hasVideo ? "checkers" : "bg-surface",
        )}
        style={{ width: cssW || "100%", height: cssH || undefined, aspectRatio: cssW ? undefined : "16 / 9" }}
      >
        {/* Decodes and plays; the canvas shows it. Kept in the box (not display:none) so every engine keeps painting it. */}
        <video
          ref={setVideo}
          src={src}
          preload="auto"
          playsInline
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none absolute inset-0 size-full opacity-0"
          onLoadedData={() => void paint()}
          onSeeked={() => void paint()}
          onLoadedMetadata={(e) => {
            // Audio plays but the picture doesn't: HEVC in some browsers, say.
            if (source.hasVideo && e.currentTarget.videoWidth === 0) onUnplayable();
          }}
          onError={onUnplayable}
        />
        <canvas ref={canvas} className="absolute inset-0 size-full" aria-label="preview" />
        {source.hasVideo ? null : (
          <p className="text-meta text-meta absolute inset-0 flex items-center justify-center font-mono uppercase">
            sound only
          </p>
        )}
        {edit.crop && scale > 0 ? (
          <CropBox
            crop={edit.crop}
            scale={scale}
            frame={frame}
            ratio={cropAspect}
            onCrop={onCrop}
            onGestureStart={onGestureStart}
          />
        ) : null}
        {onPick && source.hasVideo ? (
          <button
            type="button"
            aria-label="pick the key colour — click the backdrop"
            className="absolute inset-0 cursor-crosshair"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const v = video.current;
              const img = still ?? (v && v.readyState >= 2 && v.videoWidth > 0 ? v : null);
              if (!img || r.width <= 0 || r.height <= 0) return;
              const rgb = sampleColor(
                img,
                source,
                edit.rotate,
                (e.clientX - r.left) / r.width,
                (e.clientY - r.top) / r.height,
              );
              if (rgb) onPick(rgb);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

let shared: HTMLCanvasElement | null = null;
/** One scratch canvas for the hook's input; the hook sees a fresh draw each call. */
function workCanvas(width: number, height: number): HTMLCanvasElement {
  shared ??= document.createElement("canvas");
  if (shared.width !== width) shared.width = width;
  if (shared.height !== height) shared.height = height;
  return shared;
}

const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

function CropBox({
  crop,
  scale,
  frame,
  ratio,
  onCrop,
  onGestureStart,
}: {
  crop: Rect;
  scale: number;
  frame: { width: number; height: number };
  ratio: number | null;
  onCrop: (crop: Rect, kind: "commit" | "preview") => void;
  onGestureStart: () => void;
}) {
  const drag = useRef<{ id: number; mode: Corner | "move"; x: number; y: number; start: Rect } | null>(null);
  const x = crop.left * scale;
  const y = crop.top * scale;
  const w = crop.width * scale;
  const h = crop.height * scale;
  const W = frame.width * scale;
  const H = frame.height * scale;

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    onCrop(moveCrop(crop, d[0]! / scale, d[1]! / scale, frame), "commit");
  };

  return (
    <div
      className="absolute inset-0 touch-none select-none"
      onPointerDown={(e) => {
        const target = e.target as HTMLElement;
        const mode =
          (target.closest<HTMLElement>("[data-corner]")?.dataset.corner as Corner | undefined) ??
          (target.closest("[data-crop]") ? "move" : null);
        if (!mode || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        onGestureStart();
        drag.current = { id: e.pointerId, mode, x: e.clientX, y: e.clientY, start: crop };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = (e.clientX - d.x) / scale;
        const dy = (e.clientY - d.y) / scale;
        onCrop(
          d.mode === "move" ? moveCrop(d.start, dx, dy, frame) : resizeCrop(d.start, d.mode, dx, dy, frame, ratio),
          "preview",
        );
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
        <path d={`M0 0H${W}V${H}H0Z M${x} ${y}V${y + h}H${x + w}V${y}Z`} fillRule="evenodd" className="fill-paper/70" />
      </svg>
      <div
        data-crop
        role="group"
        aria-label="crop — drag to move, corners to resize, arrow keys to nudge"
        tabIndex={0}
        onKeyDown={onKey}
        className="border-indigo focus-visible:outline-indigo absolute cursor-move border focus-visible:outline-1"
        style={{ left: x, top: y, width: w, height: h }}
      >
        {CORNERS.map((c) => (
          <span
            key={c}
            data-corner={c}
            className={cn(
              "bg-indigo absolute size-2.5 [@media(pointer:coarse)]:size-4",
              c === "nw" && "-left-1 -top-1 cursor-nwse-resize",
              c === "ne" && "-right-1 -top-1 cursor-nesw-resize",
              c === "sw" && "-bottom-1 -left-1 cursor-nesw-resize",
              c === "se" && "-bottom-1 -right-1 cursor-nwse-resize",
            )}
          />
        ))}
      </div>
    </div>
  );
}
