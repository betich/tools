"use strict";
/*
 * Builds a numbered fixture for merge by page (#39):
 *
 *   mutool run outlined.js <out.pdf> <tag> <pages> [outline.json] [labels.json]
 *
 * Each page draws "<tag> <n>" large, so every page of every file renders
 * differently. outline.json is [{ title, page, down? }] with 1-based pages;
 * labels.json is [[index, style, prefix, start]] with 0-based indices.
 * merge.test.ts writes these itself; they are not part of make.sh.
 */
var out = scriptArgs[0];
var tag = scriptArgs[1];
var count = Number(scriptArgs[2]);
var outline = scriptArgs[3] ? JSON.parse(scriptArgs[3]) : [];
var labels = scriptArgs[4] ? JSON.parse(scriptArgs[4]) : [];

var pdf = new PDFDocument();
var helv = pdf.addSimpleFont(new Font("Helvetica"));
for (var i = 1; i <= count; i++) {
  var b = new Buffer();
  // Offset by the page number too, so "A 1" and "B 1" differ in more than a glyph.
  b.write("BT /F1 96 Tf " + (60 + i * 7) + " " + (600 - i * 11) + " Td (" + tag + " " + i + ") Tj ET");
  pdf.insertPage(-1, pdf.addPage([0, 0, 612, 792], 0, pdf.addObject({ Font: { F1: helv } }), b));
}

function add(it, items) {
  for (var k = 0; k < items.length; k++) {
    var o = items[k];
    it.insert({ title: o.title, uri: o.page ? "#page=" + o.page : o.uri, open: false });
    if (o.down && o.down.length) {
      it.prev();
      it.down();
      add(it, o.down);
      it.up();
      it.next();
    }
  }
}
add(pdf.outlineIterator(), outline);
for (var l = 0; l < labels.length; l++) pdf.setPageLabels(labels[l][0], labels[l][1], labels[l][2], labels[l][3]);

pdf.save(out, "compress");
