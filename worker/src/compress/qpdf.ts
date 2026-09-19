import { registerStep } from "./pipeline";

/**
 * qpdf's two parts in a run. Exit code 3 means "warnings, output written"
 * (a repaired xref, say), so both pass `--warning-exit-0`.
 */

/**
 * Flatten (opt-in): each visible annotation's appearance is drawn into the page
 * content and the annotation removed; form fields whose value has no
 * appearance yet get one generated first, so their values survive. Only what
 * shows on screen is flattened — hidden and no-view annotations are dropped
 * with the rest.
 */
registerStep({
  id: "qpdf-flatten",
  phase: "edit",
  stage: "flattening forms and annotations",
  engines: ["mupdf", "qpdf", "ghostscript"],
  passes: ["flatten"],
  async run(run) {
    const out = run.scratch("flat.pdf");
    await run.ctx.run(
      "qpdf",
      ["--warning-exit-0", "--generate-appearances", "--flatten-annotations=screen", run.current, out],
      { label: "qpdf", where: "while flattening the forms" },
    );
    await run.adopt(out);
  },
});

/**
 * The final lossless pass of the default (MuPDF) pipeline: re-deflate every
 * Flate stream at level 9 (MuPDF copies already-filtered streams as they are)
 * and write object streams. Kept only when it is smaller — on a file MuPDF
 * just packed it sometimes is not. The other engines stop at their own
 * structure pass, so a run shows what the picked engine does (#13).
 */
registerStep({
  id: "qpdf-finish",
  phase: "finish",
  stage: "recompressing streams",
  engines: ["mupdf"],
  passes: ["recompress-streams", "object-streams"],
  async run(run) {
    const out = run.scratch("qpdf.pdf");
    const args = [
      "--warning-exit-0",
      `--object-streams=${run.wants("object-streams") ? "generate" : "preserve"}`,
      ...(run.wants("recompress-streams") ? ["--recompress-flate", "--compression-level=9"] : []),
      "--compress-streams=y",
      run.current,
      out,
    ];
    await run.ctx.run("qpdf", args, { label: "qpdf", where: "while recompressing streams" });
    await run.adopt(out, { ifSmaller: true });
  },
});
