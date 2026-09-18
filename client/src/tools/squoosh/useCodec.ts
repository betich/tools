import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultOptions, formatMeta, type EncodeOptions, type Job, type WorkerRequest, type WorkerResponse } from "./types";

const POOL_SIZE = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));

function makeWorker(): Worker {
  return new Worker(new URL("./codec.worker.ts", import.meta.url), { type: "module" });
}

/**
 * Owns the worker pool and the job list. Changing an encode setting re-runs
 * every job, so the panel always describes what is on screen.
 */
export function useCodec() {
  const [options, setOptions] = useState<EncodeOptions>(defaultOptions);
  const [jobs, setJobs] = useState<Job[]>([]);

  const pool = useRef<Worker[]>([]);
  const queue = useRef<WorkerRequest[]>([]);
  const idle = useRef<Worker[]>([]);
  const jobsRef = useRef<Job[]>([]);
  jobsRef.current = jobs;

  useEffect(() => {
    pool.current = Array.from({ length: POOL_SIZE }, makeWorker);
    idle.current = [...pool.current];
    for (const worker of pool.current) worker.addEventListener("message", onMessage);
    return () => {
      for (const worker of pool.current) worker.terminate();
      pool.current = [];
      idle.current = [];
      queue.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pump = useCallback(() => {
    while (idle.current.length > 0 && queue.current.length > 0) {
      const worker = idle.current.pop()!;
      const request = queue.current.shift()!;
      setJobs((prev) => prev.map((j) => (j.id === request.id ? { ...j, status: "working" } : j)));
      worker.postMessage(request, [request.buffer]);
    }
  }, []);

  function onMessage(event: MessageEvent<WorkerResponse>) {
    const worker = event.currentTarget as Worker;
    idle.current.push(worker);
    const res = event.data;

    setJobs((prev) =>
      prev.map((job) => {
        if (job.id !== res.id) return job;
        if (!res.ok) return { ...job, status: "error", error: res.error, outBlob: null, outSize: 0 };
        const blob = new Blob([res.buffer], { type: res.mime });
        return {
          ...job,
          status: "done",
          error: null,
          outBlob: blob,
          outSize: blob.size,
          outWidth: res.width,
          outHeight: res.height,
          elapsedMs: res.elapsedMs,
        };
      }),
    );
    pump();
  }

  const enqueue = useCallback(
    async (targets: Job[], opts: EncodeOptions) => {
      for (const job of targets) {
        queue.current.push({ id: job.id, buffer: await job.file.arrayBuffer(), type: job.file.type, options: opts });
      }
      setJobs((prev) => prev.map((j) => (targets.some((t) => t.id === j.id) ? { ...j, status: "queued", error: null } : j)));
      pump();
    },
    [pump],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
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
      void enqueue(fresh, options);
      return images.length;
    },
    [enqueue, options],
  );

  /** Re-encode everything whenever a setting changes. */
  const apply = useCallback(
    (next: EncodeOptions) => {
      setOptions(next);
      if (jobsRef.current.length > 0) void enqueue(jobsRef.current, next);
    },
    [enqueue],
  );

  const remove = useCallback((id: string) => setJobs((prev) => prev.filter((j) => j.id !== id)), []);
  const clear = useCallback(() => setJobs([]), []);

  const totals = useMemo(() => {
    const done = jobs.filter((j) => j.status === "done");
    const before = done.reduce((n, j) => n + j.file.size, 0);
    const after = done.reduce((n, j) => n + j.outSize, 0);
    return { done: done.length, total: jobs.length, before, after, saved: before - after };
  }, [jobs]);

  const busy = jobs.some((j) => j.status === "queued" || j.status === "working");

  const outputName = useCallback(
    (job: Job) => {
      const stem = job.file.name.replace(/\.[^.]+$/, "");
      return `${stem}.${formatMeta(options.format).ext}`;
    },
    [options.format],
  );

  return { options, setOptions: apply, jobs, addFiles, remove, clear, totals, busy, outputName };
}
