import type { EncodeOptions } from "./formats";

/** Pixels in: a file's bytes, or pixels a previous decode already produced. */
export type WorkerSource = { kind: "bytes"; buffer: ArrayBuffer; type: string } | { kind: "pixels"; image: ImageData };

export type WorkerRequest =
  | { id: number; op: "decode"; source: WorkerSource; maxEdge: number }
  | { id: number; op: "encode"; source: WorkerSource; options: EncodeOptions };

type Common = { id: number; ok: true; sourceWidth: number; sourceHeight: number; elapsedMs: number };

export type WorkerResponse =
  | (Common & { op: "decode"; image: ImageData })
  | (Common & { op: "encode"; buffer: ArrayBuffer; mime: string; width: number; height: number })
  | { id: number; ok: false; error: string };
