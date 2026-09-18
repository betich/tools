import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { renderDoc, type Ctx2D, type MergeDoc, type MergeRow } from "@tools/shared";
import { paths } from "../env";
import { registerFontBuffer, registerGoogleFont } from "./fonts";

/**
 * Resolve every face the doc references. Google faces are fetched and cached;
 * uploaded faces are read back out of the asset store. A face that cannot be
 * resolved falls through to the canvas default rather than failing the render.
 */
export async function prepareFonts(doc: MergeDoc): Promise<string[]> {
  const missing: string[] = [];
  const faces = doc.layers.flatMap((layer) => [
    { family: layer.font.family, source: layer.font.source },
    ...(layer.font.fallbacks ?? []),
  ]);

  for (const face of faces) {
    if (face.source.kind === "google") {
      if (!(await registerGoogleFont(face.source.family, face.source.variant))) missing.push(face.family);
    } else if (face.source.kind === "upload") {
      try {
        const buf = await readFile(join(paths.assets, face.source.assetId));
        if (!registerFontBuffer(buf, face.family)) missing.push(face.family);
      } catch {
        missing.push(face.family);
      }
    }
  }
  return [...new Set(missing)];
}

/** `asset:<id>`, a data URL, or an absolute http(s) URL. */
export async function resolveImage(src: string): Promise<Image | null> {
  try {
    if (src.startsWith("asset:")) {
      const buf = await readFile(join(paths.assets, src.slice("asset:".length)));
      return await loadImage(buf);
    }
    if (src.startsWith("data:") || /^https?:\/\//.test(src)) return await loadImage(src);
    return null;
  } catch {
    return null;
  }
}

export type RenderedRow = { buffer: Buffer; width: number; height: number };

export async function renderRow(doc: MergeDoc, row: MergeRow | null, base: Image | null): Promise<RenderedRow> {
  const { width, height } = doc.canvas;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  renderDoc(ctx as unknown as Ctx2D, doc, { row, base });
  return { buffer: canvas.toBuffer("image/png"), width, height };
}
