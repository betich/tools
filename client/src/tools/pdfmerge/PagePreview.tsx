import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { pageLayout, PAPER_SIZES, usableDpi, type PageLayout } from "@tools/shared";
import { url } from "@/lib/api";
import { cn } from "@/lib/cn";
import { bytes, pad } from "@/lib/format";
import type { MergeEntry } from "./useMergeFiles";

/** Breathing room around the page inside the stage, in CSS pixels. */
const GUTTER = 24;

/**
 * The selected input as it will come out. An image is drawn from its own
 * pixels by `pageLayout`, the function the worker places it with, so what is
 * shown here is what the PDF holds. A PDF shows the server's render of its
 * first page, or says what it is when there is none yet.
 */
export function PagePreview({ entry, index, count }: { entry: MergeEntry | null; index: number; count: number }) {
  const source = entry?.source;
  const options = entry?.layout;
  // Memoised on the source and options alone, so upload progress elsewhere never redraws the page.
  const layout = useMemo(
    () =>
      source?.state === "image" && options
        ? pageLayout({ width: source.bitmap.width, height: source.bitmap.height, dpi: source.dpi }, options)
        : null,
    [source, options],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="border-wash checkers relative flex h-[54vh] max-h-[640px] min-h-72 items-center justify-center overflow-hidden rounded-sm border">
        {!entry ? (
          <Tile lines={["no file chosen"]} />
        ) : layout && entry.source.state === "image" ? (
          <PageCanvas bitmap={entry.source.bitmap} layout={layout} />
        ) : entry.kind === "pdf" ? (
          <PdfThumb entry={entry} />
        ) : entry.source.state === "reading" ? (
          <Tile lines={["reading…"]} />
        ) : (
          <Tile
            lines={[`${entry.kind} · ${bytes(entry.file.size)}`]}
            prose="This browser cannot draw this format, so there is no preview. The server reads it, and lays it out with the settings on the left."
          />
        )}
      </div>

      <p className="text-meta flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono text-meta uppercase tabular-nums">
        <span>{entry ? `page ${pad(index + 1)} / ${pad(count)}` : "preview"}</span>
        <span>{entry ? caption(entry, layout) : null}</span>
      </p>
    </div>
  );
}

function caption(entry: MergeEntry, layout: PageLayout | null): string {
  if (entry.kind === "pdf") return "pages kept as they are";
  const { mode, paper } = entry.layout;
  const where = mode === "image" ? "image size" : `${PAPER_SIZES[paper].label} ${entry.layout.fit}`;
  if (!layout) return where;
  const mm = (pt: number) => Math.round((pt / 72) * 25.4);
  let dpi = "";
  if (entry.source.state === "image" && mode === "image") {
    const read = entry.source.dpi;
    const used = usableDpi(read);
    const x = Math.round(used.x);
    const y = Math.round(used.y);
    dpi = ` · ${x === y ? x : `${x}×${y}`} dpi${read && used !== read ? " (file's ignored)" : read ? "" : " (none in file)"}`;
  }
  return `${where}${dpi} · ${mm(layout.width)} × ${mm(layout.height)} mm`;
}

/** The page at the stage's size: white sheet, then the image through its clip. */
function PageCanvas({ bitmap, layout }: { bitmap: ImageBitmap; layout: PageLayout }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = size.w && size.h ? Math.min((size.w - GUTTER * 2) / layout.width, (size.h - GUTTER * 2) / layout.height) : 0;
  const cssW = Math.max(1, Math.floor(layout.width * scale));
  const cssH = Math.max(1, Math.floor(layout.height * scale));

  useEffect(() => {
    const c = canvas.current;
    if (!c || !scale) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const k = c.width / layout.width;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, layout.width, layout.height);
    ctx.save();
    if (layout.clip) {
      ctx.beginPath();
      ctx.rect(layout.clip.x, layout.clip.y, layout.clip.width, layout.clip.height);
      ctx.clip();
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, layout.image.x, layout.image.y, layout.image.width, layout.image.height);
    ctx.restore();
  }, [bitmap, layout, scale, cssW, cssH]);

  return (
    <div ref={box} className="absolute inset-0 flex items-center justify-center">
      {scale > 0 ? <canvas ref={canvas} style={{ width: cssW, height: cssH }} aria-label="page preview" role="img" /> : null}
    </div>
  );
}

/** The server's first-page render, when it has one; a plain tile otherwise. A 404 is expected, never an error. */
function PdfThumb({ entry }: { entry: MergeEntry }) {
  const id = entry.upload.phase === "done" ? entry.upload.result.id : null;
  const [failed, setFailed] = useState<string | null>(null);
  const label = `pdf · ${bytes(entry.file.size)}`;

  if (!id) return <Tile lines={[label, entry.upload.phase === "failed" ? "not uploaded" : "preview after upload"]} />;
  if (failed === id) return <Tile lines={[label, "pages kept as they are"]} />;

  return (
    <img
      key={id}
      src={url(`/api/pdf/uploads/${id}/thumbnail.png`)}
      alt={`first page of ${entry.file.name}`}
      onError={() => setFailed(id)}
      className="max-h-[calc(100%-48px)] max-w-[calc(100%-48px)] bg-white object-contain"
    />
  );
}

function Tile({ lines, prose }: { lines: string[]; prose?: string }) {
  return (
    <div className="flex max-w-[46ch] flex-col items-center gap-2 px-6 text-center">
      {lines.map((l, i) => (
        <p key={i} className={cn("font-mono text-meta uppercase tabular-nums", i === 0 ? "text-label" : "text-meta")}>
          {l}
        </p>
      ))}
      {prose ? <p className="text-prose font-sans text-body normal-case">{prose}</p> : null}
    </div>
  );
}
