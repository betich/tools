/// <reference lib="webworker" />
/**
 * Pictures out of the source, off the main thread: timeline thumbnails, and
 * preview frames when the browser's <video> can't play the file (MKV in
 * Safari, say). Mediabunny decodes with WebCodecs and reads the file in
 * ranges, so opening a 2 GB file here costs a few kilobytes.
 *
 * One request is decoded at a time, newest first, and anything the tab has
 * cancelled since is skipped — a fast scrub asks for many frames and wants
 * only the last.
 */
import type { CanvasSink, Input } from "mediabunny";

export type FramesRequest =
  | { type: "open"; file: File }
  | { type: "frame"; id: number; ms: number; width: number; height: number; fit: "cover" | "contain" }
  | { type: "cancel"; id: number };

export type FramesResponse = { id: number; bitmap: ImageBitmap | null };

const scope = self as unknown as DedicatedWorkerGlobalScope;

let input: Input | null = null;
let track: Awaited<ReturnType<Input["getPrimaryVideoTrack"]>> = null;
const sinks = new Map<string, CanvasSink>();
let queue: Extract<FramesRequest, { type: "frame" }>[] = [];
let busy = false;
let opened: Promise<void> | null = null;
/** The file's first timestamp, seconds: the tab's time 0 (as in `readSource`). */
let first = 0;

scope.onmessage = (e: MessageEvent<FramesRequest>) => {
  const msg = e.data;
  if (msg.type === "open") {
    opened = open(msg.file);
    return;
  }
  if (msg.type === "cancel") {
    const before = queue.length;
    queue = queue.filter((q) => q.id !== msg.id);
    if (queue.length !== before) reply(msg.id, null);
    return;
  }
  queue.push(msg);
  void pump();
};

async function open(file: File) {
  const mb = await import("mediabunny");
  input?.dispose();
  sinks.clear();
  input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    first = Math.max(0, await input.getFirstTimestamp());
    track = await input.getPrimaryVideoTrack();
    if (track && !(await track.canDecode())) track = null;
  } catch {
    track = null;
  }
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    await opened;
    while (queue.length > 0) {
      // Newest first: the tile or playhead the user is looking at now.
      const req = queue.pop()!;
      reply(req.id, await draw(req));
    }
  } finally {
    busy = false;
  }
}

async function draw(req: Extract<FramesRequest, { type: "frame" }>): Promise<ImageBitmap | null> {
  if (!track) return null;
  try {
    const mb = await import("mediabunny");
    const key = `${req.width}x${req.height}:${req.fit}`;
    let sink = sinks.get(key);
    if (!sink) {
      sink = new mb.CanvasSink(track, { width: req.width, height: req.height, fit: req.fit, poolSize: 1 });
      sinks.set(key, sink);
    }
    const wrapped = await sink.getCanvas(first + req.ms / 1000);
    if (!wrapped) return null;
    return await createImageBitmap(wrapped.canvas);
  } catch {
    return null;
  }
}

function reply(id: number, bitmap: ImageBitmap | null) {
  scope.postMessage({ id, bitmap } satisfies FramesResponse, bitmap ? [bitmap] : []);
}
