import { readFileSync } from "node:fs";
import { freemem } from "node:os";
import { env } from "./env";

/**
 * The memory guard. Hardware is the limit here: an 8 GB Pi shared with other
 * services, whose kernel boots with `cgroup_disable=memory`, so no container
 * limit is enforced and a runaway child would push the whole box into swap.
 * Instead every child runs under `prlimit --as=<headroom>` (see ./exec), big
 * images are downsampled before they are decoded at full size, and running
 * out of memory is a sentence the user reads, not a crash.
 */

const MB = 1024 * 1024;

/** A number from a file, `null` when the file is missing or says "max". */
function readBytes(file: string): number | null {
  try {
    const n = Number(readFileSync(file, "utf8").trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** The cgroup v2 directory this process lives in — `/sys/fs/cgroup` itself inside a container. */
function cgroupDir(): string | null {
  try {
    const line = readFileSync("/proc/self/cgroup", "utf8")
      .split("\n")
      .find((l) => l.startsWith("0::"));
    return line ? `/sys/fs/cgroup${line.slice(3).replace(/\/$/, "")}` : null;
  } catch {
    return null;
  }
}

/** Room left under the cgroup's limit, when there is one and it is enforced. */
function cgroupRoom(): number | null {
  for (const dir of new Set(["/sys/fs/cgroup", cgroupDir()])) {
    if (!dir) continue;
    const max = readBytes(`${dir}/memory.max`);
    const current = readBytes(`${dir}/memory.current`);
    if (max !== null && current !== null) return max - current;
  }
  return null;
}

/** What the kernel could hand out now without swapping. */
function available(): number {
  try {
    const m = /^MemAvailable:\s+(\d+) kB/m.exec(readFileSync("/proc/meminfo", "utf8"));
    if (m) return Number(m[1]) * 1024;
  } catch {
    // not Linux — fall through
  }
  return freemem();
}

/**
 * Bytes a child may use right now: the least of what is left of the worker's
 * budget, what the machine has available, and the cgroup's room when a limit
 * is actually enforced — less a reserve for the worker and the page cache.
 * Children run one at a time, so the headroom is all theirs.
 */
export function headroom(): number {
  const budget = env.memoryBudgetBytes - process.memoryUsage().rss;
  const room = Math.min(budget, available(), cgroupRoom() ?? Infinity) - env.memoryReserveBytes;
  return Math.max(0, Math.floor(room));
}

/**
 * The `prlimit --as` cap for the next child. `--as` counts address space the
 * child reserves, which runs well ahead of what it touches, so the cap is the
 * headroom with some slack (`CHILD_AS_FACTOR`) and never below a floor the
 * tools need just to start. Plan work against `headroom()`, not this.
 */
export function childMemoryLimit(): number {
  return Math.floor(Math.max(headroom() * env.childAddressFactor, env.childMemoryFloorBytes));
}

// ── images ─────────────────────────────────────────────────────────────────

/** A decoder's own tables and buffers on top of the pixels, roughly. */
const CODEC_OVERHEAD_BYTES = 48 * MB;
/** Only this much of the headroom is planned for; the estimate is a guess. */
const SAFETY = 0.8;

/**
 * Peak memory to decode and re-encode one image: the decoded pixels twice
 * (source and resampled/converted copy, 8 bits per sample) plus a quarter
 * again for the encoder's working set and a fixed codec overhead.
 */
export function estimateImagePeak(width: number, height: number, channels: number): number {
  const pixels = Math.max(0, width) * Math.max(0, height) * Math.max(1, channels);
  return pixels * 2 + pixels / 4 + CODEC_OVERHEAD_BYTES;
}

/** Whether an image must be shrunk (vips shrink-on-load) before it is processed at full size. */
export function needsPredownsample(width: number, height: number, channels: number, room = headroom()): boolean {
  return estimateImagePeak(width, height, channels) > room * SAFETY;
}

/**
 * The largest size, keeping the aspect ratio, whose estimated peak fits the
 * headroom — what to ask vips for when `needsPredownsample` says the full
 * size will not. `null` when the image fits as it is.
 */
export function predownsampleSize(
  width: number,
  height: number,
  channels: number,
  room = headroom(),
): { width: number; height: number } | null {
  if (!needsPredownsample(width, height, channels, room)) return null;
  const budget = Math.max(0, room * SAFETY - CODEC_OVERHEAD_BYTES);
  const scale = Math.sqrt(budget / (width * height * Math.max(1, channels) * 2.25));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

// ── analysis ───────────────────────────────────────────────────────────────

/**
 * How far an analysis (#8) may walk, so a hostile PDF — a million pages, or a
 * stream that inflates to gigabytes — cannot exhaust memory or time. Past
 * either cap the walk stops and `PdfAnalysis.truncated` is set.
 */
export const ANALYSIS_MAX_PAGES = 5_000;
/** Decoded stream bytes the analysis may read in total. */
export const ANALYSIS_MAX_BYTES_READ = 256 * MB;
/** Objects the analysis may visit. */
export const ANALYSIS_MAX_OBJECTS = 2_000_000;
/** Wall-clock cap for the analysis child. */
export const ANALYSIS_TIMEOUT_MS = 2 * 60_000;

// ── failures ───────────────────────────────────────────────────────────────

/**
 * Tool output that means an allocation failed under the `--as` cap. Each
 * tool says it differently: mutool "malloc (1615680000 bytes) failed"
 * (checked against 1.25), gs "VMerror", vips "out of memory"/"memory
 * allocation failed", C++ `std::bad_alloc`, Python `MemoryError`, Bun/V8
 * "out of memory" — and under a cap too small to load the tool at all, the
 * dynamic loader's "failed to map segment from shared object".
 */
const OOM_TEXT =
  /out of memory|cannot allocate memory|malloc\b[^\n]*\bfailed|failed to allocate|allocation failed|memory allocation|bad_alloc|VMerror|MemoryError|ENOMEM|failed to map segment/i;

/** Whether a finished child ran out of memory, judged by its signal and stderr. */
export function ranOutOfMemory(r: { code: number | null; signal: string | null; timedOut: boolean; aborted: boolean; stderr: string }): boolean {
  if (r.timedOut || r.aborted) return false;
  // A SIGKILL we did not send is the kernel's OOM killer.
  if (r.signal === "SIGKILL") return true;
  return (r.code !== 0 || r.signal !== null) && OOM_TEXT.test(r.stderr);
}

/**
 * The sentence shown as-is when memory runs out. `where` places it
 * ("on page 214 (image 18000×24000)"); `hint` says what to change.
 */
export function outOfMemorySentence(where?: string, hint?: string): string {
  return `Ran out of memory${where ? ` ${where}` : ""}. ${hint ?? "Try a lower DPI cap or a smaller file."}`;
}
