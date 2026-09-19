export type OutputFormat = "webp" | "avif" | "jpeg" | "png" | "jxl";

/**
 * What the output carries from the source's EXIF. `none` (the default) is
 * what every encoder writes on its own. The others copy the source block,
 * orientation reset and thumbnail dropped, into formats that can hold it —
 * see `carriesMetadata`.
 */
export type MetadataMode = "none" | "no-location" | "all";

export type EncodeOptions = {
  format: OutputFormat;
  /** 0–100 for lossy formats; ignored by png. */
  quality: number;
  /** Codec effort 0–6: webp method, avif 10 − speed, oxipng level; jxl maps it onto its own 1–9. */
  effort: number;
  /** Longest-edge cap in pixels, or 0 to keep the original size. */
  maxEdge: number;
  /** Omitted means `none`. */
  metadata?: MetadataMode;
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
  /** Whether the container gets the source's EXIF back when asked. */
  carriesMetadata: boolean;
  /** A caveat to show wherever the format is picked. */
  note?: string;
};

export const formats: FormatMeta[] = [
  { value: "webp", label: "webp", lossy: true, effortful: true, effortHint: "encoder method — slower, smaller", mime: "image/webp", ext: "webp", carriesMetadata: true },
  { value: "avif", label: "avif", lossy: true, effortful: true, effortHint: "slower encode, smaller file", mime: "image/avif", ext: "avif", carriesMetadata: false },
  { value: "jpeg", label: "jpeg", lossy: true, effortful: false, effortHint: "mozjpeg has no effort dial", mime: "image/jpeg", ext: "jpg", carriesMetadata: true },
  { value: "png", label: "png", lossy: false, effortful: true, effortHint: "oxipng optimisation level", mime: "image/png", ext: "png", carriesMetadata: true },
  {
    value: "jxl",
    label: "jpeg xl",
    lossy: true,
    effortful: true,
    effortHint: "slower encode, smaller file",
    mime: "image/jxl",
    ext: "jxl",
    carriesMetadata: false,
    note: "Opens in Safari only; Chrome and Firefox keep JPEG XL behind flags.",
  },
];

export const formatMeta = (f: OutputFormat) => formats.find((x) => x.value === f)!;
