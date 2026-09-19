/**
 * The document model shared by the browser editor and the server renderer.
 * Everything here must stay plain JSON — it is persisted to SQLite and shared by link.
 */

export type Fit = "cover" | "contain" | "stretch";
export type Align = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

export type GradientStop = { offset: number; color: string };

export type Fill =
  | { type: "solid"; color: string }
  | { type: "linear"; angle: number; stops: GradientStop[] };

export type Stroke = { color: string; width: number };

export type Shadow = { color: string; blur: number; offsetX: number; offsetY: number };

export type FontSpec = {
  /** Family name as it is registered with the canvas, e.g. "Roboto Mono". */
  family: string;
  weight: number;
  italic: boolean;
  size: number;
  /** Multiplier of font size. */
  lineHeight: number;
  /** Pixels added between characters. */
  letterSpacing: number;
  /** Where the face came from, so the server can load the same bytes. */
  source: FontSource;
  /**
   * Families tried after `family`, for scripts the primary face has no glyphs
   * for — a Latin display face backed by a Thai one, for instance.
   */
  fallbacks?: FallbackFont[];
};

export type FallbackFont = { family: string; source: FontSource };

export type FontSource =
  | { kind: "system" }
  | { kind: "google"; family: string; variant: string }
  | { kind: "upload"; assetId: string; fileName: string };

export type TextLayer = {
  id: string;
  name: string;
  kind: "text";
  /** May contain `<field>` tokens resolved against a merge row. */
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  align: Align;
  vAlign: VAlign;
  opacity: number;
  visible: boolean;
  locked: boolean;
  font: FontSpec;
  fill: Fill;
  stroke: Stroke | null;
  shadow: Shadow | null;
  /** Shrink the type until the block fits its box, down to `minSize`. */
  autoFit: { enabled: boolean; minSize: number };
  /**
   * How the merged text is cased before it is drawn. Absent on documents
   * saved before it existed, which fall back to `uppercase` — read it through
   * `textCaseOf`, never directly.
   */
  textCase?: TextCase;
  /** Kept in step with `textCase` so an older client still draws upper right. */
  uppercase: boolean;
};

export type TextCase = "none" | "upper" | "lower" | "sentence";

export type Layer = TextLayer;

export type BaseImage = {
  /** Data URL in the browser; an asset id once persisted server-side. */
  src: string;
  fit: Fit;
};

export type MergeDoc = {
  version: 1;
  name: string;
  canvas: { width: number; height: number; background: string };
  base: BaseImage | null;
  layers: Layer[];
  /**
   * One row's own layout, laid over the main design the way an instance
   * overrides a component: row key → layer id → only the fields that row
   * changed. Everything a row has not changed follows the main design.
   */
  overrides?: Record<string, Record<string, LayerOverride>>;
};

/** What a single row may change about a layer: where it sits, and its type size. */
export type LayerOverride = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  size?: number;
};

export type MergeRow = Record<string, string>;

export type MergeData = {
  fields: string[];
  rows: MergeRow[];
  /** File name the rows came from, when they came from a file. */
  source?: string;
  /** Newest last. Each step carries what it needs to be undone. */
  history?: DataEdit[];
  /**
   * A stable key per row, parallel to `rows`, so a row's own layout stays with
   * that row when others are added, removed or the sheet is reloaded. Absent on
   * data saved before it existed; `withKeys` fills it in.
   */
  keys?: string[];
};

/**
 * One step on the data's edit timeline. Every kind is invertible from what it
 * stores, so rolling back is replaying inverses newest-first — no snapshots of
 * the whole sheet, except for a reload, which replaces the whole sheet.
 */
export type DataStep =
  | { kind: "change"; row: number; changes: Record<string, [from: string, to: string]> }
  | { kind: "add"; row: number; values: MergeRow; key?: string }
  | { kind: "remove"; row: number; values: MergeRow; key?: string }
  | {
      kind: "reload";
      before: { fields: string[]; rows: MergeRow[]; source?: string; keys?: string[] };
      source?: string;
      count: number;
    }
  /** Template tokens rewritten to follow a renamed column: `<from>` became `<to>`. */
  | { kind: "remap"; map: Record<string, string> };

export type DataEdit = DataStep & { id: string; at: string };

export type Project = {
  id: string;
  name: string;
  doc: MergeDoc;
  data: MergeData;
  createdAt: string;
  updatedAt: string;
};

/** A read-only publicly shared snapshot of a project. */
export type ShareLink = {
  slug: string;
  projectId: string;
  createdAt: string;
};

export type GoogleFont = {
  family: string;
  category: string;
  variants: string[];
  /** variant -> woff2/ttf url */
  files: Record<string, string>;
};

export type ToolId = "squoosh" | "mail-merge" | "pdf-compress" | "pdf-merge" | "media2media";

export type ToolMeta = {
  id: ToolId;
  name: string;
  blurb: string;
  href: string;
  /** Zero-padded index stamped on the launchpad tile. */
  index: string;
  status: "live" | "wip";
};

/** What an export writes. A PDF is one page per row, drawn as a JPEG. */
export type ExportFormat = "png" | "jpeg" | "webp" | "pdf";

/** A PDF export is either every row as a page of one file, or one file per row. */
export type PdfLayout = "single" | "each";
