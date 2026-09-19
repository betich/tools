/// <reference lib="webworker" />
import { stabilise } from "./diff";
import { fitReport, ladder, searchToFit, type FitReport } from "./target";
import {
  describeOptions,
  FORMATS,
  type AnimFormat,
  type EncodeOptions,
  type Encoder,
  type RawAnimation,
} from "./types";

/* ───────────────────────────────────────────────────────────────────────────
   The animation encoder worker. One export, one worker: the page terminates
   it to cancel, since a wasm encode can't be interrupted from inside.
   Encoders load on demand, so exporting an APNG never fetches gifski.
   ─────────────────────────────────────────────────────────────────────────── */

const ENCODERS: Record<AnimFormat, () => Promise<Encoder>> = {
  gif: () => import("./gifski").then((m) => m.gifski),
  apng: () => import("./apng").then((m) => m.apng),
  webp: () => import("./webp").then((m) => m.webp),
};

export type EncodeRequest = {
  format: AnimFormat;
  width: number;
  height: number;
  plays: number;
  frames: ArrayBuffer[];
  delays: number[];
  options: EncodeOptions;
};

export type EncodeReport = {
  /** The settings the file was made with (the search's pick when there was a target). */
  options: EncodeOptions;
  /** Share of the canvas written per frame after the first, after frame diff: 0–1. */
  changedShare: number;
  fit: FitReport | null;
  elapsedMs: number;
};

export type EncodeMessage =
  | { type: "progress"; fraction: number; label: string }
  | { type: "done"; bytes: ArrayBuffer; report: EncodeReport }
  | { type: "error"; message: string };

const post = (msg: EncodeMessage, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<EncodeRequest>) => {
  try {
    const done = await run(e.data);
    post({ type: "done", bytes: done.bytes.buffer as ArrayBuffer, report: done.report }, [done.bytes.buffer]);
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};

async function run(req: EncodeRequest): Promise<{ bytes: Uint8Array; report: EncodeReport }> {
  const started = performance.now();
  const info = FORMATS[req.format];
  const encoder = await ENCODERS[req.format]();
  const source = req.frames.map((b) => new Uint8Array(b));
  const target = req.options.targetBytes;

  /** One encode at `o`. With a search ahead the source is copied, since frame diff and palettes write over the frames. */
  const once = async (o: EncodeOptions, keepSource: boolean) => {
    const frames = keepSource ? source.map((f) => f.slice()) : source;
    const { changedShare } = stabilise(frames, o.tolerance);
    const anim: RawAnimation = { width: req.width, height: req.height, plays: req.plays, frames, delays: req.delays };
    return { bytes: await encoder(anim, o), changedShare };
  };

  if (target === null) {
    const options = info.resolve(req.options);
    post({ type: "progress", fraction: 0.1, label: `encoding ${info.label}` });
    const out = await once(options, false);
    return {
      bytes: out.bytes,
      report: { options, changedShare: out.changedShare, fit: null, elapsedMs: performance.now() - started },
    };
  }

  const rungs = ladder(req.format, req.options);
  const kept = new Map<number, { bytes: Uint8Array; changedShare: number }>();
  let tried = 0;
  const result = await searchToFit(rungs, target, async (o, index) => {
    tried++;
    post({
      type: "progress",
      fraction: Math.min(0.95, tried / 11),
      label: `try ${tried} · ${describeOptions(req.format, o)}`,
    });
    const out = await once(o, true);
    kept.set(index, out);
    // Only the best fit so far and the smallest overall can be the answer; let the rest go.
    prune(kept, target);
    return out.bytes.length;
  });
  const chosen = kept.get(result.index)!;
  return {
    bytes: chosen.bytes,
    report: {
      options: rungs[result.index]!,
      changedShare: chosen.changedShare,
      fit: fitReport(req.format, rungs, result, target),
      elapsedMs: performance.now() - started,
    },
  };
}

function prune(kept: Map<number, { bytes: Uint8Array }>, target: number) {
  let bestFit = -1;
  let smallest = -1;
  for (const [i, { bytes }] of kept) {
    if (bytes.length <= target && (bestFit < 0 || i < bestFit)) bestFit = i;
    // Same tie-break as the search: equal sizes go to the later rung.
    const s = smallest < 0 ? Infinity : kept.get(smallest)!.bytes.length;
    if (bytes.length < s || (bytes.length === s && i > smallest)) smallest = i;
  }
  for (const i of [...kept.keys()]) if (i !== bestFit && i !== smallest) kept.delete(i);
}
