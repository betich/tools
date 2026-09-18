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

/** Render one row to a PNG blob, entirely in the browser. */
export function renderToBlob(doc: MergeDoc, row: MergeRow | null, base: HTMLImageElement | null): Promise<Blob> {
  const canvas = document.createElement("canvas");
  paint(canvas, doc, row, base);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas export failed"))), "image/png");
  });
}
