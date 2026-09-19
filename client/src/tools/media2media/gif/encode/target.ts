/* ───────────────────────────────────────────────────────────────────────────
   Target size: find the best settings whose file fits.

   Each format has a ladder of settings, best-looking first, each rung a
   little smaller than the last. The search tries the user's own settings,
   then the smallest rung (if even that is over, nothing will fit), then
   halves the ladder until it finds the first rung that fits. File size isn't
   perfectly monotonic in the settings, so every result is kept and the
   answer is the best-looking one that fit — or, when none did, the smallest,
   with the gap said in words (same idea as PDF Compress, #12).
   ─────────────────────────────────────────────────────────────────────────── */

import { bytes } from "@/lib/format";
import { describeOptions, FORMATS, MAX_TOLERANCE, QUALITY_FORMATS, type AnimFormat, type EncodeOptions } from "./types";

/** A hit is "on target" when it is at most this far under. */
export const CLOSE_ENOUGH = 0.05;
export const MAX_TRIES = 12;

/** Past this, frame-diff tolerance starts to smear motion, so the ladder only goes there after the cheap cuts. */
const SOFT_TOLERANCE = 24;
/** Quality (gifski's, WebP's) is lowered to here before tolerance is raised, then the rest of the way. */
const SOFT_QUALITY = 30;
/** A palette is cut to here before tolerance is raised, then the rest of the way. */
const SOFT_COLOURS = 32;

const range = (from: number, to: number) => {
  const out: number[] = [];
  const step = from <= to ? 1 : -1;
  for (let v = from; step > 0 ? v <= to : v >= to; v += step) out.push(v);
  return out;
};

/**
 * The settings to search, from the user's own (rung 0) down to the smallest
 * this format can go. Only the knobs the format has are moved; the rest keep
 * the user's values.
 */
export function ladder(format: AnimFormat, start: EncodeOptions): EncodeOptions[] {
  const o = FORMATS[format].resolve({ ...start, targetBytes: null });
  const rungs: EncodeOptions[] = [o];
  const push = (patch: Partial<EncodeOptions>) => {
    const last = rungs[rungs.length - 1]!;
    const next = FORMATS[format].resolve({ ...last, ...patch });
    if (next.quality !== last.quality || next.colours !== last.colours || next.tolerance !== last.tolerance)
      rungs.push(next);
  };
  const tolerance = (to: number) => {
    for (const t of range(rungs[rungs.length - 1]!.tolerance + 1, to)) push({ tolerance: t });
  };

  if (QUALITY_FORMATS.includes(format)) {
    for (const q of range(o.quality - 1, Math.min(o.quality - 1, SOFT_QUALITY))) push({ quality: q });
    tolerance(SOFT_TOLERANCE);
    for (const q of range(rungs[rungs.length - 1]!.quality - 1, 1)) push({ quality: q });
    tolerance(MAX_TOLERANCE);
  } else {
    // Full colour first gives way to the largest palette, dithered the way the user chose.
    if (o.colours === 0) push({ colours: 256, dither: start.dither });
    const now = () => rungs[rungs.length - 1]!.colours;
    for (const c of range(now() - 1, Math.min(now() - 1, SOFT_COLOURS))) push({ colours: c });
    tolerance(SOFT_TOLERANCE);
    for (const c of range(now() - 1, 2)) push({ colours: c });
    tolerance(MAX_TOLERANCE);
  }
  return rungs;
}

export type Try = { index: number; bytes: number };

export type SearchResult = {
  /** The rung chosen: the best-looking that fit, or else the smallest. */
  index: number;
  bytes: number;
  reached: boolean;
  /** When the hit is well under the target: the next better-looking rung that was tried, and its size. */
  nextUp: Try | null;
  tries: Try[];
};

/**
 * Searches `rungs` for the first (best-looking) rung whose size, measured by
 * `measure`, is at most `target`. At most `maxTries` measurements.
 */
export async function searchToFit<T>(
  rungs: readonly T[],
  target: number,
  measure: (rung: T, index: number) => Promise<number>,
  maxTries = MAX_TRIES,
): Promise<SearchResult> {
  if (rungs.length === 0) throw new Error("Nothing to search.");
  const tries: Try[] = [];
  const sizes = new Map<number, number>();
  const at = async (index: number) => {
    const known = sizes.get(index);
    if (known !== undefined) return known;
    const size = await measure(rungs[index]!, index);
    sizes.set(index, size);
    tries.push({ index, bytes: size });
    return size;
  };

  const last = rungs.length - 1;
  if ((await at(0)) <= target || last === 0 || (await at(last)) > target) return settle(tries, target);

  // Invariant: rung `lo` is over, rung `hi` fits.
  let lo = 0;
  let hi = last;
  while (hi - lo > 1 && tries.length < maxTries) {
    const mid = (lo + hi) >> 1;
    if ((await at(mid)) <= target) hi = mid;
    else lo = mid;
  }
  return settle(tries, target);
}

function settle(tries: Try[], target: number): SearchResult {
  const fits = tries.filter((t) => t.bytes <= target).sort((a, b) => a.index - b.index);
  const best = fits[0];
  if (!best) {
    const smallest = [...tries].sort((a, b) => a.bytes - b.bytes || b.index - a.index)[0]!;
    return { index: smallest.index, bytes: smallest.bytes, reached: false, nextUp: null, tries };
  }
  const better = tries.filter((t) => t.index < best.index).sort((a, b) => b.index - a.index)[0] ?? null;
  return { index: best.index, bytes: best.bytes, reached: true, nextUp: better, tries };
}

export type FitReport = {
  target: number;
  bytes: number;
  reached: boolean;
  /** Reached and within `CLOSE_ENOUGH` of the target, or reached at the user's own settings. */
  close: boolean;
  /** The chosen settings, in words. */
  settings: string;
  /** Why it isn't on target, or null when it is. Leads with the numbers, like PDF Compress's gap line. */
  gap: string | null;
  tries: number;
};

/** The search's outcome in words, for the export panel. */
export function fitReport(
  format: AnimFormat,
  rungs: readonly EncodeOptions[],
  result: SearchResult,
  target: number,
): FitReport {
  const chosen = rungs[result.index]!;
  const settings = describeOptions(format, chosen);
  const under = (target - result.bytes) / target;
  const base = { target, bytes: result.bytes, reached: result.reached, settings, tries: result.tries.length };

  if (!result.reached) {
    return {
      ...base,
      close: false,
      gap:
        `reached ${bytes(result.bytes)} of ${bytes(target)} — even at ${settings} the frames hold more than fits. ` +
        "Fewer frames or a smaller canvas will get there.",
    };
  }
  // The user's own settings already fit: nothing was lowered, so there is no gap to explain.
  if (result.index === 0 || under <= CLOSE_ENOUGH) return { ...base, close: true, gap: null };

  const up = result.nextUp;
  const why = !up
    ? "the search ran out of tries before it got closer."
    : up.index === result.index - 1
      ? `the next step up, ${describeOptions(format, rungs[up.index]!)}, came to ${bytes(up.bytes)}.`
      : `the search stopped after ${result.tries.length} tries; the closest better setting, ${describeOptions(format, rungs[up.index]!)}, came to ${bytes(up.bytes)}.`;
  return {
    ...base,
    close: false,
    gap: `landed at ${bytes(result.bytes)}, ${Math.round(under * 100)}% under ${bytes(target)} — ${why}`,
  };
}
