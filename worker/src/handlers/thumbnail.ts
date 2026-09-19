import { join } from "node:path";
import { registerHandler, TaskError } from "../jobs";
import { renderThumbnail, THUMBNAIL_FILE } from "../thumbnails";

/**
 * A `thumbnail` task: page 1 of one of the job's PDFs as a task artefact
 * (`GET /api/pdf/jobs/:id/tasks/:taskId/file/thumbnail.png`). Params
 * `{ upload?: string }` pick the input; the first PDF otherwise. The merge
 * preview uses the upload route's lane instead, which needs no job.
 */
registerHandler("thumbnail", async ({ task, inputs, outDir, signal }) => {
  const want = (task.params as { upload?: unknown } | null)?.upload;
  const input = inputs.find((i) => i.kind === "pdf" && (typeof want !== "string" || i.id === want));
  if (!input) throw new TaskError("There is no PDF to draw a thumbnail of.");
  if (!(await renderThumbnail(input.path, join(outDir, THUMBNAIL_FILE), signal))) {
    throw new TaskError(`${input.name} has no first page that can be drawn.`);
  }
  return { result: { file: THUMBNAIL_FILE }, file: { name: THUMBNAIL_FILE, downloadName: THUMBNAIL_FILE } };
});
