import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPdfPassword } from "../src/lib/pdfPassword";

/**
 * The API's password check against files qpdf and mutool encrypt, every
 * revision the standard handler has. Needs qpdf and mutool, so it runs in
 * the worker image:
 *
 *   docker run --rm -v "$PWD":/app -w /app --entrypoint bun tools-pdf-worker:latest test server/test
 */

const hasTools = !!Bun.which("qpdf") && !!Bun.which("mutool");
let dir = "";

function sh(cmd: string[]) {
  const r = Bun.spawnSync(cmd, { cwd: dir });
  if (r.exitCode !== 0 && r.exitCode !== 3) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString()}`);
}

describe.skipIf(!hasTools)("checkPdfPassword", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "pdfpw-"));
    writeFileSync(
      join(dir, "make.js"),
      `var pdf = new PDFDocument(); var b = new Buffer(); b.write("BT /F1 12 Tf 72 720 Td (x) Tj ET");
       pdf.insertPage(-1, pdf.addPage([0,0,612,792], 0, pdf.addObject({Font:{F1:pdf.addSimpleFont(new Font("Helvetica"))}}), b));
       pdf.save(scriptArgs[0]);`,
    );
    sh(["mutool", "run", "make.js", "plain.pdf"]);
    for (const [name, bits, extra] of [
      ["r2", "40", []],
      ["r3", "128", ["--use-aes=n"]],
      ["r4", "128", ["--use-aes=y"]],
      ["r6", "256", []],
    ] as const) {
      sh(["qpdf", "--allow-weak-crypto", "--encrypt", "--user-password=sécret", "--owner-password=boss", `--bits=${bits}`, ...extra, "--", "plain.pdf", `${name}.pdf`]);
    }
    sh(["qpdf", "--object-streams=generate", "--encrypt", "--user-password=sécret", "--owner-password=boss", "--bits=256", "--", "plain.pdf", "r6-objstm.pdf"]);
    sh(["qpdf", "--encrypt", "--user-password=abc", "--owner-password=boss", "--bits=256", "--force-R5", "--", "plain.pdf", "r5.pdf"]);
    sh(["mutool", "clean", "-E", "aes-256", "-U", "sécret", "-O", "boss", "plain.pdf", "mutool.pdf"]);
    sh(["mutool", "clean", "-E", "rc4-128", "-U", "sécret", "-O", "boss", "plain.pdf", "mutool-rc4.pdf"]);
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  for (const name of ["r2", "r3", "r4", "r6", "r6-objstm", "mutool", "mutool-rc4"]) {
    test(`${name}: user and owner passwords open it, others do not`, async () => {
      const file = join(dir, `${name}.pdf`);
      expect(await checkPdfPassword(file, "sécret")).toBe("ok");
      expect(await checkPdfPassword(file, "boss")).toBe("ok");
      expect(await checkPdfPassword(file, "secret")).toBe("wrong");
      expect(await checkPdfPassword(file, "")).toBe("wrong");
    });
  }

  test("r5 (the AES-256 draft)", async () => {
    expect(await checkPdfPassword(join(dir, "r5.pdf"), "abc")).toBe("ok");
    expect(await checkPdfPassword(join(dir, "r5.pdf"), "boss")).toBe("ok");
    expect(await checkPdfPassword(join(dir, "r5.pdf"), "abd")).toBe("wrong");
  });

  test("an unencrypted file is not something to check", async () => {
    expect(await checkPdfPassword(join(dir, "plain.pdf"), "x")).toBe("unknown");
  });
});
