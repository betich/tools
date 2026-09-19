/* ───────────────────────────────────────────────────────────────────────────
   The video tab's edit model: what the user asked for, with no Mediabunny,
   React or DOM in it, so it can be tested with `bun test` and handed to the
   export pipeline, the preview and (later) the GIF tab alike.

   Times are milliseconds (the timeline's unit). Pixels are the source's
   display pixels — after the file's own rotation, before ours.
   ─────────────────────────────────────────────────────────────────────────── */

import type { Trim } from "@/components/timeline/model";
import { DEFAULT_KEY, type KeySettings } from "./key/settings";

export type Container = "mp4" | "webm";
export type VideoCodecId = "avc" | "hevc" | "vp9" | "av1";
/** Extract-audio outputs, named by the file they make. */
export type AudioOutput = "m4a" | "ogg" | "wav";
export type Rotation = 0 | 90 | 180 | 270;
export type QualityLevel = "low" | "medium" | "high";
export type Rect = { left: number; top: number; width: number; height: number };

export type VideoEdit = {
  /** Make a video, or pull the sound out on its own. */
  output: "video" | "audio";
  container: Container;
  codec: VideoCodecId;
  audioOutput: AudioOutput;
  trim: Trim;
  /** Clockwise, on top of the file's own rotation. Applied before the crop. */
  rotate: Rotation;
  /** In rotated pixels; null keeps the whole frame. */
  crop: Rect | null;
  /** Output height in pixels (width follows the aspect); null keeps the size. Never scales up. */
  height: number | null;
  /** Output frame rate; null keeps the source's. */
  fps: number | null;
  /** Playback speed, 0.25–4. Audio follows, pitch and all. */
  speed: number;
  mute: boolean;
  quality: QualityLevel;
  /** Chroma key to transparency. Off by default; needs WebM + VP9 when on. */
  key: KeySettings;
};

/** What the export and preview need to know about the file. */
export type SourceInfo = {
  /** Display size, after the file's own rotation. */
  width: number;
  height: number;
  /** ms, from the first frame to the end. */
  duration: number;
  /** Seconds: the file's first timestamp. Timeline time 0 is this moment; trims are sent to Mediabunny in file time. */
  start: number;
  /** Average frame rate, when the file says. */
  fps: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Mediabunny's codec names, for the readout. */
  videoCodec: string | null;
  audioCodec: string | null;
  audioSampleRate: number | null;
  /** This browser can decode the video track; without that nothing can be re-encoded. */
  videoDecodable: boolean;
};

export const CODECS: { id: VideoCodecId; label: string }[] = [
  { id: "avc", label: "h.264" },
  { id: "hevc", label: "hevc" },
  { id: "vp9", label: "vp9" },
  { id: "av1", label: "av1" },
];

export const CODEC_NAMES: Record<VideoCodecId, string> = { avc: "H.264", hevc: "HEVC", vp9: "VP9", av1: "AV1" };

export const CONTAINER_CODECS: Record<Container, readonly VideoCodecId[]> = {
  mp4: ["avc", "hevc", "vp9", "av1"],
  webm: ["vp9", "av1"],
};

export const AUDIO_OUTPUTS: { id: AudioOutput; label: string; codec: "aac" | "opus" | "pcm-s16"; codecName: string }[] =
  [
    { id: "m4a", label: "m4a · aac", codec: "aac", codecName: "AAC" },
    { id: "ogg", label: "ogg · opus", codec: "opus", codecName: "Opus" },
    { id: "wav", label: "wav", codec: "pcm-s16", codecName: "WAV" },
  ];

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
export const HEIGHTS = [2160, 1440, 1080, 720, 480, 360] as const;
export const FRAME_RATES = [60, 30, 25, 24, 15, 12] as const;
export const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: "free", label: "free", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "4:5", label: "4:5", ratio: 4 / 5 },
];

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
/** The smallest crop side, in pixels. Encoders refuse tiny frames. */
export const MIN_CROP = 16;

export function defaultEdit(source: Pick<SourceInfo, "duration">): VideoEdit {
  return {
    output: "video",
    container: "mp4",
    codec: "avc",
    audioOutput: "m4a",
    trim: { in: 0, out: source.duration },
    rotate: 0,
    crop: null,
    height: null,
    fps: null,
    speed: 1,
    mute: false,
    quality: "high",
    key: DEFAULT_KEY,
  };
}

/* ── Geometry ────────────────────────────────────────────────────────────── */

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

export function rotatedSize(source: { width: number; height: number }, rotate: Rotation) {
  return rotate % 180 === 0
    ? { width: source.width, height: source.height }
    : { width: source.height, height: source.width };
}

/** A crop pulled inside the frame, whole pixels, even sides (encoders want 4:2:0), never under MIN_CROP. */
export function clampCrop(crop: Rect, bounds: { width: number; height: number }): Rect {
  const width = Math.min(bounds.width, Math.max(MIN_CROP, Math.floor(crop.width / 2) * 2));
  const height = Math.min(bounds.height, Math.max(MIN_CROP, Math.floor(crop.height / 2) * 2));
  const left = Math.round(Math.min(Math.max(0, crop.left), bounds.width - width));
  const top = Math.round(Math.min(Math.max(0, crop.top), bounds.height - height));
  return { left, top, width, height };
}

/** The largest centred crop of `ratio` (width / height) in the frame. */
export function centredCrop(bounds: { width: number; height: number }, ratio: number): Rect {
  let width = bounds.width;
  let height = width / ratio;
  if (height > bounds.height) {
    height = bounds.height;
    width = height * ratio;
  }
  return clampCrop({ left: (bounds.width - width) / 2, top: (bounds.height - height) / 2, width, height }, bounds);
}

export function moveCrop(crop: Rect, dx: number, dy: number, bounds: { width: number; height: number }): Rect {
  return clampCrop({ ...crop, left: crop.left + dx, top: crop.top + dy }, bounds);
}

export type Corner = "nw" | "ne" | "sw" | "se";

/**
 * Drag one corner; the opposite corner stays put. With a ratio the height
 * follows the width. Clamped to the frame, never inverted.
 */
export function resizeCrop(
  crop: Rect,
  corner: Corner,
  dx: number,
  dy: number,
  bounds: { width: number; height: number },
  ratio: number | null,
): Rect {
  const west = corner === "nw" || corner === "sw";
  const north = corner === "nw" || corner === "ne";
  // The fixed corner.
  const fx = west ? crop.left + crop.width : crop.left;
  const fy = north ? crop.top + crop.height : crop.top;
  // Room between the fixed corner and the frame edge we're dragging towards.
  const roomX = west ? fx : bounds.width - fx;
  const roomY = north ? fy : bounds.height - fy;
  let w = Math.min(roomX, Math.max(MIN_CROP, crop.width + (west ? -dx : dx)));
  let h = Math.min(roomY, Math.max(MIN_CROP, crop.height + (north ? -dy : dy)));
  if (ratio) {
    h = w / ratio;
    if (h > roomY) {
      h = roomY;
      w = h * ratio;
    }
  }
  return clampCrop({ left: west ? fx - w : fx, top: north ? fy - h : fy, width: w, height: h }, bounds);
}

/** Frame size after rotate and crop, before resizing. */
export function framedSize(edit: Pick<VideoEdit, "rotate" | "crop">, source: { width: number; height: number }) {
  const r = rotatedSize(source, edit.rotate);
  if (!edit.crop) return r;
  const c = clampCrop(edit.crop, r);
  return { width: c.width, height: c.height };
}

/** What comes out: even sides, never larger than the framed picture. */
export function outputSize(
  edit: Pick<VideoEdit, "rotate" | "crop" | "height">,
  source: { width: number; height: number },
) {
  const f = framedSize(edit, source);
  if (edit.height === null || edit.height >= f.height) return { width: even(f.width), height: even(f.height) };
  return { width: even((f.width * edit.height) / f.height), height: even(edit.height) };
}

/** Heights worth offering: those below the framed picture's own. */
export function heightChoices(framedHeight: number): number[] {
  return HEIGHTS.filter((h) => h < framedHeight);
}

/* ── Time ────────────────────────────────────────────────────────────────── */

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

/** Length of the output, ms. */
export function outputDuration(edit: Pick<VideoEdit, "trim" | "speed">): number {
  return Math.max(0, edit.trim.out - edit.trim.in) / clampSpeed(edit.speed);
}

/** Frames the output will hold, for progress readouts; null when the rate is unknown. */
export function outputFrameCount(
  edit: Pick<VideoEdit, "trim" | "speed" | "fps">,
  source: Pick<SourceInfo, "fps">,
): number | null {
  const rate = edit.fps ?? (source.fps ? source.fps * clampSpeed(edit.speed) : null);
  if (!rate) return null;
  return Math.max(1, Math.round((outputDuration(edit) / 1000) * rate));
}

/** Whether the trim leaves the whole source. */
export function isWhole(trim: Trim, duration: number): boolean {
  return trim.in <= 0 && trim.out >= duration;
}

/* ── Files ───────────────────────────────────────────────────────────────── */

export function extensionFor(edit: Pick<VideoEdit, "output" | "container" | "audioOutput">): string {
  return edit.output === "audio" ? edit.audioOutput : edit.container;
}

export const MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

/** The source's name with the new extension. Unicode stays — a Thai filename is still a Thai filename. */
export function outputName(sourceName: string, edit: Pick<VideoEdit, "output" | "container" | "audioOutput">): string {
  const dot = sourceName.lastIndexOf(".");
  const stem = (dot > 0 ? sourceName.slice(0, dot) : sourceName).trim() || "video";
  const ext = extensionFor(edit);
  const clash = dot > 0 && sourceName.slice(dot + 1).toLowerCase() === ext;
  return `${stem}${clash ? "-edit" : ""}.${ext}`;
}

/** What actually changes, for the summary line: `trim · 2× · 720p`. */
export function editSummary(edit: VideoEdit, source: SourceInfo): string[] {
  const out: string[] = [];
  if (!isWhole(edit.trim, source.duration)) out.push("trim");
  if (edit.rotate) out.push(`rotate ${edit.rotate}°`);
  if (edit.crop) out.push("crop");
  if (edit.output === "video") {
    const size = outputSize(edit, source);
    if (edit.height !== null && edit.height < framedSize(edit, source).height) out.push(`${size.height}p`);
    if (edit.fps) out.push(`${edit.fps} fps`);
  }
  if (edit.speed !== 1) out.push(`${edit.speed}×`);
  if (edit.mute && edit.output === "video") out.push("mute");
  if (edit.key.enabled && edit.output === "video") out.push("key");
  return out;
}
