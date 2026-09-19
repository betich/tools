import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { downloadZip } from "client-zip";
import { FiDownload, FiServer, FiX } from "react-icons/fi";
import {
  docForRow,
  extensionFor,
  fileNameFor,
  hasOverrides,
  pdfFromJpegs,
  type ExportFormat,
  type MergeData,
  type MergeDoc,
  type PdfLayout,
} from "@tools/shared";
import { Button, Field, Input, Segmented, Slider, TextButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { download } from "@/lib/download";
import { pad } from "@/lib/format";
import { ensureDocFonts } from "./fonts";
import { OwnMark } from "./OwnMark";
import { renderThumbnail, renderToBlob } from "./render";

/**
 * The export sheet: every row rendered small, the ones you want picked by
 * clicking them, and the format decided beside the grid rather than guessed.
 *
 * It renders thumbnails one row at a time with a yield between each, so a
 * 500-row merge fills in progressively instead of freezing the tab, and the
 * full-size render only happens for what you actually asked for.
 */
export function ExportSheet({
  doc,
  data,
  base,
  namePattern,
  onNamePattern,
  serverBusy,
  onServerRender,
  onClose,
}: {
  doc: MergeDoc;
  data: MergeData;
  base: HTMLImageElement | null;
  namePattern: string;
  onNamePattern: (pattern: string) => void;
  /** The page is already talking to the api — a save, a share, a server render. */
  serverBusy: boolean;
  /** Every row, rendered by the api in the chosen format. */
  onServerRender: (format: ExportFormat, quality: number, pdf: PdfLayout) => void;
  onClose: () => void;
}) {
  // With no sheet loaded there is still exactly one thing to export: the
  // document as it stands.
  const rows = data.rows.length > 0 ? data.rows : [null];

  const [selected, setSelected] = useState<Set<number>>(() => new Set(rows.map((_, i) => i)));
  const [thumbs, setThumbs] = useState<(string | null)[]>(() => rows.map(() => null));
  const [format, setFormat] = useState<ExportFormat>("png");
  const [quality, setQuality] = useState(92);
  const [pdfLayout, setPdfLayout] = useState<PdfLayout>("single");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Thumbnails, one per frame, so the grid fills in front of you.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Every face and every glyph the sheet will draw, before the first page:
      // a page rendered while a face is still downloading is a wrong page.
      await ensureDocFonts(doc, rows);
      for (let i = 0; i < rows.length; i++) {
        if (cancelled) return;
        const url = renderThumbnail(docForRow(doc, data.keys?.[i]), rows[i] ?? null, base);
        setThumbs((prev) => {
          const next = [...prev];
          next[i] = url;
          return next;
        });
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    return () => {
      cancelled = true;
    };
    // The sheet is opened on a frozen document; re-rendering it is the point of closing and reopening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const ext = extensionFor(format);
  const names = useMemo(
    () => rows.map((row, i) => fileNameFor(namePattern, row ?? {}, i, ext)),
    [rows, namePattern, ext],
  );

  const run = useCallback(async () => {
    const picks = [...selected].sort((a, b) => a - b);
    if (picks.length === 0) return;

    setBusy(true);
    setProgress({ done: 0, total: picks.length });
    try {
      await ensureDocFonts(doc, picks.map((i) => rows[i] ?? null));
      // A PDF page is the row drawn as a JPEG, laid into the file as-is.
      const options = { format: format === "pdf" ? "jpeg" : format, quality: quality / 100 } as const;
      const { width, height } = doc.canvas;
      const page = async (blob: Blob) => pdfFromJpegs([{ jpeg: new Uint8Array(await blob.arrayBuffer()), width, height }], doc.name);

      const files: { name: string; input: Blob }[] = [];
      const pages: Uint8Array[] = [];
      for (const i of picks) {
        const blob = await renderToBlob(docForRow(doc, data.keys?.[i]), rows[i] ?? null, base, options);
        if (format === "pdf" && pdfLayout === "single") pages.push(new Uint8Array(await blob.arrayBuffer()));
        else files.push({ name: names[i]!, input: format === "pdf" ? new Blob([await page(blob)], { type: "application/pdf" }) : blob });
        if (!alive.current) return;
        setProgress({ done: files.length + pages.length, total: picks.length });
        await new Promise((r) => setTimeout(r, 0));
      }

      if (pages.length) {
        const pdf = pdfFromJpegs(pages.map((jpeg) => ({ jpeg, width, height })), doc.name);
        download(new Blob([pdf], { type: "application/pdf" }), `${doc.name || "merge"}.pdf`);
      } else if (files.length === 1) download(files[0]!.input, files[0]!.name);
      else download(await downloadZip(files).blob(), `${doc.name || "merge"}.zip`);
      onClose();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [base, data.keys, doc, format, names, onClose, pdfLayout, quality, rows, selected]);

  const rendered = thumbs.filter(Boolean).length;

  // Portalled to the body: the editor's chrome sits in its own stacking
  // context, and a sheet the bottom rail can paint over is not a sheet.
  return createPortal(
    <div className="bg-paper/97 fixed inset-0 z-[70] flex flex-col backdrop-blur-2xl" role="dialog" aria-modal>
      <header className="border-wash flex shrink-0 items-center justify-between gap-6 border-b px-5 py-4 sm:px-8">
        <div className="flex items-baseline gap-5">
          <h2 className="text-ink font-mono text-title font-bold uppercase">export</h2>
          <span className="text-meta font-mono text-micro tabular-nums uppercase">
            {pad(selected.size)} of {pad(rows.length)} selected
          </span>
          {rendered < rows.length ? (
            <span className="text-indigo font-mono text-micro tabular-nums uppercase">
              rendering {pad(rendered)} / {pad(rows.length)}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-5">
          <TextButton onClick={() => setSelected(new Set(rows.map((_, i) => i)))} disabled={busy}>
            all
          </TextButton>
          <TextButton onClick={() => setSelected(new Set())} disabled={busy}>
            none
          </TextButton>
          <button
            type="button"
            aria-label="close"
            onClick={onClose}
            disabled={busy}
            className="text-meta hover:text-indigo cursor-pointer transition-colors duration-200 disabled:opacity-35"
          >
            <FiX className="size-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* the sheet of pages */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {rows.map((_, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  aria-pressed={selected.has(i)}
                  className={cn(
                    "group relative block w-full cursor-pointer overflow-hidden rounded-sm border text-left transition-colors duration-200",
                    selected.has(i) ? "border-indigo bg-surface-high" : "border-hairline-faint bg-surface hover:border-edge",
                  )}
                >
                  <span
                    className="checkers block w-full"
                    style={{ aspectRatio: `${doc.canvas.width} / ${doc.canvas.height}` }}
                  >
                    {thumbs[i] ? (
                      // The page is shown as it will be written — selection is
                      // carried by the frame and the tick, never by dimming the artwork.
                      <img src={thumbs[i]!} alt="" className="size-full object-contain" />
                    ) : null}
                  </span>

                  {/* the tick, in the corner a page number would take */}
                  <span
                    className={cn(
                      "absolute top-2 left-2 flex size-4 items-center justify-center rounded-hairline border transition-colors duration-200",
                      selected.has(i) ? "border-indigo bg-indigo" : "border-wash bg-paper/70",
                    )}
                    aria-hidden
                  >
                    {selected.has(i) ? (
                      <svg viewBox="0 0 10 10" className="text-paper size-2.5">
                        <path d="M1.5 5.2 4 7.5 8.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                      </svg>
                    ) : null}
                  </span>

                  <span className="border-wash flex items-center gap-2 border-t px-2.5 py-2">
                    <span className="text-meta font-mono text-micro tabular-nums">{pad(i + 1)}</span>
                    <span
                      className={cn(
                        "truncate font-mono text-micro tracking-normal normal-case",
                        selected.has(i) ? "text-ink" : "text-meta",
                      )}
                    >
                      {names[i]}
                    </span>
                    {hasOverrides(doc, data.keys?.[i]) ? <OwnMark className="ml-auto" /> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* what to write, and the one button that writes it */}
        <aside className="border-wash flex shrink-0 flex-col gap-6 border-t p-5 sm:px-8 lg:w-[19rem] lg:border-t-0 lg:border-l lg:px-6">
          <div className="flex flex-col gap-5">
            <Field label="format">
              <Segmented
                value={format}
                onChange={setFormat}
                options={[
                  { value: "png", label: "png" },
                  { value: "jpeg", label: "jpg" },
                  { value: "webp", label: "webp" },
                  { value: "pdf", label: "pdf" },
                ]}
              />
            </Field>

            {format === "pdf" ? (
              <Field label="pages" hint="each row is a page, drawn at 96 pixels to the inch">
                <Segmented
                  value={pdfLayout}
                  onChange={setPdfLayout}
                  options={[
                    { value: "single", label: "one pdf" },
                    { value: "each", label: "one per row" },
                  ]}
                />
              </Field>
            ) : null}

            <Field label={`quality · ${quality}%`} hint={format === "png" ? "png is lossless — quality applies to the others" : undefined}>
              <Slider min={40} max={100} value={quality} onChange={setQuality} disabled={format === "png"} />
            </Field>

            <Field label="file name" hint="tokens work here too">
              <Input value={namePattern} onChange={(e) => onNamePattern(e.target.value)} spellCheck={false} />
            </Field>
          </div>

          <div className="mt-auto flex flex-col gap-3">
            <p className="text-meta font-mono text-micro uppercase">
              {selected.size === 0
                ? "nothing selected"
                : selected.size === 1
                  ? `one ${ext} · ${doc.canvas.width}×${doc.canvas.height}`
                  : format === "pdf" && pdfLayout === "single"
                    ? `one pdf · ${selected.size} pages`
                    : `${selected.size} ${ext} files · one zip`}
            </p>
            <Button onClick={() => void run()} disabled={busy || selected.size === 0} className="w-full">
              <FiDownload className="size-3.5" aria-hidden />
              {progress ? `rendering ${pad(progress.done)} / ${pad(progress.total)}` : `download ${pad(selected.size)}`}
            </Button>

            {/* The other way out: the api draws every row and hands back one zip. */}
            <div className="border-hairline-faint mt-3 flex flex-col gap-3 border-t pt-5">
              <p className="text-meta font-sans text-body leading-snug normal-case">
                {data.rows.length > 0
                  ? `Or have the server draw all ${data.rows.length} rows in the same format — for a big set, or to keep this tab free.`
                  : "Load a sheet to render a whole set on the server."}
              </p>
              <Button
                variant="outline"
                onClick={() => onServerRender(format, quality, pdfLayout)}
                disabled={busy || serverBusy || data.rows.length === 0}
                className="w-full"
              >
                <FiServer className="size-3.5" aria-hidden />
                {serverBusy ? "rendering on server…" : "render all on server"}
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>,
    document.body,
  );
}
