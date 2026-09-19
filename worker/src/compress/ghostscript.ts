import { reasonCodecUnsupported, type CompressParams, type PassId } from "@tools/shared";
import { registerStep, type CompressRun } from "./pipeline";
import { qpdfEdits } from "./qpdfEdits";

/**
 * The Ghostscript engine (#13): pdfwrite re-distills the whole file — every
 * page is interpreted and written out again — and owns image handling when it
 * is chosen: downsampling, re-encoding and grayscale all happen inside that
 * one pass. Around it:
 *
 *   edit       flatten (./qpdf.ts), then remove extras with qpdf (./qpdfEdits.ts),
 *              so what Ghostscript would half-carry-over is gone before it runs
 *   structure  gs; then, when stripping metadata, a qpdf edit that takes the
 *              document info down to its Title (pdfwrite writes its own Producer
 *              and dates back in)
 *
 * Re-distilling loses tagged structure and form fields, and can grow a file
 * that was already well packed — the handler serves the original then.
 */

/** pdfwrite's JPEG quality is a QFactor on the base tables: IJG quality q maps to the same scale factor. */
export function qFactor(quality: number): number {
  const q = Math.min(100, Math.max(1, quality));
  const f = q < 50 ? 50 / q : (200 - 2 * q) / 100;
  return Math.max(0.02, Math.round(f * 1000) / 1000);
}

/** The gs command line for a run. Numbers only in the `-c` distiller params — never anything the user typed. */
export function ghostscriptArgs(
  params: CompressParams,
  wants: (pass: PassId) => boolean,
  opts: { keepXmp: boolean; input: string; output: string },
): string[] {
  const downsample = wants("downsample") && params.dpiCap !== null;
  // JPEG (per image, Ghostscript's choice: smooth images JPEG, sharp ones Flate) unless the run asked for lossless Flate.
  const jpeg = wants("reencode-images") && params.codec !== "flate";
  const gray = wants("grayscale");
  const objstms = wants("object-streams");
  const args = [
    "-q",
    "-dSAFER",
    "-dBATCH",
    "-dNOPAUSE",
    "-sDEVICE=pdfwrite",
    `-sOutputFile=${opts.output}`,
    "-dCompatibilityLevel=1.7",
    // pdfwrite otherwise turns pages to follow their text.
    "-dAutoRotatePages=/None",
    "-dDetectDuplicateImages=true",
    "-dSubsetFonts=true",
    "-dCompressFonts=true",
    `-dWriteObjStms=${objstms}`,
    `-dWriteXRefStm=${objstms}`,
    "-dPassThroughJPEGImages=true",
    "-dPassThroughJPXImages=true",
    // 1-bit images keep their resolution: downsampling text scans ruins them.
    "-dDownsampleMonoImages=false",
  ];
  for (const kind of ["Color", "Gray"]) {
    if (downsample) {
      args.push(
        `-dDownsample${kind}Images=true`,
        `-d${kind}ImageResolution=${Math.round(params.dpiCap!)}`,
        `-d${kind}ImageDownsampleType=/Bicubic`,
        `-d${kind}ImageDownsampleThreshold=1.0`,
      );
    } else {
      args.push(`-dDownsample${kind}Images=false`);
    }
    if (jpeg) args.push(`-dAutoFilter${kind}Images=true`);
    else args.push(`-dAutoFilter${kind}Images=false`, `-d${kind}ImageFilter=/FlateEncode`);
  }
  if (gray) args.push("-sColorConversionStrategy=Gray", "-dProcessColorModel=/DeviceGray");
  if (wants("strip-metadata")) {
    args.push("-dOmitInfoDate=true");
    if (!opts.keepXmp) args.push("-dOmitXMP=true");
  }
  if (jpeg) {
    const q = qFactor(params.quality);
    // Full-resolution chroma for print quality, 4:2:0 below it.
    const s = params.quality >= 90 ? "[1 1 1 1]" : "[2 1 1 2]";
    const dict = `<< /QFactor ${q} /Blend 1 /HSamples ${s} /VSamples ${s} >>`;
    args.push(
      "-c",
      `<< /ColorACSImageDict ${dict} /GrayACSImageDict ${dict} /ColorImageDict ${dict} /GrayImageDict ${dict} >> setdistillerparams`,
    );
  }
  args.push("-f", opts.input);
  return args;
}

async function qpdfEdit(run: CompressRun, stage: string, opts: { stripMetadata: boolean; removeExtras: boolean }) {
  const edits = await qpdfEdits(run, { ...opts, keepXmp: run.keepXmp });
  if (!edits.args.length) return;
  const out = run.scratch("edited.pdf");
  await run.ctx.run("qpdf", ["--warning-exit-0", ...edits.args, "--object-streams=generate", edits.input, out], {
    label: "qpdf",
    where: stage,
  });
  await run.adopt(out);
}

registerStep({
  id: "gs-remove-extras",
  phase: "edit",
  stage: "removing extras",
  engines: ["ghostscript"],
  passes: ["remove-extras"],
  run: (run) => qpdfEdit(run, "while removing extras", { stripMetadata: false, removeExtras: true }),
});

registerStep({
  id: "gs-distill",
  phase: "structure",
  stage: "re-distilling with Ghostscript",
  engines: ["ghostscript"],
  passes: [
    "object-streams",
    "recompress-streams",
    "dedupe",
    "garbage-collect",
    "subset-fonts",
    "downsample",
    "reencode-images",
    "strip-metadata",
    "grayscale",
  ],
  async run(run) {
    const { params } = run;
    const codec = reasonCodecUnsupported("ghostscript", params.codec);
    if (codec && run.wants("reencode-images")) run.note(`${codec} Images were written as JPEG instead.`);
    if (Object.keys(params.overrides).length) {
      run.note("Per-image settings apply only with MuPDF — Ghostscript used the run's settings for every image.");
    }
    const out = run.scratch("gs.pdf");
    const args = ghostscriptArgs(params, run.wants, { keepXmp: run.keepXmp, input: run.current, output: out });
    await run.ctx.run("gs", args, { label: "Ghostscript", where: "while re-distilling the file" });
    // Not lossless, so no ifSmaller: the handler serves the original if the whole run grew the file.
    await run.adopt(out);
    if (run.wants("strip-metadata")) {
      await qpdfEdit(run, "while stripping metadata", { stripMetadata: true, removeExtras: false });
    }
  },
});
