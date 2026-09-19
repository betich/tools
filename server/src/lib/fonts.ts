import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";
import type { GoogleFont } from "@tools/shared";
import { env, paths } from "../env";
import { cacheGet, cacheSet } from "./db";
import { diskHasRoom } from "./limits";

const CATALOGUE_KEY = "google-fonts:catalogue";

/** Upstream calls give up rather than hold a request open. */
const UPSTREAM_TIMEOUT_MS = 10_000;
/** No real font face is this big; anything larger is not one. */
const MAX_FACE_BYTES = 20 * 1024 * 1024;
/** A family Google does not know is remembered briefly, so a typo is not re-fetched on every render. */
const UNKNOWN_FAMILY_TTL_MS = 60 * 60 * 1000;

const upstream = (url: string, init?: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });

/**
 * A small hand-picked catalogue used when no API key is configured, so the
 * editor still has a usable font list on a cold box.
 */
const FALLBACK: GoogleFont[] = [
  { family: "Roboto Mono", category: "monospace", variants: ["400", "500", "700", "italic"], files: {} },
  { family: "Inter", category: "sans-serif", variants: ["400", "500", "600", "700", "900"], files: {} },
  { family: "Playfair Display", category: "serif", variants: ["400", "700", "900", "italic"], files: {} },
  { family: "Bebas Neue", category: "sans-serif", variants: ["400"], files: {} },
  { family: "Lora", category: "serif", variants: ["400", "700", "italic"], files: {} },
  { family: "Montserrat", category: "sans-serif", variants: ["400", "600", "800"], files: {} },
  { family: "Sarabun", category: "sans-serif", variants: ["400", "700"], files: {} },
  { family: "IBM Plex Sans Thai", category: "sans-serif", variants: ["400", "600"], files: {} },
  { family: "Space Grotesk", category: "sans-serif", variants: ["400", "700"], files: {} },
  { family: "DM Serif Display", category: "serif", variants: ["400", "italic"], files: {} },
];

type WebfontsResponse = {
  items?: Array<{ family: string; category: string; variants: string[]; files: Record<string, string> }>;
};

export async function catalogue(): Promise<{ fonts: GoogleFont[]; source: "google" | "fallback" }> {
  const result = await googleCatalogue();
  if (result.source === "google") return result;
  // The hand-picked list cannot know every weight a family ships; ask Google.
  const fonts = await Promise.all(
    result.fonts.map(async (font) => {
      const faces = await familyFaces(font.family).catch(() => []);
      return faces.length ? { ...font, variants: variantsOf(faces) } : font;
    }),
  );
  return { fonts, source: "fallback" };
}

async function googleCatalogue(): Promise<{ fonts: GoogleFont[]; source: "google" | "fallback" }> {
  const cached = cacheGet<GoogleFont[]>(CATALOGUE_KEY);
  if (cached) return { fonts: cached, source: "google" };
  if (!env.googleFontsKey) return { fonts: FALLBACK, source: "fallback" };

  try {
    const url = `https://www.googleapis.com/webfonts/v1/webfonts?sort=popularity&key=${encodeURIComponent(env.googleFontsKey)}`;
    const res = await upstream(url);
    if (!res.ok) throw new Error(`webfonts ${res.status}`);
    const json = (await res.json()) as WebfontsResponse;
    const fonts: GoogleFont[] = (json.items ?? []).map((f) => ({
      family: f.family,
      category: f.category,
      variants: f.variants,
      files: f.files,
    }));
    if (fonts.length === 0) throw new Error("empty catalogue");
    cacheSet(CATALOGUE_KEY, fonts, env.fontCacheTtlMs);
    return { fonts, source: "google" };
  } catch {
    return { fonts: FALLBACK, source: "fallback" };
  }
}

const registered = new Set<string>();
const inflight = new Map<string, Promise<boolean>>();

/** Roboto Mono closes every family stack in the renderer, so the server always has it. */
export const DEFAULT_FAMILY = "Roboto Mono";

export type GoogleFace = { weight: number; italic: boolean; url: string };

/**
 * Every face Google serves for a family, found without an API key: css2 accepts
 * the full ital×wght grid and answers only with the faces that exist, and a
 * User-Agent that predates woff2 gets plain TTFs the canvas can register.
 */
export async function familyFaces(family: string): Promise<GoogleFace[]> {
  const key = `google-faces:${family.toLowerCase()}`;
  const cached = cacheGet<GoogleFace[]>(key);
  if (cached) return cached;

  const grid: string[] = [];
  for (const ital of [0, 1]) for (let w = 100; w <= 900; w += 100) grid.push(`${ital},${w}`);
  const url =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}` +
    `:ital,wght@${grid.join(";")}&display=swap`;

  let faces: GoogleFace[] = [];
  try {
    const res = await upstream(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (res.ok) faces = parseFaces(await res.text());
  } catch {
    /* fall through to the catalogue */
  }

  // The keyed catalogue carries the same TTFs; it is the backstop if css2 is unreachable.
  if (faces.length === 0) {
    const { fonts } = await googleCatalogue();
    const font = fonts.find((f) => f.family.toLowerCase() === family.toLowerCase());
    faces = Object.entries(font?.files ?? {}).map(([variant, file]) => ({ ...parseVariant(variant), url: file }));
  }

  cacheSet(key, faces, faces.length ? env.fontCacheTtlMs : UNKNOWN_FAMILY_TTL_MS);
  return faces;
}

function parseFaces(css: string): GoogleFace[] {
  const out: GoogleFace[] = [];
  for (const block of css.split("@font-face").slice(1)) {
    const style = /font-style:\s*(\w+)/.exec(block)?.[1];
    const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1]);
    const url = /url\((https:\/\/[^)]+\.(?:ttf|otf))\)/.exec(block)?.[1];
    if (url && Number.isFinite(weight)) out.push({ weight, italic: style === "italic", url });
  }
  return out;
}

/** Google variant strings for a set of faces: `400`, `700italic`, … */
export function variantsOf(faces: GoogleFace[]): string[] {
  return faces
    .toSorted((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight)
    .map((f) => `${f.weight}${f.italic ? "italic" : ""}`);
}

/**
 * Make every face of `family` available to the canvas under its own name,
 * downloading each TTF once and caching it on disk. Registering the whole
 * family is what lets Skia match the weight and style a layer asks for — and
 * synthesize an oblique when the family has no italic, as the browser does.
 * Safe to call on every render; concurrent calls share one download.
 */
export function registerGoogleFamily(family: string): Promise<boolean> {
  const key = family.toLowerCase();
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    const faces = await familyFaces(family);
    const results = await Promise.all(faces.map((face) => registerFace(family, face)));
    return results.some(Boolean);
  })().finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}

async function registerFace(family: string, face: GoogleFace): Promise<boolean> {
  const file = await faceFile(family, face);
  if (!file) return false;
  if (registered.has(file)) return true;
  const ok = Boolean(GlobalFonts.registerFromPath(file, family));
  if (ok) registered.add(file);
  return ok;
}

/**
 * The face's TTF on disk, downloaded once and kept. `null` when it cannot be
 * had — upstream is down, the file is implausibly large, or the disk is low.
 */
export async function faceFile(family: string, face: GoogleFace): Promise<string | null> {
  const file = join(paths.fonts, `${slugify(family)}-${face.weight}${face.italic ? "italic" : ""}.ttf`);
  if (existsSync(file)) return file;
  if (!/^https?:\/\/fonts\.gstatic\.com\//.test(face.url)) return null;
  try {
    const res = await upstream(face.url);
    if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_FACE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_FACE_BYTES || !(await diskHasRoom(buf.byteLength))) return null;
    await mkdir(paths.fonts, { recursive: true });
    await writeFile(file, buf);
    return file;
  } catch {
    return null;
  }
}

/** Register an uploaded face (TTF/OTF/WOFF) under an arbitrary family name. */
export function registerFontBuffer(buffer: Buffer, family: string, assetId: string): boolean {
  const key = `upload::${family}::${assetId}`;
  if (registered.has(key)) return true;
  const ok = Boolean(GlobalFonts.register(buffer, family));
  if (ok) registered.add(key);
  return ok;
}

export function parseVariant(variant: string): { weight: number; italic: boolean } {
  const italic = variant.includes("italic");
  const digits = variant.replace(/[^0-9]/g, "");
  const weight = digits ? Number(digits) : 400;
  return { weight, italic };
}


function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
