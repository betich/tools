"use strict";
/*
 * PDF analysis for the compress workbench (#8), run as
 *
 *   mutool run analyse.js <in.pdf> <out.json> <progress.txt> <fileBytes>
 *                         <maxPages> <maxBytesRead> <maxObjects> <deadlineEpochMs>
 *                         [<passwordFile>]
 *
 * MuPDF 1.25 runs this under MuJS: ES5, strict mode, no let/const/arrows.
 * `print` goes to stdout and a NUL would truncate it, so the result is written
 * to <out.json> instead; progress is rewritten into <progress.txt> as
 * "<stage>\t<done>\t<total>", which the worker polls (a pipe would sit in
 * stdio's buffer until exit).
 *
 * Two passes:
 *
 * 1. The xref, object by object. Every stream's stored (still filtered) byte
 *    count goes to a category — images (incl. soft masks), fonts (FontFile*,
 *    Type3 CharProcs), content (page /Contents, Form XObjects incl. annotation
 *    appearances, tiling patterns), metadata (XMP) — and everything else
 *    (object streams, xref streams, ICC profiles, CMaps, embedded files) to
 *    other. Non-stream objects and stream dictionaries go to other at their
 *    serialised size; objects packed in an object stream are skipped, since the
 *    object stream's own bytes already hold them. A classic xref table goes to
 *    other at 20 bytes an entry. What remains of the file — whitespace,
 *    superseded revisions of an incrementally saved file — is left
 *    unattributed. The Length key is trusted when it is plausible, so this pass
 *    reads almost nothing.
 *
 * 2. The pages. Each page's resources are walked (nested Form XObjects,
 *    tiling patterns, Type3 fonts, annotation appearances) to learn which image
 *    objects it can draw, then the page is run through a device that records
 *    every image placement with its CTM. Effective DPI of a placement is
 *    pixels ÷ placed inches along each image axis, the smaller of the two (the
 *    formula MuPDF's own image rewriter uses). The device hands over images,
 *    not object numbers, so a placement is matched to the page's candidates by
 *    pixel size; candidates of the same size on one page share each other's
 *    placements. An image's DPI is the highest over its placements.
 *
 * Caps (pages, stream bytes read, objects, wall clock) stop a walk early and
 * set `truncated`; everything counted so far is still reported.
 *
 * An encrypted file is opened with the password in <passwordFile> (its first
 * line; a file, so the password never shows in a process list). Without the
 * right one it is `locked` and only the dictionaries can be read.
 */

var args = scriptArgs;
var IN = args[0], OUT = args[1], PROGRESS = args[2];
var FILE_BYTES = Number(args[3]);
var MAX_PAGES = Number(args[4]), MAX_READ = Number(args[5]), MAX_OBJECTS = Number(args[6]);
var DEADLINE = Number(args[7]);
var PASSWORD_FILE = args[8] || "";

var truncated = false;
var bytesRead = 0;
var lastProgress = 0;

function progress(stage, done, total, force) {
  var now = Date.now();
  if (!force && now - lastProgress < 200) return;
  lastProgress = now;
  var b = new Buffer();
  b.write(stage + "\t" + done + "\t" + total + "\n");
  b.save(PROGRESS);
}

function finish(result) {
  var b = new Buffer();
  b.write(JSON.stringify(result));
  b.save(OUT);
  quit(0);
}

function wasRepaired() {
  try {
    return pdf.wasRepaired();
  } catch (e) {
    return false;
  }
}

function outOfTime() {
  return Date.now() > DEADLINE;
}

function has(o) {
  return o !== null && o !== undefined && !o.isNull();
}

function nameOf(o) {
  return has(o) && o.isName() ? o.asName() : "";
}

function numOf(o) {
  return has(o) && o.isNumber() ? o.asNumber() : 0;
}

function get(o, key) {
  if (!has(o) || !o.isDictionary()) return null;
  var v = o.get(key);
  return has(v) ? v : null;
}

function refNum(o) {
  return has(o) && o.isIndirect() ? o.asIndirect() : 0;
}

function each(o, fn) {
  if (!has(o)) return;
  if (o.isArray()) {
    for (var i = 0; i < o.length; i++) fn(o.get(i), i);
  } else if (o.isDictionary()) {
    o.forEach(fn);
  }
}

// ── open ────────────────────────────────────────────────────────────────────

var pdf;
try {
  pdf = new PDFDocument(IN);
} catch (e) {
  finish({ error: "open", message: String(e.message || e) });
}

var locked = false;
if (pdf.needsPassword()) {
  var password = "";
  if (PASSWORD_FILE) {
    try {
      password = read(PASSWORD_FILE).split(/\r?\n/)[0];
    } catch (e) {}
  }
  locked = !password || !pdf.authenticatePassword(password);
}

var version = "";
try {
  var v = pdf.getVersion();
  version = v.major + "." + v.minor;
} catch (e) {}

var pageCount = 0;
try {
  pageCount = pdf.countPages();
} catch (e) {}

var trailer = pdf.getTrailer();
var root = get(trailer, "Root");

// ── pass 1: the xref ────────────────────────────────────────────────────────

var objectCount = pdf.countObjects();
var lastObject = objectCount;
if (lastObject > MAX_OBJECTS + 1) {
  lastObject = MAX_OBJECTS + 1;
  truncated = true;
}

var streams = {}; // num → { bytes, kind: tentative category or "" }
var looseBytes = {}; // num → serialised size of a non-stream object or a stream's dictionary
var packed = {}; // num → true when the object lives inside an object stream
var fontFiles = {}; // num → true for FontFile*, CharProcs
var contents = {}; // num → true for page content streams
var imageNums = [];
var fontNums = [];
var maskOf = {}; // mask image num → owner image num
var sawXrefStream = false;

function rawLength(o) {
  var n = numOf(get(o, "Length"));
  if (n >= 0 && n <= FILE_BYTES && get(o, "Length")) return n;
  try {
    var raw = o.readRawStream();
    bytesRead += raw.length;
    return raw.length;
  } catch (e) {
    return 0;
  }
}

function objectOverhead(num) {
  return String(num).length + 15; // "N 0 obj\n" … "\nendobj\n"
}

function readPacked(o) {
  var first = numOf(get(o, "First"));
  var n = numOf(get(o, "N"));
  if (first <= 0 || n <= 0 || bytesRead > MAX_READ) return;
  try {
    var data = o.readStream();
    bytesRead += data.length;
    var head = data.slice(0, first).asString().split(/\s+/);
    var k = 0;
    for (var i = 0; i < head.length && k < 2 * n; i++) {
      if (head[i] === "") continue;
      if (k % 2 === 0) packed[Number(head[i])] = true;
      k++;
    }
  } catch (e) {}
}

for (var i = 1; i < lastObject; i++) {
  if (i % 2000 === 0) {
    progress("reading objects", i, lastObject - 1);
    if (outOfTime()) {
      truncated = true;
      break;
    }
  }
  // Streams are a property of the indirect reference, so keep it: a resolved
  // stream is only its dictionary.
  var o = pdf.newIndirect(i, 0);
  var direct;
  try {
    direct = o.resolve();
  } catch (e) {
    continue;
  }
  if (!has(direct)) continue;

  var type = nameOf(get(o, "Type"));
  var subtype = nameOf(get(o, "Subtype"));

  if (o.isStream()) {
    var dictSize = 0;
    try {
      dictSize = direct.toString(true).length;
    } catch (e) {}
    looseBytes[i] = dictSize + 17 + objectOverhead(i); // + "stream\n" … "\nendstream"
    var kind = "";
    if (subtype === "Image") {
      kind = "images";
      imageNums.push(i);
      var sm = refNum(get(o, "SMask"));
      if (sm) maskOf[sm] = i;
      var mk = get(o, "Mask");
      if (mk && mk.isIndirect() && mk.isStream()) maskOf[mk.asIndirect()] = i;
    } else if (type === "Metadata" || subtype === "XML") kind = "metadata";
    else if (subtype === "Form" || numOf(get(o, "PatternType")) === 1) kind = "content";
    else if (type === "ObjStm") readPacked(o);
    else if (type === "XRef") sawXrefStream = true;
    streams[i] = { bytes: rawLength(o), kind: kind };
    continue;
  }

  try {
    looseBytes[i] = direct.toString(true).length + objectOverhead(i);
  } catch (e) {}

  if (!direct.isDictionary()) continue;
  if (type === "FontDescriptor") {
    ["FontFile", "FontFile2", "FontFile3"].forEach(function (k) {
      var f = refNum(get(o, k));
      if (f) fontFiles[f] = true;
    });
  } else if (type === "Font") {
    if (subtype !== "CIDFontType0" && subtype !== "CIDFontType2") fontNums.push(i);
    if (subtype === "Type3") {
      each(get(o, "CharProcs"), function (p) {
        var n = refNum(p);
        if (n) fontFiles[n] = true;
      });
    }
  } else if (type === "Page") {
    var c = get(o, "Contents");
    if (c && c.isIndirect() && !c.isArray()) contents[c.asIndirect()] = true;
    else
      each(c, function (part) {
        var n = refNum(part);
        if (n) contents[n] = true;
      });
  }
}

var breakdown = { images: 0, fonts: 0, content: 0, metadata: 0, other: 0 };
Object.keys(streams).forEach(function (k) {
  var s = streams[k];
  var cat = s.kind;
  if (fontFiles[k]) cat = "fonts";
  else if (contents[k]) cat = "content";
  else if (!cat) cat = "other";
  breakdown[cat] += s.bytes;
});
Object.keys(looseBytes).forEach(function (k) {
  if (!packed[k]) breakdown.other += looseBytes[k];
});
// A classic xref table is 20 bytes an entry, plus the trailer; an xref stream
// was counted above as a stream. A repaired file's table was rebuilt from a
// scan and may not exist on disk at all.
if (!sawXrefStream && !truncated && !wasRepaired()) {
  var trailerSize = 0;
  try {
    trailerSize = trailer.toString(true).length;
  } catch (e) {}
  breakdown.other += objectCount * 20 + trailerSize + 40; // "xref\n0 N\n" … "trailer" … "startxref\nN\n%%EOF"
}

// ── images and fonts, from their dictionaries ───────────────────────────────

function colorSpaceName(o, cs) {
  if (get(o, "ImageMask") && get(o, "ImageMask").isBoolean() && get(o, "ImageMask").asBoolean()) return "ImageMask";
  if (!cs) return nameOf(get(o, "Filter")) === "JPXDecode" ? "JPX" : "none";
  if (cs.isName()) return cs.asName();
  if (cs.isArray() && cs.length > 0) {
    var family = nameOf(cs.get(0));
    if (family === "ICCBased") return "ICCBased(" + numOf(get(cs.get(1), "N")) + ")";
    return family || "unknown";
  }
  return "unknown";
}

function lastFilter(o) {
  var f = get(o, "Filter");
  if (!f) return "none";
  if (f.isName()) return f.asName();
  if (f.isArray() && f.length > 0) return nameOf(f.get(f.length - 1)) || "none";
  return "none";
}

function streamBytes(num) {
  return streams[num] ? streams[num].bytes : 0;
}

var images = {}; // num → PdfImage under construction, pages as a set
imageNums.forEach(function (num) {
  if (maskOf[num]) return; // listed with the image it masks
  var o = pdf.newIndirect(num, 0);
  var sm = refNum(get(o, "SMask"));
  var mk = get(o, "Mask");
  var mkNum = mk && mk.isIndirect() && mk.isStream() ? mk.asIndirect() : 0;
  images[num] = {
    id: String(num),
    pages: {},
    width: numOf(get(o, "Width")),
    height: numOf(get(o, "Height")),
    dpi: null,
    colorSpace: colorSpaceName(o, get(o, "ColorSpace")),
    bitsPerComponent: numOf(get(o, "BitsPerComponent")) || (nameOf(get(o, "Filter")) === "JPXDecode" ? 8 : 1),
    filter: lastFilter(o),
    alpha: sm !== 0 || numOf(get(o, "SMaskInData")) > 0,
    bytes: streamBytes(num) + streamBytes(sm) + streamBytes(mkNum),
  };
});

var SUBSET = /^[A-Z]{6}\+/;
var fonts = [];
fontNums.forEach(function (num) {
  var o = pdf.newIndirect(num, 0).resolve();
  var subtype = nameOf(get(o, "Subtype"));
  var base = nameOf(get(o, "BaseFont")) || nameOf(get(o, "Name"));
  var type = subtype;
  var descriptor = get(o, "FontDescriptor");
  if (subtype === "Type0") {
    var d = get(o, "DescendantFonts");
    var desc = d && d.isArray() && d.length > 0 ? d.get(0) : null;
    if (desc) {
      type = "Type0/" + nameOf(get(desc, "Subtype"));
      descriptor = get(desc, "FontDescriptor");
    }
  }
  var bytes = 0;
  var embedded = false;
  if (subtype === "Type3") {
    embedded = true;
    each(get(o, "CharProcs"), function (p) {
      bytes += streamBytes(refNum(p));
    });
  } else {
    ["FontFile", "FontFile2", "FontFile3"].forEach(function (k) {
      var f = get(descriptor, k);
      if (!f) return;
      embedded = true;
      bytes += streamBytes(refNum(f));
    });
  }
  fonts.push({
    id: String(num),
    name: base.replace(SUBSET, "") || (subtype === "Type3" ? "Type3 font" : "unnamed"),
    type: type || "unknown",
    embedded: embedded,
    subset: SUBSET.test(base),
    bytes: bytes,
  });
});

// ── pass 2: the pages ───────────────────────────────────────────────────────

function collect(res, found, seen, depth) {
  if (!res || depth > 16) return;
  each(get(res, "XObject"), function (x) {
    var num = refNum(x);
    if (!num || seen[num]) return;
    seen[num] = true;
    var st = nameOf(get(x, "Subtype"));
    if (st === "Image") found.push(num);
    else if (st === "Form") collect(get(x, "Resources"), found, seen, depth + 1);
  });
  each(get(res, "Pattern"), function (p) {
    var num = refNum(p);
    if (num && seen[num]) return;
    if (num) seen[num] = true;
    if (numOf(get(p, "PatternType")) === 1) collect(get(p, "Resources"), found, seen, depth + 1);
  });
  each(get(res, "Font"), function (f) {
    var num = refNum(f);
    if (num && seen[num]) return;
    if (num) seen[num] = true;
    if (nameOf(get(f, "Subtype")) === "Type3") collect(get(f, "Resources"), found, seen, depth + 1);
  });
}

function appearanceForms(annot, fn) {
  var n = get(get(annot, "AP"), "N");
  if (!n) return;
  if (n.isStream()) fn(n);
  else each(n, function (state) {
    if (has(state) && state.isStream()) fn(state);
  });
}

function placementDpi(img, m) {
  var ex = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
  var ey = Math.sqrt(m[2] * m[2] + m[3] * m[3]);
  if (!ex || !ey) return 0;
  return Math.min((img.getWidth() * 72) / ex, (img.getHeight() * 72) / ey);
}

// A signature's /V often has no /Name (mutool sign, most signing tools put
// the signer only in the certificate). The widget can read the certificate's
// distinguished name, so pages with a signed field are asked for theirs.
var signatories = {}; // field object num → common name from the certificate
function noteSignatories(page, pageObj) {
  var any = false;
  each(get(pageObj, "Annots"), function (a) {
    if (nameOf(get(a, "FT")) === "Sig" || nameOf(get(get(a, "Parent"), "FT")) === "Sig") any = true;
  });
  if (!any) return;
  try {
    page.getWidgets().forEach(function (w) {
      if (w.getFieldType() !== "signature" || !w.isSigned()) return;
      var dn = String(w.getSignatory() || "");
      var cn = /(?:^|,\s*)cn=([^,]+)/i.exec(dn);
      var who = (cn ? cn[1] : "").trim();
      if (!who) return;
      var obj = w.getObject();
      signatories[refNum(obj)] = who;
      var parent = get(obj, "Parent");
      if (parent) signatories[refNum(parent)] = who;
    });
  } catch (e) {}
}

var walked = 0;
var pagesToWalk = locked ? 0 : Math.min(pageCount, MAX_PAGES);
if (pageCount > MAX_PAGES || locked) truncated = true;
var drawn = {}; // image num → true once its bytes have been counted against the read cap

for (var p = 0; p < pagesToWalk; p++) {
  progress("reading pages", p, pageCount);
  if (outOfTime() || bytesRead > MAX_READ) {
    truncated = true;
    break;
  }
  try {
    var page = pdf.loadPage(p);
    var pageObj = page.getObject();
    var found = [];
    var seen = {};
    collect(pageObj.getInheritable("Resources"), found, seen, 0);
    each(get(pageObj, "Annots"), function (a) {
      appearanceForms(a, function (form) {
        collect(get(form, "Resources"), found, seen, 1);
      });
    });
    noteSignatories(page, pageObj);
    var c = get(pageObj, "Contents");
    if (c && c.isArray()) each(c, function (part) { bytesRead += streamBytes(refNum(part)); });
    else bytesRead += streamBytes(refNum(c));

    var hits = [];
    var record = function (img, ctm) {
      hits.push({ w: img.getWidth(), h: img.getHeight(), dpi: placementDpi(img, ctm) });
    };
    page.run({ fillImage: record, fillImageMask: record, clipImageMask: record }, Matrix.identity);

    found.forEach(function (num) {
      var owner = images[num] ? num : maskOf[num];
      var image = images[owner];
      if (!image) return;
      image.pages[p + 1] = true;
      if (!drawn[owner]) {
        drawn[owner] = true;
        bytesRead += image.bytes;
      }
      hits.forEach(function (h) {
        if (h.w !== image.width || h.h !== image.height || !(h.dpi > 0)) return;
        if (image.dpi === null || h.dpi > image.dpi) image.dpi = h.dpi;
      });
    });
    walked = p + 1;
  } catch (e) {
    walked = p + 1; // a broken page is skipped, not fatal
  }
  if (p % 25 === 24) gc();
}
progress("reading pages", walked, pageCount, true);

// ── flags ───────────────────────────────────────────────────────────────────

var encrypted = has(get(trailer, "Encrypt"));

var tagged = !!get(root, "StructTreeRoot");

var pdfa = null;
try {
  var meta = get(root, "Metadata");
  if (meta && meta.isStream() && streamBytes(refNum(meta)) < 4 * 1024 * 1024) {
    var xmp = meta.readStream().asString();
    var part = /pdfaid:part(?:>|\s*=\s*["'])\s*(\d)/.exec(xmp);
    if (part) {
      var conf = /pdfaid:conformance(?:>|\s*=\s*["'])\s*([A-Za-z])/.exec(xmp);
      pdfa = "PDF/A-" + part[1] + (conf ? conf[1].toLowerCase() : "");
    }
  }
} catch (e) {}

var signed = null;
function sigFields(field, inheritedFT, depth) {
  if (!has(field) || depth > 32) return;
  var ft = nameOf(get(field, "FT")) || inheritedFT;
  var v = get(field, "V");
  if (ft === "Sig" && v && v.isDictionary()) {
    if (signed === null) signed = [];
    var who = get(v, "Name");
    var name = who && who.isString() ? who.asString().trim() : "";
    if (!name) name = signatories[refNum(field)] || "";
    if (name && signed.indexOf(name) < 0) signed.push(name);
  }
  each(get(field, "Kids"), function (kid) {
    sigFields(kid, ft, depth + 1);
  });
}
try {
  each(get(get(root, "AcroForm"), "Fields"), function (f) {
    sigFields(f, "", 0);
  });
} catch (e) {}

var repaired = wasRepaired() ? 1 : 0;

// ── out ─────────────────────────────────────────────────────────────────────

var imageList = Object.keys(images).map(function (k) {
  var image = images[k];
  image.pages = Object.keys(image.pages)
    .map(Number)
    .sort(function (a, b) {
      return a - b;
    });
  if (image.dpi !== null) image.dpi = Math.round(image.dpi * 10) / 10;
  return image;
});

finish({
  bytes: FILE_BYTES,
  pages: pageCount,
  version: version,
  breakdown: breakdown,
  images: imageList,
  fonts: fonts,
  flags: { encrypted: encrypted, signed: signed, pdfa: pdfa, tagged: tagged, repaired: repaired },
  truncated: truncated,
  walked: walked,
  locked: locked,
});
