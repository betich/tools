"use strict";
/*
 * mutool run merge-pages.js <spec.json> <out.pdf>
 *
 * Builds a small PDF of image pages for the merge (#17). Every number here —
 * page size, clip, placement matrix — was worked out in Bun by the shared
 * `pageLayout` and arrives ready to write; this script only assembles
 * objects. MuPDF 1.25 runs ES5 in strict mode: var only, no arrows.
 *
 * spec = { pages: [{ width, height, content, image }] }
 *   content: the page's content stream, drawing the image as /Im0
 *   image:   { type: "dct", path, smask? }   a JPEG embedded byte for byte
 *          | { type: "flate", path, width, height, bpc, colors, smask? }
 *            a zlib stream of PNG-filtered rows (a PNG's IDAT data)
 *   smask:   a "flate" image with colors 1 — the alpha channel
 * Prints { pages } as JSON.
 */

var spec = JSON.parse(readFile(scriptArgs[0]).asString());
var out = scriptArgs[1];
var pdf = new PDFDocument();

function flateImage(f) {
  var parms = pdf.newDictionary();
  parms.put("Predictor", 15);
  parms.put("Colors", f.colors);
  parms.put("BitsPerComponent", f.bpc);
  parms.put("Columns", f.width);
  var dict = pdf.newDictionary();
  dict.put("Type", pdf.newName("XObject"));
  dict.put("Subtype", pdf.newName("Image"));
  dict.put("Width", f.width);
  dict.put("Height", f.height);
  dict.put("BitsPerComponent", f.bpc);
  dict.put("ColorSpace", pdf.newName(f.colors === 1 ? "DeviceGray" : "DeviceRGB"));
  dict.put("Filter", pdf.newName("FlateDecode"));
  dict.put("DecodeParms", parms);
  return pdf.addRawStream(readFile(f.path), dict);
}

function image(spec) {
  // addImage keeps a JPEG's bytes as DCTDecode and handles Adobe CMYK's inverted Decode.
  var ref = spec.type === "dct" ? pdf.addImage(new Image(spec.path)) : flateImage(spec);
  if (spec.smask) ref.put("SMask", flateImage(spec.smask));
  return ref;
}

for (var i = 0; i < spec.pages.length; i++) {
  var p = spec.pages[i];
  var resources = pdf.addObject(pdf.newDictionary());
  var xobjects = pdf.newDictionary();
  xobjects.put("Im0", image(p.image));
  resources.put("XObject", xobjects);
  var content = new Buffer();
  content.write(p.content);
  pdf.insertPage(-1, pdf.addPage([0, 0, p.width, p.height], 0, resources, content));
}

pdf.save(out, "compress");
print(JSON.stringify({ pages: pdf.countPages() }));
