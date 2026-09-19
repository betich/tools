/* ───────────────────────────────────────────────────────────────────────────
   Time arithmetic for the export: retiming frames for a speed change, and
   the progress readout (fps, time remaining). No Mediabunny, no DOM.
   Seconds here, because that is what Mediabunny's samples carry.
   ─────────────────────────────────────────────────────────────────────────── */

export type Slot = { timestamp: number; duration: number };

/** Half a microsecond: timestamps that close are the same moment. */
const EPS = 5e-7;

/**
 * Maps each decoded frame (output-relative time, before the speed change) to
 * the frames it becomes. With no target rate that is one frame, sped up.
 * With one, the sped-up frame covers some slots on the output's grid: none
 * (dropped — fast forward), one, or several (held — slow motion). Slots are
 * handed out once each, in order, so overlapping frames never double up.
 */
export class Retimer {
  private next = 0;
  constructor(
    private readonly speed: number,
    private readonly fps: number | null,
  ) {}

  map(timestamp: number, duration: number): Slot[] {
    const t = timestamp / this.speed;
    const d = duration / this.speed;
    if (!this.fps) return [{ timestamp: t, duration: d }];
    const step = 1 / this.fps;
    const out: Slot[] = [];
    let n = Math.max(this.next, Math.ceil(t * this.fps - EPS * this.fps));
    while (n * step < t + d - EPS) {
      out.push({ timestamp: n * step, duration: step });
      n++;
    }
    if (out.length > 0) this.next = n;
    return out;
  }
}

/** Relabelled audio: same samples, new clock. */
export function retimeAudio(timestamp: number, speed: number): number {
  return timestamp / speed;
}

/* ── Progress ────────────────────────────────────────────────────────────── */

export type ProgressReading = {
  /** 0–1 */
  fraction: number;
  /** Output frames per wall-clock second, over the recent window; null until known. */
  fps: number | null;
  /** Wall-clock ms left; null until there is enough to go on. */
  remaining: number | null;
  elapsed: number;
};

/**
 * Turns Mediabunny's `onProgress(fraction)` into a readout. The rate is
 * taken over the last few seconds rather than since the start, so a slow
 * first second (encoder warm-up) doesn't haunt the estimate for the rest of
 * a long export.
 */
export class ProgressMeter {
  private samples: { at: number; fraction: number }[] = [];
  constructor(
    private readonly startedAt: number,
    /** Frames in the whole output, when known. */
    private readonly totalFrames: number | null,
    private readonly window = 4000,
  ) {}

  read(now: number, fraction: number): ProgressReading {
    const f = Math.min(1, Math.max(0, fraction));
    this.samples.push({ at: now, fraction: f });
    while (this.samples.length > 2 && now - this.samples[0]!.at > this.window) this.samples.shift();
    const elapsed = Math.max(0, now - this.startedAt);
    const first = this.samples[0]!;
    const span = now - first.at;
    const done = f - first.fraction;
    // Fraction per ms over the window, or since the start while the window fills.
    const rate = span >= 500 && done > 0 ? done / span : elapsed >= 500 && f > 0 ? f / elapsed : null;
    const enough = elapsed >= 1000 && f >= 0.01;
    return {
      fraction: f,
      fps: rate !== null && this.totalFrames ? rate * this.totalFrames * 1000 : null,
      remaining: rate !== null && enough ? (1 - f) / rate : null,
      elapsed,
    };
  }
}

/** `about 3 min`, `40 s`, `under 5 s` — an estimate, so it never pretends to the second above a minute. */
export function formatRemaining(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "estimating";
  const s = ms / 1000;
  if (s < 5) return "under 5 s";
  if (s < 60) return `${Math.round(s / 5) * 5} s`;
  const m = s / 60;
  if (m < 60) return `about ${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  return `about ${h} h ${Math.round(m - h * 60)} min`;
}

export function formatFps(fps: number | null): string {
  if (fps === null || !Number.isFinite(fps)) return "—";
  return fps >= 10 ? String(Math.round(fps)) : fps.toFixed(1);
}
