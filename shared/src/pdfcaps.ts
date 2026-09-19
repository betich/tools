/**
 * What each PDF engine can do, as data (see #3). The Compress and Merge UIs
 * read it to enable or dim rows, and the pdf-worker reads it to decide which
 * passes it may run. One table, so a row the UI offers is a pass the worker
 * will actually run. Reasons are sentences the client shows as-is.
 *
 * Checked against the worker's binaries in #13 (qpdf 12.2, Ghostscript 10.05.1,
 * pdf-lib 1.17.1): a pass marked supported here is one the worker has a step for.
 */

export type EngineId = "mupdf" | "qpdf" | "ghostscript" | "pdf-lib";
export type PdfTool = "compress" | "merge";

/** Always on (lossless), set by the preset, or opt-in under Advanced. */
export type PassGroup = "lossless" | "preset" | "advanced";

export type PassId =
  // lossless — always on
  | "object-streams"
  | "recompress-streams"
  | "dedupe"
  | "garbage-collect"
  | "lossless-images"
  | "subset-fonts"
  // preset-driven
  | "downsample"
  | "reencode-images"
  | "strip-metadata"
  // opt-in
  | "remove-extras"
  | "flatten"
  | "grayscale";

export type CodecId = "mozjpeg" | "openjpeg" | "libjxl" | "flate";
export type PresetId = "screen" | "ebook" | "print";

/** `partial` still counts as supported; its note says what's missing. */
export type Support =
  | { level: "full" }
  | { level: "partial"; note: string }
  | { level: "none"; reason?: string };

const FULL: Support = { level: "full" };
const partial = (note: string): Support => ({ level: "partial", note });
const none = (reason?: string): Support => ({ level: "none", reason });

export type PassInfo = {
  id: PassId;
  group: PassGroup;
  label: string;
  /** Completes "<engine> can't …" when an engine has no custom reason. */
  verb: string;
};

export const PASSES: readonly PassInfo[] = [
  { id: "object-streams", group: "lossless", label: "Object streams + xref stream", verb: "write object streams" },
  { id: "recompress-streams", group: "lossless", label: "Recompress streams", verb: "recompress streams" },
  { id: "dedupe", group: "lossless", label: "Deduplicate objects", verb: "deduplicate objects" },
  { id: "garbage-collect", group: "lossless", label: "Drop unused objects", verb: "drop unused objects" },
  { id: "lossless-images", group: "lossless", label: "Recompress images losslessly", verb: "recompress images losslessly" },
  { id: "subset-fonts", group: "lossless", label: "Subset fonts", verb: "subset fonts" },
  { id: "downsample", group: "preset", label: "Downsample images", verb: "downsample images" },
  { id: "reencode-images", group: "preset", label: "Re-encode images", verb: "re-encode images" },
  { id: "strip-metadata", group: "preset", label: "Strip metadata", verb: "strip metadata" },
  { id: "remove-extras", group: "advanced", label: "Remove attachments, scripts, bookmarks, annotations, forms", verb: "remove extras" },
  { id: "flatten", group: "advanced", label: "Flatten forms and annotations", verb: "flatten forms and annotations" },
  { id: "grayscale", group: "advanced", label: "Convert to grayscale", verb: "convert to grayscale" },
];

export type EngineInfo = {
  id: EngineId;
  label: string;
  /** Per tool; merge support is about what survives the join. */
  tools: Record<PdfTool, Support>;
  passes: Record<PassId, Support>;
  /** Codecs it can write images with, when it can re-encode at all. */
  codecs: readonly CodecId[];
  /** Can rasterise pages — before/after crops and pixel-diff checks. */
  renders: boolean;
  /** Shown permanently beside the engine row, whatever passes are chosen. */
  caution?: string;
};

export const ENGINES: Record<EngineId, EngineInfo> = {
  mupdf: {
    id: "mupdf",
    label: "MuPDF",
    tools: { compress: FULL, merge: FULL },
    passes: {
      "object-streams": FULL,
      "recompress-streams": FULL,
      dedupe: FULL,
      "garbage-collect": FULL,
      "lossless-images": FULL,
      "subset-fonts": FULL,
      downsample: FULL,
      "reencode-images": FULL,
      "strip-metadata": FULL,
      "remove-extras": FULL,
      flatten: FULL,
      grayscale: partial("Images only — vector colours are left as they are."),
    },
    codecs: ["mozjpeg", "openjpeg", "libjxl", "flate"],
    renders: true,
  },
  qpdf: {
    id: "qpdf",
    label: "qpdf",
    tools: { compress: FULL, merge: FULL },
    passes: {
      "object-streams": FULL,
      "recompress-streams": FULL,
      dedupe: none(),
      "garbage-collect": FULL,
      "lossless-images": none(),
      "subset-fonts": none(),
      downsample: none("qpdf can't downsample images — it only re-encodes them at their own size."),
      "reencode-images": partial("JPEG only, with qpdf's own encoder — kept only when the file gets smaller."),
      "strip-metadata": FULL,
      "remove-extras": FULL,
      flatten: FULL,
      grayscale: none(),
    },
    codecs: ["mozjpeg"],
    renders: false,
  },
  ghostscript: {
    id: "ghostscript",
    label: "Ghostscript",
    tools: {
      compress: FULL,
      merge: partial("Re-distills every page — form fields and tagged structure don't survive."),
    },
    passes: {
      "object-streams": FULL,
      "recompress-streams": partial("Re-distills the file rather than recompressing it in place."),
      dedupe: partial("Duplicate images only."),
      "garbage-collect": FULL,
      "lossless-images": none("Ghostscript re-encodes images rather than repacking them — JPEGs it doesn't downsample keep their bytes."),
      "subset-fonts": FULL,
      downsample: partial("Bicubic, not Lanczos."),
      "reencode-images": partial("JPEG or Flate, with Ghostscript's own encoder, chosen per image — JPEGs it doesn't downsample keep their bytes."),
      "strip-metadata": FULL,
      "remove-extras": FULL,
      flatten: FULL,
      grayscale: FULL,
    },
    codecs: ["mozjpeg", "flate"],
    renders: true,
    caution: "Re-distills the whole file — tagged structure, form fields and links may not survive.",
  },
  "pdf-lib": {
    id: "pdf-lib",
    label: "pdf-lib",
    tools: {
      compress: partial("Rewrites structure only — little to gain on most files."),
      merge: partial("Copies pages only — form fields are dropped."),
    },
    passes: {
      "object-streams": FULL,
      "recompress-streams": none("pdf-lib copies streams as they are."),
      dedupe: none(),
      "garbage-collect": none("pdf-lib writes out every object, used or not."),
      "lossless-images": none(),
      "subset-fonts": none(),
      downsample: none("pdf-lib can't decode images, so it can't downsample them."),
      "reencode-images": none("pdf-lib can't decode images, so it can't re-encode them."),
      "strip-metadata": FULL,
      "remove-extras": none(),
      flatten: none(),
      grayscale: none(),
    },
    codecs: [],
    renders: false,
  },
};

export const ENGINE_IDS = Object.keys(ENGINES) as EngineId[];
export const DEFAULT_ENGINE: EngineId = "mupdf";
/** The default pipeline ends with a lossless pass through this engine. */
export const FINISHING_ENGINE: EngineId = "qpdf";

export type CodecInfo = {
  id: CodecId;
  label: string;
  /** The PDF filter the stream is written with. */
  filter: "DCTDecode" | "JPXDecode" | "JXLDecode" | "FlateDecode";
  lossy: boolean;
  lossless: boolean;
  /** `inline` carries alpha in the stream; `smask` needs a separate soft mask. */
  alpha: "inline" | "smask";
  viewers: "all" | "most" | "few";
  /** `default` is used unless changed; `experimental` sits behind a warning dialog (#14). */
  availability: "default" | "opt-in" | "experimental";
};

export const CODECS: Record<CodecId, CodecInfo> = {
  mozjpeg: {
    id: "mozjpeg",
    label: "JPEG (mozjpeg)",
    filter: "DCTDecode",
    lossy: true,
    lossless: false,
    alpha: "smask",
    viewers: "all",
    availability: "default",
  },
  openjpeg: {
    id: "openjpeg",
    label: "JPEG 2000 (OpenJPEG)",
    filter: "JPXDecode",
    lossy: true,
    lossless: true,
    alpha: "inline",
    viewers: "most",
    availability: "opt-in",
  },
  libjxl: {
    id: "libjxl",
    label: "JPEG XL (libjxl)",
    filter: "JXLDecode",
    lossy: true,
    lossless: true,
    alpha: "inline",
    viewers: "few",
    availability: "experimental",
  },
  flate: {
    id: "flate",
    label: "Flate (zopfli / libdeflate)",
    filter: "FlateDecode",
    lossy: false,
    lossless: true,
    alpha: "smask",
    viewers: "all",
    availability: "default",
  },
};

export const CODEC_IDS = Object.keys(CODECS) as CodecId[];
export const DEFAULT_CODEC: CodecId = "mozjpeg";

/** Never offered, with why — so nobody adds them back by accident. */
export const NEVER_CODECS: readonly { label: string; reason: string }[] = [
  { label: "Lossy JBIG2", reason: "Symbol substitution can silently swap one character for another." },
  { label: "AVIF", reason: "Not a PDF filter — no viewer could open it." },
];

export type PresetInfo = {
  id: PresetId;
  label: string;
  /** Images above this resolution are downsampled to it. */
  dpiCap: number;
  /** 0–100; each codec maps it onto its own scale. */
  quality: number;
  stripMetadata: boolean;
};

export const PRESETS: Record<PresetId, PresetInfo> = {
  screen: { id: "screen", label: "Screen", dpiCap: 72, quality: 60, stripMetadata: true },
  ebook: { id: "ebook", label: "Ebook", dpiCap: 150, quality: 75, stripMetadata: true },
  print: { id: "print", label: "Print", dpiCap: 300, quality: 90, stripMetadata: false },
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];
export const DEFAULT_PRESET: PresetId = "ebook";

export function passInfo(pass: PassId): PassInfo {
  return PASSES.find((p) => p.id === pass)!;
}

export function passesIn(group: PassGroup): PassId[] {
  return PASSES.filter((p) => p.group === group).map((p) => p.id);
}

export function supports(engine: EngineId, pass: PassId): boolean {
  return ENGINES[engine].passes[pass].level !== "none";
}

/** Why the engine can't run the pass ("qpdf can't subset fonts."), or null if it can. */
export function reasonUnsupported(engine: EngineId, pass: PassId): string | null {
  const s = ENGINES[engine].passes[pass];
  if (s.level !== "none") return null;
  return s.reason ?? `${ENGINES[engine].label} can't ${passInfo(pass).verb}.`;
}

/** What a partly supported pass leaves out, or null. */
export function supportNote(engine: EngineId, pass: PassId): string | null {
  const s = ENGINES[engine].passes[pass];
  return s.level === "partial" ? s.note : null;
}

export function supportsCodec(engine: EngineId, codec: CodecId): boolean {
  return ENGINES[engine].codecs.includes(codec);
}

export function reasonCodecUnsupported(engine: EngineId, codec: CodecId): string | null {
  if (supportsCodec(engine, codec)) return null;
  return `${ENGINES[engine].label} can't write ${CODECS[codec].label}.`;
}

/** Engines offered for a tool, default first. */
export function enginesFor(tool: PdfTool): EngineId[] {
  return ENGINE_IDS.filter((e) => ENGINES[e].tools[tool].level !== "none");
}

/** What a tool loses on this engine, or null. */
export function toolNote(engine: EngineId, tool: PdfTool): string | null {
  const s = ENGINES[engine].tools[tool];
  return s.level === "partial" ? s.note : s.level === "none" ? (s.reason ?? null) : null;
}

/**
 * The passes a compress run asks for: every lossless pass, the preset's
 * passes, and the Advanced ones switched on.
 */
export function requestedPasses(preset: PresetId, advanced: readonly PassId[] = []): PassId[] {
  const out = passesIn("lossless");
  out.push("downsample", "reencode-images");
  if (PRESETS[preset].stripMetadata) out.push("strip-metadata");
  for (const p of advanced) if (passInfo(p).group === "advanced" && !out.includes(p)) out.push(p);
  return out;
}

/** Split requested passes into what the engine runs and what it skips, with reasons. */
export function planPasses(
  engine: EngineId,
  passes: readonly PassId[],
): { run: PassId[]; skipped: { pass: PassId; reason: string }[] } {
  const run: PassId[] = [];
  const skipped: { pass: PassId; reason: string }[] = [];
  for (const pass of passes) {
    const reason = reasonUnsupported(engine, pass);
    if (reason) skipped.push({ pass, reason });
    else run.push(pass);
  }
  return { run, skipped };
}
