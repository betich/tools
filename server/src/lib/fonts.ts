import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";
import type { GoogleFont } from "@tools/shared";
import { env, paths } from "../env";
import { cacheGet, cacheSet } from "./db";

const CATALOGUE_KEY = "google-fonts:catalogue";

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
  const cached = cacheGet<GoogleFont[]>(CATALOGUE_KEY);
  if (cached) return { fonts: cached, source: "google" };
  if (!env.googleFontsKey) return { fonts: FALLBACK, source: "fallback" };

  try {
    const url = `https://www.googleapis.com/webfonts/v1/webfonts?sort=popularity&key=${encodeURIComponent(env.googleFontsKey)}`;
    const res = await fetch(url);
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

/**
 * Make `family` available to the canvas under its own name, downloading the
 * TTF once and caching it on disk. Safe to call on every render.
 */
export async function registerGoogleFont(family: string, variant = "regular"): Promise<boolean> {
  const key = `${family}::${variant}`;
  if (registered.has(key)) return true;

  const file = join(paths.fonts, `${slugify(family)}-${slugify(variant)}.ttf`);
  if (!existsSync(file)) {
    const url = await ttfUrl(family, variant);
    if (!url) return false;
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      await mkdir(paths.fonts, { recursive: true });
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
    } catch {
      return false;
    }
  }

  const ok = Boolean(GlobalFonts.registerFromPath(file, family));
  if (ok) registered.add(key);
  return ok;
}

/** Register an uploaded face (TTF/OTF/WOFF) under an arbitrary family name. */
export function registerFontBuffer(buffer: Buffer, family: string): boolean {
  const key = `upload::${family}`;
  if (registered.has(key)) return true;
  const ok = Boolean(GlobalFonts.register(buffer, family));
  if (ok) registered.add(key);
  return ok;
}

async function ttfUrl(family: string, variant: string): Promise<string | null> {
  const { fonts } = await catalogue();
  const font = fonts.find((f) => f.family.toLowerCase() === family.toLowerCase());
  const files = font?.files ?? {};
  const fromCatalogue = files[variant] ?? files[normaliseVariant(variant)] ?? files["regular"] ?? Object.values(files)[0];
  if (fromCatalogue) return fromCatalogue;
  return resolveViaCss2(family, variant);
}

/**
 * The catalogue needs an API key; the CSS2 endpoint does not. Asking it with a
 * User-Agent that predates woff2 makes Google answer with a plain TTF, which is
 * what the canvas can register — so the renderer works on a box with no key.
 */
async function resolveViaCss2(family: string, variant: string): Promise<string | null> {
  const { weight, italic } = parseVariant(variant);
  const url =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}` +
    `:ital,wght@${italic ? 1 : 0},${weight}&display=swap`;
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const css = await res.text();
    return /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.(?:ttf|otf))\)/.exec(css)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function parseVariant(variant: string): { weight: number; italic: boolean } {
  const italic = variant.includes("italic");
  const digits = variant.replace(/[^0-9]/g, "");
  const weight = digits ? Number(digits) : 400;
  return { weight, italic };
}

/** Google's webfonts API calls weight 400 "regular" and 400 italic "italic". */
export function normaliseVariant(variant: string): string {
  if (variant === "400") return "regular";
  if (variant === "400italic") return "italic";
  return variant;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
