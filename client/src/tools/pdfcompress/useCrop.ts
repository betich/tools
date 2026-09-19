import { useEffect, useRef, useState } from "react";
import type { CropParams, TaskInfo } from "@tools/shared";
import { ApiError } from "@/lib/api";
import { pdfJobs } from "@/lib/pdfjobs";

/** How long the settings must sit still before a crop is asked for. */
const SETTLE_MS = 600;
/** How long to wait after the queue says another task of ours is still going (another tab, say). */
const BUSY_RETRY_MS = 3_000;

type Drawn = { key: string; imageId: string; taskId: string };

export type CropState = {
  /** The crop task for exactly these settings, once asked for — queued, running, done or failed. */
  task: TaskInfo | null;
  /** The newest finished crop of this image: the current one, or an older one while the new one is drawn. */
  shown: TaskInfo | null;
  /** `shown` was drawn under other settings than the ones now chosen. */
  stale: boolean;
  /** Why nothing has been asked for yet: a slider is held, or the queue is busy with our run. */
  waiting: "held" | "busy" | null;
  /** The last refusal, as the server's sentence. */
  error: string | null;
};

/**
 * Before/after crops for the selected image. Each distinct set of params is
 * drawn once: the params are the key, so going back to settings already seen
 * shows that crop again without asking the worker. A new crop waits until the
 * settings have been still for a moment, until any held slider is let go, and
 * until the queue has nothing else of ours — one task at a time per caller, so
 * asking during a run would only be refused. The worker runs crops in its
 * priority lane, so once asked they come back quickly.
 */
export function useCrop({
  jobId,
  tasks,
  params,
  busy,
  held,
}: {
  jobId: string;
  tasks: TaskInfo[];
  /** What to draw, or null when nothing should be (no row selected, or the image is skipped). */
  params: CropParams | null;
  /** A task of ours is queued or running. */
  busy: boolean;
  held: boolean;
}): CropState {
  const drawn = useRef<Drawn[]>([]);
  // Tasks as the POST answered them, until the stream reports them.
  const [answered, setAnswered] = useState<Record<string, TaskInfo>>({});
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);

  const key = params ? JSON.stringify(params) : null;
  const imageId = params?.imageId ?? null;
  const find = (id: string) => tasks.find((t) => t.id === id) ?? answered[id] ?? null;
  const asked = key ? drawn.current.find((d) => d.key === key) : undefined;
  // A failed crop is asked for again only when the settings change, not on every render.
  const refused = error !== null && error.key === key;

  useEffect(() => {
    if (!params || !key || asked || held || busy || refused) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const task = await pdfJobs.addTask(jobId, { kind: "crop", params });
        if (cancelled) return;
        drawn.current = [...drawn.current, { key, imageId: params.imageId, taskId: task.id }];
        setAnswered((a) => ({ ...a, [task.id]: task }));
        setError(null);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 429) {
          // Something of ours we can't see is still running; look again shortly.
          setTimeout(() => setRetry((n) => n + 1), BUSY_RETRY_MS);
          return;
        }
        setError({
          key,
          message: e instanceof ApiError ? e.message : "The API could not be reached. Try again in a moment.",
        });
      }
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, key, asked, held, busy, refused, retry]); // eslint-disable-line react-hooks/exhaustive-deps -- `params` is `key`

  const task = asked ? find(asked.taskId) : null;
  const shown =
    task?.state === "done"
      ? task
      : ([...drawn.current]
          .reverse()
          .filter((d) => d.imageId === imageId)
          .map((d) => find(d.taskId))
          .find((t) => t?.state === "done") ?? null);

  return {
    task,
    shown,
    stale: shown !== null && shown !== task,
    waiting: !params || asked ? null : held ? "held" : busy ? "busy" : null,
    error: refused ? error.message : null,
  };
}
