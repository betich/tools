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
 *          files: [{ title, label, start, count, source }] }
 *   start:  the file's first page in the joined PDF, 0-based
 *   label:  page-label prefix for the file (its short name)
 *   source: the original PDF's path, to read its outline and labels; null for images
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

/** Copies a source outline under the iterator's position, pointing links at the file's pages in the joined PDF. */
function copyOutline(it, src, items, base, count) {
  for (var k = 0; k < items.length && bookmarks < MAX_BOOKMARKS; k++) {
    var o = items[k];
    var uri = o.uri;
    if (uri && uri.charAt(0) === "#") {
      var p = -1;
      try {
        p = src.resolveLink(uri);
      } catch (e) {
        p = -1;
      }
      uri = p >= 0 && p < count ? "#page=" + (base + p + 1) : undefined;
    }
    it.insert({ title: o.title || "", uri: uri, open: false });
    bookmarks++;
    if (o.down && o.down.length) {
      it.prev();
      it.down();
      copyOutline(it, src, o.down, base, count);
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
    var items = src ? tolerant(function () { return src.loadOutline(); }, null) : null;
    if (items && items.length) {
      it.prev();
      it.down();
      copyOutline(it, src, items, file.start, file.count);
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
    var ranges = fsrc ? tolerant(function () { return sourceLabels(fsrc); }, []) : [];
    ranges = ranges.filter(function (r) { return r.index >= 0 && r.index < fl.count; });
    // Every file's labels start with its name; a PDF that numbers its own pages keeps its numbering after it.
    if (!ranges.length || ranges[0].index !== 0) {
      if (fl.count === 1) doc.setPageLabels(fl.start, "", fl.label, 1);
      else doc.setPageLabels(fl.start, "D", fl.label + " ", 1);
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
