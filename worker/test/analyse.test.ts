import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PdfAnalysis } from "@tools/shared";

/**
 * The analysis walk against generated fixtures (test/fixtures/make.sh). Needs
 * the worker image's toolchain, so it is skipped where mutool is missing:
 *
 *   docker run --rm -v "$PWD":/app -w /app --entrypoint bun tools-pdf-worker:latest test worker/test
 */

const SCRIPT = join(import.meta.dir, "../scripts/analyse.js");
const hasTools = !!Bun.which("mutool") && !!Bun.which("vips") && !!Bun.which("gs") && !!Bun.which("qpdf");
let dir = "";

function analyse(name: string, caps: { pages?: number } = {}): PdfAnalysis & { walked: number; locked: boolean } {
  const file = join(dir, name);
  const out = join(dir, `${name}.json`);
  const size = statSync(file).size;
  const r = Bun.spawnSync([
    "mutool", "run", SCRIPT, file, out, join(dir, "progress.txt"), String(size),
    String(caps.pages ?? 5000), String(256 << 20), "2000000", String(Date.now() + 60_000),
  ]);
  expect(r.exitCode).toBe(0);
  return JSON.parse(readFileSync(out, "utf8"));
}

function attributed(a: PdfAnalysis): number {
  return Object.values(a.breakdown).reduce((n, b) => n + b, 0);
}

describe.skipIf(!hasTools)("analyse.js", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "analyse-"));
    const r = Bun.spawnSync(["sh", join(import.meta.dir, "fixtures/make.sh"), dir]);
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    return () => rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  test("born-digital deck: images, fonts, DPI through a nested form, flags", () => {
    const a = analyse("deck.pdf");
    expect(a.pages).toBe(3);
    expect(a.truncated).toBe(false);
    // Everything but the xref stream's trailer bits is attributed.
    expect(attributed(a)).toBeLessThanOrEqual(a.bytes);
    expect(attributed(a)).toBeGreaterThan(a.bytes * 0.99);
    const photo = a.images.find((i) => i.width === 1200)!;
    expect(photo).toMatchObject({ pages: [1, 3], filter: "DCTDecode", colorSpace: "DeviceRGB", alpha: false });
    expect(photo.dpi).toBeCloseTo(864, 0);
    const alpha = a.images.find((i) => i.width === 300)!;
    expect(alpha).toMatchObject({ pages: [2], alpha: true, dpi: 150 });
    expect(a.images).toHaveLength(2); // the soft mask is folded into its image
    expect(a.breakdown.images).toBe(photo.bytes + alpha.bytes);
    expect(a.fonts.find((f) => f.name === "Courier")).toMatchObject({ embedded: true, subset: false });
    expect(a.fonts.find((f) => f.name === "Times-Roman")).toMatchObject({ embedded: false, bytes: 0 });
    expect(a.flags).toEqual({ encrypted: false, signed: ["Test Signer"], pdfa: "PDF/A-2b", tagged: true, repaired: 0 });
  });

  test("ghostscript rewrite: subset fonts, classic xref", () => {
    const a = analyse("deck-gs.pdf");
    expect(attributed(a)).toBeLessThanOrEqual(a.bytes);
    expect(attributed(a)).toBeGreaterThan(a.bytes * 0.99);
    expect(a.fonts.length).toBeGreaterThan(0);
    for (const f of a.fonts) expect(f).toMatchObject({ embedded: true, subset: true });
    expect(a.breakdown.fonts).toBe(a.fonts.reduce((n, f) => n + f.bytes, 0));
  });

  test("scan: one shared 300 dpi image on every page", () => {
    const a = analyse("scan.pdf");
    expect(a.images).toHaveLength(1);
    expect(a.images[0]).toMatchObject({ pages: [1, 2, 3], dpi: 300, colorSpace: "DeviceGray", filter: "DCTDecode" });
    expect(a.breakdown.images / a.bytes).toBeGreaterThan(0.99);
    expect(attributed(a)).toBeLessThanOrEqual(a.bytes);
  });

  test("page cap truncates", () => {
    const a = analyse("scan.pdf", { pages: 2 });
    expect(a.truncated).toBe(true);
    expect(a.walked).toBe(2);
    expect(a.images[0]!.pages).toEqual([1, 2]);
  });

  test("password-locked: reports what the dictionaries show, marked truncated", () => {
    const a = analyse("locked.pdf");
    expect(a.locked).toBe(true);
    expect(a.flags.encrypted).toBe(true);
    expect(a.truncated).toBe(true);
    expect(attributed(a)).toBeLessThanOrEqual(a.bytes);
  });
});
