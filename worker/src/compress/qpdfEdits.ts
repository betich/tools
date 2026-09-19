import { readFile, stat, writeFile } from "node:fs/promises";
import type { CompressRun } from "./pipeline";
import { removedSentence, type Removed } from "./mupdf";

/**
 * Strip metadata and remove extras without MuPDF, for the qpdf and Ghostscript
 * engines: qpdf dumps the object graph as JSON (`--json-output`, no stream
 * data), `planEdits` makes the same edits as scripts/compress.js on it, and
 * the changed objects go back in through `--update-from-json` as part of the
 * caller's own qpdf write. Objects the edits cut loose are dropped by that
 * write, since qpdf only writes what is reachable. Stream data is never read:
 * an updated stream keeps its bytes.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Dict = { [key: string]: Json };
type Entry = { value?: Json; stream?: { dict: Dict } };
export type QpdfJson = { qpdf: [Record<string, Json>, Record<string, Entry>] };

export type EditOptions = { stripMetadata: boolean; keepXmp: boolean; removeExtras: boolean };

/** Past this the dump itself would be the memory problem; the edits are skipped with a reason. */
const MAX_DUMP_BYTES = 256 * 1024 * 1024;

const REF = /^\d+ \d+ R$/;
const isDict = (v: Json | undefined): v is Dict => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The edits as a qpdf update document (null when nothing changes) and what
 * was removed, counted the way scripts/compress.js counts it.
 */
export function planEdits(json: QpdfJson, opts: EditOptions): { update: QpdfJson | null; removed: Removed } {
  const [header, objects] = json.qpdf;
  const dirty = new Set<string>();
  const removed: Removed = {};
  const count = (key: keyof Removed, n = 1) => void (removed[key] = (removed[key] ?? 0) + n);

  const entryDict = (key: string): Dict | null => {
    const e = objects[key];
    if (!e) return null;
    if (e.stream) return e.stream.dict;
    return isDict(e.value) ? e.value : null;
  };
  /** A value with the indirect object that holds it, so an edit marks the right object dirty. */
  const resolve = (v: Json | undefined, owner: string): { v: Json | undefined; owner: string } => {
    if (typeof v === "string" && REF.test(v)) {
      const key = `obj:${v}`;
      const e = objects[key];
      return { v: e ? (e.stream ? e.stream.dict : e.value) : undefined, owner: key };
    }
    return { v, owner };
  };
  const isStreamRef = (v: Json | undefined) => typeof v === "string" && REF.test(v) && !!objects[`obj:${v}`]?.stream;
  const name = (v: Json | undefined) => (typeof v === "string" && v.startsWith("/") ? v.slice(1) : "");
  const drop = (d: Dict, key: string, owner: string) => {
    if (!(key in d)) return false;
    delete d[key];
    dirty.add(owner);
    return true;
  };

  const trailer = entryDict("trailer");
  if (!trailer) return { update: null, removed };
  const root = resolve(trailer["/Root"], "trailer");
  if (!isDict(root.v)) return { update: null, removed };
  const catalog = root.v;

  const countNameTree = (node: Json | undefined, owner: string, depth: number): number => {
    const r = resolve(node, owner);
    if (!isDict(r.v) || depth > 32) return 0;
    let n = 0;
    const names = resolve(r.v["/Names"], r.owner).v;
    if (Array.isArray(names)) n += Math.floor(names.length / 2);
    const kids = resolve(r.v["/Kids"], r.owner);
    if (Array.isArray(kids.v)) for (const k of kids.v) n += countNameTree(k, kids.owner, depth + 1);
    return n;
  };
  const isScriptAction = (action: Json | undefined, owner: string) => {
    const a = resolve(action, owner).v;
    return isDict(a) && ["JavaScript", "Launch"].includes(name(a["/S"]));
  };

  /** Leaf pages in order, walked from the catalog (the dump has no page list). */
  const pages: { dict: Dict; owner: string }[] = [];
  const seen = new Set<string>();
  const walk = (node: Json | undefined, owner: string, depth: number) => {
    if (typeof node === "string" && REF.test(node)) {
      if (seen.has(node)) return;
      seen.add(node);
    }
    const r = resolve(node, owner);
    if (!isDict(r.v) || depth > 64) return;
    const kids = resolve(r.v["/Kids"], r.owner);
    if (Array.isArray(kids.v)) for (const k of kids.v) walk(k, kids.owner, depth + 1);
    else pages.push({ dict: r.v, owner: r.owner });
  };

  if (opts.removeExtras) {
    walk(catalog["/Pages"], root.owner, 0);
    const names = resolve(catalog["/Names"], root.owner);
    if (isDict(names.v)) {
      if ("/EmbeddedFiles" in names.v) {
        count("attachments", countNameTree(names.v["/EmbeddedFiles"], names.owner, 0));
        drop(names.v, "/EmbeddedFiles", names.owner);
      }
      if ("/JavaScript" in names.v) {
        count("scripts", countNameTree(names.v["/JavaScript"], names.owner, 0));
        drop(names.v, "/JavaScript", names.owner);
      }
      if (!Object.keys(names.v).length) drop(catalog, "/Names", root.owner);
    }
    drop(catalog, "/AF", root.owner);
    if (isScriptAction(catalog["/OpenAction"], root.owner)) {
      count("scripts");
      drop(catalog, "/OpenAction", root.owner);
    }
    if (drop(catalog, "/AA", root.owner)) count("scripts");
    if (drop(catalog, "/Outlines", root.owner)) {
      count("bookmarks");
      if (name(catalog["/PageMode"]) === "UseOutlines") catalog["/PageMode"] = "/UseNone";
    }
    const form = resolve(catalog["/AcroForm"], root.owner);
    if (form.v !== undefined) {
      const fields = isDict(form.v) ? resolve(form.v["/Fields"], form.owner).v : null;
      count("fields", Array.isArray(fields) ? fields.length : 0);
      drop(catalog, "/AcroForm", root.owner);
    }
    if (drop(catalog, "/PieceInfo", root.owner)) count("privateData");

    for (const page of pages) {
      if (drop(page.dict, "/AA", page.owner)) count("scripts");
      if (drop(page.dict, "/Thumb", page.owner)) count("thumbnails");
      if (drop(page.dict, "/PieceInfo", page.owner)) count("privateData");
      const annots = resolve(page.dict["/Annots"], page.owner);
      if (!Array.isArray(annots.v)) continue;
      const keep: Json[] = [];
      for (const a of annots.v) {
        const annot = resolve(a, annots.owner);
        if (!isDict(annot.v) || name(annot.v["/Subtype"]) !== "Link") {
          count("annotations");
          continue;
        }
        if (isScriptAction(annot.v["/A"], annot.owner)) {
          count("scripts");
          drop(annot.v, "/A", annot.owner);
        }
        keep.push(a);
      }
      if (keep.length === annots.v.length) continue;
      // Written onto the page itself, so an Annots array shared with another page is left alone.
      if (keep.length) page.dict["/Annots"] = keep;
      else delete page.dict["/Annots"];
      dirty.add(page.owner);
    }
  }

  if (opts.stripMetadata) {
    // The document info except its Title, as MuPDF's pass does it.
    const info = resolve(trailer["/Info"], "trailer");
    if (isDict(info.v)) {
      const title = info.v["/Title"];
      const kept: Dict = title === undefined ? {} : { "/Title": title };
      if (Object.keys(info.v).length !== Object.keys(kept).length) {
        if (info.owner === "trailer") trailer["/Info"] = kept;
        else objects[info.owner] = { value: kept };
        dirty.add(info.owner);
      }
    }
    // XMP on the catalog unless PDF/A needs it, and on anything else: pages, images, fonts, forms.
    for (const key of Object.keys(objects)) {
      if (key === "trailer") continue;
      const d = entryDict(key);
      if (!d || !isStreamRef(d["/Metadata"])) continue;
      if (d === catalog && opts.keepXmp) continue;
      drop(d, "/Metadata", key);
    }
  }

  if (!dirty.size) return { update: null, removed };
  const changed: Record<string, Entry> = {};
  for (const key of dirty) {
    const e = objects[key]!;
    changed[key] = e.stream ? { stream: { dict: e.stream.dict } } : { value: e.value ?? null };
  }
  return { update: { qpdf: [header, changed] }, removed };
}

/**
 * Plans the edits on `run.current` and returns the file and qpdf arguments
 * that apply them (no arguments when there is nothing to change). Notes what
 * was removed.
 *
 * qpdf 12.2 silently ignores an update to an object that sits in an object
 * stream of some files (Ghostscript's output, for one), so the edit works on a
 * copy written without object streams: streams are copied as they are, and
 * the caller's write packs objects again.
 */
export async function qpdfEdits(run: CompressRun, opts: EditOptions): Promise<{ input: string; args: string[] }> {
  const input = run.current;
  if (!opts.stripMetadata && !opts.removeExtras) return { input, args: [] };
  const where = "while reading the file's structure";
  const flat = run.scratch("unpacked.pdf");
  await run.ctx.run("qpdf", ["--warning-exit-0", "--object-streams=disable", input, flat], { label: "qpdf", where });
  const dump = run.scratch("objects.json");
  await run.ctx.run("qpdf", ["--warning-exit-0", "--json-output", "--json-stream-data=none", flat, dump], {
    label: "qpdf",
    where,
  });
  if ((await stat(dump)).size > MAX_DUMP_BYTES) {
    const why = "This file has too many objects to edit its structure in reasonable memory — it was left as it is.";
    if (opts.stripMetadata) run.skip("strip-metadata", why);
    if (opts.removeExtras) run.skip("remove-extras", why);
    return { input, args: [] };
  }
  const { update, removed } = planEdits(JSON.parse(await readFile(dump, "utf8")), opts);
  const sentence = removedSentence(removed);
  if (sentence) run.note(sentence);
  if (!update) return { input, args: [] };
  const file = run.scratch("update.json");
  await writeFile(file, JSON.stringify(update));
  return { input: flat, args: [`--update-from-json=${file}`] };
}
