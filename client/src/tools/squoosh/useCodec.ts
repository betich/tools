import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isImageFile, pixelsToBlob } from "@/lib/codecs";
import { useCodecPool } from "@/hooks/useCodecPool";
import { fileStem } from "@/tools/media2media/names";
import { defaultOptions, formatMeta, type EncodeOptions, type Job } from "./types";

/**
 * Owns the job list on top of the shared codec pool. Changing an encode
 * setting re-runs every job, so the panel always describes what is on screen;
 * each re-run aborts the job's previous one so a stale result can't land last.
 */
export function useCodec() {
  const [options, setOptions] = useState<EncodeOptions>(defaultOptions);
  const [jobs, setJobs] = useState<Job[]>([]);

  const runs = useRef(new Map<string, AbortController>());
  const jobsRef = useRef<Job[]>([]);
  jobsRef.current = jobs;

  useEffect(
    () => () => {
      for (const c of runs.current.values()) c.abort();
      runs.current.clear();
    },
    [],
  );
  // After the effect above, so the jobs are aborted before the pool goes.
  const pool = useCodecPool();

  /** An upright PNG of the original, for sources the page can't show itself (HEIC outside Safari). */
  const preview = useCallback(async (file: File) => pixelsToBlob((await pool().decode(file)).image), [pool]);

  const patch = useCallback((id: string, next: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...next } : j)));
  }, []);

  const cancel = useCallback((id: string) => {
    runs.current.get(id)?.abort();
    runs.current.delete(id);
  }, []);

  const enqueue = useCallback(
    (targets: Job[], opts: EncodeOptions) => {
      const ids = new Set(targets.map((t) => t.id));
      setJobs((prev) => prev.map((j) => (ids.has(j.id) ? { ...j, status: "queued", error: null } : j)));

      for (const job of targets) {
        cancel(job.id);
        const run = new AbortController();
        runs.current.set(job.id, run);
        pool()
          .encode(job.file, opts, { signal: run.signal, onStart: () => patch(job.id, { status: "working" }) })
          .then((out) =>
            patch(job.id, {
              status: "done",
              error: null,
              width: out.sourceWidth,
              height: out.sourceHeight,
              outBlob: out.blob,
              outSize: out.blob.size,
              outWidth: out.width,
              outHeight: out.height,
              elapsedMs: out.elapsedMs,
            }),
          )
          .catch((error: unknown) => {
            if (run.signal.aborted) return;
            patch(job.id, { status: "error", error: error instanceof Error ? error.message : String(error), outBlob: null, outSize: 0 });
          })
          .finally(() => {
            if (runs.current.get(job.id) === run) runs.current.delete(job.id);
          });
      }
    },
    [cancel, patch, pool],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const images = files.filter(isImageFile);
      if (images.length === 0) return 0;

      const fresh: Job[] = images.map((file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        status: "queued",
        width: 0,
        height: 0,
        outWidth: 0,
        outHeight: 0,
        outBlob: null,
        outSize: 0,
        elapsedMs: 0,
        error: null,
      }));

      setJobs((prev) => [...prev, ...fresh]);
      enqueue(fresh, options);
      return images.length;
    },
    [enqueue, options],
  );

  /** Re-encode everything whenever a setting changes. */
  const apply = useCallback(
    (next: EncodeOptions) => {
      setOptions(next);
      if (jobsRef.current.length > 0) enqueue(jobsRef.current, next);
    },
    [enqueue],
  );

  const remove = useCallback(
    (id: string) => {
      cancel(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
    },
    [cancel],
  );
  const clear = useCallback(() => {
    for (const id of [...runs.current.keys()]) cancel(id);
    setJobs([]);
  }, [cancel]);

  const totals = useMemo(() => {
    const done = jobs.filter((j) => j.status === "done");
    const before = done.reduce((n, j) => n + j.file.size, 0);
    const after = done.reduce((n, j) => n + j.outSize, 0);
    return { done: done.length, total: jobs.length, before, after, saved: before - after };
  }, [jobs]);

  const busy = jobs.some((j) => j.status === "queued" || j.status === "working");

  const outputName = useCallback(
    (job: Job) => {
      return `${fileStem(job.file.name, "image")}.${formatMeta(options.format).ext}`;
    },
    [options.format],
  );

  return { options, setOptions: apply, jobs, addFiles, remove, clear, totals, busy, outputName, preview };
}
