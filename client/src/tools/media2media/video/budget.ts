/* ───────────────────────────────────────────────────────────────────────────
   Compress to a target size: the arithmetic, and nothing else. No
   Mediabunny, React or DOM, so every number is checked under `bun test`.

     video bitrate = (target − headroom − audio − container) × 8 / seconds

   The audio gets a fixed, known bitrate (it is re-encoded, never copied,
   when aiming at a size), the container's bytes are estimated per packet,
   and a little headroom is kept back because encoders wobble. When the
   picture that's left is too thin for its pixel count (bits per pixel), a
   smaller height is suggested. After the export, an overshoot can be
   retried once at a bitrate scaled by how far off the first pass was.
   ─────────────────────────────────────────────────────────────────────────── */

import {
  clampSpeed,
  framedSize,
  heightChoices,
  outputDuration,
  outputSize,
  type Container,
  type SourceInfo,
  type VideoCodecId,
  type VideoEdit,
} from "./settings";

/** Kept back from the target on the first pass: encoders under a bitrate still wander by a few percent. */
export const HEADROOM = 0.02;
/** Kept back on the retry, which already knows how far this encoder overshoots on this clip. */
export const RETRY_HEADROOM = 0.03;
/** Below this the encoder can't make a picture worth having; the target is refused. */
export const MIN_VIDEO_BITRATE = 64_000;
/** Assumed when the file doesn't say, for bits per pixel. */
export const DEFAULT_FPS = 30;
/** Audio may take up to this share of the whole budget before it steps down a rung. */
const AUDIO_SHARE = 0.15;

/**
 * Bits per pixel below which the picture turns to mush, per codec. H.264
 * holds up to about 0.045 on ordinary footage (1080p30 at ~2.8 Mbps); the
 * newer codecs need roughly two thirds (HEVC, VP9) or half (AV1) as much.
 */
export const BPP_FLOOR: Record<VideoCodecId, number> = { avc: 0.045, hevc: 0.03, vp9: 0.03, av1: 0.024 };

/**
 * Audio bitrates to choose from, best first. AAC through WebCodecs takes only
 * a few fixed rates (96–192 kbps); Opus takes anything.
 */
const AUDIO_LADDER: Record<string, readonly number[]> = {
  aac: [128_000, 96_000],
  opus: [96_000, 64_000, 48_000, 32_000],
  vorbis: [96_000, 64_000],
};

/** Encoded audio frames per second, for the container estimate. */
function audioPacketRate(codec: string, sampleRate: number): number {
  if (codec === "aac") return sampleRate / 1024;
  if (codec === "opus") return 50; // 20 ms frames
  return sampleRate / 1024;
}

/** Container bytes: a fixed header plus an index or block header per packet. */
const CONTAINER_BASE = 8 * 1024;
const PER_PACKET: Record<Container, number> = { mp4: 12, webm: 14 };

export type BudgetInput = {
  targetBytes: number;
  /** Length of the output, ms. */
  durationMs: number;
  /** Output picture size. */
  size: { width: number; height: number };
  /** Output frame rate; null when unknown. */
  fps: number | null;
  codec: VideoCodecId;
  container: Container;
  /** The audio codec the output will carry, or null when it will be silent. */
  audio: { codec: string; sampleRate: number } | null;
  /** The picture's height before resizing, for the heights worth suggesting. */
  framedHeight: number;
};

export type Budget = {
  ok: true;
  videoBitrate: number;
  /** Null when the output is silent. */
  audio: { codec: string; bitrate: number } | null;
  /** Estimated container bytes. */
  overheadBytes: number;
  bitsPerPixel: number;
  /** Too few bits for this many pixels; `suggestHeight` says what would do. */
  thin: boolean;
  /** The largest offered height at which the same bitrate would look acceptable, or null. */
  suggestHeight: number | null;
};

export type BudgetRefusal = { ok: false; reason: string };

export function containerOverhead(
  container: Container,
  seconds: number,
  fps: number,
  audio: { codec: string; sampleRate: number } | null,
): number {
  const packets = seconds * fps + (audio ? seconds * audioPacketRate(audio.codec, audio.sampleRate) : 0);
  return Math.round(CONTAINER_BASE + packets * PER_PACKET[container]);
}

export function bitsPerPixel(bitrate: number, size: { width: number; height: number }, fps: number): number {
  const pixels = size.width * size.height * fps;
  return pixels > 0 ? bitrate / pixels : 0;
}

/** The audio rung: the best rate that stays under its share of the budget, else the lowest. */
export function audioBitrate(codec: string, totalBitrate: number): number {
  const ladder = AUDIO_LADDER[codec] ?? AUDIO_LADDER.opus!;
  return ladder.find((r) => r <= totalBitrate * AUDIO_SHARE) ?? ladder[ladder.length - 1]!;
}

export function planBudget(input: BudgetInput): Budget | BudgetRefusal {
  const seconds = input.durationMs / 1000;
  if (!(seconds > 0)) return { ok: false, reason: "The trim keeps nothing — move the in or out point." };
  if (!(input.targetBytes > 0)) return { ok: false, reason: "Name a size above zero." };

  const fps = input.fps && input.fps > 0 ? input.fps : DEFAULT_FPS;
  const usable = input.targetBytes * (1 - HEADROOM);
  const overheadBytes = containerOverhead(input.container, seconds, fps, input.audio);
  const total = ((usable - overheadBytes) * 8) / seconds;

  const audio = input.audio ? { codec: input.audio.codec, bitrate: audioBitrate(input.audio.codec, total) } : null;
  const videoBitrate = Math.floor(total - (audio?.bitrate ?? 0));

  if (videoBitrate < MIN_VIDEO_BITRATE) {
    const least = minimumBytes(input, fps, audio);
    return {
      ok: false,
      reason: `${formatMb(input.targetBytes)} is too small for ${formatLength(seconds)} of video — it needs at least ${formatMb(least)}. Trim it${audio ? ", mute it" : ""} or aim higher.`,
    };
  }

  const bpp = bitsPerPixel(videoBitrate, input.size, fps);
  const floor = BPP_FLOOR[input.codec];
  const thin = bpp < floor;
  return {
    ok: true,
    videoBitrate,
    audio,
    overheadBytes,
    bitsPerPixel: bpp,
    thin,
    suggestHeight: thin ? suggestHeight(videoBitrate, input.size, fps, floor, input.framedHeight) : null,
  };
}

/** The smallest target that leaves the picture its minimum. */
function minimumBytes(input: BudgetInput, fps: number, audio: { bitrate: number } | null): number {
  const seconds = input.durationMs / 1000;
  const overhead = containerOverhead(input.container, seconds, fps, input.audio);
  const bytes = ((MIN_VIDEO_BITRATE + (audio?.bitrate ?? 0)) * seconds) / 8 + overhead;
  return Math.ceil(bytes / (1 - HEADROOM));
}

/**
 * The largest offered height below the current one where the bitrate gives
 * at least `floor` bits per pixel; the smallest offered when none does
 * (still better), null when nothing smaller is offered.
 */
export function suggestHeight(
  bitrate: number,
  size: { width: number; height: number },
  fps: number,
  floor: number,
  framedHeight: number,
): number | null {
  const aspect = size.width / size.height;
  const choices = heightChoices(framedHeight).filter((h) => h < size.height);
  if (choices.length === 0) return null;
  for (const h of choices) {
    if (bitsPerPixel(bitrate, { width: h * aspect, height: h }, fps) >= floor) return h;
  }
  return choices[choices.length - 1]!;
}

/* ── After the export ────────────────────────────────────────────────────── */

export type Outcome = {
  targetBytes: number;
  achievedBytes: number;
  /** achieved / target − 1: +0.04 is 4% over. */
  off: number;
  over: boolean;
};

export function outcome(targetBytes: number, achievedBytes: number): Outcome {
  return {
    targetBytes,
    achievedBytes,
    off: achievedBytes / targetBytes - 1,
    over: achievedBytes > targetBytes,
  };
}

/**
 * The bitrate for the one retry after an overshoot, or null when there is
 * nothing to correct. The first pass shows how many bytes this encoder
 * really spent on the picture at `videoBitrate`; the retry scales the rate
 * by what the picture may have, with a little more headroom.
 */
export function correctedBitrate(
  budget: Pick<Budget, "videoBitrate" | "audio" | "overheadBytes">,
  durationMs: number,
  targetBytes: number,
  achievedBytes: number,
): number | null {
  if (achievedBytes <= targetBytes) return null;
  const seconds = durationMs / 1000;
  const audioBytes = ((budget.audio?.bitrate ?? 0) * seconds) / 8;
  const spent = achievedBytes - audioBytes - budget.overheadBytes;
  const allowed = targetBytes * (1 - RETRY_HEADROOM) - audioBytes - budget.overheadBytes;
  if (spent <= 0 || allowed <= 0) return null;
  // Never back off by more than half in one go: a wild first pass is a wild measurement.
  const ratio = Math.max(0.5, Math.min(1, allowed / spent));
  const next = Math.floor(budget.videoBitrate * ratio);
  return next >= MIN_VIDEO_BITRATE && next < budget.videoBitrate ? next : null;
}

/* ── Wording ─────────────────────────────────────────────────────────────── */

const MB = 1024 * 1024;

function formatMb(bytes: number): string {
  const mb = bytes / MB;
  return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)} MB`;
}

function formatLength(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m ? `${m} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}

/** `2.4 Mbps` / `850 kbps`. */
export function formatBitrate(bps: number): string {
  return bps >= 1_000_000 ? `${Math.round(bps / 100_000) / 10} Mbps` : `${Math.round(bps / 1000)} kbps`;
}

/** `+4%` / `−3%`, signed. */
export function formatOff(off: number): string {
  const pct = Math.round(off * 1000) / 10;
  if (pct === 0) return "0%";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

/* ── From the edit ───────────────────────────────────────────────────────── */

/**
 * The budget for an edit as it stands, or null when there's nothing to aim
 * (no size named, or not making a video). `containerAudio` is the audio
 * codec the probe found for each container; null there means silent.
 */
export function budgetFor(
  edit: VideoEdit,
  source: SourceInfo,
  containerAudio: Record<Container, string | null> | null,
  targetBytes: number | null,
): Budget | BudgetRefusal | null {
  if (targetBytes === null || edit.output !== "video" || !source.hasVideo) return null;
  const audioCodec = source.hasAudio && !edit.mute ? (containerAudio?.[edit.container] ?? null) : null;
  return planBudget({
    targetBytes,
    durationMs: outputDuration(edit),
    size: outputSize(edit, source),
    fps: edit.fps ?? (source.fps ? source.fps * clampSpeed(edit.speed) : null),
    codec: edit.codec,
    container: edit.container,
    audio: audioCodec ? { codec: audioCodec, sampleRate: source.audioSampleRate ?? 48_000 } : null,
    framedHeight: framedSize(edit, source).height,
  });
}
