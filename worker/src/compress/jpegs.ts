import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TaskError } from "../jobs";
import { registerStep } from "./pipeline";

/**
 * Lossless image recompression for JPEGs: mozjpeg's `jpegtran` rewrites each
 * DCT stream with optimised Huffman tables as a progressive JPEG — the same
 * coefficients, so the decoded pixels are identical — and the smaller ones go
 * back in (scripts/jpegs.js). Typically 3–10 % off JPEGs that were written
 * with default tables. Flate images are re-deflated by the final qpdf pass.
 *
 * A JPEG jpegtran can't read, or one too big for the memory headroom, is left
 * as it was; this pass never fails a run.
 */

const SCRIPT = join(import.meta.dir, "../../scripts/jpegs.js");
/** Below this the process start costs more than it could save. */
const MIN_BYTES = 2048;

type Extracted = { id: number; bytes: number };

registerStep({
  id: "jpeg-repack",
  phase: "images",
  stage: "repacking JPEG images",
  engines: ["mupdf"],
  passes: ["lossless-images"],
  async run(run) {
    const { ctx } = run;
    const dir = run.scratch("jpegs");
    await mkdir(dir);
    const list = join(dir, "list.json");
    await ctx.run("mutool", ["run", SCRIPT, "extract", run.current, dir, list, String(MIN_BYTES)], {
      label: "MuPDF",
      where: "while reading the images",
    });
    // An image the user set to "leave it as it is" (#10 override skip) keeps even its bytes.
    const found = (JSON.parse(await readFile(list, "utf8")) as Extracted[]).filter((i) => !run.params.overrides[String(i.id)]?.skip);

    const better: { id: number; file: string }[] = [];
    for (const [i, image] of found.entries()) {
      ctx.progress("repacking JPEG images", i, found.length);
      const src = join(dir, `${image.id}.jpg`);
      const dst = join(dir, `${image.id}.opt.jpg`);
      try {
        const r = await ctx.run("jpegtran", ["-copy", "none", "-optimize", "-progressive", "-outfile", dst, src], {
          check: false,
        });
        if (r.code === 0 && (await stat(dst)).size < image.bytes) better.push({ id: image.id, file: dst });
      } catch (err) {
        // Out of memory or too slow on this one image: keep it as it is. A discard still ends the run.
        if (ctx.signal.aborted || !(err instanceof TaskError)) throw err;
      }
    }
    ctx.progress("repacking JPEG images", found.length, found.length);
    if (!better.length) return;

    const todo = join(dir, "replace.json");
    const out = run.scratch("jpegs.pdf");
    await writeFile(todo, JSON.stringify(better));
    await ctx.run("mutool", ["run", SCRIPT, "replace", run.current, out, todo], {
      label: "MuPDF",
      where: "while writing the images back",
    });
    // Saved without object streams or garbage collection, so it can come out bigger than it went in
    // even with every image smaller; the structure pass packs it again, and the run never serves growth.
    await run.adopt(out);
  },
});
