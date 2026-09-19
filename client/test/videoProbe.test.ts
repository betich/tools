import { describe, expect, test } from "bun:test";
import {
  audioCodecNote,
  codecReason,
  decodeNote,
  discardReason,
  exportBlocker,
  NO_WEBCODECS_AUDIO,
  NO_WEBCODECS_VIDEO,
  probe,
  saveNote,
  silentReason,
  type ProbeEnv,
} from "../src/tools/media2media/video/probe";
import { defaultEdit, type SourceInfo, type VideoCodecId } from "../src/tools/media2media/video/settings";
import { formatFps, formatRemaining, ProgressMeter, Retimer } from "../src/tools/media2media/video/timing";

const env = (patch: Partial<ProbeEnv> & { video?: VideoCodecId[]; audio?: string[]; maxWidth?: number }): ProbeEnv => ({
  hasVideoEncoder: true,
  hasAudioEncoder: true,
  hasVideoDecoder: true,
  hasSavePicker: false,
  canEncodeVideo: async (codec, size) => (patch.video ?? []).includes(codec) && size.width <= (patch.maxWidth ?? 8192),
  canEncodeAudio: async (codec) => (patch.audio ?? []).includes(codec),
  ...patch,
});

const SOURCE: SourceInfo = {
  width: 1920,
  height: 1080,
  duration: 10_000,
  start: 0,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  videoCodec: "hevc",
  audioCodec: "aac",
  audioSampleRate: 48_000,
  videoDecodable: true,
};

describe("probe", () => {
  test("Chrome-like: everything but HEVC", async () => {
    const c = await probe(env({ video: ["avc", "vp9", "av1"], audio: ["aac", "opus"], hasSavePicker: true }), {
      width: 1920,
      height: 1080,
    });
    expect(c.codecs.avc).toEqual({ ok: true });
    expect(c.codecs.hevc).toEqual({ ok: false, reason: "This browser can't encode HEVC." });
    expect(c.audioOutputs.m4a.ok).toBe(true);
    expect(c.containerAudio).toEqual({ mp4: "aac", webm: "opus" });
    expect(c.saveToDisk).toBe(true);
  });

  test("Firefox-like: no AAC, so MP4 gets Opus and m4a is dimmed", async () => {
    const c = await probe(env({ video: ["avc", "vp9", "av1"], audio: ["opus", "vorbis"] }), null);
    expect(c.audioOutputs.m4a).toEqual({ ok: false, reason: "This browser can't encode AAC." });
    expect(c.audioOutputs.wav).toEqual({ ok: true });
    expect(c.containerAudio.mp4).toBe("opus");
    expect(audioCodecNote("mp4", c.containerAudio.mp4)).toBe("Audio goes in as Opus — this browser can't encode AAC.");
  });

  test("no WebCodecs at all says so, once per choice, and WAV survives", async () => {
    const c = await probe(
      env({ hasVideoEncoder: false, hasAudioEncoder: false, video: ["avc"], audio: ["aac"] }),
      null,
    );
    expect(c.codecs.av1).toEqual({ ok: false, reason: NO_WEBCODECS_VIDEO });
    expect(c.audioOutputs.ogg).toEqual({ ok: false, reason: NO_WEBCODECS_AUDIO });
    expect(c.audioOutputs.wav.ok).toBe(true);
    expect(c.containerAudio).toEqual({ mp4: null, webm: null });
  });

  test("tells 'not at this size' from 'not at all'", async () => {
    const c = await probe(env({ video: ["avc"], maxWidth: 4096 }), { width: 7680, height: 4320 });
    expect(c.codecs.avc).toEqual({ ok: false, reason: "This browser can't encode H.264 at 7680×4320." });
    expect(c.codecs.av1).toEqual({ ok: false, reason: "This browser can't encode AV1." });
  });

  test("an encoder question that throws is a no", async () => {
    const c = await probe(
      env({
        canEncodeVideo: async () => {
          throw new Error("driver");
        },
      }),
      null,
    );
    expect(c.codecs.vp9.ok).toBe(false);
  });
});

describe("wording", () => {
  test("codec and container reasons", () => {
    expect(codecReason("av1", null)).toBe("This browser can't encode AV1.");
    expect(silentReason("webm")).toBe("This browser can't encode audio for WEBM, so the export will be silent.");
    expect(audioCodecNote("webm", "opus")).toBeNull();
  });

  test("discarded tracks: the user's own choices say nothing", () => {
    expect(discardReason("audio", "discarded_by_user", "aac")).toBeNull();
    expect(discardReason("video", "undecodable_source_codec", "hevc")).toBe(
      "This browser can't decode HEVC video in this file, so it was left out.",
    );
    expect(discardReason("audio", "no_encodable_target_codec", null)).toBe(
      "This browser can't encode audio for this format, so it was left out.",
    );
  });

  test("save note states the memory limit", () => {
    expect(saveNote(false, 1024 ** 3)).toBe(
      "This browser can't write straight to disk, so the export is held in memory — up to 1 GB.",
    );
    expect(saveNote(true, 1024 ** 3)).toContain("written there as it's made");
  });

  test("blocker order: file, trim, browser", async () => {
    const caps = await probe(env({ video: ["vp9"], audio: ["opus"] }), null);
    const e = defaultEdit(SOURCE);
    expect(exportBlocker(e, { ...SOURCE, hasVideo: false }, caps)).toBe(
      "This file has no video — extract its audio instead.",
    );
    expect(exportBlocker({ ...e, trim: { in: 5000, out: 5000 } }, SOURCE, caps)).toBe(
      "The trim keeps nothing — move the in or out point.",
    );
    expect(exportBlocker(e, SOURCE, null)).toBe("Checking what this browser can encode.");
    expect(exportBlocker(e, SOURCE, caps)).toBe("This browser can't encode H.264.");
    expect(exportBlocker({ ...e, container: "webm", codec: "avc" }, SOURCE, caps)).toBe(
      "WEBM can't hold H.264 — pick MP4 for it.",
    );
    expect(exportBlocker({ ...e, codec: "vp9" }, SOURCE, caps)).toBeNull();
    expect(exportBlocker({ ...e, output: "audio", audioOutput: "m4a" }, SOURCE, caps)).toBe(
      "This browser can't encode AAC.",
    );
  });

  test("decode note names the codec", () => {
    expect(decodeNote(SOURCE)).toBeNull();
    expect(decodeNote({ ...SOURCE, videoDecodable: false })).toContain("can't decode the HEVC video");
  });
});

describe("retiming", () => {
  test("no target rate: every frame, sped up", () => {
    const r = new Retimer(2, null);
    expect(r.map(1, 1 / 30)).toEqual([{ timestamp: 0.5, duration: 1 / 60 }]);
  });

  test("fast forward onto a grid drops frames", () => {
    const r = new Retimer(4, 30);
    const kept = [];
    for (let i = 0; i < 120; i++) kept.push(...r.map(i / 30, 1 / 30));
    // 4 s of 30 fps source at 4× is 1 s: 30 frames, each on the grid once.
    expect(kept.length).toBe(30);
    kept.forEach((s, i) => expect(s.timestamp).toBeCloseTo(i / 30, 9));
  });

  test("slow motion onto a grid holds frames", () => {
    const r = new Retimer(0.5, 30);
    const out = [];
    for (let i = 0; i < 30; i++) out.push(r.map(i / 30, 1 / 30).length);
    expect(out.every((n) => n === 2)).toBe(true);
  });

  test("a slot is never handed out twice", () => {
    const r = new Retimer(1.5, 24);
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      for (const s of r.map(i / 29.97, 1 / 29.97)) {
        const k = Math.round(s.timestamp * 24);
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
    // Contiguous from zero.
    expect(Math.max(...seen) + 1).toBe(seen.size);
  });
});

describe("progress", () => {
  test("rate, fps and time left", () => {
    const m = new ProgressMeter(0, 3000);
    m.read(0, 0);
    const r = m.read(2000, 0.2);
    expect(r.fraction).toBe(0.2);
    expect(r.remaining).toBeCloseTo(8000, 3);
    expect(r.fps).toBeCloseTo(300, 3);
  });

  test("no estimate in the first second", () => {
    const m = new ProgressMeter(0, null);
    expect(m.read(400, 0.1).remaining).toBeNull();
    expect(m.read(800, 0.2).fps).toBeNull();
  });

  test("the estimate follows the recent rate, not the slow start", () => {
    const m = new ProgressMeter(0, null, 4000);
    m.read(0, 0);
    m.read(10_000, 0.1); // slow warm-up
    for (let t = 11_000; t <= 20_000; t += 1000) m.read(t, 0.1 + ((t - 10_000) / 1000) * 0.05);
    const r = m.read(20_000, 0.6);
    // 0.05 per second lately: 0.4 left is about 8 s, not the 20 s the whole-run average says.
    expect(r.remaining).toBeCloseTo(8000, -2);
  });

  test("formatting", () => {
    expect(formatRemaining(null)).toBe("estimating");
    expect(formatRemaining(3000)).toBe("under 5 s");
    expect(formatRemaining(42_000)).toBe("40 s");
    expect(formatRemaining(150_000)).toBe("about 3 min");
    expect(formatRemaining(3_900_000)).toBe("about 1 h 5 min");
    expect(formatFps(null)).toBe("—");
    expect(formatFps(4.25)).toBe("4.3");
    expect(formatFps(58.6)).toBe("59");
  });
});
