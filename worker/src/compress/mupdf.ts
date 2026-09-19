import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { registerStep } from "./pipeline";

/**
 * The MuPDF engine's structure pass: one `mutool run scripts/compress.js`
 * that makes the edits the run asks for (strip metadata, remove extras) and
 * saves with
 *
 *   garbage=compact      drop unreferenced objects and renumber (garbage-collect)
 *   garbage=4            …and merge identical objects, streams compared byte for byte (dedupe)
 *   compress             deflate every stream still stored raw; 1-bit images get CCITT G4
 *   compression-effort=100
 *   objstms              pack objects into object streams, with an xref stream (object-streams)
 *   regenerate-id=no     keep the file's identity
 *
 * Streams that are already filtered are copied as they are; re-deflating them
 * is the final qpdf pass's job (./qpdf.ts). Encryption is kept as found (#15
 * decrypts in `prepare` and re-encrypts in `seal`).
 */

const SCRIPT = join(import.meta.dir, "../../scripts/compress.js");

/**
 * MuPDF deduplicates by comparing every pair of objects. Measured on the Pi
 * (text pages, ~4 objects each): garbage=4 takes 3 s at 4k objects and 12 s at
 * 10k; garbage=3 takes 5 s at 10k and 28 s at 20k. Past the second cap only
 * unused objects are dropped.
 */
const DEEP_DEDUPE_MAX_OBJECTS = 10_000;
const DEDUPE_MAX_OBJECTS = 15_000;

type Removed = Partial<
  Record<"attachments" | "scripts" | "bookmarks" | "annotations" | "fields" | "thumbnails" | "privateData", number>
>;
type Report = { objects: number; garbage: "none" | "compact" | "deduplicate" | "4"; removed: Removed };

registerStep({
  id: "mupdf-structure",
  phase: "structure",
  stage: "rewriting the file",
  engines: ["mupdf"],
  passes: ["garbage-collect", "dedupe", "object-streams", "strip-metadata", "remove-extras"],
  async run(run) {
    const edits = run.wants("strip-metadata") || run.wants("remove-extras");
    const ops = {
      garbage: run.wants("dedupe") ? "dedupe" : run.wants("garbage-collect") ? "compact" : "none",
      deepMax: DEEP_DEDUPE_MAX_OBJECTS,
      shallowMax: DEDUPE_MAX_OBJECTS,
      objstms: run.wants("object-streams"),
      stripMetadata: run.wants("strip-metadata"),
      keepXmp: run.keepXmp,
      removeExtras: run.wants("remove-extras"),
    };
    const opsFile = run.scratch("mupdf-ops.json");
    const reportFile = run.scratch("mupdf-report.json");
    const out = run.scratch("mupdf.pdf");
    await writeFile(opsFile, JSON.stringify(ops));
    await run.ctx.run("mutool", ["run", SCRIPT, run.current, out, opsFile, reportFile], {
      label: "MuPDF",
      where: "while rewriting the file",
    });
    // Edits are what the user asked for, so they stand even in the unlikely case they cost bytes.
    await run.adopt(out, { ifSmaller: !edits });

    const report: Report = JSON.parse(await readFile(reportFile, "utf8"));
    if (run.wants("dedupe") && report.garbage === "compact") {
      run.skip("dedupe", `Too many objects (${report.objects.toLocaleString("en")}) to compare in reasonable time — duplicates were left in.`);
    }
    const sentence = removedSentence(report.removed);
    if (sentence) run.note(sentence);
  },
});

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Removed 2 attachments, 1 script, the bookmarks and 14 annotations." */
export function removedSentence(r: Removed): string | null {
  const parts = [
    r.attachments && plural(r.attachments, "attachment"),
    r.scripts && plural(r.scripts, "script"),
    r.bookmarks && "the bookmarks",
    r.annotations && plural(r.annotations, "annotation"),
    r.fields && plural(r.fields, "form field"),
    r.thumbnails && plural(r.thumbnails, "page thumbnail"),
    r.privateData && "application data",
  ].filter((p): p is string => !!p);
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Removed ${list}.`;
}
