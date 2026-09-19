import type { CompressParams } from "./pdfcompress";
import type { PdfAnalysis } from "./pdfjobs";

/**
 * Inputs that need more than a straight compress (#15): encrypted, signed,
 * PDF/A, tagged and damaged files. These are the sentences and checks both
 * the API (refusing at once) and the worker (refusing again at run time, in
 * case the analysis landed after the task was queued) agree on.
 */

export const WRONG_PASSWORD = "That password didn't open the file.";
export const NEEDS_PASSWORD = "This file is locked — enter its password first.";
export const SIGNATURE_REFUSAL = "This file is signed — confirm that compressing removes the signature's validity.";

/** What the analysis calls a signature whose signer it could not name. */
export const UNNAMED_SIGNER = "an unnamed signer";

/**
 * Why a compress of this file cannot start with these settings, or null.
 * A signed input needs `acceptSignatureLoss`; any rewrite breaks the
 * signature's byte range, so its validity goes with it.
 */
export function signatureGuard(params: Pick<CompressParams, "acceptSignatureLoss"> | null | undefined, analysis: PdfAnalysis | null | undefined): string | null {
  if (!analysis?.flags.signed) return null;
  return params?.acceptSignatureLoss === true ? null : SIGNATURE_REFUSAL;
}

/** "Repaired 3 broken objects" for a file MuPDF had to rebuild, or null for a sound one. */
export function repairNote(n: number): string | null {
  if (!(n > 0)) return null;
  return n === 1 ? "Repaired 1 broken object" : `Repaired ${n} broken objects`;
}
