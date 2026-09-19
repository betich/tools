/**
 * The pdf-lib engine (#13), run in its own Bun process so a file that takes
 * pdf-lib past its memory, or too long, is a failed child the worker reports,
 * not a stuck worker:
 *
 *   bun pdflib.ts compress <in.pdf> <out.pdf> <ops.json>
 *     ops: { objectStreams, stripMetadata, keepXmp }
 *   bun pdflib.ts join <out.pdf> <a.pdf> <b.pdf> …
 *
 * pdf-lib parses the whole file into memory and writes every object back out
 * (used or not), copying streams as they are; what it adds is object streams
 * and, here, the metadata edits. `join` copies pages and what they reference —
 * the catalog (outlines, form fields, names) of the sources is not carried.
 * Errors go to stderr as one line; the exit code is 1.
 */
import { PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";

const LOAD = { updateMetadata: false, throwOnInvalidObject: false } as const;

async function open(path: string): Promise<PDFDocument> {
  return PDFDocument.load(await Bun.file(path).bytes(), LOAD);
}

async function save(doc: PDFDocument, path: string, objectStreams: boolean) {
  await Bun.write(path, await doc.save({ useObjectStreams: objectStreams, addDefaultPage: false, updateFieldAppearances: false }));
}

/** The document info except its Title, the catalog's XMP unless keepXmp, and XMP on any other object. */
function stripMetadata(doc: PDFDocument, keepXmp: boolean) {
  const { context } = doc;
  const info = context.lookup(context.trailerInfo.Info);
  if (info instanceof PDFDict) {
    for (const key of info.keys()) if (key !== PDFName.Title) info.delete(key);
  }
  const metadata = PDFName.of("Metadata");
  for (const [, obj] of context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (!dict?.has(metadata) || !(dict.lookup(metadata) instanceof PDFStream)) continue;
    if (dict === doc.catalog && keepXmp) continue;
    dict.delete(metadata);
  }
}

async function main(argv: string[]) {
  const [mode, ...rest] = argv;
  if (mode === "compress") {
    const [input, output, opsFile] = rest as [string, string, string];
    const ops = (await Bun.file(opsFile).json()) as { objectStreams: boolean; stripMetadata: boolean; keepXmp: boolean };
    const doc = await open(input);
    if (ops.stripMetadata) stripMetadata(doc, ops.keepXmp);
    await save(doc, output, ops.objectStreams);
  } else if (mode === "join") {
    const [output, ...inputs] = rest as [string, ...string[]];
    const out = await PDFDocument.create({ updateMetadata: false });
    for (const input of inputs) {
      const src = await open(input);
      for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
    }
    await save(out, output, true);
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(String(err instanceof Error ? err.message : err).split("\n")[0]);
  process.exit(1);
});
