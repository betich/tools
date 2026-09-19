"use strict";
/*
 * Builds the #15 fixtures that need MuPDF's object API:
 *
 *   mutool run special.js tagged <out.pdf>    a tagged page: marked content, a StructTreeRoot
 *                                             with one /P element and its ParentTree
 *   mutool run special.js sigfield <out.pdf>  three text pages and an empty signature field
 *                                             on page 1, for `mutool sign` to sign
 */
var kind = scriptArgs[0], out = scriptArgs[1];
var pdf = new PDFDocument();
var helv = pdf.addSimpleFont(new Font("Helvetica"));

function page(text) {
  var b = new Buffer();
  b.write(text);
  var obj = pdf.addPage([0, 0, 612, 792], 0, pdf.addObject({ Font: { F1: helv } }), b);
  pdf.insertPage(-1, obj);
  return obj;
}

if (kind === "tagged") {
  var p = page("/P <</MCID 0>> BDC BT /F1 18 Tf 72 720 Td (A tagged paragraph) Tj ET EMC");
  p = pdf.getTrailer().Root.Pages.Kids[0];
  p.StructParents = 0;
  var root = pdf.getTrailer().Root;
  var tree = pdf.addObject({ Type: "StructTreeRoot" });
  var doc = pdf.addObject({ Type: "StructElem", S: "Document", P: tree });
  var para = pdf.addObject({ Type: "StructElem", S: "P", P: doc, Pg: p, K: 0 });
  doc.K = [para];
  tree.K = doc;
  tree.ParentTree = pdf.addObject({ Nums: [0, [para]] });
  tree.ParentTreeNextKey = 1;
  root.StructTreeRoot = tree;
  root.MarkInfo = pdf.addObject({ Marked: true });
  root.Lang = pdf.newString("en");
} else if (kind === "sigfield") {
  for (var i = 1; i <= 3; i++) page("BT /F1 18 Tf 72 720 Td (Contract page " + i + ") Tj ET");
  pdf.loadPage(0).createSignature("Signature1");
} else {
  throw new Error("unknown fixture " + kind);
}
pdf.save(out, "compress");
