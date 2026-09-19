import { TaskError } from "../jobs";
import {
  lockedGuard,
  prepareInput,
  readXmp,
  reencryptOutput,
  requiredXmp,
  signatureGuard,
  specialNotes,
  xmpPolicy,
} from "../special";
import { registerStep } from "./pipeline";

/**
 * Special inputs (#15) at both ends of a compress run; the helpers live in
 * ../special.ts.
 *
 * prepare — refuses a locked file and a signed one whose loss was not
 * accepted, then hands every later step a plain copy: decrypted with the
 * job's password, and for a PDF/A file being stripped, its XMP cut down to
 * the conformance identification (the MuPDF step then keeps that packet,
 * `keepXmp`, instead of dropping it). Object numbers are kept.
 *
 * seal — encrypts the result again with the job's password when asked, and
 * adds the notes that explain what happened to the signature, the password
 * and the metadata.
 */

registerStep({
  id: "special-prepare",
  phase: "prepare",
  stage: "preparing the file",
  passes: [],
  when: ({ analysis: a, params }) => !!a && (a.flags.encrypted || !!a.locked || !!a.flags.signed || (!!a.flags.pdfa && params.stripMetadata)),
  async run(run) {
    const { analysis, ctx } = run;
    const refusal = lockedGuard(analysis) ?? signatureGuard(run.params, analysis);
    if (refusal) throw new TaskError(refusal);

    const encrypted = !!analysis?.flags.encrypted;
    // An owner-password-only file opens without one; a user password is the job's, from unlock.
    const password = ctx.job.password;
    let xmp: string | null = null;
    if (xmpPolicy({ stripMetadata: run.wants("strip-metadata") }, analysis) === "required") {
      xmp = requiredXmp(await readXmp(ctx.run, run.current, password, ctx.workDir));
      run.keepXmp = xmp !== null;
    }
    if (!encrypted && xmp === null) return;
    await run.adopt(await prepareInput(ctx.run, run.current, { password, xmp }, ctx.workDir, run.scratch("prepared.pdf")));
  },
});

registerStep({
  id: "special-seal",
  phase: "seal",
  stage: "sealing the file",
  passes: [],
  when: ({ analysis: a }) => !!a && (a.flags.encrypted || !!a.flags.signed || !!a.flags.pdfa),
  async run(run) {
    const { analysis, ctx, params } = run;
    const encrypted = !!analysis?.flags.encrypted;
    const reencrypt = encrypted && params.reencrypt === true && !!ctx.job.password;
    if (reencrypt) {
      await run.adopt(await reencryptOutput(ctx.run, run.current, ctx.job.password!, ctx.workDir));
    }
    const notes = specialNotes(
      { stripMetadata: run.wants("strip-metadata") && run.keepXmp, reencrypt, acceptSignatureLoss: params.acceptSignatureLoss },
      analysis,
    );
    for (const note of notes) run.note(note);
  },
});
