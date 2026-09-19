/// <reference lib="webworker" />
import { renderSpinJob, type SpinRequest, type SpinResponse } from "./spin";

/**
 * Renders spin frames off the page. Each frame is posted (transferred) as
 * soon as it's drawn, so progress is real and memory isn't held twice.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (e: MessageEvent<SpinRequest>) => {
  const { id, job } = e.data;
  const post = (msg: SpinResponse, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);
  try {
    if (typeof OffscreenCanvas === "undefined" || !new OffscreenCanvas(1, 1).getContext("2d")) {
      return post({ id, kind: "error", error: "unavailable" });
    }
    await renderSpinJob(job, (bitmap, index) => post({ id, kind: "frame", index, bitmap }, [bitmap]));
    post({ id, kind: "done" });
  } catch (error) {
    post({ id, kind: "error", error: error instanceof Error ? error.message : "could not draw the spin" });
  } finally {
    job.front.close();
    job.back?.close();
  }
};
