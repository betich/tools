/// <reference lib="webworker" />
import type { LibHeif } from "libheif-js/libheif-wasm/libheif-bundle.mjs";

/**
 * libheif (LGPL-3.0, via libheif-js) for browsers without a native HEIC
 * decoder — Chrome and Firefox. The worker imports this module only after
 * `createImageBitmap` has refused a file whose bytes say HEIF, so no libheif
 * bytes load until one arrives. The wasm is inlined in the ESM bundle.
 */

let lib: Promise<LibHeif> | null = null;

function load(): Promise<LibHeif> {
  lib ??= import("libheif-js/libheif-wasm/libheif-bundle.mjs").then(({ default: factory }) => factory());
  return lib;
}

/** Decodes the primary image. libheif applies irot/imir itself, so the pixels are already upright. */
export async function decodeHeif(buffer: ArrayBuffer): Promise<ImageData> {
  const libheif = await load();
  const images = new libheif.HeifDecoder().decode(new Uint8Array(buffer));
  try {
    const image = images.find((i) => i.is_primary()) ?? images[0];
    if (!image) throw new Error("No image inside this HEIF file");
    const out = new ImageData(image.get_width(), image.get_height());
    await new Promise<void>((resolve, reject) =>
      image.display(out, (result) => (result ? resolve() : reject(new Error("HEIF decode failed")))),
    );
    return out;
  } finally {
    for (const i of images) i.free();
  }
}
