import { url } from "@/lib/api";

/**
 * The first page of an uploaded PDF, rendered by the worker. The route answers
 * 200 with the PNG once it exists, 202 `{ retryAfter }` while the worker's
 * priority lane draws it, and anything else (404, 415, 503) when there will be
 * none — so this polls on 202 only, for a bounded time, and resolves to an
 * object URL or `null`. It never throws; a missing thumbnail is a tile, not an
 * error. Finished renders are kept for the page's life (they are ~320 px PNGs),
 * so going back to a file shows its page at once.
 */

/** Give up after this long of 202s — the tile says what the file is, which is enough. */
const POLL_LIMIT_MS = 60_000;
const DEFAULT_RETRY_S = 1;
const MAX_RETRY_S = 5;

const ready = new Map<string, string>();

export async function pdfThumbnail(uploadId: string, signal: AbortSignal): Promise<string | null> {
  const known = ready.get(uploadId);
  if (known) return known;

  const deadline = Date.now() + POLL_LIMIT_MS;
  while (!signal.aborted) {
    let res: Response;
    try {
      res = await fetch(url(`/api/pdf/uploads/${encodeURIComponent(uploadId)}/thumbnail.png`), { signal });
    } catch {
      return null;
    }
    if (res.status === 200) {
      try {
        const blob = await res.blob();
        if (!blob.type.startsWith("image/") && blob.type !== "") return null;
        const href = URL.createObjectURL(blob);
        ready.set(uploadId, href);
        return href;
      } catch {
        return null;
      }
    }
    if (res.status !== 202) return null;

    const body = (await res.json().catch(() => null)) as { retryAfter?: unknown } | null;
    const header = Number(res.headers.get("retry-after"));
    const asked = typeof body?.retryAfter === "number" ? body.retryAfter : Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_S;
    const wait = Math.min(Math.max(asked, 0.25), MAX_RETRY_S) * 1000;
    if (Date.now() + wait > deadline) return null;
    const slept = await sleep(wait, signal);
    if (!slept) return null;
  }
  return null;
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
