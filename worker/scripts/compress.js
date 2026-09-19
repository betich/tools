"use strict";
/*
 * The MuPDF structure pass of a compress run (#9), run as
 *
 *   mutool run compress.js <in.pdf> <out.pdf> <ops.json> <report.json>
 *
 * ops.json: { garbage: "none"|"compact"|"dedupe", deepMax, shallowMax, objstms,
 *             stripMetadata, keepXmp, removeExtras }
 *
 * Edits the document the options ask for, then saves it, which is where the
 * lossless work happens (see worker/src/compress/mupdf.ts for the options).
 * MuPDF's deduplication compares every pair of objects, so "dedupe" is
 * garbage=4 (streams compared too) up to `deepMax` objects, garbage=3 up to
 * `shallowMax`, and only compaction past that — the report says which ran.
 * ES5 under MuJS 1.3.6: no let/const/arrows, strict mode.
 *
 * stripMetadata: the document info dictionary except its Title (the viewer's
 *   window title, rarely private), the catalog's XMP unless keepXmp, and XMP
 *   attached to any other object (pages, images, fonts, forms).
 * removeExtras: attachments (EmbeddedFiles, AF), document and page scripts and
 *   additional actions, bookmarks, every annotation but links (form widgets
 *   included, with the AcroForm), page thumbnails and application private data
 *   (PieceInfo — Illustrator keeps a whole copy of the artwork there).
 *
 * report.json: { objects, garbage: "none"|"compact"|"deduplicate"|"4",
 *                removed: { attachments, scripts, bookmarks, annotations, fields, thumbnails, privateData } }
 */

var IN = scriptArgs[0], OUT = scriptArgs[1], OPS = JSON.parse(read(scriptArgs[2])), REPORT = scriptArgs[3];
var pdf = new PDFDocument(IN);
var trailer = pdf.getTrailer();
var root = trailer.get("Root");
var removed = {};

function count(key, n) {
  removed[key] = (removed[key] || 0) + (n === undefined ? 1 : n);
}

function get(obj, key) {
  if (!obj || !obj.isDictionary()) return null;
  var v = obj.get(key);
  return v && !v.isNull() ? v : null;
}

function nameOf(obj) {
  return obj && obj.isName() ? obj.asName() : "";
}

/** Entries in a name tree (EmbeddedFiles, JavaScript): pairs in /Names, recursing through /Kids. */
function countNameTree(node, depth) {
  if (!node || depth > 32) return 0;
  var n = 0;
  var names = get(node, "Names");
  if (names && names.isArray()) n += Math.floor(names.length / 2);
  var kids = get(node, "Kids");
  if (kids && kids.isArray()) for (var i = 0; i < kids.length; i++) n += countNameTree(kids.get(i), depth + 1);
  return n;
}

function isScriptAction(action) {
  var s = nameOf(get(action, "S"));
  return s === "JavaScript" || s === "Launch";
}

function stripMetadata() {
  // Emptied in place: a new Info put on the trailer is not what 1.25 writes out.
  var info = get(trailer, "Info");
  if (info) {
    var keys = [];
    info.forEach(function (value, key) {
      if (key !== "Title") keys.push(key);
    });
    keys.forEach(function (key) {
      info.delete(key);
    });
  }
  if (!OPS.keepXmp) root.delete("Metadata");
  // XMP hung on anything else: pages, images, fonts, form XObjects.
  var n = pdf.countObjects();
  for (var i = 1; i < n; i++) {
    var o = pdf.newIndirect(i, 0);
    if (!o.isDictionary() || nameOf(get(o, "Type")) === "Catalog") continue;
    var m = get(o, "Metadata");
    if (m && m.isStream()) o.delete("Metadata");
  }
}

function removeExtras() {
  var names = get(root, "Names");
  var files = get(names, "EmbeddedFiles");
  if (files) {
    count("attachments", countNameTree(files, 0));
    names.delete("EmbeddedFiles");
  }
  var scripts = get(names, "JavaScript");
  if (scripts) {
    count("scripts", countNameTree(scripts, 0));
    names.delete("JavaScript");
  }
  if (names) {
    var left = 0;
    names.forEach(function () {
      left++;
    });
    if (!left) root.delete("Names");
  }
  if (get(root, "AF")) root.delete("AF");
  var open = get(root, "OpenAction");
  if (open && open.isDictionary() && isScriptAction(open)) {
    count("scripts");
    root.delete("OpenAction");
  }
  if (get(root, "AA")) {
    count("scripts");
    root.delete("AA");
  }
  if (get(root, "Outlines")) {
    count("bookmarks");
    root.delete("Outlines");
    if (nameOf(get(root, "PageMode")) === "UseOutlines") root.put("PageMode", pdf.newName("UseNone"));
  }
  var form = get(root, "AcroForm");
  if (form) {
    var fields = get(form, "Fields");
    count("fields", fields && fields.isArray() ? fields.length : 0);
    root.delete("AcroForm");
  }
  if (get(root, "PieceInfo")) {
    count("privateData");
    root.delete("PieceInfo");
  }

  var pages = pdf.countPages();
  for (var p = 0; p < pages; p++) {
    var page = pdf.findPage(p);
    if (get(page, "AA")) {
      count("scripts");
      page.delete("AA");
    }
    if (get(page, "Thumb")) {
      count("thumbnails");
      page.delete("Thumb");
    }
    if (get(page, "PieceInfo")) {
      count("privateData");
      page.delete("PieceInfo");
    }
    var annots = get(page, "Annots");
    if (!annots || !annots.isArray()) continue;
    var keep = pdf.newArray();
    for (var a = 0; a < annots.length; a++) {
      var annot = annots.get(a);
      if (nameOf(get(annot, "Subtype")) !== "Link") {
        count("annotations");
        continue;
      }
      var action = get(annot, "A");
      if (action && isScriptAction(action)) {
        count("scripts");
        annot.delete("A");
      }
      keep.push(annot);
    }
    if (keep.length) page.put("Annots", keep);
    else page.delete("Annots");
  }
}

if (OPS.removeExtras) removeExtras();
if (OPS.stripMetadata) stripMetadata();
var objects = pdf.countObjects();
var garbage = OPS.garbage === "dedupe"
  ? objects <= OPS.deepMax ? "4" : objects <= OPS.shallowMax ? "deduplicate" : "compact"
  : OPS.garbage;
var save = ["compress", "compression-effort=100", "regenerate-id=no"];
if (garbage !== "none") save.push("garbage=" + garbage);
if (OPS.objstms) save.push("objstms");
pdf.save(OUT, save.join(","));

var b = new Buffer();
b.write(JSON.stringify({ objects: objects, garbage: garbage, removed: removed }));
b.save(REPORT);
