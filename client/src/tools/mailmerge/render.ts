import { renderDoc, type Ctx2D, type MergeDoc, type MergeRow } from "@tools/shared";

/** Draw the doc onto a canvas at 1:1 document pixels. */
export function paint(canvas: HTMLCanvasElement, doc: MergeDoc, row: MergeRow | null, base: HTMLImageElement | null): void {
  const { width, height } = doc.canvas;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  renderDoc(ctx as unknown as Ctx2D, doc, { row, base });
}

export type ExportFormat = "png" | "jpeg";

export type ExportOptions = {
  format?: ExportFormat;
  /** JPEG only, 0–1. */
  quality?: number;
  /** Longest edge of the output in pixels; omitted renders at document size. */
  maxEdge?: number;
};

export const extensionFor = (format: ExportFormat) => (format === "jpeg" ? "jpg" : "png");

/**
 * Render one row in the browser. Layout is always computed at document pixels
 * — auto-fitted type only lands where the export does if the box it was fitted
 * to is the real one — so a smaller output is a downscale of the full render,
 * never a smaller document.
 */
export function renderToBlob(
  doc: MergeDoc,
  row: MergeRow | null,
  base: HTMLImageElement | null,
  { format = "png", quality = 0.92, maxEdge }: ExportOptions = {},
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  paint(canvas, doc, row, base);

  // JPEG has no alpha: a transparent document would flatten to black.
  const ground = format === "jpeg" ? doc.canvas.background || "#FFFFFF" : undefined;
  const out = maxEdge || ground ? resample(canvas, maxEdge ?? Math.max(canvas.width, canvas.height), ground) : canvas;

  return new Promise((resolve, reject) => {
    out.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas export failed"))),
      `image/${format}`,
      format === "jpeg" ? quality : undefined,
    );
  });
}

/** A cheap preview of a row as a data URL — small enough to hold a gridful. */
export function renderThumbnail(
  doc: MergeDoc,
  row: MergeRow | null,
  base: HTMLImageElement | null,
  maxEdge = 340,
): string {
  const canvas = document.createElement("canvas");
  paint(canvas, doc, row, base);
  return resample(canvas, maxEdge, doc.canvas.background || "#FFFFFF").toDataURL("image/jpeg", 0.7);
}

function resample(source: HTMLCanvasElement, maxEdge: number, ground?: string): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(source.width * scale));
  out.height = Math.max(1, Math.round(source.height * scale));

  const ctx = out.getContext("2d");
  if (!ctx) return source;
  if (ground) {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}
