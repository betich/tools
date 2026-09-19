import type { ThumbnailProvider } from "@/components/timeline";
import { DEFAULT_DELAY, type GifFrame } from "./model";

/**
 * A frame from any source, on its way into the doc: a folder of renders,
 * the spin generator, frames sent over from the video tab. The bitmap keeps
 * its alpha and becomes the store's to close.
 */
export type IncomingFrame = {
  image: ImageBitmap;
  /** For the reader — a filename, `spin 12°`. */
  name: string;
  /** Milliseconds. Left out, the frame gets `DEFAULT_DELAY`. */
  delay?: number;
};

let nextId = 1;

/**
 * The pixels behind a doc's frames, kept out of the doc so undo history
 * holds ids, not images. A frame deleted from the doc keeps its bitmap here
 * — undo may bring it back — until the doc is cleared or replaced.
 */
export class FrameStore {
  private bitmaps = new Map<string, ImageBitmap>();
  private thumbs = new Map<string, Promise<ImageBitmap | null>>();

  /** Takes the bitmaps and hands back doc frames naming them. */
  admit(incoming: readonly IncomingFrame[]): GifFrame[] {
    return incoming.map(({ image, name, delay }) => {
      const id = `g${nextId++}`;
      this.bitmaps.set(id, image);
      return { id, name, delay: delay ?? DEFAULT_DELAY, width: image.width, height: image.height };
    });
  }

  get(id: string): ImageBitmap | undefined {
    return this.bitmaps.get(id);
  }

  /** Closes every bitmap except the ones in `keep`. */
  release(keep: ReadonlySet<string> = new Set()): void {
    for (const [id, bitmap] of this.bitmaps) {
      if (keep.has(id)) continue;
      bitmap.close();
      this.bitmaps.delete(id);
    }
    for (const [key, thumb] of this.thumbs) {
      if (keep.has(key.slice(0, key.indexOf("@")))) continue;
      void thumb.then((t) => t?.close());
      this.thumbs.delete(key);
    }
  }

  /**
   * Thumbnails for the timeline, scaled down once per frame and size by
   * `createImageBitmap` (off the main thread in every current browser) and
   * kept until the frame is released.
   */
  readonly thumbnails: ThumbnailProvider = (request, size) => {
    if (request.kind !== "frame") return Promise.resolve(null);
    const key = `${request.id}@${size.width}x${size.height}`;
    let thumb = this.thumbs.get(key);
    if (!thumb) {
      const source = this.bitmaps.get(request.id);
      if (!source) return Promise.resolve(null);
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      const scale = Math.min(1, (size.height * dpr) / source.height);
      thumb = createImageBitmap(source, {
        resizeWidth: Math.max(1, Math.round(source.width * scale)),
        resizeHeight: Math.max(1, Math.round(source.height * scale)),
        resizeQuality: "medium",
      }).catch(() => null);
      this.thumbs.set(key, thumb);
    }
    return thumb;
  };
}
