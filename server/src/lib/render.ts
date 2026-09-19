import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { opaqueGround, renderDoc, type Ctx2D, type ExportFormat, type FallbackFont, type MergeDoc, type MergeRow } from "@tools/shared";
import { paths } from "../env";
import { DEFAULT_FAMILY, registerFontBuffer, registerGoogleFamily } from "./fonts";

/**
 * Resolve every face the doc references. Google families are fetched whole —
 * every weight and style — and cached, so whatever weight or italic a layer
 * asks for is there to match. Uploaded faces are read back out of the asset
 * store. A face that cannot be resolved falls through to the canvas default
 * rather than failing the render; its name is reported back.
 */
export async function prepareFonts(doc: MergeDoc): Promise<string[]> {
  const faces = new Map<string, FallbackFont>();
  faces.set(`google:${DEFAULT_FAMILY}`, { family: DEFAULT_FAMILY, source: { kind: "google", family: DEFAULT_FAMILY, variant: "400" } });
  for (const layer of doc.layers) {
    for (const face of [{ family: layer.font.family, source: layer.font.source }, ...(layer.font.fallbacks ?? [])]) {
      const key =
        face.source.kind === "google"
          ? `google:${face.source.family || face.family}`
          : face.source.kind === "upload"
            ? `upload:${face.family}:${face.source.assetId}`
            : `system:${face.family}`;
      faces.set(key, face);
    }
  }

  const missing = await Promise.all(
    [...faces.values()].map(async (face) => {
      if (face.source.kind === "google") return (await registerGoogleFamily(face.source.family || face.family)) ? null : face.family;
      if (face.source.kind === "upload") {
        try {
          const buf = await readFile(join(paths.assets, face.source.assetId));
          return registerFontBuffer(buf, face.family, face.source.assetId) ? null : face.family;
        } catch {
          return face.family;
        }
      }
      return null;
    }),
  );
  return [...new Set(missing.filter((m): m is string => m !== null))];
}

/**
 * `asset:<id>` or a data URL. Remote URLs are not fetched: the editor never
 * sends one, and fetching whatever a caller names would let them point this
 * box at its neighbours.
 */
export async function resolveImage(src: string): Promise<Image | null> {
  try {
    if (src.startsWith("asset:")) {
      const buf = await readFile(join(paths.assets, src.slice("asset:".length)));
      return await loadImage(buf);
    }
    if (src.startsWith("data:")) return await loadImage(src);
    return null;
  } catch {
    return null;
  }
}

export type RenderedRow = { buffer: Buffer; width: number; height: number };

/** A PDF page is a JPEG; the PDF itself is assembled by the caller. */
export type RasterFormat = Exclude<ExportFormat, "pdf">;

export async function renderRow(
  doc: MergeDoc,
  row: MergeRow | null,
  base: Image | null,
  { format = "png", quality = 92 }: { format?: RasterFormat; quality?: number } = {},
): Promise<RenderedRow> {
  const { width, height } = doc.canvas;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (format === "jpeg") {
    // JPEG has no alpha: lay the same ground the browser export does, or a transparent document goes black.
    ctx.fillStyle = opaqueGround(doc);
    ctx.fillRect(0, 0, width, height);
  }
  renderDoc(ctx as unknown as Ctx2D, doc, { row, base, skipClear: format === "jpeg" });
  // `encode` compresses off the main thread, so the API keeps answering mid-batch.
  const buffer = format === "png" ? await canvas.encode("png") : await canvas.encode(format, quality);
  return { buffer, width, height };
}
