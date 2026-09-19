import type { SourceInfo } from "./settings";

/** Formats the tab accepts. MKV and MOV often report an empty or odd MIME, so extensions too. */
export const VIDEO_ACCEPT = "video/*,.mp4,.m4v,.mov,.webm,.mkv";

export function looksLikeVideo(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name);
}

export class SourceError extends Error {}

/**
 * Reads what the tab needs from the file's headers. Mediabunny reads only
 * the byte ranges it asks for, so a 2 GB file costs a few kilobytes here.
 */
export async function readSource(file: File): Promise<SourceInfo> {
  const { Input, BlobSource, ALL_FORMATS, UnsupportedInputFormatError } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    let video, audio;
    try {
      [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    } catch (e) {
      if (e instanceof UnsupportedInputFormatError) {
        throw new SourceError("This isn't a video this tool can read. MP4, MOV, WebM and MKV work.");
      }
      throw e;
    }
    if (!video && !audio) throw new SourceError("This file has no video or audio in it.");
    // Some files don't start at zero (MPEG-TS, edit lists); the tab counts from the first frame.
    const start = Math.max(0, await input.getFirstTimestamp());
    const duration = Math.max(0, (await input.computeDuration()) - start) * 1000;
    let fps: number | null = null;
    if (video) {
      try {
        const stats = await video.computePacketStats(120);
        fps = stats.averagePacketRate > 0 ? stats.averagePacketRate : null;
      } catch {
        fps = null;
      }
    }
    return {
      width: video ? await video.getDisplayWidth() : 0,
      height: video ? await video.getDisplayHeight() : 0,
      duration,
      start,
      fps,
      hasVideo: !!video,
      hasAudio: !!audio,
      videoCodec: video ? await video.getCodec() : null,
      audioCodec: audio ? await audio.getCodec() : null,
      audioSampleRate: audio ? await audio.getSampleRate() : null,
      videoDecodable: video ? await video.canDecode().catch(() => false) : true,
    };
  } finally {
    input.dispose();
  }
}
