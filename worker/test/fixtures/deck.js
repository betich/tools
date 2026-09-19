"use strict";
/*
 * Builds the born-digital fixture: mutool run deck.js <out.pdf> <photo.jpg> <alpha.png>
 *
 *   page 1  photo 1200×800 drawn at 400×266.67 pt → 216 dpi; Times + Helvetica text
 *   page 2  alpha PNG 300×300 at 144 pt → 150 dpi (SMask); Courier as an embedded Type0 font
 *   page 3  a Form XObject that draws the photo at 200×133.33 pt, placed at half
 *           scale → 100×66.67 pt → 864 dpi, so the photo's highest is 864
 *
 * Also a signature field (/V with /Name), a StructTreeRoot and XMP with
 * pdfaid part 2 / conformance B, so the flags have something to find. Saved
 * with object streams, so the byte walk has packed objects to skip.
 */
var out = scriptArgs[0];
var pdf = new PDFDocument();
var photo = pdf.addImage(new Image(scriptArgs[1]));
var alpha = pdf.addImage(new Image(scriptArgs[2]));
var times = pdf.addSimpleFont(new Font("Times-Roman"));
var helv = pdf.addSimpleFont(new Font("Helvetica"));
var mono = pdf.addFont(new Font("Courier")); // Type0, the whole font file embedded

function page(resources, text) {
  var b = new Buffer();
  b.write(text);
  pdf.insertPage(-1, pdf.addPage([0, 0, 612, 792], 0, pdf.addObject(resources), b));
}

page({ Font: { F1: times, F2: helv }, XObject: { Im1: photo } },
  "BT /F1 28 Tf 72 720 Td (Quarterly review) Tj ET BT /F2 12 Tf 72 690 Td (Born-digital deck fixture) Tj ET " +
  "q 400 0 0 266.6667 72 360 cm /Im1 Do Q");
page({ Font: { F2: helv, F3: mono }, XObject: { Im2: alpha } },
  "BT /F2 18 Tf 72 720 Td (Transparency) Tj ET BT /F3 14 Tf 72 690 Td <0024002500260027> Tj ET " +
  "q 144 0 0 144 72 500 cm /Im2 Do Q");

var formBody = new Buffer();
formBody.write("q 200 0 0 133.3333 0 0 cm /Im1 Do Q");
var form = pdf.addStream(formBody, pdf.addObject({
  Type: "XObject", Subtype: "Form", BBox: [0, 0, 200, 133.3333],
  Resources: { XObject: { Im1: photo } },
}));
page({ Font: { F1: times }, XObject: { Fm1: form } },
  "BT /F1 18 Tf 72 720 Td (Nested form) Tj ET q 0.5 0 0 0.5 72 400 cm /Fm1 Do Q");

var root = pdf.getTrailer().Root;
var sigV = pdf.addObject({ Type: "Sig", Filter: "Adobe.PPKLite", SubFilter: "adbe.pkcs7.detached" });
sigV.Name = pdf.newString("Test Signer");
var sig = pdf.addObject({ FT: "Sig", V: sigV });
sig.T = pdf.newString("Signature1");
root.AcroForm = pdf.addObject({ Fields: [sig], SigFlags: 3 });
root.StructTreeRoot = pdf.addObject({ Type: "StructTreeRoot" });
root.MarkInfo = pdf.addObject({ Marked: true });
var xmp = new Buffer();
xmp.write('<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>2</pdfaid:part>' +
  '<pdfaid:conformance>B</pdfaid:conformance></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>');
root.Metadata = pdf.addStream(xmp, pdf.addObject({ Type: "Metadata", Subtype: "XML" }));

pdf.save(out, "compress,objstms,garbage");
