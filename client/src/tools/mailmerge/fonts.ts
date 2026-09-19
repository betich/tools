import { useEffect, useState } from "react";
import { applyCase, resolve, textCaseOf, type FallbackFont, type MergeDoc, type MergeRow } from "@tools/shared";
import { assetUrl } from "@/lib/api";

/** Families already requested this session, so a re-select is instant. */
const loaded = new Map<string, Promise<void>>();

export const SYSTEM_STACKS = ["Roboto Mono", "Inter", "Georgia", "Times New Roman", "Courier New", "Arial"];

/** Closes every family stack in the renderer, so it is always wanted. */
const DEFAULT_FAMILY = "Roboto Mono";

/** No single face may hold a render hostage; past this the nearest face is used. */
const FACE_TIMEOUT_MS = 12_000;

/**
 * Every weight and style of a Google family. css2 accepts the full ital×wght
 * grid and answers with only the faces that exist, so one stylesheet brings in
 * the whole family — whatever weight or italic a layer picks later is already
 * declared, and the browser only fetches the files a render actually touches.
 */
export function loadGoogleFont(family: string): Promise<void> {
  const key = `google:${family}`;
  const existing = loaded.get(key);
  if (existing) return existing;

  const grid: string[] = [];
  for (const ital of [0, 1]) for (let w = 100; w <= 900; w += 100) grid.push(`${ital},${w}`);

  const promise = new Promise<void>((done, fail) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:ital,wght@${grid.join(";")}&display=swap`;
    link.onload = () => done();
    link.onerror = () => {
      link.remove();
      // Forget the failure so the next render gets another go.
      loaded.delete(key);
      fail(new Error(`could not load ${family}`));
    };
    document.head.appendChild(link);
  });

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

/** An uploaded face this browser has not seen — a shared or reopened merge — read back from the asset store. */
function loadAssetFont(family: string, assetId: string): Promise<void> {
  const key = `upload:${family}`;
  const existing = loaded.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const face = new FontFace(family, `url("${assetUrl(assetId)}")`);
    await face.load();
    document.fonts.add(face);
  })();
  promise.catch(() => loaded.delete(key));
  loaded.set(key, promise);
  return promise;
}

function loadFace(face: FallbackFont): Promise<void> {
  if (face.source.kind === "google") return loadGoogleFont(face.source.family || face.family);
  if (face.source.kind === "upload" && face.source.assetId) return loadAssetFont(face.family, face.source.assetId);
  return Promise.resolve();
}

const withTimeout = <T,>(p: Promise<T>, ms = FACE_TIMEOUT_MS) =>
  Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]).catch(() => {});

/**
 * Resolve once every face `doc` draws with is ready to paint the text these
 * rows will put on the canvas. Declaring a face is not enough — canvas never
 * waits for a download, it silently paints the fallback, so a preview or an
 * export taken a moment too early disagrees with the server render. Asking
 * `document.fonts.load` for the exact weight, style and characters fetches the
 * very files (including Thai unicode-range subsets) the render needs.
 *
 * Never rejects and never hangs: a face that fails or stalls is skipped.
 */
export async function ensureDocFonts(doc: MergeDoc, rows: (MergeRow | null)[]): Promise<void> {
  const sample = rows.length ? rows : [null];
  const jobs: Promise<unknown>[] = [];

  jobs.push(withTimeout(loadGoogleFont(DEFAULT_FAMILY).then(() => document.fonts.load(`400 16px "${DEFAULT_FAMILY}"`))));

  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const chars = new Set<string>();
    for (const row of sample) {
      const text = resolve(layer.text, row);
      for (const ch of applyCase(text, textCaseOf(layer))) chars.add(ch);
    }
    const text = [...chars].join("") || " ";
    const style = layer.font.italic ? "italic " : "";

    for (const face of [{ family: layer.font.family, source: layer.font.source }, ...(layer.font.fallbacks ?? [])]) {
      jobs.push(
        withTimeout(
          loadFace(face).then(() => document.fonts.load(`${style}${layer.font.weight} 16px "${face.family}"`, text)),
        ),
      );
    }
  }

  await Promise.all(jobs);
}

/** A number that ticks whenever the browser finishes loading font files — a cue to repaint. */
export function useFontEpoch(): number {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setEpoch((n) => n + 1);
    document.fonts.addEventListener("loadingdone", bump);
    return () => document.fonts.removeEventListener("loadingdone", bump);
  }, []);
  return epoch;
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

/** Google's variant strings map onto the weight/italic pair the editor uses. */
export function variantFor(weight: number, italic: boolean, variants: string[]): string {
  const candidates = italic ? [`${weight}italic`, "italic", `${weight}`] : [`${weight}`, "regular"];
  for (const c of candidates) if (variants.includes(c)) return c;
  return variants[0] ?? "regular";
}
