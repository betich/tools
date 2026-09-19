/* ───────────────────────────────────────────────────────────────────────────
   The export pipeline: one file in, one file out, through Mediabunny and
   the browser's own WebCodecs encoders.

   The input is read in ranges straight from the `File` (never loaded
   whole). The output goes either into memory, under a stated limit, or —
   where the File System Access API exists — to a file the user picked,
   written as it is made, so a 2 GB export never sits in RAM.

   Two seams for what comes next: an explicit `videoBitrate` (target size),
   and a `frameHook` every frame passes through (chroma key).
   ─────────────────────────────────────────────────────────────────────────── */

import type { InputTrack, VideoSample } from "mediabunny";
import { bytes as formatBytes } from "@/lib/format";
import type { FrameHook } from "./frameHook";
import { planConversion, type OutputKind } from "./plan";
import { discardReason } from "./probe";
import { MIME, extensionFor, outputFrameCount, outputSize, type SourceInfo, type VideoEdit } from "./settings";
import { ExportCanceled, ExportError, MEMORY_LIMIT, type ExportTarget } from "./target";
import { ProgressMeter, Retimer, retimeAudio, type ProgressReading } from "./timing";

export { ExportCanceled, ExportError, MEMORY_LIMIT, type ExportTarget } from "./target";

export type ExportProgress = ProgressReading & {
  /** Bytes written so far. */
  bytes: number;
};

export type ExportRequest = {
  file: Blob;
  edit: VideoEdit;
  source: SourceInfo;
  target: ExportTarget;
  /** Bits per second; overrides the edit's quality level. */
  videoBitrate?: number | null;
  /** Re-encode the audio at this codec and bitrate (target size), instead of copying it where possible. */
  audio?: { codec: string; bitrate: number } | null;
  /** Every video frame passes through this, after rotate/crop/resize and before the speed change. */
  frameHook?: FrameHook | null;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
};

export type ExportResult = {
  /** The file, when it was made in memory; null when it went to disk. */
  blob: Blob | null;
  bytes: number;
  mime: string;
  /** Things the user should know — a track that was left out, say. */
  notes: string[];
  /** How an explicit `videoBitrate` was spent; null without one. */
  bitrateMode: "constant" | "variable" | null;
};

const PROGRESS_EVERY_MS = 150;

export async function exportVideo(req: ExportRequest): Promise<ExportResult> {
  const { edit, source, signal } = req;
  if (signal?.aborted) throw new ExportCanceled();
  if (edit.output === "audio" && !source.hasAudio) throw new ExportError("This file has no audio to extract.");
  if (edit.output === "video" && !source.hasVideo)
    throw new ExportError("This file has no video in it — extract its audio instead.");

  const mb = await import("mediabunny");
  const bitrateMode = req.videoBitrate ? await pickBitrateMode(mb, edit, source, req.videoBitrate) : null;
  const plan = planConversion(edit, source, {
    videoBitrate: req.videoBitrate,
    bitrateMode: bitrateMode ?? undefined,
    audio: req.audio,
  });
  const limit = req.target.kind === "memory" ? (req.target.limit ?? MEMORY_LIMIT) : Infinity;

  const input = new mb.Input({ source: new mb.BlobSource(req.file), formats: mb.ALL_FORMATS });
  const target =
    req.target.kind === "memory" ? new mb.BufferTarget() : new mb.StreamTarget(req.target.writable, { chunked: true });
  const output = new mb.Output({ format: makeFormat(mb, plan.format), target });

  let written = 0;
  let overLimit = false;
  let cancel: (() => void) | null = null;
  target.onwrite = (_start, end) => {
    if (end > written) written = end;
    if (written > limit && !overLimit) {
      overLimit = true;
      cancel?.();
    }
  };

  const hook = req.frameHook ?? null;
  const retimer = plan.retime ? new Retimer(plan.retime.speed, plan.retime.fps) : null;
  const process =
    hook || retimer
      ? async (sample: VideoSample) => {
          let base: VideoSample = sample;
          if (hook) {
            const frame = sample.toCanvasImageSource();
            const result = await hook(frame, {
              width: sample.displayWidth,
              height: sample.displayHeight,
              time: sample.timestamp,
              purpose: "export",
            });
            if (result === null) return null;
            // The VideoSample constructor copies a canvas, so the hook may reuse its own.
            if (result !== frame)
              base = new mb.VideoSample(result, { timestamp: sample.timestamp, duration: sample.duration });
          }
          if (!retimer) return base;
          const slots = retimer.map(sample.timestamp, sample.duration);
          if (slots.length === 0) {
            if (base !== sample) base.close();
            return null;
          }
          // Mediabunny closes every sample we hand back except the one it gave us.
          return slots.map((slot, i) => {
            const s = i === 0 ? base : base.clone();
            s.setTimestamp(slot.timestamp);
            s.setDuration(slot.duration);
            return s;
          });
        }
      : undefined;

  const speed = plan.retime?.speed ?? 1;

  try {
    const conversion = await mb.Conversion.init({
      input,
      output,
      trim: plan.trim,
      copy: plan.copy,
      showWarnings: false,
      video: plan.video.discard ? plan.video : { ...plan.video, process },
      audio: async (track) => {
        const rate = await track.getSampleRate();
        const options = plan.audio({ sampleRate: rate });
        if (options.discard || speed === 1) return options;
        // Speed: the track was resampled to rate / speed; call it `rate` again
        // and the same samples play `speed` times as fast (and as high).
        return {
          ...options,
          process: (s) => relabelAudio(mb, s, rate, speed),
        };
      },
    });
    cancel = () => void conversion.cancel();

    const notes = await describeDiscards(conversion.discardedTracks);
    if (!conversion.isValid) {
      throw new ExportError(notes[0] ?? "Nothing in this file can be exported with these settings.");
    }

    const onAbort = () => void conversion.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });

    const meter = new ProgressMeter(performance.now(), edit.output === "video" ? outputFrameCount(edit, source) : null);
    let lastReport = 0;
    conversion.onProgress = (fraction) => {
      const now = performance.now();
      if (now - lastReport < PROGRESS_EVERY_MS && fraction < 1) return;
      lastReport = now;
      req.onProgress?.({ ...meter.read(now, fraction), bytes: written });
    };

    try {
      await conversion.execute();
    } catch (e) {
      if (e instanceof mb.ConversionCanceledError) {
        if (overLimit) {
          throw new ExportError(
            `The export passed ${formatBytes(limit)}, the most this browser can hold in memory. Trim it, lower the size, or use Chrome or Edge, which write straight to disk.`,
          );
        }
        throw new ExportCanceled();
      }
      throw e;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    const mime = MIME[extensionFor(edit)] ?? "application/octet-stream";
    const buffer = target instanceof mb.BufferTarget ? target.buffer : null;
    return {
      blob: buffer ? new Blob([buffer], { type: mime }) : null,
      bytes: buffer ? buffer.byteLength : written,
      mime,
      notes,
      bitrateMode,
    };
  } catch (e) {
    if (e instanceof ExportError || e instanceof ExportCanceled) throw e;
    throw new ExportError(`The export stopped: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    input.dispose();
  }
}

type Mediabunny = typeof import("mediabunny");

function makeFormat(mb: Mediabunny, kind: OutputKind) {
  switch (kind) {
    case "mp4":
    case "m4a":
      // The index goes at the end, so media is written as it's made: to disk,
      // or into memory where `onwrite` can see it grow and stop at the limit.
      // ("in-memory" fast start would hold everything back until the end.)
      return new mb.Mp4OutputFormat({ fastStart: false });
    case "webm":
      return new mb.WebMOutputFormat();
    case "ogg":
      return new mb.OggOutputFormat();
    case "wav":
      return new mb.WavOutputFormat();
  }
}

/**
 * Constant bitrate lands closest to a size, so it's asked for first; not
 * every encoder takes it (hardware ones often don't), and then it's variable.
 */
async function pickBitrateMode(
  mb: Mediabunny,
  edit: VideoEdit,
  source: SourceInfo,
  bitrate: number,
): Promise<"constant" | "variable"> {
  if (edit.output !== "video") return "variable";
  const size = outputSize(edit, source);
  try {
    const ok = await mb.canEncodeVideo(edit.codec, {
      width: size.width,
      height: size.height,
      quality: new mb.Quality({ bitrate: Math.round(bitrate), bitrateMode: "constant" }),
    });
    return ok ? "constant" : "variable";
  } catch {
    return "variable";
  }
}

/** Same samples, new clock: labelled at the track's own rate, so they play `speed`× as fast. */
function relabelAudio(mb: Mediabunny, sample: InstanceType<Mediabunny["AudioSample"]>, rate: number, speed: number) {
  const channels = sample.numberOfChannels;
  const frames = sample.numberOfFrames;
  const data = new Float32Array(channels * frames);
  for (let c = 0; c < channels; c++) {
    sample.copyTo(data.subarray(c * frames, (c + 1) * frames), { planeIndex: c, format: "f32-planar" });
  }
  return new mb.AudioSample({
    data,
    format: "f32-planar",
    numberOfChannels: channels,
    sampleRate: rate,
    timestamp: retimeAudio(sample.timestamp, speed),
  });
}

async function describeDiscards(discarded: { track: InputTrack; reason: string }[]): Promise<string[]> {
  const notes: string[] = [];
  for (const d of discarded) {
    const t = d.track;
    const type = t.isVideoTrack() ? "video" : t.isAudioTrack() ? "audio" : null;
    if (!type) continue;
    const codec = t.isVideoTrack() || t.isAudioTrack() ? await t.getCodec() : null;
    const note = discardReason(type, d.reason, codec);
    if (note && !notes.includes(note)) notes.push(note);
  }
  return notes;
}
