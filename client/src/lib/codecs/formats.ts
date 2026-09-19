export type OutputFormat = "webp" | "avif" | "jpeg" | "png";

export type EncodeOptions = {
  format: OutputFormat;
  /** 0–100 for lossy formats; ignored by png. */
  quality: number;
  /** Codec effort: webp method 0–6, avif 10 − speed, oxipng level 0–6. */
  effort: number;
  /** Longest-edge cap in pixels, or 0 to keep the original size. */
  maxEdge: number;
};

export type FormatMeta = {
  value: OutputFormat;
  label: string;
  lossy: boolean;
  /** Whether the effort dial does anything for this codec. */
  effortful: boolean;
  effortHint: string;
  mime: string;
  ext: string;
};

export const formats: FormatMeta[] = [
  { value: "webp", label: "webp", lossy: true, effortful: true, effortHint: "encoder method — slower, smaller", mime: "image/webp", ext: "webp" },
  { value: "avif", label: "avif", lossy: true, effortful: true, effortHint: "slower encode, smaller file", mime: "image/avif", ext: "avif" },
  { value: "jpeg", label: "jpeg", lossy: true, effortful: false, effortHint: "mozjpeg has no effort dial", mime: "image/jpeg", ext: "jpg" },
  { value: "png", label: "png", lossy: false, effortful: true, effortHint: "oxipng optimisation level", mime: "image/png", ext: "png" },
];

export const formatMeta = (f: OutputFormat) => formats.find((x) => x.value === f)!;
