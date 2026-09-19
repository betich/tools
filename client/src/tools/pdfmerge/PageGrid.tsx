import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { FiArrowLeft, FiArrowRight, FiImage } from "react-icons/fi";
import { IconButton, TextButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { pad } from "@/lib/format";
import { canInterleave, type Slot } from "./pageOrder";
import { pdfPageThumb } from "./thumbnail";
import type { MergeEntry } from "./useMergeFiles";
import type { PageOrderState } from "./usePageOrder";

/** Where a dragged block would land: against one side of the tile under the pointer. */
type Over = { id: string; side: "before" | "after" };

/**
 * The page view (#37): the merge's output, page by page, in order. Pages
 * gather under a bracket per run — consecutive pages of one file — because a
 * run is what becomes one bookmark, so the grid shows the outline it will
 * make. A file still being counted holds its place as a single tile.
 *
 * Click picks a page, shift-click a span, ⌘/ctrl-click one more; delete takes
 * the picked pages out of the output (the file is untouched). Picking a page
 * also makes its file the one the page section and preview are about.
 *
 * Pages drag anywhere in the output, across files too (#42): a picked page
 * takes every picked page with it, as one block, and a periwinkle rule on a
 * tile's edge shows where it will land. Alt+arrows do the same from the
 * keyboard, one place at a time, and the arrows in the bar do it for touch.
 * Interleave deals the picked pages out a file at a time, so fronts and backs
 * scanned as two files become one document in one gesture. Every drop, move
 * and deal is one undo step.
 */
export function PageGrid({
  state,
  entries,
  onFocusFile,
}: {
  state: PageOrderState;
  entries: MergeEntry[];
  onFocusFile: (key: string) => void;
}) {
  const { slots, selection } = state;
  const byKey = new Map(entries.map((e, i) => [e.key, { entry: e, index: i }]));
  const runs = groupRuns(slots);
  const picked = selection.ids.size;
  const total = slots.filter((s) => s.kind === "page").length;
  const list = useRef<HTMLOListElement>(null);
  const ghost = useRef<HTMLSpanElement>(null);
  const dealable = picked > 1 && canInterleave(slots, selection.ids);

  // The pages being dragged, and the edge they would land against.
  const [dragging, setDragging] = useState<ReadonlySet<string> | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  // Read by handlers that stay put across renders, so the memoised tiles don't redraw on every change.
  const live = useRef({ selection, slots, dragging });
  live.current = { selection, slots, dragging };

  const { pick } = state;
  const onPick = useCallback(
    (id: string, key: string, e: MouseEvent) => {
      pick(id, { shift: e.shiftKey, mod: e.metaKey || e.ctrlKey });
      onFocusFile(key);
    },
    [pick, onFocusFile],
  );

  /** A picked page takes the whole pick with it; any other page goes alone, and is picked. */
  const carried = useCallback(
    (id: string) => {
      const sel = live.current.selection.ids;
      if (sel.has(id)) return sel;
      pick(id);
      return new Set([id]);
    },
    [pick],
  );

  const onDragStart = useCallback(
    (id: string, key: string, e: DragEvent) => {
      const ids = carried(id);
      onFocusFile(key);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      // More than one page: the pointer carries a count rather than a picture of one of them.
      if (ids.size > 1 && ghost.current) {
        ghost.current.textContent = `${pad(ids.size)} pages`;
        e.dataTransfer.setDragImage(ghost.current, 14, 12);
      }
      setDragging(ids);
    },
    [carried, onFocusFile],
  );

  const onDragOver = useCallback((id: string, e: DragEvent) => {
    if (!live.current.dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = e.currentTarget.getBoundingClientRect();
    const side = e.clientX < r.left + r.width / 2 ? "before" : "after";
    setOver((o) => (o?.id === id && o.side === side ? o : { id, side }));
  }, []);

  const endDrag = useCallback(() => {
    setDragging(null);
    setOver(null);
  }, []);

  const ids = () => live.current.slots.flatMap((s) => (s.kind === "page" ? [s.id] : []));

  const onDrop = (e: DragEvent) => {
    if (!dragging) return;
    e.preventDefault();
    if (over) {
      const order = ids();
      const before = over.side === "before" ? over.id : (order[order.indexOf(over.id) + 1] ?? null);
      state.movePages(dragging, before);
    }
    endDrag();
  };

  // After a keyboard move the page may sit under another run's bracket, a new element: focus follows it.
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    const tile = [...(list.current?.querySelectorAll<HTMLButtonElement>("button[data-page]") ?? [])].find((b) => b.dataset.page === id);
    if (tile && document.activeElement !== tile) tile.focus();
  });

  const shift = (by: -1 | 1, id?: string) => {
    const moving = id ? carried(id) : selection.ids;
    if (!moving.size) return;
    refocus.current = id ?? null;
    state.shiftPages(moving, by);
  };

  // Arrow keys walk the tiles in reading order; alt+arrows move the page (and the rest of the pick) instead.
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const tiles = [...(list.current?.querySelectorAll<HTMLButtonElement>("button[data-page]") ?? [])];
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    if (e.altKey) return shift(step, tiles[at]!.dataset.page);
    tiles[at + step]?.focus();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* What is picked and what can be done with it; the hint while nothing is. */}
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-meta font-mono text-micro uppercase tabular-nums" aria-live="polite">
          {picked ? (
            <span className="text-ink">
              {pad(picked)} of {pad(total)} picked
            </span>
          ) : (
            "click · shift-click · ⌘-click to pick · drag to move"
          )}
        </p>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {picked ? (
            <>
              <TextButton onClick={state.clearPicked}>clear</TextButton>
              <span className="flex items-center gap-2">
                <IconButton label="move earlier · alt ←" onClick={() => shift(-1)}>
                  <FiArrowLeft className="size-3.5" aria-hidden />
                </IconButton>
                <IconButton label="move later · alt →" onClick={() => shift(1)}>
                  <FiArrowRight className="size-3.5" aria-hidden />
                </IconButton>
              </span>
              {dealable ? (
                <TextButton
                  onClick={() => state.interleave(selection.ids)}
                  aria-label="interleave"
                  data-tip="one page from each file in turn"
                  className="tooltip"
                >
                  interleave
                </TextButton>
              ) : null}
              <TextButton
                onClick={state.removePicked}
                aria-label={`remove ${picked === 1 ? "page" : "pages"}`}
                aria-keyshortcuts="Delete Backspace"
                data-tip="delete"
                className="tooltip"
              >
                remove {picked === 1 ? "page" : "pages"}
              </TextButton>
            </>
          ) : !state.untouched ? (
            <TextButton onClick={state.resetAll}>reset all</TextButton>
          ) : null}
          <span className="flex items-center gap-4">
            <TextButton
              onClick={state.undo}
              disabled={!state.canUndo}
              aria-label="undo"
              aria-keyshortcuts="Control+Z Meta+Z"
              data-tip="⌘Z"
              className="tooltip"
            >
              undo
            </TextButton>
            <TextButton
              onClick={state.redo}
              disabled={!state.canRedo}
              aria-label="redo"
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
              data-tip="⇧⌘Z"
              data-tip-pos="top-right"
              className="tooltip"
            >
              redo
            </TextButton>
          </span>
        </span>
      </div>

      {slots.length === 0 ? (
        <p className="text-meta font-sans text-body normal-case">
          Every page has been taken out. Reset a file, or all of them, to put pages back — or undo.
        </p>
      ) : (
        <ol
          ref={list}
          className="flex flex-wrap items-start gap-x-3 gap-y-5"
          aria-label="pages in merge order"
          onKeyDown={onKeyDown}
          // The gaps between tiles take the drop too, landing where the rule was last drawn.
          onDragOver={(e) => dragging && e.preventDefault()}
          onDrop={onDrop}
          onDragEnd={endDrag}
        >
          {runs.map((run) => {
            const file = byKey.get(run.key);
            if (!file) return null;
            return (
              <li key={run.slots[0]!.id} className="flex max-w-full min-w-0 flex-col gap-1.5">
                <RunHead index={file.index} name={file.entry.file.name} />
                <ol className="flex flex-wrap gap-2">
                  {run.slots.map((slot, k) =>
                    slot.kind === "page" ? (
                      <li key={slot.id} className="relative">
                        <PageTile
                          id={slot.id}
                          entry={file.entry}
                          page={slot.ref.page}
                          at={run.start + k}
                          picked={selection.ids.has(slot.id)}
                          lifted={dragging?.has(slot.id) ?? false}
                          onPick={onPick}
                          onDragStart={onDragStart}
                          onDragOver={onDragOver}
                        />
                        {/* The drop line: a 1px periwinkle rule in the gap on the side the block would land. */}
                        {dragging && over?.id === slot.id ? (
                          <span
                            className={cn(
                              "bg-indigo pointer-events-none absolute inset-y-0 w-px",
                              over.side === "before" ? "-left-[5px]" : "-right-[5px]",
                            )}
                            aria-hidden
                          />
                        ) : null}
                      </li>
                    ) : (
                      <li key={slot.id}>
                        <FileTile slot={slot} onRetry={state.retryCounts} />
                      </li>
                    ),
                  )}
                </ol>
              </li>
            );
          })}
        </ol>
      )}

      {/* What the pointer carries when several pages move: a count, not one page's picture. Off screen until then. */}
      <span
        ref={ghost}
        className="border-indigo bg-panel-high text-ink pointer-events-none fixed -top-24 left-0 rounded-xs border px-2 py-1 font-mono text-micro uppercase tabular-nums"
        aria-hidden
      />
    </div>
  );
}

type Run = { key: string; start: number; slots: Slot[] };

/** Consecutive pages of one file, as `toRuns` joins them — each one bookmark. A file still counting is a run of its own. */
function groupRuns(slots: readonly Slot[]): Run[] {
  const runs: Run[] = [];
  let at = 0;
  let prev: Slot | null = null;
  for (const slot of slots) {
    const last = runs[runs.length - 1];
    const joins =
      last &&
      prev?.kind === "page" &&
      slot.kind === "page" &&
      prev.ref.key === slot.ref.key &&
      prev.ref.page + 1 === slot.ref.page;
    if (joins) last.slots.push(slot);
    else runs.push({ key: slot.kind === "page" ? slot.ref.key : slot.key, start: at, slots: [slot] });
    if (slot.kind === "page") at++;
    prev = slot;
  }
  return runs;
}

/** The run's bracket: its file's number and name over a hairline that turns down at both ends. */
function RunHead({ index, name }: { index: number; name: string }) {
  return (
    // w-0 + min-w-full: as wide as the run's tiles, never wider, so a one-page run's name truncates instead of widening it.
    <div className="flex w-0 min-w-full flex-col gap-1" title={name}>
      <span className="flex min-w-0 items-baseline gap-2 font-mono text-meta">
        <span className="text-meta shrink-0 tabular-nums">{pad(index + 1)}</span>
        <span className="text-label min-w-0 truncate tracking-normal">{name}</span>
      </span>
      <span className="border-edge block h-1.5 border-x border-t" aria-hidden />
    </div>
  );
}

const TILE = "w-[5.5rem]";

/**
 * One output page. The page is never dimmed: being picked is the frame, the
 * tick and the numbers going to full ink, as on the export sheet. Its number
 * in the output is on the left of the foot, the page it is in its file on the
 * right. It drags (see `PageGrid`); alt+arrows move it from the keyboard.
 */
const PageTile = memo(function PageTile({
  id,
  entry,
  page,
  at,
  picked,
  lifted,
  onPick,
  onDragStart,
  onDragOver,
}: {
  id: string;
  entry: MergeEntry;
  page: number;
  at: number;
  picked: boolean;
  /** Being dragged: it fades where it was, as a file row does, until it lands. */
  lifted: boolean;
  onPick: (id: string, key: string, e: MouseEvent) => void;
  onDragStart: (id: string, key: string, e: DragEvent) => void;
  onDragOver: (id: string, e: DragEvent) => void;
}) {
  const image = entry.kind !== "pdf";
  return (
    <button
      type="button"
      data-page={id}
      draggable
      onDragStart={(e) => onDragStart(id, entry.key, e)}
      onDragOver={(e) => onDragOver(id, e)}
      aria-pressed={picked}
      aria-label={`page ${at + 1}: ${image ? entry.file.name : `page ${page + 1} of ${entry.file.name}`}`}
      onClick={(e) => onPick(id, entry.key, e)}
      // A shift-click picks a span; without this the browser also selects the text across it.
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      className={cn(
        "group relative block cursor-pointer overflow-hidden rounded-xs border text-left transition-colors duration-200",
        "focus-visible:outline-indigo focus-visible:outline-1 focus-visible:outline-offset-2",
        TILE,
        picked ? "border-indigo bg-surface-high" : "border-hairline-faint bg-surface hover:border-edge",
        lifted && "opacity-35",
      )}
    >
      <span className="flex aspect-[3/4] items-center justify-center p-1.5">
        {image ? <ImageFace entry={entry} /> : <PdfFace entry={entry} page={page} />}
      </span>

      <span
        className={cn(
          "absolute top-1.5 left-1.5 flex size-3.5 items-center justify-center rounded-hairline border transition-[opacity,color] duration-200",
          picked ? "border-indigo bg-indigo opacity-100" : "border-wash bg-paper/70 opacity-0 group-hover:opacity-100",
        )}
        aria-hidden
      >
        {picked ? (
          <svg viewBox="0 0 10 10" className="text-paper size-2.5">
            <path d="M1.5 5.2 4 7.5 8.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        ) : null}
      </span>

      <span
        className={cn(
          "border-hairline-faint flex items-baseline justify-between gap-1 border-t px-1.5 py-1 font-mono text-micro tabular-nums transition-colors duration-200",
          picked ? "text-ink" : "text-meta",
        )}
      >
        <span>{pad(at + 1)}</span>
        <span className="uppercase">{image ? entry.kind : `p${pad(page + 1)}`}</span>
      </span>
    </button>
  );
});

/** A PDF page: the server's drawing once this tile has been on screen, the page's number until then (or for good, without the server). */
function PdfFace({ entry, page }: { entry: MergeEntry; page: number }) {
  const id = entry.upload.phase === "done" ? entry.upload.result.id : null;
  const box = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((hits) => hits.some((h) => h.isIntersecting) && setSeen(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    if (!seen || !id) return;
    const ctrl = new AbortController();
    void pdfPageThumb(id, page + 1, ctrl.signal).then((h) => !ctrl.signal.aborted && setHref(h));
    return () => ctrl.abort();
  }, [seen, id, page]);

  return (
    <span ref={box} className="flex size-full items-center justify-center">
      {href ? (
        <img src={href} alt="" onError={() => setHref(null)} className="max-h-full max-w-full bg-white object-contain" draggable={false} />
      ) : (
        <span className="text-meta font-mono text-small tabular-nums">{pad(page + 1)}</span>
      )}
    </span>
  );
}

/** An image goes in as one page: its own pixels where the browser can draw them, a glyph where it can't. */
function ImageFace({ entry }: { entry: MergeEntry }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bitmap = entry.source.state === "image" ? entry.source.bitmap : null;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !bitmap) return;
    const side = 160;
    const k = Math.min(side / bitmap.width, side / bitmap.height, 1);
    c.width = Math.max(1, Math.round(bitmap.width * k));
    c.height = Math.max(1, Math.round(bitmap.height * k));
    c.getContext("2d")?.drawImage(bitmap, 0, 0, c.width, c.height);
  }, [bitmap]);

  return bitmap ? (
    <canvas ref={canvas} className="max-h-full max-w-full" aria-hidden />
  ) : (
    <FiImage className="text-meta size-4" aria-hidden />
  );
}

/**
 * A file whose pages aren't known: counting, or the server couldn't count
 * them — its sentence as it was sent, and a way to ask again when that was
 * only for now (the worker was offline, say).
 */
function FileTile({ slot, onRetry }: { slot: Extract<Slot, { kind: "file" }>; onRetry: () => void }) {
  return (
    <span
      className={cn(
        "border-hairline-faint flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-xs border px-2 text-center font-mono text-meta text-micro uppercase",
        TILE,
      )}
    >
      {slot.state === "counting" ? "counting pages…" : (slot.why.reason ?? "pages unknown")}
      {slot.state === "uncounted" && slot.why.retry ? <TextButton onClick={onRetry}>try again</TextButton> : null}
    </span>
  );
}
