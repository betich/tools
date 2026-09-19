import { pageThumbBatch, type PdfPageCount } from "@tools/shared";
import { url } from "@/lib/api";

/**
 * Pictures and page counts of an uploaded PDF, made by the worker's thumbnail
 * lane. Every route here answers 200 once the lane has done the work, 202
 * `{ retryAfter }` while it does it, 503 `{ retryAfter }` while it is busy, and
 * anything else (404, 415, 422, a 503 without a wait) when there will be
 * nothing — so these poll while told to wait, for a bounded time. They never
 * throw; a missing thumbnail is a tile, not an error. Finished answers are
 * kept for the page's life (the PNGs are small), so going back to a file
 * shows its pages at once.
 *
 *  - `pdfThumbnail`: page 1, ~320 px, for the merge preview (#17).
 *  - `pdfPageCount`: the page count Merge will use (#37). Unlike a picture it
 *    says why when there is none, and whether asking again could help.
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

/**
 * A PDF's page count as the server gave it. `refused` is final — the file is
 * locked or broken — and `reason` is the server's sentence, to show as-is.
 * `unavailable` is only for now: the worker is offline, the connection
 * dropped, or the count took too long; `reason` is the server's sentence when
 * it sent one. Ask again later.
 */
export type PageCount =
  | { state: "counted"; pages: number }
  | { state: "refused"; reason: string }
  | { state: "unavailable"; reason: string | null };

/** For a refusal that came without a sentence. */
const UNCOUNTABLE = "this PDF's pages could not be counted";

const base = (uploadId: string) => `/api/pdf/uploads/${encodeURIComponent(uploadId)}`;

export async function pdfThumbnail(uploadId: string, signal: AbortSignal): Promise<string | null> {
  const known = ready.get(uploadId);
  if (known) return known;
  const a = await poll(`${base(uploadId)}/thumbnail.png`, signal);
  return a.kind === "ok" ? keepImage(uploadId, a.res) : null;
}

/** How many pages the PDF has — or why that can't be known, and whether it may be later. */
export async function pdfPageCount(uploadId: string, signal: AbortSignal): Promise<PageCount> {
  const known = counts.get(uploadId);
  if (known) return { state: "counted", pages: known };
  const a = await poll(`${base(uploadId)}/pages`, signal);
  if (a.kind === "no") {
    // A 4xx is about the file (locked, broken, not a PDF, gone); the rest is the server, for now.
    const final = a.status !== null && a.status >= 400 && a.status < 500;
    return final ? { state: "refused", reason: a.reason ?? UNCOUNTABLE } : { state: "unavailable", reason: a.reason };
  }
  if (a.kind === "gave-up") return { state: "unavailable", reason: null };
  const body = (await a.res.json().catch(() => null)) as Partial<PdfPageCount> | null;
  const pages = body?.pages;
  if (typeof pages !== "number" || !Number.isInteger(pages) || pages < 1) return { state: "unavailable", reason: null };
  counts.set(uploadId, pages);
  return { state: "counted", pages };
}

/** Page `page` (1-based) of the PDF as an object URL, or `null` when there will be none. */
export async function pdfPageThumb(uploadId: string, page: number, signal: AbortSignal): Promise<string | null> {
  const key = `${uploadId}#${page}`;
  const path = `${base(uploadId)}/pages/${page}.png`;
  const deadline = Date.now() + POLL_LIMIT_MS;
  while (!signal.aborted && Date.now() < deadline) {
    const known = ready.get(key);
    if (known) return known;
    const a = await askOnce(path, signal);
    if (a.kind === "ok") return keepImage(key, a.res);
    if (a.kind === "no") return null;
    // Asked for: wait on the batch's one poller, which keeps its own page when it lands.
    await waitOnShared(`${uploadId}#b${pageThumbBatch(page)}`, path, a.ms, (res) => keepImage(key, res), signal);
  }
  return ready.get(key) ?? null;
}

// ── plumbing ───────────────────────────────────────────────────────────────

/**
 * One answer from the API: the 200, how long to wait before asking again, or
 * a no — with its status (`null` when the request never got an answer) and
 * the server's sentence when it sent one.
 */
type Answer =
  | { kind: "ok"; res: Response }
  | { kind: "wait"; ms: number }
  | { kind: "no"; status: number | null; reason: string | null };

async function askOnce(path: string, signal: AbortSignal): Promise<Answer> {
  let res: Response;
  try {
    res = await fetch(url(path), { signal });
  } catch {
    return { kind: "no", status: null, reason: null };
  }
  if (res.status === 200) return { kind: "ok", res };
  const body = (await res.json().catch(() => null)) as { retryAfter?: unknown; error?: unknown } | null;
  const no: Answer = { kind: "no", status: res.status, reason: typeof body?.error === "string" && body.error ? body.error : null };
  if (res.status !== 202 && res.status !== 503) return no;
  // A 503 without a wait is an offline worker — nothing to wait for.
  if (res.status === 503 && typeof body?.retryAfter !== "number") return no;
  const header = Number(res.headers.get("retry-after"));
  const asked =
    typeof body?.retryAfter === "number"
      ? body.retryAfter
      : Number.isFinite(header) && header > 0
        ? header
        : DEFAULT_RETRY_S;
  return { kind: "wait", ms: Math.min(Math.max(asked, 0.25), MAX_RETRY_S) * 1000 };
}

/** How a poll ended: the 200, a no, or it stopped waiting (POLL_LIMIT_MS passed, or it was aborted). */
type Polled = Exclude<Answer, { kind: "wait" }> | { kind: "gave-up" };

/** Asks until the answer is a 200 or a no, for at most POLL_LIMIT_MS. */
async function poll(path: string, signal: AbortSignal, firstWaitMs = 0): Promise<Polled> {
  const deadline = Date.now() + POLL_LIMIT_MS;
  let wait = firstWaitMs;
  while (!signal.aborted) {
    if (wait > 0) {
      if (Date.now() + wait > deadline) break;
      if (!(await sleep(wait, signal))) break;
    }
    const a = await askOnce(path, signal);
    if (a.kind !== "wait") return a;
    wait = a.ms;
  }
  return { kind: "gave-up" };
}

/** Reads a 200 into an object URL and keeps it under `key`. */
async function keepImage(key: string, res: Response): Promise<string | null> {
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
async function waitOnShared(
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
      .then((a) => (a.kind === "ok" ? onReady(a.res) : null))
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
