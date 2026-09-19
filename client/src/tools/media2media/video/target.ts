/* ───────────────────────────────────────────────────────────────────────────
   Where an export goes, and how it fails. Kept apart from the pipeline so
   the tab can ask for a save location and tell errors apart without loading
   Mediabunny before the user presses export.
   ─────────────────────────────────────────────────────────────────────────── */

import type { StreamTargetChunk } from "mediabunny";

/** The most an export may hold in memory when it can't go to disk. */
export const MEMORY_LIMIT = 1024 ** 3;

export type ExportTarget =
  | { kind: "memory"; limit?: number }
  /** A stream that honours positioned writes, like `FileSystemWritableFileStream`. */
  | { kind: "stream"; writable: WritableStream<StreamTargetChunk> };

/** A failure with a sentence the tab can show as is. */
export class ExportError extends Error {}

/** The user stopped it. */
export class ExportCanceled extends Error {
  constructor() {
    super("export stopped");
  }
}

type SavePicker = (options: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable: () => Promise<WritableStream> }>;

export function canSaveToDisk(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

/**
 * Asks where to save, where the browser can. Resolves a stream target, or
 * `"canceled"` when the user closed the dialog, or null when there is no
 * such dialog here and the export must go to memory.
 */
export async function pickDiskTarget(name: string, mime: string): Promise<ExportTarget | "canceled" | null> {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (!picker) return null;
  const ext = name.slice(name.lastIndexOf("."));
  try {
    const handle = await picker({
      suggestedName: name,
      types: [{ description: ext.slice(1).toUpperCase(), accept: { [mime]: [ext] } }],
    });
    const writable = await handle.createWritable();
    // FileSystemWritableFileStream takes { type: "write", position, data } — exactly StreamTarget's chunks.
    return { kind: "stream", writable: writable as WritableStream<StreamTargetChunk> };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "canceled";
    // A blocked picker (no user gesture, a sandboxed frame) falls back to memory.
    return null;
  }
}
