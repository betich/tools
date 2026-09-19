"use strict";
/*
 * Builds the everything-to-remove fixture: mutool run bloated.js <out.pdf> <photo.jpg>
 *
 * Saved with no compression and no object streams, and carrying what each
 * compress pass acts on: the same JPEG embedded twice (dedupe), an object
 * nothing refers to (garbage collection), raw content streams (recompression),
 * document info + XMP on the catalog and on a page (strip metadata), an
 * attachment, document JavaScript and a JavaScript open action, a bookmark, a
 * page thumbnail and PieceInfo (remove extras), and on page 1 a link, a square
 * annotation and a filled-in text field, both with appearance streams (flatten).
 */
var out = scriptArgs[0];
var pdf = new PDFDocument();
var s = function (text) { return pdf.newString(text); };
var photoA = pdf.addImage(new Image(scriptArgs[1]));
var photoB = pdf.addImage(new Image(scriptArgs[1]));
var helv = pdf.addSimpleFont(new Font("Helvetica"));
pdf.addObject({ Unused: true, Note: s("nothing points here") });

function stream(text, dict) {
  var b = new Buffer();
  b.write(text);
  return pdf.addStream(b, pdf.addObject(dict));
}

function page(resources, text) {
  var b = new Buffer();
  b.write(text);
  pdf.insertPage(-1, pdf.addPage([0, 0, 612, 792], 0, pdf.addObject(resources), b));
}

page({ Font: { F1: helv }, XObject: { Im1: photoA } },
  "BT /F1 24 Tf 72 720 Td (Bloated fixture) Tj ET q 300 0 0 200 72 400 cm /Im1 Do Q");
page({ Font: { F1: helv }, XObject: { Im1: photoB } },
  "BT /F1 24 Tf 72 720 Td (Same photo, second copy) Tj ET q 300 0 0 200 72 400 cm /Im1 Do Q");

var root = pdf.getTrailer().Root;
var first = pdf.findPage(0);

var square = pdf.addObject({ Type: "Annot", Subtype: "Square", Rect: [300, 100, 400, 150], F: 4,
  AP: { N: stream("0.9 0.2 0.2 rg 0 0 100 50 re f", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 100, 50] }) } });
var field = pdf.addObject({ Type: "Annot", Subtype: "Widget", FT: "Tx", Rect: [72, 200, 272, 230], F: 4,
  AP: { N: stream("/Tx BMC q BT 0 g /F1 14 Tf 4 9 Td (Filled in) Tj ET Q EMC",
    { Type: "XObject", Subtype: "Form", BBox: [0, 0, 200, 30], Resources: { Font: { F1: helv } } }) } });
field.T = s("name");
field.V = s("Filled in");
field.DA = s("/Helv 14 Tf 0 g");
var link = pdf.addObject({ Type: "Annot", Subtype: "Link", Rect: [72, 700, 300, 740], Border: [0, 0, 0],
  A: { S: "URI" } });
link.A.URI = s("https://tools.betich.me/");
first.Annots = [link, square, field];
root.AcroForm = pdf.addObject({ Fields: [field], DR: { Font: { Helv: helv } } });
root.AcroForm.DA = s("/Helv 0 Tf 0 g");

var info = pdf.addObject({});
info.Title = s("Bloated fixture");
info.Author = s("Someone Private");
info.Producer = s("bloated.js");
pdf.getTrailer().Info = info;
var xmp = '<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Someone Private</dc:creator>' +
  '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
root.Metadata = stream(xmp, { Type: "Metadata", Subtype: "XML" });
first.Metadata = stream(xmp, { Type: "Metadata", Subtype: "XML" });

var file = stream("attached text, attached text, attached text", { Type: "EmbeddedFile" });
var spec = pdf.addObject({ Type: "Filespec", EF: { F: file } });
spec.F = s("notes.txt");
var js = pdf.addObject({ S: "JavaScript" });
js.JS = s("app.alert('hello');");
root.Names = pdf.addObject({ EmbeddedFiles: { Names: [s("notes.txt"), spec] }, JavaScript: { Names: [s("init"), js] } });
root.OpenAction = pdf.addObject({ S: "JavaScript" });
root.OpenAction.JS = s("app.alert('opened');");

var outlines = pdf.addObject({ Type: "Outlines", Count: 1 });
var item = pdf.addObject({ Parent: outlines, Dest: [first, "Fit"] });
item.Title = s("Start");
outlines.First = item;
outlines.Last = item;
root.Outlines = outlines;
root.PageMode = "UseOutlines";

first.Thumb = pdf.addImage(new Image(scriptArgs[1]));
first.PieceInfo = pdf.addObject({ Illustrator: { Private: stream("private application data", {}) } });

pdf.save(out, "");
