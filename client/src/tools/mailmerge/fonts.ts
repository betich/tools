import type { FontSource } from "@tools/shared";

/** Families already requested this session, so a re-select is instant. */
const loaded = new Map<string, Promise<void>>();

export const SYSTEM_STACKS = ["Roboto Mono", "Inter", "Georgia", "Times New Roman", "Courier New", "Arial"];

/**
 * Pull a family in from Google Fonts and wait until the browser can actually
 * paint with it — canvas silently falls back to a default otherwise, and the
 * preview would then disagree with the server render.
 */
export function loadGoogleFont(family: string, variants: string[]): Promise<void> {
  const key = `google:${family}`;
  const existing = loaded.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:${axes(variants)}&display=swap`;
    document.head.appendChild(link);

    await Promise.all(
      weightsOf(variants).map((w) =>
        document.fonts.load(`${w} 32px "${family}"`).catch(() => {
          /* a missing weight is not fatal — the nearest one is used */
        }),
      ),
    );
    await document.fonts.ready;
  })();

  loaded.set(key, promise);
  return promise;
}

/** Register an uploaded face under a family name of our choosing. */
export async function loadUploadedFont(family: string, file: File): Promise<void> {
  const face = new FontFace(family, await file.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  loaded.set(`upload:${family}`, Promise.resolve());
}

export function ensureFont(source: FontSource, family: string, variants: string[]): Promise<void> {
  if (source.kind === "google") return loadGoogleFont(source.family || family, variants);
  return Promise.resolve();
}

export function weightsOf(variants: string[]): number[] {
  const set = new Set<number>();
  for (const v of variants) {
    const n = Number.parseInt(v, 10);
    set.add(Number.isFinite(n) ? n : 400);
  }
  if (set.size === 0) set.add(400);
  return [...set].sort((a, b) => a - b);
}

export const hasItalic = (variants: string[]) => variants.some((v) => v.includes("italic"));

/** css2 wants the axis tuples sorted: ital ascending, then weight ascending. */
function axes(variants: string[]): string {
  const weights = weightsOf(variants);
  const italics = hasItalic(variants);
  const tuples: string[] = [];
  for (const w of weights) tuples.push(`0,${w}`);
  if (italics) for (const w of weights) tuples.push(`1,${w}`);
  return `ital,wght@${tuples.join(";")}`;
}

/** Google's variant strings map onto the weight/italic pair the editor uses. */
export function variantFor(weight: number, italic: boolean, variants: string[]): string {
  const candidates = italic ? [`${weight}italic`, "italic", `${weight}`] : [`${weight}`, "regular"];
  for (const c of candidates) if (variants.includes(c)) return c;
  return variants[0] ?? "regular";
}
