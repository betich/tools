// libheif-js ships types for the raw embind API only; this is the slice the decoder uses.
declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  type DisplayTarget = { data: Uint8ClampedArray; width: number; height: number };
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    display<T extends DisplayTarget>(target: T, done: (result: T | null) => void): void;
    free(): void;
  }
  export interface LibHeif {
    HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] };
  }
  const factory: (options?: object) => LibHeif;
  export default factory;
}
