"use strict";
/*
 * Special inputs for a compress run (#15), under `mutool run`:
 *
 *   special.js xmp     <in.pdf> <passwordFile|-> <out.xml>
 *       writes the catalog's XMP packet (empty when there is none)
 *
 *   special.js prepare <in.pdf> <out.pdf> <passwordFile|-> <xmpFile|->
 *       opens with the password, replaces the catalog's XMP with <xmpFile>
 *       when given, and saves unencrypted — without garbage collection, so
 *       object numbers (PdfImage.id, PdfFont.id) stay those of the input
 *
 * Exits 3 when the password does not open the file. Passwords come from a
 * file so they never show in a process list. ES5 (MuJS).
 */

var args = scriptArgs;
var mode = args[0];

function password(file) {
  if (!file || file === "-") return "";
  return read(file).split(/\r?\n/)[0];
}

function open(file, pwFile) {
  var pdf = new PDFDocument(file);
  if (pdf.needsPassword() && !pdf.authenticatePassword(password(pwFile))) quit(3);
  return pdf;
}

function catalogXmp(pdf) {
  var m = pdf.getTrailer().get("Root").get("Metadata");
  return m && m.isStream() ? m.readStream().asString() : "";
}

if (mode === "xmp") {
  var doc = open(args[1], args[2]);
  var b = new Buffer();
  b.write(catalogXmp(doc));
  b.save(args[3]);
} else if (mode === "prepare") {
  var pdf = open(args[1], args[3]);
  var xmpFile = args[4];
  if (xmpFile && xmpFile !== "-") {
    var root = pdf.getTrailer().get("Root");
    var data = new Buffer();
    data.write(read(xmpFile));
    var meta = root.get("Metadata");
    // XMP must stay readable as plain XML: stored unfiltered, like the writers that made it.
    if (meta && meta.isStream()) {
      meta.writeStream(data);
      meta.delete("Filter");
      meta.delete("DecodeParms");
    } else {
      root.put("Metadata", pdf.addStream(data, pdf.addObject({ Type: "Metadata", Subtype: "XML" })));
    }
  }
  pdf.save(args[2], "decrypt");
} else {
  throw new Error("unknown mode " + mode);
}
