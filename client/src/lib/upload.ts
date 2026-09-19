import type { UploadedFile, UploadSession, UploadStatus } from "@tools/shared";
import { ApiError, request, url } from "./api";

/**
 * Chunked, resumable uploads for the PDF tools (#5). A file goes up in
 * `partSize` slices, two at a time, each carrying its own SHA-256 so the server
 * can refuse a part that arrived damaged. A part that fails on the wire is
 * retried with backoff, after asking the server whether it landed anyway; a
 * session is remembered per file, so calling `uploadFile` again with the same
 * file after a failure or a cancel picks up where it stopped.
 */

export type UploadProgress = {
  /** Bytes the server has, plus the bytes of the parts in flight. */
  sent: number;
  total: number;
  partsDone: number;
  parts: number;
};

export type UploadOptions = {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
};

const CONCURRENCY = 2;
const ATTEMPTS = 5;
/** Hash mismatch, a dropped connection, and Cloudflare's origin hiccups — worth another go. */
const RETRYABLE = new Set([0, 400, 502, 504, 520, 521, 522, 523, 524]);

export async function uploadFile(file: File, { onProgress, signal }: UploadOptions = {}): Promise<UploadedFile> {
  signal?.throwIfAborted();
  let { session, received } = await open(file, signal);
  if ("kind" in session) return finish(file, session);

  for (let round = 0; ; round++) {
    await sendParts(file, session, received, onProgress, signal);
    try {
      return finish(file, await request<UploadedFile>(`/api/pdf/uploads/${session.id}/complete`, { method: "POST", signal }));
    } catch (error) {
      // `complete` names the parts it is missing; ask which and send them once more.
      if (!(error instanceof ApiError) || error.status !== 400 || round > 0) throw forgetOn404(file, error);
      const status = await request<UploadStatus | UploadedFile>(`/api/pdf/uploads/${session.id}`, { signal });
      if ("kind" in status) return finish(file, status);
      received = status.received;
    }
  }
}

/** A remembered session if the server still has it, else a fresh one. */
async function open(file: File, signal?: AbortSignal): Promise<{ session: UploadSession | UploadedFile; received: number[] }> {
  const remembered = recall(file);
  if (remembered) {
    try {
      const status = await request<UploadStatus | UploadedFile>(`/api/pdf/uploads/${remembered}`, { signal });
      if ("kind" in status) return { session: status, received: [] };
      return { session: status, received: status.received };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      remember(file, null);
    }
  }
  const session = await request<UploadSession>("/api/pdf/uploads", {
    method: "POST",
    body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
    signal,
  });
  remember(file, session.id);
  return { session, received: [] };
}

function finish(file: File, done: UploadedFile): UploadedFile {
  remember(file, null);
  return done;
}

async function sendParts(
  file: File,
  session: UploadSession,
  received: number[],
  onProgress: UploadOptions["onProgress"],
  outer: AbortSignal | undefined,
) {
  const sizeOf = (n: number) => Math.min(session.partSize, file.size - n * session.partSize);
  const done = new Set(received);
  const inFlight = new Map<number, number>();
  const report = () => {
    let sent = 0;
    for (const n of done) sent += sizeOf(n);
    for (const loaded of inFlight.values()) sent += loaded;
    onProgress?.({ sent, total: file.size, partsDone: done.size, parts: session.parts });
  };
  report();

  const queue = Array.from({ length: session.parts }, (_, n) => n).filter((n) => !done.has(n));
  // One part failing for good stops its sibling rather than letting it finish into the void.
  const stop = new AbortController();
  const signal = outer ? AbortSignal.any([outer, stop.signal]) : stop.signal;

  const worker = async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
      await sendPart(file, session, n, sizeOf(n), signal, (loaded) => {
        inFlight.set(n, loaded);
        report();
      });
      inFlight.delete(n);
      done.add(n);
      report();
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  } catch (error) {
    stop.abort();
    throw forgetOn404(file, outer?.aborted ? outer.reason : error);
  }
}

async function sendPart(
  file: File,
  session: UploadSession,
  n: number,
  size: number,
  signal: AbortSignal,
  onLoaded: (bytes: number) => void,
) {
  const start = n * session.partSize;
  const body = await file.slice(start, start + size).arrayBuffer();
  const hash = await sha256(body);

  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted();
    try {
      onLoaded(0);
      await put(`/api/pdf/uploads/${session.id}/parts/${n}`, body, hash, signal, onLoaded);
      return;
    } catch (error) {
      if (signal.aborted || !(error instanceof ApiError) || !RETRYABLE.has(error.status) || attempt >= ATTEMPTS) {
        throw error instanceof ApiError && error.status === 0 ? new UploadInterrupted() : error;
      }
      onLoaded(0);
      await wait(Math.min(1000 * 2 ** (attempt - 1), 15_000), signal);
      // The connection dropped mid-part: it may have landed before the reply was lost.
      if (error.status !== 400 && (await landed(session.id, n, signal))) return;
    }
  }
}

async function landed(id: string, n: number, signal: AbortSignal): Promise<boolean> {
  try {
    const status = await request<UploadStatus | UploadedFile>(`/api/pdf/uploads/${id}`, { signal });
    return "kind" in status || status.received.includes(n);
  } catch {
    return false; // still offline — the retry will find out
  }
}

/** XHR rather than fetch, because fetch cannot report upload progress. */
function put(path: string, body: ArrayBuffer, hash: string, signal: AbortSignal, onLoaded: (bytes: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const settle = () => signal.removeEventListener("abort", abort);
    xhr.open("PUT", url(path));
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader("x-sha256", hash);
    xhr.upload.onprogress = (e) => onLoaded(e.loaded);
    xhr.onload = () => {
      settle();
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `upload failed (${xhr.status})`;
      try {
        message = JSON.parse(xhr.responseText)?.error ?? message;
      } catch {
        /* not JSON — a proxy's error page */
      }
      reject(new ApiError(message, xhr.status));
    };
    xhr.onerror = xhr.ontimeout = () => {
      settle();
      reject(new ApiError("network error", 0));
    };
    xhr.onabort = () => {
      settle();
      reject(signal.reason ?? new DOMException("The upload was cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(body);
  });
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", cancel);
      resolve();
    }
    function cancel() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", cancel, { once: true });
  });
}

/** The wire, not the server, gave out — the parts already sent are kept for the next try. */
export class UploadInterrupted extends Error {
  constructor() {
    super("The connection kept dropping. Try again and the upload picks up where it stopped.");
    this.name = "UploadInterrupted";
  }
}

/** The server has let the session go; the next try starts a new one. */
function forgetOn404(file: File, error: unknown): unknown {
  if (error instanceof ApiError && error.status === 404) remember(file, null);
  return error;
}

// ── Remembered sessions ────────────────────────────────────────────────────
// Keyed by what identifies a picked file without reading it. Every access is
// guarded — private mode throws, and a tool that forgets still uploads.

const STORE = "tools.uploads";
const KEEP_MS = 2 * 24 * 60 * 60 * 1000;
type Remembered = Record<string, { id: string; at: number }>;

const keyOf = (file: File) => `${file.name}\u0000${file.size}\u0000${file.lastModified}`;

function read(): Remembered {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Remembered;
    return all && typeof all === "object" ? all : {};
  } catch {
    return {};
  }
}

function recall(file: File): string | null {
  return read()[keyOf(file)]?.id ?? null;
}

function remember(file: File, id: string | null) {
  const now = Date.now();
  const all = Object.fromEntries(Object.entries(read()).filter(([, v]) => now - v.at < KEEP_MS));
  if (id) all[keyOf(file)] = { id, at: now };
  else delete all[keyOf(file)];
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* quota or private mode */
  }
}
