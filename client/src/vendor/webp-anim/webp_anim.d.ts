/* Types for the Emscripten glue built by client/wasm/webp-anim/build.sh. Pointers are wasm heap offsets. */

export type WebpAnimModule = {
  HEAPU8: Uint8Array;
  UTF8ToString(ptr: number): string;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _webp_anim_new(width: number, height: number, loopCount: number, lossless: number, quality: number, method: number): number;
  _webp_anim_add(enc: number, rgba: number, timestampMs: number): number;
  _webp_anim_finish(enc: number, endMs: number): number;
  _webp_anim_output(enc: number): number;
  _webp_anim_error(enc: number): number;
  _webp_anim_delete(enc: number): void;
};

export type WebpAnimOptions = {
  /** The .wasm bytes, to skip fetching them (tests, Node). */
  wasmBinary?: ArrayBuffer | Uint8Array;
  locateFile?: (path: string, prefix: string) => string;
};

export default function webpAnim(options?: WebpAnimOptions): Promise<WebpAnimModule>;
