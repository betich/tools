"use strict";
/*
 * mutool run photos.js <out.pdf> <photo.jpg> <flat.png> <alpha.png> <gray.jpg> <cmyk.jpg> — see photos.sh.
 */
var a = scriptArgs;
var pdf = new PDFDocument();
var photo = pdf.addImage(new Image(a[1]));
var flat = pdf.addImage(new Image(a[2]));
var alpha = pdf.addImage(new Image(a[3]));
var gray = pdf.addImage(new Image(a[4]));
var cmyk = pdf.addImage(new Image(a[5]));

function page(xobjects, content) {
  var b = new Buffer();
  b.write(content);
  pdf.insertPage(-1, pdf.addPage([0, 0, 612, 792], 0, pdf.addObject({ XObject: xobjects }), b));
}

page({ Im1: photo }, "q 432 0 0 288 90 400 cm /Im1 Do Q");
page({ Im1: flat }, "q 432 0 0 288 90 400 cm /Im1 Do Q");
page({ Im1: alpha }, "0 0 1 rg 60 380 480 320 re f q 288 0 0 288 90 400 cm /Im1 Do Q");
page({ Im1: gray, Im2: photo, Im3: cmyk }, "q 432 0 0 324 90 400 cm /Im1 Do Q q 72 0 0 48 90 300 cm /Im2 Do Q q 216 0 0 144 300 200 cm /Im3 Do Q");
pdf.save(a[0], "compress");
