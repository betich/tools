import type { CodecPool } from "@/lib/codecs";
import { isImageFile } from "@/lib/codecs";
import type { IncomingFrame } from "../frames";
import { sortNaturally } from "../model";

/** The path a file is sorted by: its place in a chosen folder when there is one, else its name. */
export const framePath = (file: File) => file.webkitRelativePath || file.name;

export type FilesResult = {
  frames: IncomingFrame[];
  /** Names of images that could not be opened, in order. */
  failed: string[];
  /** How many files were not images at all (a folder's .txt, .DS_Store). */
  skipped: number;
};

/**
 * A folder or a multi-selection of images → one frame each, in natural
 * filename order. Decoding goes through the shared codec pool, so HEIC opens
 * outside Safari too and the page stays responsive while 200 frames decode.
 * Frames keep their alpha.
 */
export async function framesFromFiles(
  files: readonly File[],
  pool: CodecPool,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<FilesResult> {
  const images = sortNaturally(files.filter(isImageFile), framePath);
  const skipped = files.length - images.length;
  let done = 0;
  onProgress?.(0, images.length);

  const decoded = await Promise.all(
    images.map(async (file): Promise<IncomingFrame | null> => {
      try {
        const { image } = await pool.decode(file, { signal });
        const bitmap = await createImageBitmap(image, { premultiplyAlpha: "none" });
        return { image: bitmap, name: file.name };
      } catch {
        return null;
      } finally {
        onProgress?.(++done, images.length);
      }
    }),
  );
  if (signal?.aborted) {
    for (const f of decoded) f?.image.close();
    throw signal.reason ?? new DOMException("Loading cancelled", "AbortError");
  }

  const frames: IncomingFrame[] = [];
  const failed: string[] = [];
  decoded.forEach((f, i) => (f ? frames.push(f) : failed.push(images[i]!.name)));
  return { frames, failed, skipped };
}
