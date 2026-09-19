import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_ENGINE,
  DEFAULT_MERGE_ITEM,
  imageDpi,
  type EngineId,
  type ImageDpi,
  type MergeItem,
  type MergeItemOptions,
  type MergeOutput,
  type MergePageRun,
  type MergeParams,
  type UploadedFile,
  type UploadKind,
} from "@tools/shared";
import { uploadFailure } from "@/hooks/useUpload";
import { uploadFile, type UploadProgress } from "@/lib/upload";

/** Where one file's trip to the server stands. Files go up one at a time, in list order at the moment each starts. */
export type EntryUpload =
  | { phase: "queued" }
  | { phase: "uploading"; sent: number; total: number }
  | { phase: "done"; result: UploadedFile }
  | { phase: "failed"; message: string };

/** What the browser could make of the file for the preview. */
export type EntrySource =
  | { state: "reading" }
  | { state: "image"; bitmap: ImageBitmap; dpi: ImageDpi | null }
  /** HEIC and TIFF outside Safari: the server can read it, this browser cannot draw it. */
  | { state: "undecodable" }
  | { state: "pdf" };

export type MergeEntry = {
  key: string;
  file: File;
  kind: UploadKind;
  layout: MergeItemOptions;
  upload: EntryUpload;
  source: EntrySource;
};

export const ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,image/avif,image/gif,image/heic,image/heif,image/tiff,.pdf,.jpg,.jpeg,.png,.webp,.avif,.gif,.heic,.heif,.tif,.tiff";

const BY_EXT: Record<string, UploadKind> = {
  pdf: "pdf",
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  avif: "avif",
  gif: "gif",
  heic: "heic",
  heif: "heic",
  tif: "tiff",
  tiff: "tiff",
};

/** The kind a file claims by type or extension. The server sniffs again and has the last word. */
export function kindOf(file: File): UploadKind | null {
  const t = file.type.toLowerCase();
  if (t === "application/pdf") return "pdf";
  if (t === "image/jpeg") return "jpeg";
  if (t === "image/heif") return "heic";
  const sub = t.startsWith("image/") ? t.slice(6) : "";
  if (sub && sub in BY_EXT) return BY_EXT[sub]!;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXT[ext] ?? null;
}

/** Density lives in the first few segments; a TIFF whose IFD sits further in reads as none. */
const HEAD_BYTES = 512 * 1024;

async function readSource(file: File, kind: UploadKind): Promise<EntrySource> {
  if (kind === "pdf") return { state: "pdf" };
  try {
    const [bitmap, head] = await Promise.all([
      createImageBitmap(file),
      file.slice(0, HEAD_BYTES).arrayBuffer(),
    ]);
    return { state: "image", bitmap, dpi: imageDpi(new Uint8Array(head)) };
  } catch {
    return { state: "undecodable" };
  }
}

let counter = 0;

/**
 * The merge's inputs: the list in order, each file's page options, its upload
 * and its decoded pixels for the preview. A file starts uploading the moment
 * it is added, so by the time the list is arranged the server already has it.
 */
export function useMergeFiles() {
  const [entries, setEntries] = useState<MergeEntry[]>([]);
  const active = useRef<{ key: string; ctrl: AbortController } | null>(null);
  const live = useRef(entries);
  live.current = entries;

  const patch = useCallback((key: string, fn: (e: MergeEntry) => MergeEntry) => {
    setEntries((list) => list.map((e) => (e.key === key ? fn(e) : e)));
  }, []);

  // The upload pump: whenever nothing is going up and something is waiting, send the first waiting file.
  useEffect(() => {
    if (active.current) return;
    const next = entries.find((e) => e.upload.phase === "queued");
    if (!next) return;

    const { key, file } = next;
    const ctrl = new AbortController();
    active.current = { key, ctrl };
    let latest: UploadProgress | null = null;
    let frame = 0;
    const release = () => {
      cancelAnimationFrame(frame);
      if (active.current?.ctrl === ctrl) active.current = null;
    };

    patch(key, (e) => ({ ...e, upload: { phase: "uploading", sent: 0, total: file.size } }));
    uploadFile(file, {
      signal: ctrl.signal,
      onProgress: (p) => {
        latest = p;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const sent = latest?.sent ?? 0;
          const total = latest?.total ?? file.size;
          if (active.current?.ctrl === ctrl) patch(key, (e) => ({ ...e, upload: { phase: "uploading", sent, total } }));
        });
      },
    }).then(
      (result) => {
        release();
        patch(key, (e) => ({ ...e, upload: { phase: "done", result } }));
      },
      (error) => {
        release();
        // A removed file is simply gone; anything else says why it stopped.
        patch(key, (e) => ({ ...e, upload: { phase: "failed", message: uploadFailure(error) } }));
      },
    );
  }, [entries, patch]);

  useEffect(
    () => () => {
      active.current?.ctrl.abort();
      for (const e of live.current) if (e.source.state === "image") e.source.bitmap.close();
    },
    [],
  );

  /** Adds what it can and returns the names it could not take. */
  const add = useCallback(
    (files: File[]): { added: string[]; refused: string[] } => {
      const fresh: MergeEntry[] = [];
      const refused: string[] = [];
      for (const file of files) {
        const kind = kindOf(file);
        if (!kind) {
          refused.push(file.name);
          continue;
        }
        fresh.push({
          key: `m${++counter}`,
          file,
          kind,
          layout: { ...DEFAULT_MERGE_ITEM },
          upload: { phase: "queued" },
          source: kind === "pdf" ? { state: "pdf" } : { state: "reading" },
        });
      }
      setEntries((list) => [...list, ...fresh]);
      for (const e of fresh) {
        if (e.kind === "pdf") continue;
        void readSource(e.file, e.kind).then((source) => {
          // Removed while decoding: drop the pixels rather than keep them alive.
          if (!live.current.some((x) => x.key === e.key) && source.state === "image") return source.bitmap.close();
          patch(e.key, (x) => ({ ...x, source }));
        });
      }
      return { added: fresh.map((e) => e.key), refused };
    },
    [patch],
  );

  const remove = useCallback((key: string) => {
    if (active.current?.key === key) {
      active.current.ctrl.abort();
      active.current = null;
    }
    setEntries((list) => {
      const gone = list.find((e) => e.key === key);
      if (gone?.source.state === "image") gone.source.bitmap.close();
      return list.filter((e) => e.key !== key);
    });
  }, []);

  /** Moves an entry to `to` (its index after the move). */
  const moveTo = useCallback((key: string, to: number) => {
    setEntries((list) => {
      const from = list.findIndex((e) => e.key === key);
      if (from < 0) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(to, next.length)), 0, item!);
      return next;
    });
  }, []);

  const move = useCallback(
    (key: string, by: -1 | 1) => {
      const at = live.current.findIndex((e) => e.key === key);
      if (at >= 0) moveTo(key, at + by);
    },
    [moveTo],
  );

  const setLayout = useCallback(
    (key: string, change: Partial<MergeItemOptions>) => patch(key, (e) => ({ ...e, layout: { ...e.layout, ...change } })),
    [patch],
  );

  /** Every other image takes this one's page options. PDFs have none to take. */
  const layoutToAll = useCallback((key: string) => {
    setEntries((list) => {
      const from = list.find((e) => e.key === key);
      if (!from) return list;
      return list.map((e) => (e.kind === "pdf" || e === from ? e : { ...e, layout: { ...from.layout } }));
    });
  }, []);

  const retry = useCallback((key: string) => patch(key, (e) => ({ ...e, upload: { phase: "queued" } })), [patch]);

  /** Empties the list — after a discard, when the server no longer has any of the files. */
  const clear = useCallback(() => {
    active.current?.ctrl.abort();
    active.current = null;
    setEntries((list) => {
      for (const e of list) if (e.source.state === "image") e.source.bitmap.close();
      return [];
    });
  }, []);

  return { entries, add, remove, move, moveTo, setLayout, layoutToAll, retry, clear };
}

/**
 * The merge request, once every file is on the server; null until then.
 * `engine` is #18's picker. `pages` is the page view's order (#37) as
 * `orderRequest` hands it over — only when it differs from every file whole,
 * so an untouched page view sends exactly the file-level request.
 */
export function mergeParams(
  entries: MergeEntry[],
  output: MergeOutput,
  engine: EngineId = DEFAULT_ENGINE,
  pages?: MergePageRun[],
): MergeParams | null {
  const items = mergeItems(entries);
  if (!items) return null;
  const title = output.title?.trim() || null;
  return { items, output: { ...output, title }, engine, ...(pages ? { pages } : {}) };
}

/** One item per entry, in list order — so an item's index is its entry's — once every file is uploaded; null until then. */
export function mergeItems(entries: MergeEntry[]): MergeItem[] | null {
  if (entries.length === 0) return null;
  const items: MergeItem[] = [];
  for (const e of entries) {
    if (e.upload.phase !== "done") return null;
    items.push({ upload: e.upload.result.id, name: e.file.name, kind: e.upload.result.kind, layout: e.layout });
  }
  return items;
}

/** The title a merge gets when none is typed: the first file's name without its extension, as the server does. */
export function defaultTitle(name: string | undefined): string {
  if (!name) return "merged";
  return name.replace(/\.[^./\\]+$/, "") || name;
}
