import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodecPool, formatMeta, formats, isImageFile, type Encoded } from "@/lib/codecs";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import {
  defaultBatch,
  optionsKey,
  resolveOptions,
  setOverride as withOverride,
  type BatchSettings,
  type FileOverride,
  type OverrideField,
} from "./batch";
import { outputName, uniqueNames } from "./names";

export type ImageJobStatus = "idle" | "queued" | "working" | "done" | "error";

export type ImageJob = {
  id: string;
  file: File;
  override?: FileOverride;
  status: ImageJobStatus;
  /** The last finished output, and the options key it was made with. */
  out: Encoded | null;
  outKey: string | null;
  error: string | null;
};

/** A job with everything the page shows about it worked out. */
export type ImageRow = ImageJob & {
  index: number;
  name: string;
  wantedKey: string;
  /** Finished, with exactly the settings it has now. */
  fresh: boolean;
};

let seq = 0;

/**
 * The image tab's batch. Files wait until Convert; then every file whose
 * output doesn't match its current settings goes to the shared codec pool.
 * Changing a setting afterwards doesn't re-encode forty photos behind your
 * back — it marks the affected rows as changed, and Convert runs just those.
 */
export function useImageBatch() {
  const [stored, setBatch] = useLocalStorage<BatchSettings>("media2media.image.batch", defaultBatch);
  const batch = useMemo(() => sanitiseBatch(stored), [stored]);
  const [jobs, setJobs] = useState<ImageJob[]>([]);

  const poolRef = useRef<CodecPool | null>(null);
  const runs = useRef(new Map<string, { key: string; abort: AbortController }>());

  useEffect(
    () => () => {
      for (const r of runs.current.values()) r.abort.abort();
      runs.current.clear();
      poolRef.current?.dispose();
      poolRef.current = null;
    },
    [],
  );

  const pool = useCallback(() => (poolRef.current ??= new CodecPool()), []);

  const patch = useCallback((id: string, next: Partial<ImageJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...next } : j)));
  }, []);

  const rows: ImageRow[] = useMemo(() => {
    const names = uniqueNames(
      jobs.map((j, i) => outputName(j.file.name, formatMeta(resolveOptions(batch, j.override).format).ext, i)),
    );
    return jobs.map((j, index) => {
      const wantedKey = optionsKey(resolveOptions(batch, j.override));
      return { ...j, index, name: names[index]!, wantedKey, fresh: j.status === "done" && j.outKey === wantedKey };
    });
  }, [jobs, batch]);

  const addFiles = useCallback((files: File[]) => {
    const images = files.filter(isImageFile);
    const fresh: ImageJob[] = images.map((file) => ({
      id: `img-${++seq}`,
      file,
      status: "idle",
      out: null,
      outKey: null,
      error: null,
    }));
    setJobs((prev) => [...prev, ...fresh]);
    return images.length;
  }, []);

  /** Sends every row whose output is missing or out of date to the pool. */
  const convert = useCallback(() => {
    for (const row of rows) {
      if (row.fresh) continue;
      const running = runs.current.get(row.id);
      if (running?.key === row.wantedKey) continue;
      running?.abort.abort();

      const options = resolveOptions(batch, row.override);
      const key = row.wantedKey;
      const abort = new AbortController();
      runs.current.set(row.id, { key, abort });
      patch(row.id, { status: "queued", error: null });

      pool()
        .encode(row.file, options, { signal: abort.signal, onStart: () => patch(row.id, { status: "working" }) })
        .then((out) => patch(row.id, { status: "done", out, outKey: key, error: null }))
        .catch((error: unknown) => {
          if (abort.signal.aborted) return;
          patch(row.id, { status: "error", error: error instanceof Error ? error.message : String(error) });
        })
        .finally(() => {
          if (runs.current.get(row.id)?.abort === abort) runs.current.delete(row.id);
        });
    }
  }, [rows, batch, patch, pool]);

  /** Drops what hasn't started and walks away from what has. Finished outputs stay. */
  const stop = useCallback(() => {
    for (const r of runs.current.values()) r.abort.abort();
    runs.current.clear();
    setJobs((prev) =>
      prev.map((j) =>
        j.status === "queued" || j.status === "working" ? { ...j, status: j.out ? "done" : "idle" } : j,
      ),
    );
  }, []);

  const remove = useCallback((id: string) => {
    runs.current.get(id)?.abort.abort();
    runs.current.delete(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const clear = useCallback(() => {
    for (const r of runs.current.values()) r.abort.abort();
    runs.current.clear();
    setJobs([]);
  }, []);

  const setOverride = useCallback(
    <K extends OverrideField>(id: string, field: K, value: BatchSettings[K] | undefined) => {
      setJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, override: withOverride(j.override, field, value) } : j)),
      );
    },
    [],
  );

  const resetOverride = useCallback((id: string) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, override: undefined } : j)));
  }, []);

  const totals = useMemo(() => {
    const fresh = rows.filter((r) => r.fresh);
    const before = fresh.reduce((n, r) => n + r.file.size, 0);
    const after = fresh.reduce((n, r) => n + (r.out?.blob.size ?? 0), 0);
    return {
      total: rows.length,
      fresh: fresh.length,
      pending: rows.filter((r) => !r.fresh).length,
      running: rows.filter((r) => r.status === "queued" || r.status === "working").length,
      failed: rows.filter((r) => r.status === "error").length,
      before,
      after,
    };
  }, [rows]);

  return {
    batch,
    setBatch: (next: BatchSettings) => setBatch(next),
    rows,
    totals,
    addFiles,
    convert,
    stop,
    remove,
    clear,
    setOverride,
    resetOverride,
  };
}

/** A stored batch from an older build may name a format that no longer exists, or miss a field. */
function sanitiseBatch(stored: Partial<BatchSettings> | null): BatchSettings {
  const merged = { ...defaultBatch, ...stored };
  if (!formats.some((f) => f.value === merged.format)) merged.format = defaultBatch.format;
  return merged;
}
