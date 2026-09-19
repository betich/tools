import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiX } from "react-icons/fi";
import { CODECS, ENGINES, type CodecId, type CompressParams, type PdfAnalysis } from "@tools/shared";
import { Button, Field, Input, Section, TextButton, Toggle } from "@/components/ui";
import { pdfaName, pdfaPart } from "./analysis";

/**
 * What the special inputs of #15 ask of the page: a password before an
 * encrypted file can be read, a confirmation before a signed one is changed,
 * and cautions where a setting would undo something the file promises — PDF/A
 * conformance, the tags a screen reader follows.
 */

/**
 * In place of the analysis while the file is encrypted with a password we
 * don't have. The server checks it before queueing the real analysis, so a
 * wrong one comes straight back as a sentence under the field.
 */
export function UnlockPrompt({ onUnlock }: { onUnlock: (password: string) => Promise<string | null> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    const problem = await onUnlock(password);
    setBusy(false);
    setError(problem);
    if (problem) setPassword("");
  };

  return (
    <Section title="locked">
      <p className="text-prose text-body max-w-prose font-sans normal-case">
        This file is encrypted, so nothing inside it can be read without its password. It is kept with this file on the
        server and deleted with it.
      </p>
      <form
        className="flex max-w-sm flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="password">
          <Input
            type="password"
            value={password}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </Field>
        {error ? (
          <p className="text-ink text-body font-sans normal-case" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy || !password} className="w-fit">
          {busy ? "opening…" : "open"}
        </Button>
      </form>
    </Section>
  );
}

/** `Ana Lima, Somchai P. and an unnamed signer` — the signers as a sentence names them. */
const listed = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * RUN on a signed file stops here: compressing rewrites the bytes the
 * signature covers, so the copy will show as tampered with. The dialog names
 * who signed, and only its confirm sends `acceptSignatureLoss`. The share
 * dialog's frame — an overlay, so it may cast the one shadow.
 */
export function SignatureDialog({
  signers,
  onConfirm,
  onClose,
}: {
  signers: string[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    confirm.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const who = signers.length ? listed(signers) : "an unnamed signer";

  return createPortal(
    <div
      className="animate-toast-in fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-[rgb(2_2_8/0.72)] px-4 pt-[14vh] pb-10"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="alertdialog"
        aria-modal
        aria-labelledby={titleId}
        className="border-wash bg-panel-high rounded-card w-full max-w-[28rem] border"
        style={{ boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)" }}
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <h2 id={titleId} className="text-ink text-title font-mono font-bold uppercase">
            signed file
          </h2>
          <button
            type="button"
            aria-label="close"
            onClick={onClose}
            className="text-meta hover:text-indigo -mr-1 cursor-pointer p-1 transition-colors duration-200"
          >
            <FiX className="size-4" />
          </button>
        </header>

        <div className="border-hairline-faint border-t" />

        <div className="flex flex-col gap-5 px-6 pt-5 pb-6">
          <p className="text-prose text-body font-sans normal-case">
            This file is signed by <span className="text-ink">{who}</span>
            {who.endsWith(".") ? "" : "."} Compressing it rewrites the bytes the{" "}
            {signers.length > 1 ? "signatures cover" : "signature covers"}, so the copy will no longer verify as signed.
            The original you uploaded is unchanged.
          </p>
          <div className="flex items-center justify-between gap-4 pt-1">
            <TextButton onClick={onClose}>cancel</TextButton>
            <Button ref={confirm} onClick={onConfirm}>
              compress anyway
            </Button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** Every codec a run would write, the per-image overrides (#10) included. */
function codecsIn(params: CompressParams): Set<CodecId> {
  const used = new Set<CodecId>([params.codec]);
  for (const o of Object.values(params.overrides ?? {})) if (o.codec && !o.skip) used.add(o.codec);
  return used;
}

/**
 * Sentences about what this file promises and the chosen settings would
 * break, for the run column, plus the one choice an encrypted file adds.
 * Each caution appears only while it applies: JPEG XL is in no PDF/A part and
 * JPEG 2000 not in part 1; Ghostscript rewrites a file without its tags.
 */
export function InputCautions({
  analysis,
  params,
  onChange,
}: {
  analysis: PdfAnalysis | null;
  params: CompressParams;
  onChange: (params: CompressParams) => void;
}) {
  const flags = analysis?.flags;
  if (!analysis || !flags || analysis.locked) return null;

  const notes: string[] = [];
  if (flags.pdfa) {
    const name = pdfaName(flags.pdfa);
    const part = pdfaPart(flags.pdfa);
    const used = codecsIn(params);
    if (used.has("libjxl"))
      notes.push(`${CODECS.libjxl.label} isn't allowed in any PDF/A part, so the output will no longer be ${name}.`);
    if (used.has("openjpeg") && (part === 1 || part === null))
      notes.push(
        part === 1
          ? `${CODECS.openjpeg.label} isn't allowed in PDF/A-1, so the output will no longer be ${name}.`
          : `${CODECS.openjpeg.label} breaks PDF/A-1 conformance.`,
      );
    if (params.stripMetadata) notes.push(`The XMP metadata ${name} requires is kept, even with metadata stripped.`);
  }
  if (flags.tagged && params.engine === "ghostscript")
    notes.push(
      `${ENGINES.ghostscript.label} rewrites the file without its tags, so screen readers lose the reading order. The other engines keep them.`,
    );

  if (!flags.encrypted && !notes.length) return null;

  return (
    <div className="flex flex-col gap-3">
      {flags.encrypted ? (
        <div className="flex flex-col gap-1.5">
          <Toggle
            checked={params.reencrypt === true}
            onChange={(v) => onChange({ ...params, reencrypt: v })}
            label="keep the same password"
          />
          <p className="text-meta text-body pl-6 font-sans normal-case leading-snug">
            {params.reencrypt
              ? "The output opens with the password you gave (AES-256)."
              : "Off, the output opens without a password."}
          </p>
        </div>
      ) : null}
      {notes.map((n) => (
        <p key={n} className="text-prose text-body border-edge border-l pl-3 font-sans normal-case leading-snug">
          {n}
        </p>
      ))}
    </div>
  );
}
