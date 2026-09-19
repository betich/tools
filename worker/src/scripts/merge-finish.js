"use strict";
/*
 * mutool run merge-finish.js <spec.json> <joined.pdf>
 *
 * Gives the joined PDF (#17) what qpdf's page assembly leaves out: a bookmark
 * per file with each source PDF's own outline nested under it, page labels
 * and the title. Saved incrementally into the same file, so no stream is
 * copied here — the final qpdf pass rewrites the whole file anyway.
 * MuPDF 1.25 runs ES5 in strict mode: var only, no arrows.
 *
 * spec = { title, bookmarks, pageLabels, pages,
 *          files: [{ title, label, start, count, source, from, whole, first }] }
 *   Each entry is one contiguous run of pages from one file — the whole file
 *   when merging by file, or one piece of it when merging by page (#39).
 *   start:  the run's first page in the joined PDF, 0-based
 *   count:  pages in the run
 *   label:  page-label prefix for the file (its short name)
 *   source: the original PDF's path, to read its outline and labels; null for images
 *   from:   the run's first page in the source, 0-based
 *   whole:  the run is the whole file
 *   first:  the file's first run in the output; outline items that point at
 *           no page of the file (web links, broken targets) go under it only
 * A source bookmark goes under the run holding its page, once, and is left
 * out when its page is not in the output; its children that are move up
 * into its place.
 * Prints { pages, bookmarks } as JSON.
 */

var spec = JSON.parse(readFile(scriptArgs[0]).asString());
var path = scriptArgs[1];
var doc = new PDFDocument(path);
var root = doc.getTrailer().get("Root");

if (doc.countPages() !== spec.pages) throw new Error("joined PDF has " + doc.countPages() + " pages, expected " + spec.pages);

var sources = {};
/** The source PDF, or null for an image — or for a PDF MuPDF cannot open, whose pages qpdf joined anyway. */
function source(file) {
  if (!file.source) return null;
  if (!(file.source in sources)) {
    try {
      sources[file.source] = new PDFDocument(file.source);
    } catch (e) {
      sources[file.source] = null;
    }
  }
  return sources[file.source];
}

/** A source's outline or labels are extras: a broken one is skipped, not a failed merge. */
function tolerant(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    return fallback;
  }
}

/* ── bookmarks ──────────────────────────────────────────────────────────── */

var bookmarks = 0;
var MAX_BOOKMARKS = 20000;

/**
 * A source's outline with every internal link resolved to its source page:
 * [{ title, uri, page, down }], `page` -1 for an item that points at no page
 * (a web link, no link, or a target MuPDF can't resolve — whose link is
 * dropped). Read once per source, however many runs it is split into.
 */
var outlines = {};
function resolvedOutline(src, path) {
  if (path in outlines) return outlines[path];
  function walk(items) {
    var out = [];
    for (var k = 0; k < items.length; k++) {
      var o = items[k];
      var uri = o.uri;
      var p = -1;
      if (uri && uri.charAt(0) === "#") {
        try {
          p = src.resolveLink(uri);
        } catch (e) {
          p = -1;
        }
        uri = undefined;
      }
      out.push({ title: o.title || "", uri: uri, page: p, down: o.down && o.down.length ? walk(o.down) : [] });
    }
    return out;
  }
  var items = tolerant(function () { return src.loadOutline(); }, null);
  outlines[path] = items && items.length ? walk(items) : [];
  return outlines[path];
}

/**
 * The part of a resolved outline that belongs under this run, links pointed
 * at the run's pages in the joined PDF. An item whose page is outside the
 * run is left out and its children that remain take its place; one with no
 * page stays under the file's first run only.
 */
function forRun(items, file) {
  var out = [];
  for (var k = 0; k < items.length; k++) {
    var o = items[k];
    var here = o.page >= file.from && o.page < file.from + file.count;
    var down = forRun(o.down, file);
    if (here) out.push({ title: o.title, uri: "#page=" + (file.start + o.page - file.from + 1), down: down });
    else if (o.page < 0 && file.first) out.push({ title: o.title, uri: o.uri, down: down });
    else out.push.apply(out, down);
  }
  return out;
}

/** Inserts an outline under the iterator's position. */
function insertOutline(it, items) {
  for (var k = 0; k < items.length && bookmarks < MAX_BOOKMARKS; k++) {
    var o = items[k];
    it.insert({ title: o.title, uri: o.uri, open: false });
    bookmarks++;
    if (o.down.length) {
      it.prev();
      it.down();
      insertOutline(it, o.down);
      it.up();
      it.next();
    }
  }
}

// qpdf's assembly drops every outline, so the tree is built from nothing.
if (root.get("Outlines")) root.delete("Outlines");
if (spec.bookmarks) {
  var it = doc.outlineIterator();
  for (var f = 0; f < spec.files.length; f++) {
    var file = spec.files[f];
    it.insert({ title: file.title, uri: "#page=" + (file.start + 1), open: false });
    bookmarks++;
    var src = source(file);
    var items = src ? forRun(resolvedOutline(src, file.source), file) : [];
    if (items.length) {
      it.prev();
      it.down();
      insertOutline(it, items);
      it.up();
      it.next();
    }
  }
  root.put("PageMode", doc.newName("UseOutlines"));
}

/* ── page labels ────────────────────────────────────────────────────────── */

var STYLES = { D: "D", R: "R", r: "r", A: "A", a: "a" };

/** A source's label ranges, from its /PageLabels number tree: [{ index, style, prefix, start }]. */
function sourceLabels(src) {
  var tree = src.getTrailer().get("Root").get("PageLabels");
  var ranges = [];
  var depth = 0;
  function walk(node) {
    if (!node || !node.isDictionary() || ++depth > 32) return;
    var nums = node.get("Nums");
    if (nums && nums.isArray()) {
      for (var i = 0; i + 1 < nums.length; i += 2) {
        var d = nums.get(i + 1);
        var s = d.get("S");
        var p = d.get("P");
        var st = d.get("St");
        ranges.push({
          index: nums.get(i).asNumber(),
          style: s && s.isName() ? STYLES[s.asName()] || "" : "",
          prefix: p && p.isString() ? p.asString() : "",
          start: st && st.isNumber() ? st.asNumber() : 1,
        });
      }
    }
    var kids = node.get("Kids");
    if (kids && kids.isArray()) for (var k = 0; k < kids.length; k++) walk(kids.get(k));
    depth--;
  }
  walk(tree);
  ranges.sort(function (a, b) { return a.index - b.index; });
  return ranges;
}

// qpdf carries each source's own labels over piecemeal; they are rebuilt whole, or dropped when labels are off.
if (root.get("PageLabels")) root.delete("PageLabels");
if (spec.pageLabels) {
  for (var g = 0; g < spec.files.length; g++) {
    var fl = spec.files[g];
    var fsrc = source(fl);
    var all = fsrc ? tolerant(function () { return sourceLabels(fsrc); }, []) : [];
    // The run's pages keep the labels they have in the source: the range that
    // covers the run's first page starts the run, counted on to that page.
    var ranges = [];
    for (var q = 0; q < all.length; q++) {
      var sr = all[q];
      var next = all[q + 1];
      if (sr.index < 0 || sr.index >= fl.from + fl.count) continue;
      if (sr.index > fl.from) ranges.push({ index: sr.index - fl.from, style: sr.style, prefix: sr.prefix, start: sr.start });
      else if (!next || next.index > fl.from) ranges.push({ index: 0, style: sr.style, prefix: sr.prefix, start: sr.start + fl.from - sr.index });
    }
    // Every file's labels start with its name; a PDF that numbers its own pages keeps its numbering after it.
    if (!ranges.length || ranges[0].index !== 0) {
      if (fl.count === 1 && fl.whole) doc.setPageLabels(fl.start, "", fl.label, 1);
      else doc.setPageLabels(fl.start, "D", fl.label + " ", fl.from + 1);
    }
    for (var r = 0; r < ranges.length; r++) {
      var rg = ranges[r];
      doc.setPageLabels(fl.start + rg.index, rg.style, fl.label + " " + rg.prefix, rg.start);
    }
  }
}

/* ── title ──────────────────────────────────────────────────────────────── */

doc.setMetaData("info:Title", spec.title);
var prefs = root.get("ViewerPreferences");
if (!prefs || !prefs.isDictionary()) {
  prefs = doc.addObject(doc.newDictionary());
  root.put("ViewerPreferences", prefs);
}
// Viewers show the title, not the file name, in their title bar.
prefs.put("DisplayDocTitle", true);

doc.save(path, "incremental");
print(JSON.stringify({ pages: doc.countPages(), bookmarks: bookmarks }));
