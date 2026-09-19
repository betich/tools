import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  NEEDS_PASSWORD,
  repairNote,
  signatureGuard,
  UNNAMED_SIGNER,
  WRONG_PASSWORD,
  type CompressParams,
  type PdfAnalysis,
} from "@tools/shared";
import { TaskError, type TaskContext } from "./jobs";

/**
 * Inputs that need more than a straight compress (#15). The compress steps in
 * compress/special.ts call these:
 *
 * - `prepare`: `lockedGuard` and `signatureGuard` (the API checked both when
 *   the task was queued; the analysis may have landed since), then
 *   `prepareInput` — decrypted, and with the XMP cut down to `requiredXmp`
 *   when `xmpPolicy` says so — a plain copy every later tool can read
 * - `seal`: `reencryptOutput` when `reencrypt` is set; `specialNotes`
 *
 * Passwords only ever reach a tool through a 0600 file in the task's scratch
 * directory (`--password-file`, or a qpdf `@` argument file), never argv,
 * where any process listing would show them.
 */

export { repairNote, signatureGuard };

type Run = TaskContext["run"];

/** qpdf exits 3 when it succeeded with warnings — a damaged file it repaired. */
const QPDF_OK = new Set([0, 3]);

async function secretFile(workDir: string, name: string, lines: string[]): Promise<string> {
  const path = join(workDir, name);
  await writeFile(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  await chmod(path, 0o600); // the mode above is masked by umask; make sure
  return path;
}

/** The job's password as a file for `mutool run analyse.js … <passwordFile>` or `qpdf --password-file`. */
export function passwordFile(workDir: string, password: string): Promise<string> {
  return secretFile(workDir, "password", [password]);
}

/**
 * Why a compress cannot run on a locked input yet, or null. The latest
 * analysis is the judge: after an unlock it was read with the job's
 * password, so still locked means that password did not open it either.
 */
export function lockedGuard(analysis: PdfAnalysis | null | undefined): string | null {
  return analysis?.locked ? NEEDS_PASSWORD : null;
}

const SCRIPT = join(import.meta.dir, "../scripts/special.js");
/** scripts/special.js exits with this when the password does not open the file. */
const WRONG_PASSWORD_EXIT = 3;

async function mutoolSpecial(run: Run, args: string[], what: string) {
  const r = await run("mutool", ["run", SCRIPT, ...args], { check: false, label: "MuPDF", where: `while ${what}` });
  if (r.code === WRONG_PASSWORD_EXIT) throw new TaskError(WRONG_PASSWORD);
  if (r.code !== 0 || r.signal) throw new TaskError(`The file could not be prepared (${what}).`);
}

/** The catalog's XMP packet, "" when there is none. */
export async function readXmp(run: Run, input: string, password: string | null, workDir: string): Promise<string> {
  const pw = password ? await passwordFile(workDir, password) : "-";
  const out = join(workDir, "catalog.xmp");
  await mutoolSpecial(run, ["xmp", input, pw, out], "reading the metadata");
  return readFile(out, "utf8");
}

/**
 * A copy of `input` every later tool (mutool, qpdf, gs) reads without a
 * password: opened with `password` (user or owner), its catalog XMP replaced
 * by `xmp` when given, saved unencrypted. No garbage collection, so the
 * input's object numbers — PdfImage.id, PdfFont.id — still hold.
 */
export async function prepareInput(
  run: Run,
  input: string,
  opts: { password: string | null; xmp: string | null },
  workDir: string,
  out = join(workDir, "prepared.pdf"),
): Promise<string> {
  const pw = opts.password ? await passwordFile(workDir, opts.password) : "-";
  let xmpFile = "-";
  if (opts.xmp !== null) {
    xmpFile = join(workDir, "required.xmp");
    await writeFile(xmpFile, opts.xmp);
  }
  await mutoolSpecial(run, ["prepare", input, out, pw, xmpFile], opts.password ? "decrypting the file" : "keeping the PDF/A metadata");
  return out;
}

/** `prepareInput` for decryption alone. */
export function decryptInput(run: Run, input: string, password: string, workDir: string): Promise<string> {
  return prepareInput(run, input, { password, xmp: null }, workDir, join(workDir, "decrypted.pdf"));
}

/**
 * `path` encrypted with AES-256 under `password` as both user and owner
 * password, written next to it; returns the new path. The original may have
 * had a separate owner password — we never learn it, so the output grants
 * what the user password grants: everything.
 */
export async function reencryptOutput(run: Run, path: string, password: string, workDir: string): Promise<string> {
  const out = path.replace(/\.pdf$/i, "") + ".encrypted.pdf";
  const args = await secretFile(workDir, "encrypt.args", [
    "--encrypt",
    `--user-password=${password}`,
    `--owner-password=${password}`,
    "--bits=256",
    "--",
    path,
    out,
  ]);
  const r = await run("qpdf", [`@${args}`], { check: false, label: "Re-encrypting", where: "while re-encrypting the output" });
  if (r.code === null || !QPDF_OK.has(r.code)) throw new TaskError("The output could not be encrypted again.");
  return out;
}

// ── damaged files ──────────────────────────────────────────────────────────

/**
 * How many distinct objects qpdf complained about while reading a damaged
 * file — `(object 17 0, offset 1378): expected endobj`, `object 18 0: Pages
 * tree includes non-dictionary object`. A file whose only damage was its
 * cross-reference table names no object, and counts as one: the table.
 */
export function countRepairs(stderr: string): number {
  const objects = new Set<string>();
  for (const m of stderr.matchAll(/\bobject (\d+) (\d+)\b/g)) objects.add(`${m[1]} ${m[2]}`);
  return Math.max(1, objects.size);
}

/**
 * The number of broken objects in a file MuPDF had to repair. MuPDF only
 * says that it repaired, so qpdf reads every object once more (stream data
 * is not decoded) and its warnings are counted. Falls back to 1 when qpdf
 * cannot say — the file was repaired, that much is known.
 */
export async function repairCount(run: Run, input: string, pwFile: string | null): Promise<number> {
  try {
    const r = await run(
      "qpdf",
      [...(pwFile ? [`--password-file=${pwFile}`] : []), "--json", "--json-key=qpdf", "--json-stream-data=none", input],
      { check: false, timeoutMs: 60_000, label: "Checking the repair" },
    );
    return r.code === 3 ? countRepairs(r.stderr) : 1;
  } catch {
    return 1;
  }
}

// ── PDF/A metadata ─────────────────────────────────────────────────────────

/**
 * What stripping metadata may do to the XMP packet: keep it (not stripping),
 * drop it, or keep only what the file's conformance claims need (PDF/A
 * requires the packet with its `pdfaid` identification; a PDF/UA file its
 * `pdfuaid`).
 */
export function xmpPolicy(
  params: Pick<CompressParams, "stripMetadata">,
  analysis: Pick<PdfAnalysis, "flags"> | null | undefined,
): "keep" | "required" | "drop" {
  if (!params.stripMetadata) return "keep";
  return analysis?.flags.pdfa ? "required" : "drop";
}

const SCHEMAS = {
  pdfaid: { uri: "http://www.aiim.org/pdfa/ns/id/", props: ["part", "amd", "corr", "conformance", "rev"] },
  pdfuaid: { uri: "http://www.aiim.org/pdfua/ns/id/", props: ["part", "amd", "corr", "rev"] },
} as const;

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A minimal XMP packet carrying only the conformance identification found in
 * `xmp` — PDF/A's `pdfaid:*` and PDF/UA's `pdfuaid:*` — in either element
 * (`<pdfaid:part>2</pdfaid:part>`) or attribute (`pdfaid:part="2"`) form.
 * Null when `xmp` claims neither, so there is nothing to keep. The title is
 * kept too: stripping keeps the Info dictionary's Title, and PDF/A wants the
 * two to agree.
 */
export function requiredXmp(xmp: string): string | null {
  const blocks: string[] = [];
  const title = /<dc:title\b[^>]*>[\s\S]*?<\/dc:title>/.exec(xmp)?.[0];
  for (const [prefix, { uri, props }] of Object.entries(SCHEMAS)) {
    const values: string[] = [];
    for (const prop of props) {
      const tag = `${prefix}:${prop}`;
      const m =
        new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(xmp) ?? new RegExp(`\\b${tag}\\s*=\\s*(["'])(.*?)\\1`).exec(xmp);
      const value = m ? (m.length > 2 ? m[2] : m[1]) : undefined;
      if (value) values.push(`<${tag}>${escapeXml(value.trim())}</${tag}>`);
    }
    if (values.length) blocks.push(`<rdf:Description rdf:about="" xmlns:${prefix}="${uri}">${values.join("")}</rdf:Description>`);
  }
  if (!blocks.length) return null;
  if (title) blocks.push(`<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">${title}</rdf:Description>`);
  return (
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    blocks.join("") +
    "</rdf:RDF></x:xmpmeta>\n" +
    '<?xpacket end="w"?>'
  );
}

// ── notes ──────────────────────────────────────────────────────────────────

/**
 * The sentences a compress run adds to RunResult.notes for a special input.
 * The repair note is not among them: the compress handler adds that one.
 */
export function specialNotes(
  params: Pick<CompressParams, "stripMetadata" | "reencrypt" | "acceptSignatureLoss">,
  analysis: PdfAnalysis | null | undefined,
): string[] {
  if (!analysis) return [];
  const notes: string[] = [];
  const signers = analysis.flags.signed;
  if (signers) {
    const named = signers.length ? signers : [UNNAMED_SIGNER];
    notes.push(`The signature by ${listOf(named)} is no longer valid.`);
  }
  if (analysis.flags.pdfa && params.stripMetadata) notes.push(`Kept the ${analysis.flags.pdfa} identification in the metadata.`);
  if (analysis.flags.encrypted) {
    notes.push(params.reencrypt ? "Encrypted with the same password (AES-256)." : "Saved without a password.");
  }
  return notes;
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
