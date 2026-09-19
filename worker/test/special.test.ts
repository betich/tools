import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PdfAnalysis } from "@tools/shared";
import { run as exec } from "../src/exec";
import type { TaskContext } from "../src/jobs";
import {
  countRepairs,
  decryptInput,
  lockedGuard,
  reencryptOutput,
  repairCount,
  repairNote,
  requiredXmp,
  signatureGuard,
  specialNotes,
  xmpPolicy,
} from "../src/special";

/**
 * #15 special inputs: the pure helpers everywhere, and against the generated
 * fixtures (test/fixtures/make.sh) where the worker image's tools are:
 *
 *   docker run --rm -v "$PWD":/app -w /app --entrypoint bun tools-pdf-worker:latest test worker/test
 */

const analysis = (flags: Partial<PdfAnalysis["flags"]> = {}, extra: Partial<PdfAnalysis> = {}): PdfAnalysis => ({
  bytes: 1000,
  pages: 1,
  version: "1.7",
  breakdown: { images: 0, fonts: 0, content: 0, metadata: 0, other: 0 },
  images: [],
  fonts: [],
  flags: { encrypted: false, signed: null, pdfa: null, tagged: false, repaired: 0, ...flags },
  truncated: false,
  ...extra,
});

describe("guards and notes", () => {
  test("signatureGuard refuses a signed file until the loss is accepted", () => {
    const signed = analysis({ signed: ["Test Signer"] });
    expect(signatureGuard({}, signed)).toBe("This file is signed — confirm that compressing removes the signature's validity.");
    expect(signatureGuard({ acceptSignatureLoss: false }, signed)).not.toBeNull();
    expect(signatureGuard({ acceptSignatureLoss: true }, signed)).toBeNull();
    expect(signatureGuard({}, analysis())).toBeNull();
    expect(signatureGuard(null, null)).toBeNull();
  });

  test("lockedGuard", () => {
    expect(lockedGuard(analysis({ encrypted: true }, { locked: true }))).toBe("This file is locked — enter its password first.");
    expect(lockedGuard(analysis({ encrypted: true }, { locked: false }))).toBeNull();
    expect(lockedGuard(null)).toBeNull();
  });

  test("repairNote", () => {
    expect(repairNote(0)).toBeNull();
    expect(repairNote(1)).toBe("Repaired 1 broken object");
    expect(repairNote(3)).toBe("Repaired 3 broken objects");
  });

  test("countRepairs counts distinct objects, at least the table", () => {
    const stderr = [
      "WARNING: t.pdf: file is damaged",
      "WARNING: t.pdf (object 17 0, offset 1378): expected endstream",
      "WARNING: t.pdf (object 17 0, offset 1378): expected endobj",
      "WARNING: object 18 0: Pages tree includes non-dictionary object; ignoring",
      "WARNING: object 21 0: Pages tree includes non-dictionary object; ignoring",
    ].join("\n");
    expect(countRepairs(stderr)).toBe(3);
    expect(countRepairs("WARNING: t.pdf (offset 1793): xref not found")).toBe(1);
  });

  test("xmpPolicy keeps PDF/A identification when stripping", () => {
    expect(xmpPolicy({ stripMetadata: false }, analysis({ pdfa: "PDF/A-2b" }))).toBe("keep");
    expect(xmpPolicy({ stripMetadata: true }, analysis({ pdfa: "PDF/A-2b" }))).toBe("required");
    expect(xmpPolicy({ stripMetadata: true }, analysis())).toBe("drop");
  });

  test("requiredXmp keeps pdfaid/pdfuaid only, element or attribute form", () => {
    const gs = `<rdf:Description rdf:about="" xmlns:pdfaid='http://www.aiim.org/pdfa/ns/id/' pdfaid:part='2' pdfaid:conformance='B'/>
      <rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Somebody Private</dc:creator></rdf:Description>`;
    const kept = requiredXmp(gs)!;
    expect(kept).toContain("<pdfaid:part>2</pdfaid:part>");
    expect(kept).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
    expect(kept).not.toContain("Somebody");
    expect(kept.startsWith('<?xpacket begin="﻿"')).toBe(true);
    const ua = requiredXmp("<pdfaid:part>1</pdfaid:part><pdfaid:conformance>A</pdfaid:conformance><pdfuaid:part>1</pdfuaid:part>")!;
    expect(ua).toContain('xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"><pdfuaid:part>1</pdfuaid:part>');
    expect(requiredXmp("<dc:title>x</dc:title>")).toBeNull();
  });

  test("specialNotes", () => {
    const a = analysis({ encrypted: true, signed: [], pdfa: "PDF/A-2b", repaired: 2 });
    // The repair note is the compress handler's, not repeated here.
    expect(specialNotes({ stripMetadata: true, reencrypt: true }, a)).toEqual([
      "The signature by an unnamed signer is no longer valid.",
      "Kept the PDF/A-2b identification in the metadata.",
      "Encrypted with the same password (AES-256).",
    ]);
    expect(specialNotes({ stripMetadata: false }, analysis({ encrypted: true, signed: ["A", "B"] }))).toEqual([
      "The signature by A and B is no longer valid.",
      "Saved without a password.",
    ]);
  });
});

// ── against the fixtures ───────────────────────────────────────────────────

const SCRIPT = join(import.meta.dir, "../scripts/analyse.js");
const hasTools = ["mutool", "vips", "gs", "qpdf", "openssl"].every((t) => !!Bun.which(t));
let dir = "";

/** TaskContext.run without the job loop: the same exec, errors as TaskError-like throws. */
const run: TaskContext["run"] = async (cmd, args, opts = {}) => {
  const r = await exec([cmd, ...args], { memoryBytes: 2 ** 31, timeoutMs: opts.timeoutMs ?? 60_000, cwd: dir, stdout: opts.stdout });
  if (opts.check !== false && r.code !== 0) throw new Error(`${cmd} failed: ${r.stderr}`);
  return r;
};

type Raw = PdfAnalysis & { locked: boolean; walked: number };

function analyse(name: string, passwordFile?: string): Raw {
  const file = join(dir, name);
  const out = join(dir, `${name}.json`);
  const r = Bun.spawnSync([
    "mutool", "run", SCRIPT, file, out, join(dir, "progress.txt"), String(statSync(file).size),
    "5000", String(256 << 20), "2000000", String(Date.now() + 60_000), ...(passwordFile ? [passwordFile] : []),
  ]);
  expect(r.exitCode).toBe(0);
  return JSON.parse(readFileSync(out, "utf8"));
}

describe.skipIf(!hasTools)("special inputs", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "special-"));
    const r = Bun.spawnSync(["sh", join(import.meta.dir, "fixtures/make.sh"), dir]);
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  }, 90_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("encrypted: locked without the password, whole with it", async () => {
    const locked = analyse("locked.pdf");
    expect(locked.locked).toBe(true);
    expect(locked.flags.encrypted).toBe(true);

    const wrong = join(dir, "wrong.txt");
    writeFileSync(wrong, "nope\n");
    expect(analyse("locked.pdf", wrong).locked).toBe(true);

    const right = join(dir, "right.txt");
    writeFileSync(right, "secret\n");
    const open = analyse("locked.pdf", right);
    expect(open.locked).toBe(false);
    expect(open.truncated).toBe(false);
    expect(open.pages).toBe(3);
    expect(open.images).toHaveLength(2);
    expect(open.flags).toMatchObject({ encrypted: true, signed: ["Test Signer"], pdfa: "PDF/A-2b", tagged: true });
  });

  test("decryptInput / reencryptOutput round trip", async () => {
    const work = mkdtempSync(join(dir, "work-"));
    await expect(decryptInput(run, join(dir, "locked.pdf"), "nope", work)).rejects.toThrow("That password didn't open the file.");
    const plain = await decryptInput(run, join(dir, "locked.pdf"), "secret", work);
    expect(analyse(plain.slice(dir.length + 1)).flags.encrypted).toBe(false);
    // The owner password opens it too.
    expect(await decryptInput(run, join(dir, "locked.pdf"), "owner", mkdtempSync(join(dir, "work-")))).toEndWith("decrypted.pdf");

    const again = await reencryptOutput(run, plain, "pässword with spaces", work);
    const r = await run("qpdf", ["--show-encryption", again], { check: false, stdout: true });
    expect(r.stdout).toContain("AESv3"); // AES-256
    const pw = join(dir, "pw2.txt");
    writeFileSync(pw, "pässword with spaces\n");
    expect(analyse(again.slice(dir.length + 1), pw)).toMatchObject({ locked: false, pages: 3 });
    expect(analyse(again.slice(dir.length + 1)).locked).toBe(true);
    // Neither password file is left readable by others.
    expect(statSync(join(work, "password")).mode & 0o077).toBe(0);
    expect(statSync(join(work, "encrypt.args")).mode & 0o077).toBe(0);
  });

  test("signed with a real certificate: the signer's name comes from it", () => {
    const a = analyse("signed.pdf");
    expect(a.flags.signed).toEqual(["Test Signer"]);
    expect(analyse("sigfield.pdf").flags.signed).toBeNull(); // an empty field is not a signature
  });

  test("PDF/A-2b from Ghostscript", () => {
    expect(analyse("pdfa.pdf").flags.pdfa).toBe("PDF/A-2b");
    const xmp = Bun.spawnSync(["mutool", "show", "-b", join(dir, "pdfa.pdf"), "trailer/Root/Metadata"]).stdout.toString();
    expect(requiredXmp(xmp)).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
  });

  test("tagged", () => {
    expect(analyse("tagged.pdf").flags.tagged).toBe(true);
    expect(analyse("sigfield.pdf").flags.tagged).toBe(false);
  });

  test("damaged: repaired, with a count of broken objects", async () => {
    const shifted = analyse("shifted.pdf");
    expect(shifted.flags.repaired).toBe(1);
    expect(shifted.pages).toBe(3);
    expect(await repairCount(run, join(dir, "shifted.pdf"), null)).toBe(1);

    const cut = analyse("truncated.pdf");
    expect(cut.flags.repaired).toBe(1);
    expect(await repairCount(run, join(dir, "truncated.pdf"), null)).toBeGreaterThan(1);

    expect(analyse("sigfield.pdf").flags.repaired).toBe(0);
  });
});
