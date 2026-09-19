"use strict";
/*
 * mutool run inspect.js <file.pdf>
 * Prints { outline, labels } as JSON: the outline as [{ title, page, down? }]
 * with 1-based pages (null when an item has no page), and every page's label.
 */
var doc = new PDFDocument(scriptArgs[0]);

function walk(items) {
  var out = [];
  for (var k = 0; k < items.length; k++) {
    var o = items[k];
    var p = -1;
    if (o.uri && o.uri.charAt(0) === "#") {
      try {
        p = doc.resolveLink(o.uri);
      } catch (e) {
        p = -1;
      }
    }
    var entry = { title: o.title, page: p >= 0 ? p + 1 : null };
    if (o.down && o.down.length) entry.down = walk(o.down);
    out.push(entry);
  }
  return out;
}

var labels = [];
for (var i = 0; i < doc.countPages(); i++) labels.push(doc.loadPage(i).getLabel());
print(JSON.stringify({ outline: walk(doc.loadOutline() || []), labels: labels }));
