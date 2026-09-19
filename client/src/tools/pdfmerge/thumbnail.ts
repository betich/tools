import { pageThumbBatch, type PdfPageCount } from "@tools/shared";
import { url } from "@/lib/api";

/**
 * Pictures and page counts of an uploaded PDF, made by the worker's thumbnail
 * lane. Every route here answers 200 once the lane has done the work, 202
 * `{ retryAfter }` while it does it, 503 `{ retryAfter }` while it is busy, and
 * anything else (404, 415, 422, a 503 without a wait) when there will be
 * nothing — so these poll while told to wait, for a bounded time, and resolve
 * to a value or `null`. They never throw; a missing thumbnail is a tile, not
 * an error. Finished answers are kept for the page's life (the PNGs are small),
 * so going back to a file shows its pages at once.
 *
 *  - `pdfThumbnail`: page 1, ~320 px, for the merge preview (#17).
 *  - `pdfPageCount`: the page count Merge will use (#37).
 *  - `pdfPageThumb`: one page, ~200 px, for the page view's grid (#37). The
 *    worker draws pages in batches, so while a batch is on its way one request
 *    a second polls for it, however many of its tiles are waiting.
 */

/** Give up after this long of waiting — the tile says what the file is, which is enough. */
const POLL_LIMIT_MS = 60_000;
const DEFAULT_RETRY_S = 1;
const MAX_RETRY_S = 5;

const ready = new Map<string, string>();
const counts = new Map<string, number>();

const base = (uploadId: string) => `/api/pdf/uploads/${encodeURIComponent(uploadId)}`;

export async function pdfThumbnail(uploadId: string, signal: AbortSignal): Promise<string | null> {
  const known = ready.get(uploadId);
  if (known) return known;
  const res = await poll(`${base(uploadId)}/thumbnail.png`, signal);
  return res ? keep(uploadId, res) : null;
}

/** How many pages the PDF has, or `null` when that can't be known (locked, broken, no worker). */
export async function pdfPageCount(uploadId: string, signal: AbortSignal): Promise<number | null> {
  const known = counts.get(uploadId);
  if (known) return known;
  const res = await poll(`${base(uploadId)}/pages`, signal);
  if (!res) return null;
  const body = (await res.json().catch(() => null)) as Partial<PdfPageCount> | null;
  const pages = body?.pages;
  if (typeof pages !== "number" || !Number.isInteger(pages) || pages < 1) return null;
  counts.set(uploadId, pages);
  return pages;
}

/** Page `page` (1-based) of the PDF as an object URL, or `null` when there will be none. */
export async function pdfPageThumb(uploadId: string, page: number, signal: AbortSignal): Promise<string | null> {
  const key = `${uploadId}#${page}`;
  const path = `${base(uploadId)}/pages/${page}.png`;
  const deadline = Date.now() + POLL_LIMIT_MS;
  while (!signal.aborted && Date.now() < deadline) {
    const known = ready.get(key);
    if (known) return known;
    const a = await ask(path, signal);
    if (a.kind === "ok") return keep(key, a.res);
    if (a.kind === "none") return null;
    // Asked for: wait on the batch's one poller, which keeps its own page when it lands.
    await waitOn(`${uploadId}#b${pageThumbBatch(page)}`, path, a.ms, (res) => keep(key, res), signal);
  }
  return ready.get(key) ?? null;
}

// ── plumbing ───────────────────────────────────────────────────────────────

type Answer = { kind: "ok"; res: Response } | { kind: "wait"; ms: number } | { kind: "none" };

async function ask(path: string, signal: AbortSignal): Promise<Answer> {
  let res: Response;
  try {
    res = await fetch(url(path), { signal });
  } catch {
    return { kind: "none" };
  }
  if (res.status === 200) return { kind: "ok", res };
  if (res.status !== 202 && res.status !== 503) return { kind: "none" };
  const body = (await res.json().catch(() => null)) as { retryAfter?: unknown } | null;
  // A 503 without a wait is an offline worker — nothing to wait for.
  if (res.status === 503 && typeof body?.retryAfter !== "number") return { kind: "none" };
  const header = Number(res.headers.get("retry-after"));
  const asked =
    typeof body?.retryAfter === "number"
      ? body.retryAfter
      : Number.isFinite(header) && header > 0
        ? header
        : DEFAULT_RETRY_S;
  return { kind: "wait", ms: Math.min(Math.max(asked, 0.25), MAX_RETRY_S) * 1000 };
}

/** Asks until the answer is a 200 (the response) or a no (`null`), for at most POLL_LIMIT_MS. */
async function poll(path: string, signal: AbortSignal, firstWaitMs = 0): Promise<Response | null> {
  const deadline = Date.now() + POLL_LIMIT_MS;
  let wait = firstWaitMs;
  while (!signal.aborted) {
    if (wait > 0) {
      if (Date.now() + wait > deadline) return null;
      if (!(await sleep(wait, signal))) return null;
    }
    const a = await ask(path, signal);
    if (a.kind === "ok") return a.res;
    if (a.kind === "none") return null;
    wait = a.ms;
  }
  return null;
}

/** Reads a 200 into an object URL and keeps it under `key`. */
async function keep(key: string, res: Response): Promise<string | null> {
  try {
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") && blob.type !== "") return null;
    const href = URL.createObjectURL(blob);
    ready.set(key, href);
    return href;
  } catch {
    return null;
  }
}

type Shared = { done: Promise<void>; users: number; ctrl: AbortController };
const polls = new Map<string, Shared>();

/**
 * Waits on the one poller for `key`, starting it (on `path`, after `firstWaitMs`)
 * when there is none. It stops once nobody waits on it. `onReady` gets its 200.
 */
async function waitOn(
  key: string,
  path: string,
  firstWaitMs: number,
  onReady: (res: Response) => Promise<unknown>,
  signal: AbortSignal,
) {
  let shared = polls.get(key);
  if (!shared) {
    const ctrl = new AbortController();
    const entry: Shared = { users: 0, ctrl, done: Promise.resolve() };
    entry.done = poll(path, ctrl.signal, firstWaitMs)
      .then((res) => (res ? onReady(res) : null))
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (polls.get(key) === entry) polls.delete(key);
      });
    polls.set(key, entry);
    shared = entry;
  }
  shared.users++;
  try {
    await Promise.race([shared.done, aborted(signal)]);
  } finally {
    if (--shared.users === 0) shared.ctrl.abort();
  }
}

function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const t = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve(true);
    }, ms);
    const stop = () => {
      clearTimeout(t);
      resolve(false);
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}
