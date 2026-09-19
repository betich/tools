"use strict";
/*
 * Image re-encoding for a compress run (#10) and the before/after crop. MuPDF
 * 1.25 has no rewriteImages in JS, so the images go out as pixels, through
 * vips / mozjpeg / OpenJPEG in the worker, and come back in as raw streams.
 *
 *   mutool run images.js list    <in.pdf> <out.json> <ids|all> <pages|all> <maxPages> <deadlineMs> [passwordFile]
 *   mutool run images.js decode  <in.pdf> <id> <out.pnm> <raw|rgb> [passwordFile]
 *   mutool run images.js replace <in.pdf> <out.pdf> <list.json> [passwordFile]
 *   mutool run images.js raw     <in.pdf> <id> <out> [passwordFile]
 *
 * list writes one entry per image XObject that isn't someone's SMask or
 * stencil Mask: its dictionary facts, the stored bytes of it and its masks,
 * and `dpi` — the LOWEST effective resolution over its placements (its
 * largest drawing), which is what a downsample must respect. The analysis
 * (#8) reports the highest; downsampling to that would blur the big use of
 * an image that is also drawn as a thumbnail.
 *
 * decode writes the image's samples as PNM (P5 gray / P6 RGB) at full size,
 * after its Decode array; prints {width,height,components}. `rgb` converts
 * any other colour space to RGB, for showing it; `raw` refuses to.
 *
 * replace takes [{ id, file, filter, width, height, colors, predictor, gray,
 * smask?: { file, width, height } }], writes each file in as the image's
 * stored stream and fixes its dictionary; a resampled soft mask becomes a new
 * object (the old one may be shared). Saved without garbage collection, so
 * object numbers — the per-image override keys — do not move.
 *
 * raw writes the stream as stored (a JPEG, for vips to shrink on load when
 * the full size won't fit in memory).
 */

var MODE = scriptArgs[0];

function has(o) {
  return o !== null && o !== undefined && !o.isNull();
}
function get(o, key) {
  if (!has(o) || !o.isDictionary()) return null;
  var v = o.get(key);
  return has(v) ? v : null;
}
function nameOf(o) {
  return has(o) && o.isName() ? o.asName() : "";
}
function numOf(o) {
  return has(o) && o.isNumber() ? o.asNumber() : 0;
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
function writeJson(path, value) {
  var b = new Buffer();
  b.write(JSON.stringify(value));
  b.save(path);
}

function open(path, passwordFile) {
  var doc = new PDFDocument(path);
  if (doc.needsPassword()) {
    var pw = passwordFile ? read(passwordFile).replace(/\n$/, "") : "";
    if (!doc.authenticatePassword(pw)) throw new Error("password needed");
  }
  return doc;
}

function filters(o) {
  var f = get(o, "Filter");
  if (!f) return [];
  if (f.isName()) return [f.asName()];
  var out = [];
  each(f, function (x) { out.push(nameOf(x)); });
  return out;
}

/** gray | rgb | cmyk | indexed | lab | separation | devicen | none (JPX with no /ColorSpace) | other */
function colourKind(o) {
  var cs = get(o, "ColorSpace");
  if (!cs) return { kind: "none", name: "" };
  var name = cs.isName() ? cs.asName() : cs.isArray() && cs.length ? nameOf(cs.get(0)) : "";
  if (name === "DeviceGray" || name === "CalGray" || name === "G") return { kind: "gray", name: name };
  if (name === "DeviceRGB" || name === "CalRGB" || name === "RGB") return { kind: "rgb", name: name };
  if (name === "DeviceCMYK" || name === "CMYK") return { kind: "cmyk", name: name };
  if (name === "ICCBased") {
    var n = numOf(get(cs.get(1), "N"));
    return { kind: n === 1 ? "gray" : n === 3 ? "rgb" : n === 4 ? "cmyk" : "other", name: "ICCBased(" + n + ")" };
  }
  if (name === "Indexed" || name === "I") return { kind: "indexed", name: "Indexed" };
  if (name === "Lab") return { kind: "lab", name: name };
  if (name === "Separation") return { kind: "separation", name: name };
  if (name === "DeviceN") return { kind: "devicen", name: name };
  return { kind: "other", name: name || "unknown" };
}

function defaultDecode(o) {
  var d = get(o, "Decode");
  if (!d || !d.isArray()) return true;
  for (var i = 0; i < d.length; i++) if (numOf(d.get(i)) !== (i % 2 === 0 ? 0 : 1)) return false;
  return true;
}

// ── list ────────────────────────────────────────────────────────────────────

/** The stored size: /Length when it is there, else the stream read as stored (a broken file). */
function storedLength(o) {
  var n = numOf(get(o, "Length"));
  return n > 0 ? n : o.readRawStream().length;
}

function list(pdf, wantIds, wantPages, maxPages, deadline) {
  var n = pdf.countObjects();
  var masks = {};
  var candidates = [];
  var i;
  for (i = 1; i < n; i++) {
    var o = pdf.newIndirect(i, 0);
    try {
      if (!o.isStream() || nameOf(get(o, "Subtype")) !== "Image") continue;
    } catch (e) {
      continue;
    }
    candidates.push(i);
    var sm = refNum(get(o, "SMask"));
    if (sm) masks[sm] = true;
    var mk = get(o, "Mask");
    if (mk && mk.isIndirect() && mk.isStream()) masks[mk.asIndirect()] = true;
  }

  var images = {};
  candidates.forEach(function (num) {
    if (masks[num] || (wantIds && !wantIds[num])) return;
    var o = pdf.newIndirect(num, 0);
    var im = get(o, "ImageMask");
    var cs = colourKind(o);
    var smObj = get(o, "SMask");
    var sm = refNum(smObj);
    var mk = get(o, "Mask");
    var mkNum = mk && mk.isIndirect() && mk.isStream() ? mk.asIndirect() : 0;
    var smask = null;
    if (sm && smObj.isStream()) {
      smask = {
        id: sm,
        width: numOf(get(smObj, "Width")),
        height: numOf(get(smObj, "Height")),
        bpc: numOf(get(smObj, "BitsPerComponent")),
        bytes: storedLength(smObj),
        matte: !!get(smObj, "Matte"),
      };
    }
    images[num] = {
      id: num,
      width: numOf(get(o, "Width")),
      height: numOf(get(o, "Height")),
      bpc: numOf(get(o, "BitsPerComponent")),
      colour: cs.kind,
      colourName: cs.name,
      filters: filters(o),
      imageMask: !!(im && im.isBoolean() && im.asBoolean()),
      defaultDecode: defaultDecode(o),
      colourKey: !!(mk && mk.isArray()),
      smaskInData: numOf(get(o, "SMaskInData")) > 0,
      smask: smask,
      bytes: storedLength(o),
      maskBytes: mkNum ? storedLength(pdf.newIndirect(mkNum, 0)) : 0,
      dpi: null,
      page: null,
    };
  });

  var pageCount = pdf.countPages();
  var pages = [];
  if (wantPages) {
    wantPages.forEach(function (p) { if (p >= 1 && p <= pageCount) pages.push(p - 1); });
  } else {
    for (i = 0; i < Math.min(pageCount, maxPages); i++) pages.push(i);
  }
  var started = Date.now();
  for (var k = 0; k < pages.length; k++) {
    if (Date.now() - started > deadline) break;
    try {
      walkPage(pdf, pages[k], images);
    } catch (e) {
      // a broken page is skipped; its images just have no resolution from it
    }
    if (k % 25 === 24) gc();
  }

  return Object.keys(images).map(function (key) {
    var im = images[key];
    if (im.dpi !== null) im.dpi = Math.round(im.dpi * 10) / 10;
    return im;
  });
}

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

function placementDpi(img, m) {
  var ex = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
  var ey = Math.sqrt(m[2] * m[2] + m[3] * m[3]);
  if (!ex || !ey) return 0;
  return Math.min((img.getWidth() * 72) / ex, (img.getHeight() * 72) / ey);
}

// Same matching as analyse.js: the device hands out decoded images, not object
// numbers, so each placement goes to the page's candidates of the same pixel size.
function walkPage(pdf, p, images) {
  var page = pdf.loadPage(p);
  var pageObj = page.getObject();
  var found = [];
  var seen = {};
  collect(pageObj.getInheritable("Resources"), found, seen, 0);
  each(get(pageObj, "Annots"), function (a) {
    var ap = get(get(a, "AP"), "N");
    if (!ap) return;
    if (ap.isStream()) collect(get(ap, "Resources"), found, seen, 1);
    else each(ap, function (s) { if (has(s) && s.isStream()) collect(get(s, "Resources"), found, seen, 1); });
  });
  var mine = found.filter(function (num) { return !!images[num]; });
  if (!mine.length) return;
  var hits = [];
  var record = function (img, ctm) {
    hits.push({ w: img.getWidth(), h: img.getHeight(), dpi: placementDpi(img, ctm) });
  };
  page.run({ fillImage: record, fillImageMask: record, clipImageMask: record }, Matrix.identity);
  mine.forEach(function (num) {
    var image = images[num];
    if (image.page === null) image.page = p + 1;
    hits.forEach(function (h) {
      if (h.w !== image.width || h.h !== image.height || !(h.dpi > 0)) return;
      if (image.dpi === null || h.dpi < image.dpi) image.dpi = h.dpi;
    });
  });
}

function numberSet(arg) {
  if (!arg || arg === "all") return null;
  var out = {};
  arg.split(",").forEach(function (s) { if (s) out[Number(s)] = true; });
  return out;
}

// ── decode ──────────────────────────────────────────────────────────────────

function decode(pdf, id, out, mode) {
  var img = pdf.loadImage(pdf.newIndirect(id, 0));
  var pix = img.toPixmap();
  var n = pix.getNumberOfComponents();
  var cs = pix.getColorSpace();
  // `raw` is only asked of gray and RGB images (the worker checks the dictionary first).
  var plain = !pix.getAlpha() && (n === 1 || n === 3);
  var shown = plain && (n === 1 || String(cs).indexOf("RGB") >= 0);
  if (mode === "raw" ? !plain : !shown) {
    if (mode !== "rgb") throw new Error("decoded image is not plain gray or RGB");
    pix = pix.convertToColorSpace(ColorSpace.DeviceRGB);
  }
  pix.saveAsPNM(out);
  print(JSON.stringify({ width: pix.getWidth(), height: pix.getHeight(), components: pix.getNumberOfComponents() }));
}

// ── replace ─────────────────────────────────────────────────────────────────

function predictorParms(pdf, colors, columns) {
  var d = pdf.newDictionary();
  d.put("Predictor", 15);
  d.put("Colors", colors);
  d.put("BitsPerComponent", 8);
  d.put("Columns", columns);
  return d;
}

function replace(pdf, out, todo) {
  var jpx = false;
  for (var k = 0; k < todo.length; k++) {
    var t = todo[k];
    var o = pdf.newIndirect(t.id, 0);
    var hadColourSpace = !!get(o, "ColorSpace");
    o.writeRawStream(readFile(t.file));
    o.put("Filter", pdf.newName(t.filter));
    o.delete("DecodeParms");
    if (t.predictor) o.put("DecodeParms", predictorParms(pdf, t.colors, t.width));
    o.put("Width", t.width);
    o.put("Height", t.height);
    o.put("BitsPerComponent", 8);
    // The samples were decoded through Decode and any inline alpha dropped.
    o.delete("Decode");
    o.delete("SMaskInData");
    // Gray output, or a JPX source whose colour lived in its codestream: name it.
    if (t.gray) o.put("ColorSpace", pdf.newName("DeviceGray"));
    else if (!hadColourSpace) o.put("ColorSpace", pdf.newName(t.colors === 1 ? "DeviceGray" : "DeviceRGB"));
    if (t.filter === "JPXDecode") jpx = true;

    if (t.smask) {
      var old = get(o, "SMask");
      var d = pdf.newDictionary();
      d.put("Type", pdf.newName("XObject"));
      d.put("Subtype", pdf.newName("Image"));
      d.put("Width", t.smask.width);
      d.put("Height", t.smask.height);
      d.put("ColorSpace", pdf.newName("DeviceGray"));
      d.put("BitsPerComponent", 8);
      d.put("Filter", pdf.newName("FlateDecode"));
      d.put("DecodeParms", predictorParms(pdf, 1, t.smask.width));
      var matte = get(old, "Matte");
      if (matte) d.put("Matte", matte);
      o.put("SMask", pdf.addRawStream(readFile(t.smask.file), d));
    }
  }
  // JPXDecode needs PDF 1.5.
  if (jpx) {
    var v = pdf.getVersion();
    if (v.major === 1 && v.minor < 5) pdf.getTrailer().get("Root").put("Version", pdf.newName("1.5"));
  }
  pdf.save(out, "");
}

// ── main ────────────────────────────────────────────────────────────────────

if (MODE === "list") {
  var doc = open(scriptArgs[1], scriptArgs[7]);
  var pageList = scriptArgs[4] === "all" ? null : Object.keys(numberSet(scriptArgs[4])).map(Number);
  writeJson(scriptArgs[2], list(doc, numberSet(scriptArgs[3]), pageList, Number(scriptArgs[5]) || 5000, Number(scriptArgs[6]) || 60000));
} else if (MODE === "decode") {
  decode(open(scriptArgs[1], scriptArgs[5]), Number(scriptArgs[2]), scriptArgs[3], scriptArgs[4]);
} else if (MODE === "raw") {
  open(scriptArgs[1], scriptArgs[4]).newIndirect(Number(scriptArgs[2]), 0).readRawStream().save(scriptArgs[3]);
} else if (MODE === "replace") {
  replace(open(scriptArgs[1], scriptArgs[4]), scriptArgs[2], JSON.parse(read(scriptArgs[3])));
} else {
  throw new Error("usage: images.js list|decode|replace ...");
}
