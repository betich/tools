/**
 * The compress pipeline and its steps, registered in import order within each
 * phase (see ./pipeline). A ticket that adds a step adds its import here.
 */
import "./jpegs";
import "./fonts";
import "./qpdf";
import "./mupdf";
import "./special";
import "./qpdfEngine";
import "./ghostscript";
import "./pdflib";

export { readParams, registerStep, runPipeline, wantedPasses, type CompressRun, type Phase, type Step } from "./pipeline";
export { fontBytesAfter } from "./fonts";
