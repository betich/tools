/* ───────────────────────────────────────────────────────────────────────────
   What this browser can make. Asked of the browser itself, never guessed
   from the user agent: `VideoEncoder.isConfigSupported` and
   `AudioEncoder.isConfigSupported`, through Mediabunny's `canEncode*`
   (which builds the codec strings), at the size the export will really be
   — hardware encoders refuse sizes they don't like.

   Every "no" carries one plain sentence the tab shows as is. The wording
   lives here, apart from the asking, so it can be tested.
   ─────────────────────────────────────────────────────────────────────────── */

import {
  AUDIO_OUTPUTS,
  CODEC_NAMES,
  CODECS,
  CONTAINER_CODECS,
  type AudioOutput,
  type Container,
  type SourceInfo,
  type VideoCodecId,
  type VideoEdit,
} from "./settings";

export type Availability = { ok: true } | { ok: false; reason: string };

export type Capabilities = {
  /** Whether WebCodecs is here at all. */
  videoEncoder: boolean;
  audioEncoder: boolean;
  videoDecoder: boolean;
  codecs: Record<VideoCodecId, Availability>;
  audioOutputs: Record<AudioOutput, Availability>;
  /** The audio codec each container would get, or null when none can be encoded here. */
  containerAudio: Record<Container, string | null>;
  /** `showSaveFilePicker`: big exports can stream to disk. */
  saveToDisk: boolean;
};

/** The browser, as the probe sees it. Swapped for a fake under test. */
export type ProbeEnv = {
  hasVideoEncoder: boolean;
  hasAudioEncoder: boolean;
  hasVideoDecoder: boolean;
  hasSavePicker: boolean;
  canEncodeVideo: (codec: VideoCodecId, size: { width: number; height: number }) => Promise<boolean>;
  canEncodeAudio: (codec: string) => Promise<boolean>;
};

/** Where a codec is tried when the real size fails, to tell "not at this size" from "not at all". */
const REFERENCE = { width: 1280, height: 720 };

const CONTAINER_AUDIO: Record<Container, readonly string[]> = {
  mp4: ["aac", "opus"],
  webm: ["opus", "vorbis"],
};

const AUDIO_NAMES: Record<string, string> = { aac: "AAC", opus: "Opus", vorbis: "Vorbis", "pcm-s16": "WAV" };

/* ── Wording ─────────────────────────────────────────────────────────────── */

export const NO_WEBCODECS_VIDEO =
  "This browser can't encode video — it has no WebCodecs video encoder. Current Chrome, Edge, Firefox and Safari do.";
export const NO_WEBCODECS_AUDIO =
  "This browser can't encode audio — it has no WebCodecs audio encoder. WAV still works.";
export const NO_WEBCODECS_DECODE =
  "This browser can't decode video with WebCodecs, so it can't read frames out of the file. Current Chrome, Edge, Firefox and Safari can.";

export function codecReason(codec: VideoCodecId, size: { width: number; height: number } | null): string {
  const name = CODEC_NAMES[codec];
  return size
    ? `This browser can't encode ${name} at ${size.width}×${size.height}.`
    : `This browser can't encode ${name}.`;
}

export function audioReason(codecName: string): string {
  return `This browser can't encode ${codecName}.`;
}

/** Why a codec isn't offered for a container. Not the browser's fault, so it says so. */
export function containerReason(container: Container, codec: VideoCodecId): string {
  return `${container.toUpperCase()} can't hold ${CODEC_NAMES[codec]} — pick MP4 for it.`;
}

/** The note under the output when the export would come out silent although the file has sound. */
export function silentReason(container: Container): string {
  return `This browser can't encode audio for ${container.toUpperCase()}, so the export will be silent.`;
}

/** What the file will hold, when it differs from the obvious. */
export function audioCodecNote(container: Container, codec: string | null): string | null {
  if (!codec) return null;
  const preferred = CONTAINER_AUDIO[container][0];
  if (codec === preferred) return null;
  return `Audio goes in as ${AUDIO_NAMES[codec] ?? codec} — this browser can't encode ${AUDIO_NAMES[preferred!] ?? preferred}.`;
}

/** A discarded track, in words. Mediabunny's reasons, minus the ones the user chose. */
export function discardReason(type: "video" | "audio", reason: string, codec: string | null): string | null {
  const what = type === "video" ? "video" : "audio";
  const named = codec ? `${codec.toUpperCase()} ${what}` : `the ${what}`;
  switch (reason) {
    case "discarded_by_user":
    case "max_track_count_reached":
    case "max_track_count_of_type_reached":
      return null;
    case "unknown_source_codec":
      return `The ${what} in this file is in a format this tool doesn't know, so it was left out.`;
    case "undecodable_source_codec":
      return `This browser can't decode ${named} in this file, so it was left out.`;
    case "no_encodable_target_codec":
      return `This browser can't encode ${what} for this format, so it was left out.`;
    case "cannot_copy":
      return `The ${what} couldn't be copied as is, so it was left out.`;
    default:
      return `The ${what} was left out.`;
  }
}

/** The line the save row shows: where the file goes, and the limit when it's memory. */
export function saveNote(saveToDisk: boolean, limitBytes: number): string {
  const gb = Math.round((limitBytes / 1024 ** 3) * 10) / 10;
  return saveToDisk
    ? "You pick where the file goes before the export starts; it's written there as it's made, so size is no problem."
    : `This browser can't write straight to disk, so the export is held in memory — up to ${gb} GB.`;
}

/**
 * Why the export button is off, or null when it can go. Checked in the
 * order the user would fix things: the file, the trim, then the browser.
 */
export function exportBlocker(edit: VideoEdit, source: SourceInfo, caps: Capabilities | null): string | null {
  if (edit.output === "video" && !source.hasVideo) return "This file has no video — extract its audio instead.";
  if (edit.output === "audio" && !source.hasAudio) return "This file has no audio to extract.";
  if (edit.trim.out - edit.trim.in <= 0) return "The trim keeps nothing — move the in or out point.";
  if (!caps) return "Checking what this browser can encode.";
  if (edit.output === "audio") {
    const a = caps.audioOutputs[edit.audioOutput];
    return a.ok ? null : a.reason;
  }
  if (!CONTAINER_CODECS[edit.container].includes(edit.codec)) return containerReason(edit.container, edit.codec);
  const c = caps.codecs[edit.codec];
  return c.ok ? null : c.reason;
}

/** A note about the file this browser can't fully read, or null. */
export function decodeNote(source: SourceInfo): string | null {
  if (!source.hasVideo || source.videoDecodable) return null;
  const name = source.videoCodec ? `${source.videoCodec.toUpperCase()} ` : "";
  return `This browser can't decode the ${name}video in this file, so it can only be copied as is — a new codec, size, crop or speed won't work here.`;
}

/* ── Asking ──────────────────────────────────────────────────────────────── */

export async function probe(env: ProbeEnv, size: { width: number; height: number } | null): Promise<Capabilities> {
  const codecs = {} as Record<VideoCodecId, Availability>;
  await Promise.all(
    CODECS.map(async ({ id }) => {
      if (!env.hasVideoEncoder) {
        codecs[id] = { ok: false, reason: NO_WEBCODECS_VIDEO };
        return;
      }
      const at = size ?? REFERENCE;
      if (await safe(env.canEncodeVideo(id, at))) {
        codecs[id] = { ok: true };
        return;
      }
      // Tell "not at this size" apart from "not at all".
      const anywhere = size ? await safe(env.canEncodeVideo(id, REFERENCE)) : false;
      codecs[id] = { ok: false, reason: codecReason(id, anywhere ? size : null) };
    }),
  );

  const audioOk = new Map<string, boolean>();
  const askAudio = async (codec: string) => {
    if (!audioOk.has(codec)) {
      // PCM needs no encoder; everything else does.
      const ok = codec.startsWith("pcm-") ? true : env.hasAudioEncoder && (await safe(env.canEncodeAudio(codec)));
      audioOk.set(codec, ok);
    }
    return audioOk.get(codec)!;
  };

  const audioOutputs = {} as Record<AudioOutput, Availability>;
  for (const a of AUDIO_OUTPUTS) {
    const ok = await askAudio(a.codec);
    audioOutputs[a.id] = ok
      ? { ok: true }
      : { ok: false, reason: env.hasAudioEncoder ? audioReason(a.codecName) : NO_WEBCODECS_AUDIO };
  }

  const containerAudio = {} as Record<Container, string | null>;
  for (const c of ["mp4", "webm"] as const) {
    containerAudio[c] = null;
    for (const codec of CONTAINER_AUDIO[c]) {
      if (await askAudio(codec)) {
        containerAudio[c] = codec;
        break;
      }
    }
  }

  return {
    videoEncoder: env.hasVideoEncoder,
    audioEncoder: env.hasAudioEncoder,
    videoDecoder: env.hasVideoDecoder,
    codecs,
    audioOutputs,
    containerAudio,
    saveToDisk: env.hasSavePicker,
  };
}

/** A probe that throws (an odd size, a flaky driver) is a "no", not a crash. */
async function safe(p: Promise<boolean>): Promise<boolean> {
  try {
    return await p;
  } catch {
    return false;
  }
}

/** The real browser. Mediabunny is imported only when asked, so the tab's first paint doesn't wait on it. */
export async function browserEnv(): Promise<ProbeEnv> {
  const mb = await import("mediabunny");
  return {
    hasVideoEncoder: typeof VideoEncoder !== "undefined",
    hasAudioEncoder: typeof AudioEncoder !== "undefined",
    hasVideoDecoder: typeof VideoDecoder !== "undefined",
    hasSavePicker: typeof window !== "undefined" && "showSaveFilePicker" in window,
    canEncodeVideo: (codec, size) =>
      mb.canEncodeVideo(codec, { width: evenUp(size.width), height: evenUp(size.height) }),
    canEncodeAudio: (codec) => mb.canEncodeAudio(codec as Parameters<typeof mb.canEncodeAudio>[0]),
  };
}

const evenUp = (n: number) => Math.max(2, Math.ceil(n / 2) * 2);
