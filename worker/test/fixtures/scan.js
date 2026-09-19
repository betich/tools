"use strict";
/*
 * Builds the scan fixture: mutool run scan.js <out.pdf> <page.jpg> <pages>
 * Each page is the same A4 greyscale JPEG at 300 dpi (2480×3508 fills 595.28×841.89 pt),
 * as a scanner would write it: one image per page, nothing else.
 */
var pdf = new PDFDocument();
var img = pdf.addImage(new Image(scriptArgs[1]));
for (var i = 0; i < Number(scriptArgs[2]); i++) {
  var b = new Buffer();
  b.write("q 595.28 0 0 841.89 0 0 cm /Im0 Do Q");
  pdf.insertPage(-1, pdf.addPage([0, 0, 595.28, 841.89], 0, pdf.addObject({ XObject: { Im0: img } }), b));
}
pdf.save(scriptArgs[0], "compress");
