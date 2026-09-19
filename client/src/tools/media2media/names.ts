/**
 * Output filenames, for every media2media tab (and squoosh).
 *
 * `fileStem` is the name as the user gave it, minus the extension: the video
 * tab and the PNG sequence keep it exactly (spaces and all). The image batch
 * goes further with `outputStem`, whose stem keeps every letter, digit and combining mark in any script
 * (`\p{L}\p{N}\p{M}`, the same class as the merge's `fileNameFor`) plus `_`
 * and `-`; anything else runs together into one dash. Stripping to ASCII
 * would erase Thai entirely and every file would collapse to the fallback.
 * Names are NFC-normalised first, because macOS hands over decomposed ones.
 */

/**
 * `ทะเล หัวหิน.mov` → `ทะเล หัวหิน`: the extension off, NFC, trimmed, nothing
 * else touched. `fallback` when nothing is left (`.mov`, `  .mp4`).
 */
export function fileStem(fileName: string, fallback: string): string {
  const name = fileName.normalize("NFC");
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).trim() || fallback;
}

const UNSAFE = /[^\p{L}\p{N}\p{M}_-]+/gu;

/** `IMG 0042 (1).HEIC` → `IMG-0042-1`. Empty stems fall back to `image-007`. */
export function outputStem(fileName: string, index = 0): string {
  const stem = fileName.normalize("NFC").replace(/\.[^.]*$/, "");
  const slug = stem.replace(UNSAFE, "-").replace(/^-+|-+$/g, "");
  return slug || `image-${String(index + 1).padStart(3, "0")}`;
}

export function outputName(fileName: string, ext: string, index = 0): string {
  return `${outputStem(fileName, index)}.${ext}`;
}

/**
 * The same names, made distinct for one zip: a repeat becomes `name-2.ext`,
 * `name-3.ext`, compared case-insensitively so the archive also unpacks on
 * macOS and Windows without one file overwriting another.
 */
export function uniqueNames(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}
