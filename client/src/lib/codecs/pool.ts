import type { EncodeOptions } from "./formats";
import type { WorkerRequest, WorkerResponse, WorkerSource } from "./protocol";

/** A file (any format the worker can open, HEIC included) or pixels a decode already produced. */
export type CodecSource = Blob | ImageData;

export type RunOptions = {
  /** Aborting drops the job from the queue, or discards its result if it is already running. */
  signal?: AbortSignal;
  /** Called when a worker picks the job up — the moment it stops being queued. */
  onStart?: () => void;
};

export type Decoded = {
  /** Upright pixels, scaled to `maxEdge` when one was given. */
  image: ImageData;
  sourceWidth: number;
  sourceHeight: number;
  elapsedMs: number;
};

export type Encoded = {
  blob: Blob;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  elapsedMs: number;
};

type Op = { op: "decode"; maxEdge: number } | { op: "encode"; options: EncodeOptions };

type Task = {
  id: number;
  source: CodecSource;
  op: Op;
  run: RunOptions;
  resolve: (res: WorkerResponse & { ok: true }) => void;
  reject: (error: unknown) => void;
};

export const defaultPoolSize = () => Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));

const aborted = () => new DOMException("The codec job was cancelled", "AbortError");

/**
 * A small pool of codec workers shared by every tool that decodes or encodes
 * images in the browser. Workers are spawned on first use; jobs run FIFO.
 *
 *   const pool = new CodecPool();
 *   const { image } = await pool.decode(file, { maxEdge: 320 });   // thumbnail, HEIC too
 *   const out = await pool.encode(file, { format: "webp", ... });   // decode → encode in one trip
 *   const again = await pool.encode(image, options);                // re-encode pixels already decoded
 *   pool.dispose();
 */
export class CodecPool {
  private readonly size: number;
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Task[] = [];
  private running = new Map<Worker, Task>();
  private nextId = 1;
  private disposed = false;

  constructor(size = defaultPoolSize()) {
    this.size = Math.max(1, size);
  }

  decode(source: CodecSource, opts: RunOptions & { maxEdge?: number } = {}): Promise<Decoded> {
    return this.submit(source, { op: "decode", maxEdge: opts.maxEdge ?? 0 }, opts).then((res) => {
      if (res.op !== "decode") throw new Error("Codec worker answered the wrong request");
      return { image: res.image, sourceWidth: res.sourceWidth, sourceHeight: res.sourceHeight, elapsedMs: res.elapsedMs };
    });
  }

  encode(source: CodecSource, options: EncodeOptions, opts: RunOptions = {}): Promise<Encoded> {
    return this.submit(source, { op: "encode", options }, opts).then((res) => {
      if (res.op !== "encode") throw new Error("Codec worker answered the wrong request");
      return {
        blob: new Blob([res.buffer], { type: res.mime }),
        width: res.width,
        height: res.height,
        sourceWidth: res.sourceWidth,
        sourceHeight: res.sourceHeight,
        elapsedMs: res.elapsedMs,
      };
    });
  }

  /** Terminates every worker and rejects whatever is queued or running. */
  dispose(): void {
    this.disposed = true;
    for (const task of [...this.queue, ...this.running.values()]) task.reject(aborted());
    for (const worker of this.workers) worker.terminate();
    this.queue = [];
    this.running.clear();
    this.workers = [];
    this.idle = [];
  }

  private submit(source: CodecSource, op: Op, run: RunOptions) {
    return new Promise<WorkerResponse & { ok: true }>((resolve, reject) => {
      if (this.disposed || run.signal?.aborted) return reject(aborted());
      const task: Task = { id: this.nextId++, source, op, run, resolve, reject };
      run.signal?.addEventListener(
        "abort",
        () => {
          // Queued: drop it. Running: the worker finishes, but nobody hears the answer.
          this.queue = this.queue.filter((t) => t !== task);
          reject(aborted());
        },
        { once: true },
      );
      this.queue.push(task);
      this.pump();
    });
  }

  private pump() {
    while (this.queue.length > 0) {
      const worker = this.idle.pop() ?? this.spawn();
      if (!worker) return;
      void this.dispatch(worker, this.queue.shift()!);
    }
  }

  private spawn(): Worker | null {
    if (this.disposed || this.workers.length >= this.size) return null;
    const worker = new Worker(new URL("./codec.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (e: MessageEvent<WorkerResponse>) => this.settle(worker, e.data));
    worker.addEventListener("error", (e) => this.crash(worker, e.message || "Codec worker crashed"));
    this.workers.push(worker);
    return worker;
  }

  private async dispatch(worker: Worker, task: Task) {
    this.running.set(worker, task);
    try {
      const source = await toWorkerSource(task.source);
      if (task.run.signal?.aborted || this.disposed) return this.release(worker);
      task.run.onStart?.();
      const request: WorkerRequest = { id: task.id, source, ...task.op };
      // File bytes are ours to give away; caller-owned pixels are copied.
      worker.postMessage(request, source.kind === "bytes" ? [source.buffer] : []);
    } catch (error) {
      task.reject(error);
      this.release(worker);
    }
  }

  private settle(worker: Worker, res: WorkerResponse) {
    const task = this.running.get(worker);
    this.release(worker);
    if (!task || task.id !== res.id) return;
    if (res.ok) task.resolve(res);
    else task.reject(new Error(res.error));
  }

  /** A worker that dies (usually wasm out of memory) fails its job and is replaced on demand. */
  private crash(worker: Worker, message: string) {
    this.running.get(worker)?.reject(new Error(message));
    this.running.delete(worker);
    worker.terminate();
    this.workers = this.workers.filter((w) => w !== worker);
    this.idle = this.idle.filter((w) => w !== worker);
    this.pump();
  }

  private release(worker: Worker) {
    this.running.delete(worker);
    if (this.disposed) return;
    this.idle.push(worker);
    this.pump();
  }
}

async function toWorkerSource(source: CodecSource): Promise<WorkerSource> {
  if (source instanceof ImageData) return { kind: "pixels", image: source };
  return { kind: "bytes", buffer: await source.arrayBuffer(), type: source.type };
}
