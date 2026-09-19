import { reasonCodecUnsupported } from "@tools/shared";
import { registerStep } from "./pipeline";
import { qpdfEdits } from "./qpdfEdits";

/**
 * The qpdf engine (#13). Flatten comes from ./qpdf.ts like the MuPDF engine's;
 * everything else is here.
 */

/**
 * Re-encode (preset): `--optimize-images` rewrites each image qpdf can decode
 * as a JPEG at the run's quality, per image only when that is smaller. It
 * also writes an image shared by several pages once per page, so on a file
 * with shared images the whole result can grow — it is kept only when the
 * file got smaller. qpdf never changes an image's size (no downsampling).
 */
registerStep({
  id: "qpdf-images",
  phase: "images",
  stage: "re-encoding images",
  engines: ["qpdf"],
  passes: ["reencode-images"],
  async run(run) {
    const codec = reasonCodecUnsupported("qpdf", run.params.codec);
    if (codec) {
      run.skip("reencode-images", `${codec} Images keep their encoding.`);
      return;
    }
    const out = run.scratch("qpdf-images.pdf");
    const quality = Math.round(Math.min(100, Math.max(1, run.params.quality)));
    await run.ctx.run(
      "qpdf",
      ["--warning-exit-0", "--optimize-images", `--jpeg-quality=${quality}`, "--object-streams=preserve", run.current, out],
      { label: "qpdf", where: "while re-encoding the images" },
    );
    if (!(await run.adopt(out, { ifSmaller: true }))) {
      run.skip("reencode-images", "Re-encoding with qpdf didn't make the file smaller, so the images were left as they were.");
    }
  },
});

/**
 * The structure pass: one qpdf write that applies the metadata and extras
 * edits (./qpdfEdits.ts), drops every object nothing reaches (qpdf only ever
 * writes reachable objects), re-deflates every Flate stream at level 9 and
 * packs object streams. qpdf has no deduplication. Lossless, so kept only
 * when smaller — unless it made edits the user asked for.
 */
registerStep({
  id: "qpdf-structure",
  phase: "structure",
  stage: "rewriting the file",
  engines: ["qpdf"],
  passes: ["object-streams", "recompress-streams", "garbage-collect", "strip-metadata", "remove-extras"],
  async run(run) {
    const edits = await qpdfEdits(run, {
      stripMetadata: run.wants("strip-metadata"),
      keepXmp: run.keepXmp,
      removeExtras: run.wants("remove-extras"),
    });
    const out = run.scratch("qpdf-structure.pdf");
    const args = [
      "--warning-exit-0",
      ...edits.args,
      `--object-streams=${run.wants("object-streams") ? "generate" : "preserve"}`,
      ...(run.wants("recompress-streams") ? ["--recompress-flate", "--compression-level=9"] : []),
      "--compress-streams=y",
      edits.input,
      out,
    ];
    await run.ctx.run("qpdf", args, { label: "qpdf", where: "while rewriting the file" });
    await run.adopt(out, { ifSmaller: edits.args.length === 0 });
  },
});
