/* ───────────────────────────────────────────────────────────────────────────
   Settings → Mediabunny conversion options. Pure: it builds option objects
   and never touches a file, so `bun test` can check every mapping. The
   pipeline (export.ts) adds the per-frame `process` functions and the
   output target, which need a live conversion.
   ─────────────────────────────────────────────────────────────────────────── */

import { Quality, type ConversionAudioOptions, type ConversionOptions, type ConversionVideoOptions } from "mediabunny";
import {
  AUDIO_OUTPUTS,
  clampCrop,
  clampSpeed,
  framedSize,
  outputSize,
  rotatedSize,
  type SourceInfo,
  type VideoEdit,
} from "./settings";

export type OutputKind = "mp4" | "webm" | "m4a" | "ogg" | "wav";

export type ConversionPlan = {
  format: OutputKind;
  /** Seconds, for `Conversion.init({ trim })`. Omitted when it keeps the whole file. */
  trim: { start: number; end: number } | undefined;
  /** Without `process`; the pipeline wraps the frame hook and retiming around it. */
  video: ConversionVideoOptions;
  /** Built per track, since a speed change resamples from the track's own rate. */
  audio: (track: { sampleRate: number }) => ConversionAudioOptions;
  copy: ConversionOptions["copy"];
  /**
   * Speed and frame-rate work the pipeline must do in `process`, because
   * Mediabunny's own `frameRate` snaps timestamps *before* `process` runs
   * and would fight a speed change. Null when Mediabunny can do it all.
   */
  retime: { speed: number; fps: number | null } | null;
  /** Output size, for the capability probe and the preview. Null for audio. */
  size: { width: number; height: number } | null;
};

export type PlanOptions = {
  /**
   * Explicit video bitrate, bits per second. Overrides the quality level —
   * the target-size mode computes one from the size it's aiming at.
   */
  videoBitrate?: number | null;
};

const QUALITY: Record<VideoEdit["quality"], "medium" | "high" | "very-high"> = {
  low: "medium",
  medium: "high",
  high: "very-high",
};

export function videoQuality(edit: Pick<VideoEdit, "quality">, videoBitrate?: number | null): Quality {
  if (videoBitrate && Number.isFinite(videoBitrate) && videoBitrate > 0) {
    return new Quality({ bitrate: Math.round(videoBitrate) });
  }
  return new Quality(QUALITY[edit.quality]);
}

/** The rate to resample to before relabelling, so `speed`× as many seconds fit in each second. */
export function speedResampleRate(trackRate: number, speed: number): number {
  return Math.max(3000, Math.round(trackRate / clampSpeed(speed)));
}

export function planConversion(edit: VideoEdit, source: SourceInfo, options: PlanOptions = {}): ConversionPlan {
  const speed = clampSpeed(edit.speed);
  const trimmed = edit.trim.in > 0 || edit.trim.out < source.duration;
  const trim = trimmed
    ? { start: source.start + edit.trim.in / 1000, end: source.start + edit.trim.out / 1000 }
    : undefined;
  // Exact trims: copying packets may only happen when it needs no extra media at the edges.
  const copy: ConversionOptions["copy"] = { mode: "preferred", boundaryTolerance: 0 };

  const retime = speed !== 1 ? { speed, fps: edit.output === "video" ? edit.fps : null } : null;

  const audioFor = (track: { sampleRate: number }): ConversionAudioOptions => {
    if (edit.output === "video" && edit.mute) return { discard: true };
    const base: ConversionAudioOptions =
      edit.output === "audio" ? { codec: AUDIO_OUTPUTS.find((a) => a.id === edit.audioOutput)!.codec } : {};
    if (speed === 1) return base;
    return {
      ...base,
      sampleRate: speedResampleRate(track.sampleRate, speed),
      processedSampleRate: track.sampleRate,
    };
  };

  if (edit.output === "audio") {
    return {
      format: edit.audioOutput,
      trim,
      video: { discard: true },
      audio: audioFor,
      copy,
      retime,
      size: null,
    };
  }

  const video: ConversionVideoOptions = {
    codec: edit.codec,
    quality: videoQuality(edit, options.videoBitrate),
  };
  if (edit.rotate) video.rotate = edit.rotate;
  if (edit.crop) video.crop = clampCrop(edit.crop, rotatedSize(source, edit.rotate));
  const size = outputSize(edit, source);
  const framed = framedSize(edit, source);
  if (size.width !== framed.width || size.height !== framed.height) {
    video.width = size.width;
    video.height = size.height;
    video.fit = "fill";
  }
  if (edit.fps && !retime) video.frameRate = edit.fps;
  // Keyed: the frame hook hands back RGBA frames and the alpha goes into the file.
  if (edit.key.enabled) video.alpha = "keep";
  // What `process` hands the encoder, should the pipeline set one (a frame
  // hook, a speed change). Mediabunny reads these only when it does.
  video.processedWidth = size.width;
  video.processedHeight = size.height;

  return { format: edit.container, trim, video, audio: audioFor, copy, retime, size };
}
