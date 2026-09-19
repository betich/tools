import { Fragment, useMemo, useState, type ReactNode } from "react";
import { FiArrowDown, FiArrowUp } from "react-icons/fi";
import type { PdfImage } from "@tools/shared";
import { TextButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { bytes } from "@/lib/format";
import { codecName, colourName, pageRanges, share } from "./analysis";

type SortKey = "page" | "pixels" | "dpi" | "bytes";
type Sort = { key: SortKey; desc: boolean };

/** A scan can carry one image per page for hundreds of pages; the rest wait behind "show all". */
const FIRST = 40;

const value: Record<SortKey, (i: PdfImage) => number> = {
  page: (i) => (i.pages.length ? Math.min(...i.pages) : Infinity),
  pixels: (i) => i.width * i.height,
  dpi: (i) => i.dpi ?? -1,
  bytes: (i) => i.bytes,
};

/**
 * Every image in the file, heaviest first: where it is drawn, its pixel size,
 * the effective DPI it lands at on the page, its colour space, the codec it is
 * stored with and what it weighs. Headers sort (a second press flips the
 * direction). Values are machine values, so they sit in normal tracking.
 *
 * Seams for later tickets: `onSelect`/`selected` make a row pressable for the
 * before/after crop panel (#10), and `override` adds a trailing cell per row
 * for its per-image setting, headed by `overrideLabel`. `detail` draws a
 * full-width row under the selected one — the crop panel — so it opens where
 * the eye already is rather than above a long table.
 */
export function ImageTable({
  images,
  total,
  selected,
  onSelect,
  override,
  overrideLabel = "override",
  detail,
  className,
}: {
  images: PdfImage[];
  /** The file's size, for each image's share. */
  total: number;
  selected?: string | null;
  onSelect?: (id: string) => void;
  override?: (image: PdfImage) => ReactNode;
  overrideLabel?: string;
  detail?: (image: PdfImage) => ReactNode;
  className?: string;
}) {
  const [sort, setSort] = useState<Sort>({ key: "bytes", desc: true });
  const [all, setAll] = useState(false);

  const sorted = useMemo(() => {
    const get = value[sort.key];
    const dir = sort.desc ? -1 : 1;
    return [...images].sort((a, b) => dir * (get(a) - get(b)) || b.bytes - a.bytes);
  }, [images, sort]);
  const shown = all ? sorted : sorted.slice(0, FIRST);

  const press = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, desc: !s.desc } : { key, desc: key === "bytes" || key === "dpi" || key === "pixels" },
    );

  if (images.length === 0) {
    return (
      <p className="text-meta text-body font-sans normal-case">
        This file has no images — its size is in text, fonts and structure.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[40rem] border-collapse text-left">
          <thead>
            <tr className="border-wash border-b">
              <Head sort={sort} by="page" onSort={press}>
                page
              </Head>
              <Head sort={sort} by="pixels" onSort={press}>
                pixels
              </Head>
              <Head sort={sort} by="dpi" onSort={press} end>
                dpi
              </Head>
              <Head>colour</Head>
              <Head>codec</Head>
              <Head sort={sort} by="bytes" onSort={press} end>
                bytes
              </Head>
              <Head end>share</Head>
              {override ? <Head>{overrideLabel}</Head> : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((image) => {
              const on = selected === image.id;
              return (
                <Fragment key={image.id}>
                  <tr
                    onClick={onSelect ? () => onSelect(image.id) : undefined}
                    onKeyDown={
                      onSelect
                        ? (e) => {
                            if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                            e.preventDefault();
                            onSelect(image.id);
                          }
                        : undefined
                    }
                    tabIndex={onSelect ? 0 : undefined}
                    aria-selected={onSelect ? on : undefined}
                    className={cn(
                      "border-hairline-faint text-label border-b font-mono tabular-nums tracking-normal transition-colors duration-200",
                      onSelect &&
                        "hover:bg-hover-wash focus-visible:outline-indigo cursor-pointer focus-visible:outline-1",
                      on && "bg-surface-high",
                    )}
                  >
                    <Cell
                      className={on ? "text-indigo" : "text-ink"}
                      title={`pages ${pageRanges(image.pages, Infinity)}`}
                    >
                      {pageRanges(image.pages)}
                    </Cell>
                    <Cell className="text-label">
                      {image.width}×{image.height}
                    </Cell>
                    <Cell className="text-label text-right">{image.dpi == null ? "—" : Math.round(image.dpi)}</Cell>
                    <Cell className="text-label" title={image.colorSpace}>
                      {colourName(image)}
                    </Cell>
                    <Cell className="text-label" title={image.filter}>
                      {codecName(image.filter)}
                    </Cell>
                    <Cell className="text-ink text-right">{bytes(image.bytes)}</Cell>
                    <Cell className="text-meta text-right">{share(image.bytes, total)}</Cell>
                    {override ? <Cell>{override(image)}</Cell> : null}
                  </tr>
                  {on && detail ? (
                    <tr className="border-hairline-faint border-b">
                      <td colSpan={override ? 8 : 7} className="p-0">
                        {/* The table scrolls sideways on a phone; the panel stays pinned to the visible width. */}
                        <div className="sticky left-0 max-w-[calc(100vw-2rem)]">{detail(image)}</div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {images.length > FIRST ? (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-meta text-meta font-mono uppercase tabular-nums">
            {all ? images.length : FIRST} of {images.length}
          </span>
          <TextButton onClick={() => setAll((a) => !a)}>{all ? "show fewer" : `show all ${images.length}`}</TextButton>
        </div>
      ) : null}
    </div>
  );
}

function Head({
  children,
  by,
  sort,
  onSort,
  end,
}: {
  children: ReactNode;
  by?: SortKey;
  sort?: Sort;
  onSort?: (key: SortKey) => void;
  end?: boolean;
}) {
  const active = by && sort?.key === by;
  const label = (
    <span className={cn("inline-flex items-center gap-1", end && "flex-row-reverse")}>
      {children}
      {active ? (
        sort!.desc ? (
          <FiArrowDown className="size-3" aria-hidden />
        ) : (
          <FiArrowUp className="size-3" aria-hidden />
        )
      ) : null}
    </span>
  );
  return (
    <th
      scope="col"
      aria-sort={active ? (sort!.desc ? "descending" : "ascending") : undefined}
      className={cn("text-meta py-2 pr-4 font-mono font-normal uppercase last:pr-0", end && "text-right")}
    >
      {by && onSort ? (
        <button
          type="button"
          onClick={() => onSort(by)}
          className={cn(
            "hover:text-indigo cursor-pointer uppercase transition-colors duration-200",
            active ? "text-ink" : "text-meta",
          )}
        >
          {label}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

function Cell({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <td className={cn("whitespace-nowrap py-2.5 pr-4 last:pr-0", className)} title={title}>
      {children}
    </td>
  );
}
