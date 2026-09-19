/**
 * Which files the codec pool will try to open.
 *
 * HEIC often arrives with an empty `type` on Linux and Windows, so the
 * extension counts too. The worker sniffs the bytes and has the last word.
 */
export const IMAGE_ACCEPT = "image/*,.heic,.heif,.avif,.webp,.jpg,.jpeg,.png,.gif,.bmp,.tif,.tiff";

const IMAGE_EXT = new Set(["heic", "heif", "avif", "webp", "jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff"]);

export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXT.has(ext);
}

/** Decoded pixels as a PNG the page can show — for sources an `<img>` can't open, like HEIC outside Safari. */
export async function pixelsToBlob(image: ImageData): Promise<Blob> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable in this browser");
  ctx.putImageData(image, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}
