import { DEFAULT_ENGINE, ENGINE_IDS, ENGINES, type EngineId } from "@tools/shared";
import type { TaskContext } from "./jobs";

/**
 * The engine a merge runs on (#18). Merge is one pipeline whatever the engine
 * (handlers/merge.ts): images become pages with MuPDF, the pages are joined,
 * bookmarks and labels are added with MuPDF, and qpdf writes the result. Only
 * the join differs between engines, so that is the step an engine provides.
 *
 * MuPDF and qpdf both join with qpdf — it reads each source lazily, where
 * MuPDF's graft holds every copied stream in memory until the save. The other
 * engines have no join yet: a merge asking for one runs on the default engine
 * and says so in its notes. #13 adds them with `registerMergeJoin("ghostscript", …)`
 * from its own file, imported from handlers/index.ts; joins are looked up when
 * a task runs, so import order does not matter.
 */

/** Writes `parts` (PDFs, in order, pages kept in order) to `out` as one PDF. */
export type MergeJoin = (ctx: TaskContext, parts: string[], out: string) => Promise<void>;

async function qpdfJoin(ctx: TaskContext, parts: string[], out: string): Promise<void> {
  await ctx.run("qpdf", ["--warning-exit-0", "--empty", "--pages", ...parts, "--", out], {
    label: "qpdf",
    where: "while joining the files",
    hint: "Try merging fewer files at once.",
  });
}

const joins = new Map<EngineId, MergeJoin>([
  ["mupdf", qpdfJoin],
  ["qpdf", qpdfJoin],
]);

export function registerMergeJoin(engine: EngineId, join: MergeJoin): void {
  joins.set(engine, join);
}

/**
 * The join for the engine a task asked for. Anything that is not an engine
 * id means the default; an engine without a join falls back to the default
 * with a note the result carries.
 */
export function mergeJoinFor(requested: unknown): { engine: EngineId; join: MergeJoin; note: string | null } {
  const engine = typeof requested === "string" && (ENGINE_IDS as string[]).includes(requested) ? (requested as EngineId) : DEFAULT_ENGINE;
  const join = joins.get(engine);
  if (join) return { engine, join, note: null };
  return {
    engine: DEFAULT_ENGINE,
    join: joins.get(DEFAULT_ENGINE)!,
    note: `${ENGINES[engine].label} can't merge here yet — the files were merged with ${ENGINES[DEFAULT_ENGINE].label} instead.`,
  };
}
