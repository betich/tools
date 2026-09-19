/**
 * The compress pipeline and its steps, registered in import order within each
 * phase (see ./pipeline). A ticket that adds a step adds its import here.
 */
import "./jpegs";
import "./qpdf";
import "./mupdf";

export { readParams, registerStep, runPipeline, wantedPasses, type CompressRun, type Phase, type Step } from "./pipeline";
