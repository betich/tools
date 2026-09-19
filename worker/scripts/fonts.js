"use strict";
/*
 * Font subsetting for a compress run (#11), around `mutool clean -S` — MuPDF
 * 1.25 subsets fonts only in the CLI (JS gets subsetFonts() in 1.26):
 *
 *   mutool run fonts.js prepare <in.pdf> <hidden.pdf> <plan.json>
 *   mutool clean -S <hidden.pdf or in.pdf> <subset.pdf>
 *   mutool run fonts.js finish <subset.pdf> <out.pdf> <plan.json> <report.json>
 *
 * MuPDF learns which glyphs a font needs by running each page's content, its
 * form XObjects and the normal appearance of its (non-widget) annotations. It
 * doesn't look in tiling patterns, soft masks, Type 3 glyphs, fonts set by an
 * ExtGState, other appearance states, form fields or the AcroForm's default
 * resources — so a font program used there, too, would lose glyphs it needs.
 * Form fields are the sharpest case: a field's font must keep every glyph a
 * user might type. And only TrueType programs are subset (see subsettable):
 * MuPDF can't subset Type 1 (FontFile) but still rewrites its widths and
 * tags its name as a subset, and its CFF subsetter isn't safe.
 *
 * prepare finds those font programs and hides them from MuPDF: the
 * descriptor's FontFile* key is renamed to HiddenFontFile*, so MuPDF sees a
 * font that isn't embedded and leaves it alone. It saves <hidden.pdf> only
 * when it hid something. plan.json:
 *   { candidates, hidden: [{ desc, key }], kept: [{ name, reason }], files: { <num>: { stored, decoded } } }
 * where candidates counts the embedded font programs MuPDF can subset and may,
 * and files maps every embedded program to { stored, decoded } bytes.
 *
 * finish restores the hidden keys, copies the subset tag MuPDF put on
 * FontName to BaseFont (PDF wants both; the analysis reads BaseFont), and
 * saves compressed. report.json: { subset: n, before, after } — the font
 * programs MuPDF subset and their stored bytes before and after.
 *
 * Every save is without garbage collection, so object numbers — which the
 * analysis's font and image ids key on — do not move. ES5 under MuJS 1.3.6.
 */

var MODE = scriptArgs[0];
var SUBSET = /^[A-Z]{6}\+/;
var KEYS = ["FontFile", "FontFile2", "FontFile3"];

function get(obj, key) {
  if (!obj || !obj.isDictionary()) return null;
  var v = obj.get(key);
  return v && !v.isNull() ? v : null;
}

function nameOf(obj) {
  return obj && obj.isName() ? obj.asName() : "";
}

function numOf(obj) {
  return obj && obj.isIndirect() ? obj.asIndirect() : 0;
}

function each(dict, fn) {
  if (dict && dict.isDictionary()) dict.forEach(function (v) { fn(v); });
}

function writeJson(path, value) {
  var b = new Buffer();
  b.write(JSON.stringify(value));
  b.save(path);
}

/** Stored (still compressed) size of a stream. */
function storedBytes(stream) {
  try {
    return stream.readRawStream().length;
  } catch (e) {
    return 0;
  }
}

function decodedBytes(stream) {
  try {
    return stream.readStream().length;
  } catch (e) {
    return -1;
  }
}

/** The descriptor that carries a font's program: its own, or its descendant's for Type0. */
function descriptorOf(font) {
  if (nameOf(get(font, "Subtype")) === "Type0") {
    var d = get(font, "DescendantFonts");
    return d && d.isArray() && d.length ? get(d.get(0), "FontDescriptor") : null;
  }
  return get(font, "FontDescriptor");
}

/** { desc, key, file } for an embedded font, or null. */
function programOf(font) {
  var desc = descriptorOf(font);
  for (var i = 0; i < KEYS.length; i++) {
    var f = get(desc, KEYS[i]);
    if (f && f.isStream()) return { desc: desc, key: KEYS[i], file: f };
  }
  return null;
}

/**
 * Whether this font's program is one we let MuPDF 1.25 subset: TrueType, as a
 * simple font or a CIDFontType2. Its CFF subsetter (CIDFontType0) is left out:
 * it garbles CID-keyed CFF that another tool already subset (Ghostscript's,
 * for one), and those are nearly always subset anyway.
 */
function subsettable(font, program) {
  if (program.key !== "FontFile2") return false;
  var subtype = nameOf(get(font, "Subtype"));
  if (subtype === "TrueType") return true;
  if (subtype !== "Type0") return false;
  var d = get(font, "DescendantFonts");
  return nameOf(get(d && d.isArray() && d.length ? d.get(0) : null, "Subtype")) === "CIDFontType2";
}

function displayName(font) {
  var n = nameOf(get(font, "BaseFont")) || nameOf(get(descriptorOf(font), "FontName")) || "unnamed";
  return n.replace(SUBSET, "");
}

// prepare's walk: font dict num → font, → why MuPDF would miss some of its uses.
var fonts = {};
var unsafe = {};
var seen = {};

function markFont(font, reason) {
  var num = numOf(font);
  if (!num) return;
  fonts[num] = font;
  if (reason && !unsafe[num]) unsafe[num] = reason;
}

/** Walks a resource dictionary; `reason` is set once below a place MuPDF doesn't look. */
function walk(res, reason, depth) {
  if (!res || !res.isDictionary() || depth > 24) return;
  var key = (numOf(res) || "") + ":" + reason;
  if (numOf(res)) {
    if (seen[key]) return;
    seen[key] = true;
  }
  each(get(res, "Font"), function (f) {
    markFont(f, reason);
    if (nameOf(get(f, "Subtype")) === "Type3") walk(get(f, "Resources"), reason || "type3", depth + 1);
  });
  each(get(res, "XObject"), function (x) {
    if (nameOf(get(x, "Subtype")) === "Form") walk(get(x, "Resources"), reason, depth + 1);
  });
  each(get(res, "Pattern"), function (p) {
    walk(get(p, "Resources"), reason || "pattern", depth + 1);
  });
  each(get(res, "ExtGState"), function (gs) {
    var sm = get(gs, "SMask");
    walk(get(get(sm, "G"), "Resources"), reason || "mask", depth + 1);
    var f = get(gs, "Font");
    if (f && f.isArray() && f.length) markFont(f.get(0), "gstate");
  });
}

function walkAppearance(ap, reason, depth) {
  if (!ap) return;
  if (ap.isStream()) walk(get(ap, "Resources"), reason, depth);
  else each(ap, function (s) { if (s.isStream()) walk(get(s, "Resources"), reason, depth); });
}

if (MODE === "prepare") {
  var pdf = new PDFDocument(scriptArgs[1]);
  var HIDDEN = scriptArgs[2], PLAN = scriptArgs[3];

  var n = pdf.countPages();
  for (var i = 0; i < n; i++) {
    var page = pdf.findPage(i);
    walk(page.getInheritable("Resources"), "", 0);
    var annots = get(page, "Annots");
    if (!annots || !annots.isArray()) continue;
    for (var a = 0; a < annots.length; a++) {
      var annot = annots.get(a);
      var ap = get(annot, "AP");
      if (!ap) continue;
      var widget = nameOf(get(annot, "Subtype")) === "Widget";
      // MuPDF reads the normal appearance of annotations, and only that.
      var normal = get(ap, "N");
      if (widget) walkAppearance(normal, "form", 0);
      else if (normal && normal.isStream()) walk(get(normal, "Resources"), "", 0);
      else walkAppearance(normal, "annotation", 0);
      walkAppearance(get(ap, "D"), widget ? "form" : "annotation", 0);
      walkAppearance(get(ap, "R"), widget ? "form" : "annotation", 0);
    }
  }
  var acroForm = get(pdf.getTrailer().get("Root"), "AcroForm");
  walk(get(acroForm, "DR"), "form", 0);

  // MuPDF gets to see only the programs we let it subset: TrueType ones no font uses
  // anywhere its glyph count doesn't reach. Every other embedded program is hidden.
  var files = {}; // fontfile num → { programs, reason, names, can, subset }
  for (var num in fonts) {
    var font = fonts[num];
    var program = programOf(font);
    if (!program) continue;
    var fnum = numOf(program.file);
    if (!fnum) continue;
    var entry = files[fnum] || (files[fnum] = { programs: [], reason: "", names: {}, can: true, subset: false });
    entry.programs.push(program);
    entry.names[displayName(font)] = true;
    if (SUBSET.test(nameOf(get(font, "BaseFont"))) || SUBSET.test(nameOf(get(program.desc, "FontName")))) entry.subset = true;
    if (!subsettable(font, program)) {
      entry.can = false;
      if (!entry.reason) entry.reason = program.key === "FontFile" ? "type1" : program.key === "FontFile3" ? "cff" : "other";
    }
    if (unsafe[num]) entry.reason = unsafe[num];
  }

  var plan = { candidates: 0, hidden: [], kept: [], files: {} };
  for (var f in files) {
    var e = files[f];
    plan.files[f] = { stored: storedBytes(e.programs[0].file), decoded: decodedBytes(e.programs[0].file) };
    if (e.can && !e.reason) {
      plan.candidates++;
      continue;
    }
    for (var k = 0; k < e.programs.length; k++) {
      var p = e.programs[k];
      if (!get(p.desc, p.key)) continue; // a descriptor shared by two fonts, already hidden
      p.desc.put("Hidden" + p.key, p.desc.get(p.key));
      p.desc.delete(p.key);
      plan.hidden.push({ desc: numOf(p.desc), key: p.key });
    }
    // Worth saying only of a font embedded whole.
    if (!e.subset) for (var name in e.names) plan.kept.push({ name: name, reason: e.reason });
  }
  if (plan.hidden.length) pdf.save(HIDDEN, "");
  writeJson(PLAN, plan);
} else if (MODE === "finish") {
  var doc = new PDFDocument(scriptArgs[1]);
  var OUT = scriptArgs[2], plan2 = JSON.parse(read(scriptArgs[3])), REPORT = scriptArgs[4];

  for (var h = 0; h < plan2.hidden.length; h++) {
    var d = doc.newIndirect(plan2.hidden[h].desc, 0);
    var key = plan2.hidden[h].key;
    var v = get(d, "Hidden" + key);
    if (!v) continue;
    d.put(key, v);
    d.delete("Hidden" + key);
  }

  // A subset program decodes to fewer bytes; recompressing one doesn't change that.
  var changed = [], isChanged = {};
  for (var fnum in plan2.files) {
    var file = doc.newIndirect(Number(fnum), 0);
    if (file.isStream() && decodedBytes(file) !== plan2.files[fnum].decoded) {
      changed.push(fnum);
      isChanged[fnum] = true;
    }
  }
  var count = doc.countObjects();
  for (var o = 1; o < count && changed.length; o++) {
    var font = doc.newIndirect(o, 0);
    if (nameOf(get(font, "Type")) !== "Font") continue;
    var st = nameOf(get(font, "Subtype"));
    if (st === "CIDFontType0" || st === "CIDFontType2") continue;
    var program = programOf(font);
    if (!program || !isChanged[numOf(program.file)]) continue;
    var tag = nameOf(get(program.desc, "FontName")).match(SUBSET);
    if (!tag) continue;
    var named = [font];
    var kids = get(font, "DescendantFonts");
    if (kids && kids.isArray() && kids.length) named.push(kids.get(0));
    for (var j = 0; j < named.length; j++) {
      var base = nameOf(get(named[j], "BaseFont"));
      if (base && !SUBSET.test(base)) named[j].put("BaseFont", doc.newName(tag[0] + base));
    }
  }
  doc.save(OUT, "compress,compression-effort=100");

  var saved = new PDFDocument(OUT);
  var report = { subset: changed.length, before: 0, after: 0 };
  for (var c = 0; c < changed.length; c++) {
    report.before += plan2.files[changed[c]].stored;
    report.after += storedBytes(saved.newIndirect(Number(changed[c]), 0));
  }
  writeJson(REPORT, report);
} else {
  throw new Error("usage: fonts.js prepare|finish ...");
}
