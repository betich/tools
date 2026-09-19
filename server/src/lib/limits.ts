import { statfs } from "node:fs/promises";
import type { MergeDoc } from "@tools/shared";
import { env } from "../env";

/**
 * The API runs on a small shared box behind a Cloudflare tunnel, with no
 * accounts. These are the guard rails that keep one caller — careless or
 * otherwise — from taking the CPU, the memory or the disk from everyone else.
 */

type Set = { status?: number | string; headers: Record<string, string | number> };
type Ctx = { request: Request; server: { requestIP(req: Request): { address: string } | null } | null; set: Set };

/**
 * The API is only reachable through the tunnel, and Cloudflare overwrites
 * `cf-connecting-ip` on the way in, so it is the real caller. Locally there is
 * no tunnel and the socket address is.
 */
export function clientIp({ request, server }: Pick<Ctx, "request" | "server">): string {
  return request.headers.get("cf-connecting-ip") ?? server?.requestIP(request)?.address ?? "unknown";
}

// ── rate limits ────────────────────────────────────────────────────────────

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

// Expired windows are dropped once a minute so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
}, 60_000).unref();

/** Counts one hit against `key`; returns the seconds to wait when over `max`. */
function hit(key: string, max: number, windowMs: number): number | null {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count++;
  return w.count > max ? Math.ceil((w.resetAt - now) / 1000) : null;
}

function over(key: string, max: number): number | null {
  const w = windows.get(key);
  if (!w || w.resetAt <= Date.now() || w.count < max) return null;
  return Math.ceil((w.resetAt - Date.now()) / 1000);
}

function tooMany(set: Set, retryAfter: number) {
  set.status = 429;
  set.headers["retry-after"] = String(retryAfter);
  return { error: `too many requests — try again in ${retryAfter}s`, retryAfter };
}

/** A `beforeHandle` hook allowing `max` calls per `windowMs` per caller. */
export const rateLimit =
  (name: string, max: number, windowMs = 60_000) =>
  (ctx: Ctx) => {
    const wait = hit(`${name}:${clientIp(ctx)}`, max, windowMs);
    return wait === null ? undefined : tooMany(ctx.set, wait);
  };

/**
 * Password checks are slow on purpose and are what a guesser would hammer, so
 * failures are counted per caller and per locked project. Successes are free.
 */
const GUESS_WINDOW = 15 * 60_000;
const GUESSES_PER_CALLER = 10;
const GUESSES_PER_TARGET = 30;

export function guessesLeft(ctx: Ctx, target: string) {
  const wait = over(`guess:${clientIp(ctx)}`, GUESSES_PER_CALLER) ?? over(`guess-target:${target}`, GUESSES_PER_TARGET);
  return wait === null ? undefined : tooMany(ctx.set, wait);
}

export function wrongGuess(ctx: Pick<Ctx, "request" | "server">, target: string): void {
  hit(`guess:${clientIp(ctx)}`, GUESSES_PER_CALLER, GUESS_WINDOW);
  hit(`guess-target:${target}`, GUESSES_PER_TARGET, GUESS_WINDOW);
}

// ── render gate ────────────────────────────────────────────────────────────

/**
 * Rendering is the expensive thing this server does. Only a few run at once,
 * a short queue waits behind them, and each caller gets one slot — the rest
 * are told the server is busy rather than piling up in memory.
 */
class Gate {
  private active = 0;
  private waiting: Array<() => void> = [];
  private holders = new Set<string>();

  constructor(
    private readonly concurrency: number,
    private readonly queue: number,
  ) {}

  /** A release function, or why the caller cannot have a slot. */
  async enter(caller: string): Promise<(() => void) | "busy" | "yours"> {
    if (this.holders.has(caller)) return "yours";
    if (this.active >= this.concurrency && this.waiting.length >= this.queue) return "busy";
    this.holders.add(caller);
    if (this.active >= this.concurrency) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holders.delete(caller);
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    };
  }
}

const renders = new Gate(env.renderConcurrency, env.renderQueue);

/** Runs `job` inside a render slot, or answers 503 / 429 without starting it. */
export async function withRenderSlot<T>(ctx: Ctx, job: () => Promise<T>) {
  const slot = await renders.enter(clientIp(ctx));
  if (slot === "yours") {
    ctx.set.status = 429;
    return { error: "one render at a time — wait for the last one to finish" };
  }
  if (slot === "busy") {
    ctx.set.status = 503;
    ctx.set.headers["retry-after"] = "30";
    return { error: "the server is busy rendering — try again shortly" };
  }
  try {
    return await job();
  } finally {
    slot();
  }
}

// ── shapes ─────────────────────────────────────────────────────────────────

/** Why a doc is too heavy to render here, or `null` when it is fine. */
export function docProblem(doc: MergeDoc | undefined): string | null {
  if (!doc || typeof doc !== "object") return "missing doc";
  const { width, height } = doc.canvas ?? {};
  const side = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= env.maxCanvasSide;
  if (!side(width) || !side(height)) return `canvas sides must be whole numbers from 1 to ${env.maxCanvasSide}`;
  if (!Array.isArray(doc.layers)) return "missing layers";
  if (doc.layers.length > env.maxLayers) return `at most ${env.maxLayers} layers`;
  const families = new Set<string>();
  for (const layer of doc.layers) {
    for (const face of [layer?.font, ...(layer?.font?.fallbacks ?? [])]) {
      if (face?.family) families.add(String(face.family).toLowerCase());
    }
  }
  if (families.size > env.maxFamilies) return `at most ${env.maxFamilies} font families`;
  return null;
}

export function refuse(set: Set, status: number, error: string) {
  set.status = status;
  return { error };
}

// ── disk ───────────────────────────────────────────────────────────────────

/** Whether `bytes` more can be written without eating into the box's reserve. */
export async function diskHasRoom(bytes = 0): Promise<boolean> {
  try {
    const fs = await statfs(env.dataDir);
    return fs.bavail * fs.bsize - bytes >= env.minFreeBytes;
  } catch {
    return true; // cannot tell — do not take the feature down over it
  }
}

export const DISK_FULL = "the server is out of room — try again later";
