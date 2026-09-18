import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/Shell";
import { Empty } from "@/components/ui";
import { ToastProvider } from "@/hooks/useToast";
import { Launchpad } from "@/routes/Launchpad";

// Both tools pull in heavy dependencies (wasm codecs, spreadsheet parsers);
// the index page should not pay for either.
const Squoosh = lazy(() => import("@/tools/squoosh/SquooshPage").then((m) => ({ default: m.SquooshPage })));
const MailMerge = lazy(() => import("@/tools/mailmerge/MailMergePage").then((m) => ({ default: m.MailMergePage })));

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
