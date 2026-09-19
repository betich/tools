"use strict";
/*
 * Lossless JPEG recompression for a compress run (#9): the JPEG streams go out
 * to files, `jpegtran` re-packs each one (same DCT coefficients, optimised
 * Huffman tables, progressive), and the smaller ones come back in.
 *
 *   mutool run jpegs.js extract <in.pdf> <dir> <list.json> <minBytes>
 *   mutool run jpegs.js replace <in.pdf> <out.pdf> <list.json>
 *
 * extract writes <dir>/<obj>.jpg and list.json = [{ id, bytes }] for image
 * XObjects whose only filter is DCTDecode and whose colour is 1 or 3
 * components (gray or RGB, device or ICC/Cal-based) — CMYK and the Adobe
 * inverted-CMYK convention are left alone.
 *
 * replace takes list.json = [{ id, file }], writes each file in as the stored
 * stream (the dictionary stays as it is: same filter, size and colour space),
 * and saves without garbage collection, so object numbers — which the
 * analysis and per-image overrides (#10) key on — do not move.
 */

var MODE = scriptArgs[0];

function get(obj, key) {
  if (!obj || !obj.isDictionary()) return null;
  var v = obj.get(key);
  return v && !v.isNull() ? v : null;
}

function nameOf(obj) {
  return obj && obj.isName() ? obj.asName() : "";
}

function onlyDct(filter) {
  if (!filter) return false;
  if (filter.isName()) return filter.asName() === "DCTDecode";
  return filter.isArray() && filter.length === 1 && nameOf(filter.get(0)) === "DCTDecode";
}

function components(cs) {
  if (!cs) return 0;
  var name = cs.isName() ? cs.asName() : cs.isArray() && cs.length ? nameOf(cs.get(0)) : "";
  if (name === "DeviceGray" || name === "CalGray" || name === "G") return 1;
  if (name === "DeviceRGB" || name === "CalRGB" || name === "RGB") return 3;
  if (name === "ICCBased" && cs.isArray() && cs.length > 1) {
    var n = get(cs.get(1), "N");
    return n && n.isNumber() ? n.asNumber() : 0;
  }
  return 0;
}

function writeJson(path, value) {
  var b = new Buffer();
  b.write(JSON.stringify(value));
  b.save(path);
}

if (MODE === "extract") {
  var pdf = new PDFDocument(scriptArgs[1]);
  var dir = scriptArgs[2], minBytes = Number(scriptArgs[4]) || 0;
  var list = [];
  var n = pdf.countObjects();
  for (var i = 1; i < n; i++) {
    var o = pdf.newIndirect(i, 0);
    if (!o.isStream() || nameOf(get(o, "Subtype")) !== "Image") continue;
    if (!onlyDct(get(o, "Filter"))) continue;
    var imageMask = get(o, "ImageMask");
    if (imageMask && imageMask.isBoolean() && imageMask.asBoolean()) continue;
    var c = components(get(o, "ColorSpace"));
    if (c !== 1 && c !== 3) continue;
    var raw = o.readRawStream();
    if (raw.length < minBytes) continue;
    raw.save(dir + "/" + i + ".jpg");
    list.push({ id: i, bytes: raw.length });
  }
  writeJson(scriptArgs[3], list);
} else if (MODE === "replace") {
  var doc = new PDFDocument(scriptArgs[1]);
  var todo = JSON.parse(read(scriptArgs[3]));
  for (var k = 0; k < todo.length; k++) {
    doc.newIndirect(todo[k].id, 0).writeRawStream(readFile(todo[k].file));
  }
  doc.save(scriptArgs[2], "");
} else {
  throw new Error("usage: jpegs.js extract|replace ...");
}
