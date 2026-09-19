/**
 * Every native tool runs through here: under an address-space cap, so a
 * hostile PDF fails with ENOMEM inside its own process instead of dragging the
 * container to its OOM killer, and under a deadline, so a pathological file
 * cannot hold the worker forever.
 */

export type RunOptions = {
  /** Address-space cap for the child, in bytes (`prlimit --as`). */
  memoryBytes: number;
  timeoutMs: number;
  cwd?: string;
  /** Added to the worker's own environment. */
  env?: Record<string, string>;
  /** Cancels the run, e.g. when the user abandons the job. */
  signal?: AbortSignal;
  /** Keep stdout — off by default; most tools write their output to a file. */
  stdout?: boolean;
};

export type RunResult = {
  code: number | null;
  /** Set when the child was killed — by the deadline, the abort, or the kernel. */
  signal: string | null;
  timedOut: boolean;
  aborted: boolean;
  ms: number;
  stdout: string;
  /** The tail of stderr, enough to explain a failure without holding a runaway log. */
  stderr: string;
};

const STDERR_KEEP = 64 * 1024;
/** After SIGTERM, how long a tool gets to exit before SIGKILL. */
const GRACE_MS = 2_000;

export async function run(cmd: string[], opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const child = Bun.spawn(["prlimit", `--as=${Math.floor(opts.memoryBytes)}`, "--", ...cmd], {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
    stdin: "ignore",
    stdout: opts.stdout ? "pipe" : "ignore",
    stderr: "pipe",
  });

  let timedOut = false;
  let aborted = false;
  const kill = () => {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), GRACE_MS).unref();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, opts.timeoutMs);
  const onAbort = () => {
    aborted = true;
    kill();
  };
  if (opts.signal?.aborted) onAbort();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });

  const [stdout, stderr] = await Promise.all([
    opts.stdout && child.stdout instanceof ReadableStream ? new Response(child.stdout).text() : "",
    tail(child.stderr, STDERR_KEEP),
    child.exited,
  ]);
  clearTimeout(timer);
  opts.signal?.removeEventListener("abort", onAbort);

  return {
    code: child.exitCode,
    signal: child.signalCode ?? null,
    timedOut,
    aborted,
    ms: Date.now() - started,
    stdout,
    stderr,
  };
}

/** Reads a stream to the end, keeping only its last `keep` bytes. */
async function tail(stream: ReadableStream<Uint8Array>, keep: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let held = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    held += chunk.byteLength;
    while (held - chunks[0]!.byteLength >= keep) held -= chunks.shift()!.byteLength;
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length > keep ? text.slice(-keep) : text;
}
