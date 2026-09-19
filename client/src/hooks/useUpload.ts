import { useCallback, useEffect, useRef, useState } from "react";
import type { UploadedFile } from "@tools/shared";
import { ApiError } from "@/lib/api";
import { uploadFile, UploadInterrupted, type UploadProgress } from "@/lib/upload";

export type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; file: File; progress: UploadProgress | null }
  | { phase: "done"; file: File; progress: UploadProgress | null; result: UploadedFile }
  | { phase: "failed"; file: File; progress: UploadProgress | null; message: string };

/**
 * One file's trip to the server, for a tool page to hold in state. `start`
 * resolves with the upload (or `null` if it failed or was stopped, which the
 * state then explains); `retry` sends the same file again, resuming from the
 * parts already there. Progress is folded to one update per frame.
 */
export function useUpload() {
  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const control = useRef<AbortController | null>(null);

  useEffect(() => () => control.current?.abort(), []);

  const start = useCallback(async (file: File): Promise<UploadedFile | null> => {
    control.current?.abort();
    const ctrl = new AbortController();
    control.current = ctrl;
    let progress: UploadProgress | null = null;
    let frame = 0;
    setState({ phase: "uploading", file, progress });

    try {
      const result = await uploadFile(file, {
        signal: ctrl.signal,
        onProgress: (p) => {
          progress = p;
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (control.current === ctrl) setState({ phase: "uploading", file, progress });
          });
        },
      });
      if (control.current === ctrl) setState({ phase: "done", file, progress, result });
      return result;
    } catch (error) {
      if (control.current === ctrl) setState({ phase: "failed", file, progress, message: uploadFailure(error) });
      return null;
    } finally {
      cancelAnimationFrame(frame);
    }
  }, []);

  const cancel = useCallback(() => control.current?.abort(), []);

  const retry = useCallback(() => {
    if (state.phase === "failed") return start(state.file);
    return Promise.resolve(null);
  }, [state, start]);

  const reset = useCallback(() => {
    control.current?.abort();
    control.current = null;
    setState({ phase: "idle" });
  }, []);

  return { state, start, cancel, retry, reset };
}

/** What to say when an upload stops. The server's refusals are already sentences, so they pass through as-is. */
export function uploadFailure(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "Stopped. Upload the same file again to pick up where it left off.";
  if (error instanceof ApiError || error instanceof UploadInterrupted) return error.message;
  return "The API could not be reached. Try again in a moment.";
}
