import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/Shell";
import { Empty } from "@/components/ui";
import { ToastProvider } from "@/hooks/useToast";
import { Launchpad } from "@/routes/Launchpad";

// The tools pull in heavy dependencies (wasm codecs, spreadsheet parsers);
// the index page should not pay for any of them.
const Squoosh = lazy(() => import("@/tools/squoosh/SquooshPage").then((m) => ({ default: m.SquooshPage })));
const Admin = lazy(() => import("@/routes/Admin").then((m) => ({ default: m.Admin })));
const MailMerge = lazy(() => import("@/tools/mailmerge/MailMergePage").then((m) => ({ default: m.MailMergePage })));
const PdfCompress = lazy(() => import("@/tools/pdfcompress/PdfCompress").then((m) => ({ default: m.PdfCompress })));
const PdfMerge = lazy(() => import("@/tools/pdfmerge/PdfMerge").then((m) => ({ default: m.PdfMerge })));

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Launchpad />} />
            <Route path="/squoosh" element={<Squoosh />} />
            <Route path="/mail-merge" element={<MailMerge />} />
            <Route path="/mail-merge/s/:slug" element={<MailMerge />} />
            <Route path="/mail-merge/p/:id" element={<MailMerge />} />
            <Route path="/pdf-compress" element={<PdfCompress />} />
            <Route path="/pdf-merge" element={<PdfMerge />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </BrowserRouter>
  );
}

function Loading() {
  return (
    <Shell>
      <p className="text-meta font-mono text-meta uppercase">loading…</p>
    </Shell>
  );
}

function NotFound() {
  return (
    <Shell>
      <h1 className="text-ink font-mono text-title font-bold uppercase">404</h1>
      <div className="mt-4">
        <Empty>nothing here</Empty>
      </div>
    </Shell>
  );
}
