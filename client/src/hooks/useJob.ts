import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JobCreate, JobEvent, JobInfo, TaskCreate, TaskInfo, TaskKind } from "@tools/shared";
import { ApiError } from "@/lib/api";
import { pdfJobs, watchJob } from "@/lib/pdfjobs";

export type JobState = {
  job: JobInfo | null;
  /** The last refusal or failure of a call, as a sentence to show as-is. */
  error: string | null;
  /** The job ran out its hour (or was discarded elsewhere); the page should start over. */
  expired: boolean;
};

const EMPTY: JobState = { job: null, error: null, expired: false };

/**
 * One PDF job session for a tool page. It holds the latest `JobInfo`, keeps it
 * current from the event stream, and folds each call's own answer in as well so
 * the page never waits for the stream to echo what it just did. Calls resolve
 * with their result, or `null` when they failed — `error` then says why.
 */
export function useJob() {
  const [state, setState] = useState<JobState>(EMPTY);
  const unwatch = useRef<(() => void) | null>(null);
  const jobId = state.job?.id ?? null;

  useEffect(() => () => unwatch.current?.(), []);

  const watch = useCallback((id: string) => {
    unwatch.current?.();
    unwatch.current = watchJob(id, (event) =>
      setState((s) => (s.job?.id === id || event.type === "job" ? apply(s, event) : s)),
    );
  }, []);

  const createJob = useCallback(
    async (body: JobCreate): Promise<JobInfo | null> => {
      try {
        const job = await pdfJobs.create(body);
        setState({ job, error: null, expired: false });
        watch(job.id);
        return job;
      } catch (error) {
        setState((s) => ({ ...s, error: describe(error) }));
        return null;
      }
    },
    [watch],
  );

  /** Picks up a job this browser already has, e.g. after a reload. */
  const attach = useCallback(
    async (id: string): Promise<JobInfo | null> => {
      try {
        const job = await pdfJobs.get(id);
        setState({ job, error: null, expired: false });
        watch(id);
        return job;
      } catch (error) {
        const gone = error instanceof ApiError && error.status === 404;
        setState({ job: null, error: gone ? null : describe(error), expired: gone });
        return null;
      }
    },
    [watch],
  );

  /** `id` defaults to the current job; pass it when the job was created in the same handler, before a re-render. */
  const addTask = useCallback(
    async (body: TaskCreate, id: string | null = jobId): Promise<TaskInfo | null> => {
      if (!id) return null;
      try {
        const task = await pdfJobs.addTask(id, body);
        setState((s) => ({ ...apply(s, { type: "task", task }), error: null }));
        return task;
      } catch (error) {
        const gone = error instanceof ApiError && error.status === 404;
        setState((s) => (gone ? { ...EMPTY, expired: true } : { ...s, error: describe(error) }));
        return null;
      }
    },
    [jobId],
  );

  /**
   * Gives the job its password (#15). Resolves `null` once the server took it —
   * the job then carries a fresh `analyse` task — or with the sentence to show
   * beside the password field, which is where a wrong password belongs rather
   * than in `error`.
   */
  const unlock = useCallback(
    async (password: string): Promise<string | null> => {
      if (!jobId) return null;
      try {
        const job = await pdfJobs.unlock(jobId, password);
        setState((s) => ({ ...s, job, error: null }));
        return null;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          setState({ ...EMPTY, expired: true });
          return null;
        }
        return describe(error);
      }
    },
    [jobId],
  );

  /** Deletes everything on the server now and returns the page to its empty state. */
  const discard = useCallback(async (): Promise<boolean> => {
    unwatch.current?.();
    unwatch.current = null;
    if (jobId) {
      try {
        await pdfJobs.discard(jobId);
      } catch (error) {
        // Already gone is what we wanted; anything else is worth saying.
        if (!(error instanceof ApiError && error.status === 404)) {
          setState((s) => ({ ...s, error: describe(error) }));
          watch(jobId);
          return false;
        }
      }
    }
    setState(EMPTY);
    return true;
  }, [jobId, watch]);

  const reset = useCallback(() => {
    unwatch.current?.();
    unwatch.current = null;
    setState(EMPTY);
  }, []);

  const tasks = state.job?.tasks;

  /** The task the queue is working on for us — the newest queued or running one — else `null`. */
  const activeTask = useMemo(
    () => [...(tasks ?? [])].reverse().find((t) => t.state === "queued" || t.state === "running") ?? null,
    [tasks],
  );

  /** The newest finished task of a kind; its `result` holds the kind's payload and its `id` names the download. */
  const latestResult = useCallback(
    (kind: TaskKind): TaskInfo | null =>
      [...(tasks ?? [])].reverse().find((t) => t.kind === kind && t.state === "done") ?? null,
    [tasks],
  );

  return { ...state, activeTask, latestResult, createJob, attach, addTask, unlock, discard, reset };
}

/** Folds one stream event into the state. Tasks are upserted by id and kept in creation order. */
function apply(state: JobState, event: JobEvent): JobState {
  if (event.type === "expired") return { ...EMPTY, expired: true };
  if (event.type === "job") return { ...state, job: event.job, expired: false };

  const job = state.job;
  if (!job) return state;
  const { task } = event;
  const known = job.tasks.some((t) => t.id === task.id);
  const tasks = known ? job.tasks.map((t) => (t.id === task.id ? task : t)) : [...job.tasks, task];
  tasks.sort((a, b) => a.createdAt - b.createdAt);
  // The analysis also arrives in the next snapshot; taking it from the task saves waiting for one. A locked
  // analysis (#15) is only a placeholder, so the one that follows an unlock replaces it.
  const replaceable = job.analysis == null || (job.analysis as { locked?: boolean }).locked === true;
  const analysis = task.kind === "analyse" && task.state === "done" && replaceable ? task.result : job.analysis;
  return { ...state, job: { ...job, tasks, analysis } };
}

/** What to say when a call fails. The server's refusals are already sentences, so they pass through as-is. */
function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "The API could not be reached. Try again in a moment.";
}
