import { writeFile } from "node:fs/promises";
import { runPdfLib, tooBigForPdfLib } from "../engines";
import { registerStep } from "./pipeline";

/**
 * The pdf-lib engine (#13): load and save through pdf-lib (scripts/pdflib.ts)
 * with object streams, stripping metadata on the way when asked. pdf-lib
 * copies every stream and every object as it is — nothing else in a run
 * happens with this engine. Kept only when smaller, unless it stripped
 * metadata the user asked to be rid of.
 */
registerStep({
  id: "pdflib-structure",
  phase: "structure",
  stage: "rewriting the file",
  engines: ["pdf-lib"],
  passes: ["object-streams", "strip-metadata"],
  async run(run) {
    const big = tooBigForPdfLib(run.input.size);
    if (big) {
      for (const pass of ["object-streams", "strip-metadata"] as const) run.skip(pass, big);
      return;
    }
    const ops = {
      objectStreams: run.wants("object-streams"),
      stripMetadata: run.wants("strip-metadata"),
      keepXmp: run.keepXmp,
    };
    const opsFile = run.scratch("pdflib-ops.json");
    const out = run.scratch("pdflib.pdf");
    await writeFile(opsFile, JSON.stringify(ops));
    await runPdfLib(run.ctx, ["compress", run.current, out, opsFile], "while rewriting the file");
    await run.adopt(out, { ifSmaller: !ops.stripMetadata });
  },
});
