import { useEffect, useState, type ReactNode } from "react";
import {
  FiAlertCircle,
  FiArrowRight,
  FiChevronLeft,
  FiChevronRight,
  FiEdit2,
  FiFileText,
  FiPlus,
  FiRefreshCw,
} from "react-icons/fi";
import type { DataEdit, MergeData } from "@tools/shared";
import { Dropzone } from "@/components/Dropzone";
import { Button, Chip, IconButton, Section, TextButton, Toggle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { pad } from "@/lib/format";
import { rowTitle, severed as severedTokens, stepsFrom, TIMELINE_LIMIT } from "./rows";

/**
 * The merge's data, with one obvious thing to do in each state.
 *
 * Empty, that thing is loading a sheet: a real button inside the drop target,
 * and the sample offered underneath as the way to try it without a file.
 * Loaded, it is adjusting the row on the poster: the row is a card whose
 * values open the row editor, with `EDIT ROW` across its foot. Everything else
 * — reloading, the full list of rows, the timeline — sits below it, quieter.
 */
export function DataPanel({
  data,
  usedFields,
  rowIndex,
  showValues,
  editing,
  canReload,
  onPick,
  onReload,
  onDropFile,
  onSample,
  onClear,
  onStep,
  onSelectRow,
  onShowValues,
  onEdit,
  onRollback,
  onReconcile,
}: {
  data: MergeData;
  usedFields: string[];
  rowIndex: number;
  showValues: boolean;
  /** The row open in the editor: an index, `"new"`, or nothing. */
  editing: number | "new" | null;
  /** The file can be read again without asking (a file handle is held). */
  canReload: boolean;
  onPick: () => void;
  onReload: () => void;
  onDropFile: (file: File) => void;
  onSample: () => void;
  onClear: () => void;
  onStep: (direction: -1 | 1) => void;
  onSelectRow: (index: number) => void;
  onShowValues: (v: boolean) => void;
  /** Open the row editor. `null` is a new row. */
  onEdit: (index: number | null, anchor: HTMLElement, field?: string) => void;
  onRollback: (id: string) => void;
  onReconcile: () => void;
}) {
  const [over, setOver] = useState(false);
  const [armedClear, setArmedClear] = useState(false);
  useDisarm(armedClear, () => setArmedClear(false));

  const loaded = data.fields.length > 0;
  const total = data.rows.length;
  const current = Math.min(rowIndex, Math.max(0, total - 1));
  const row = data.rows[current];
  const lost = severedTokens(usedFields, data.fields);
  const used = (f: string) => usedFields.some((u) => u.toLowerCase() === f.toLowerCase());
  // Name rows by the columns the poster actually shows, when it shows any.
  const titleFields = [...data.fields.filter(used), ...data.fields.filter((f) => !used(f))];

  return (
    <Section
      title="data"
      aside={
        loaded ? (
          <TextButton
            onClick={() => (armedClear ? (setArmedClear(false), onClear()) : setArmedClear(true))}
            className={cn(armedClear && "text-indigo")}
          >
            {armedClear ? "clear all?" : "clear"}
          </TextButton>
        ) : null
      }
    >
      {!loaded ? (
        <div className="flex flex-col gap-3.5">
          <Dropzone
            onFiles={(files) => files[0] && onDropFile(files[0])}
            onPick={onPick}
            accept=".csv,.tsv,.xlsx,.xls,text/csv"
            multiple={false}
            cta={
              <>
                <FiFileText className="size-3.5" aria-hidden />
                choose a sheet
              </>
            }
            label="or drop a csv or xlsx here"
            hint="first row is the header"
            className="gap-3 py-7"
          />
          <p className="text-meta flex flex-wrap items-baseline gap-x-2 gap-y-1 font-sans text-body normal-case">
            No file to hand?
            <TextButton onClick={onSample} className="flex items-center gap-1.5">
              use the sample
              <FiArrowRight className="size-3" aria-hidden />
            </TextButton>
          </p>
        </div>
      ) : (
        <div
          className={cn(
            "flex flex-col gap-5 rounded-card outline-offset-[6px] transition-[outline-color] duration-200",
            over ? "outline-indigo outline-1 outline-dashed" : "outline-transparent",
          )}
          // A new version of the file can simply be dropped on the section.
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const file = e.dataTransfer.files[0];
            if (file) onDropFile(file);
          }}
        >
          {/* where the rows came from */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-ink flex min-w-0 items-center gap-2 font-mono text-label tracking-normal">
                <FiFileText className="text-meta size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{over ? "drop to reload" : (data.source ?? "sample sheet")}</span>
              </p>
              <span className="text-meta font-mono text-meta whitespace-nowrap uppercase tabular-nums">
                {pad(total)} rows · {pad(data.fields.length)} cols
              </span>
            </div>
            <span className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
              {data.source ? (
                <TextButton
                  onClick={canReload ? onReload : onPick}
                  className="tooltip flex items-center gap-1.5"
                  data-tip={canReload ? `read ${data.source} again` : "pick the file again"}
                  data-tip-pos="top-right"
                >
                  <FiRefreshCw className="size-3" aria-hidden />
                  reload
                </TextButton>
              ) : null}
              <TextButton onClick={onPick}>{data.source ? "replace" : "load a sheet"}</TextButton>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {data.fields.map((field) => (
              <Chip key={field} className={cn("tracking-normal normal-case", !used(field) && "opacity-50")}>
                &lt;{field}&gt;
              </Chip>
            ))}
          </div>

          {lost.length > 0 ? <Severed tokens={lost} onReconcile={onReconcile} /> : null}

          {/* the row on the poster — the thing you came here to adjust */}
          <div className="flex flex-col gap-3">
            <Toggle checked={showValues} onChange={onShowValues} label="show values on the poster" />

            {row ? (
              <div
                className={cn(
                  "rounded-card border bg-surface transition-colors duration-200",
                  editing === current ? "border-indigo/60" : "border-wash",
                )}
              >
                <header className="flex items-center justify-between gap-3 py-2.5 pr-3 pl-3.5">
                  <span className="text-ink font-mono text-meta font-bold uppercase tabular-nums">
                    row {pad(current + 1)} <span className="text-meta font-normal">/ {pad(total)}</span>
                  </span>
                  <span className="flex items-center gap-2.5">
                    <IconButton label="previous row  ←" onClick={() => onStep(-1)} disabled={total < 2}>
                      <FiChevronLeft className="size-4" />
                    </IconButton>
                    <IconButton label="next row  →" data-tip-pos="top-right" onClick={() => onStep(1)} disabled={total < 2}>
                      <FiChevronRight className="size-4" />
                    </IconButton>
                  </span>
                </header>

                <ul className="border-hairline-faint flex flex-col border-t py-1.5">
                  {data.fields.map((field) => (
                    <li key={field}>
                      <button
                        type="button"
                        onClick={(e) => onEdit(current, e.currentTarget, field)}
                        className="group hover:bg-hover-wash flex w-full cursor-pointer items-baseline px-3.5 py-1.5 text-left transition-colors duration-200"
                      >
                        <span
                          className={cn(
                            "shrink-0 font-mono text-meta uppercase transition-colors duration-200 group-hover:text-indigo",
                            used(field) ? "text-meta" : "text-meta opacity-60",
                          )}
                        >
                          {field}
                        </span>
                        <span className="leader" aria-hidden />
                        <span className="text-ink max-w-[58%] truncate font-mono text-label tracking-normal">
                          {row[field]?.replace(/\n/g, " ⏎ ") || <span className="text-meta">—</span>}
                        </span>
                        <FiEdit2
                          className="text-indigo ml-2 size-3 shrink-0 self-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
                          aria-hidden
                        />
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="border-hairline-faint border-t p-2.5">
                  <Button variant="outline" className="w-full" onClick={(e) => onEdit(current, e.currentTarget)}>
                    <FiEdit2 className="size-3.5" aria-hidden />
                    edit row {pad(current + 1)}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="border-wash flex flex-col items-center gap-3 rounded-card border border-dashed px-4 py-6">
                <p className="text-meta font-mono text-meta uppercase">every row is gone</p>
                <Button variant="outline" onClick={(e) => onEdit(null, e.currentTarget)}>
                  <FiPlus className="size-3.5" aria-hidden />
                  add a row
                </Button>
              </div>
            )}
          </div>

          {/* every row */}
          {total > 0 ? (
            <div className="flex flex-col gap-2">
              <SubHead
                title="rows"
                aside={
                  <TextButton onClick={(e) => onEdit(null, e.currentTarget)} className="flex items-center gap-1.5">
                    <FiPlus className="size-3" aria-hidden />
                    add row
                  </TextButton>
                }
              />
              <ol className="-mx-1.5 flex max-h-56 flex-col overflow-y-auto overscroll-contain">
                {data.rows.map((r, i) => {
                  const here = i === current;
                  return (
                    <li key={i} className="group relative flex items-center">
                      <button
                        type="button"
                        onClick={() => onSelectRow(i)}
                        aria-current={here || undefined}
                        className={cn(
                          "flex min-w-0 flex-1 cursor-pointer items-baseline gap-2.5 rounded-xs py-1.5 pr-7 pl-1.5 text-left transition-colors duration-200",
                          here ? "bg-surface-high text-ink" : "text-label hover:text-indigo",
                        )}
                      >
                        <span className={cn("shrink-0 font-mono text-meta tabular-nums", here ? "text-indigo" : "text-meta")}>
                          {pad(i + 1)}
                        </span>
                        <span className="min-w-0 truncate font-mono text-label tracking-normal">
                          {rowTitle(r, titleFields) || <span className="text-meta">empty row</span>}
                        </span>
                      </button>
                      <IconButton
                        label={`edit row ${i + 1}`}
                        data-tip-pos="top-right"
                        onClick={(e) => onEdit(i, e.currentTarget)}
                        className={cn(
                          "absolute right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100",
                          here && "opacity-100",
                        )}
                      >
                        <FiEdit2 className="size-3" />
                      </IconButton>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}

          <Timeline data={data} onRollback={onRollback} />
        </div>
      )}
    </Section>
  );
}

function SubHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="border-hairline-faint flex items-center justify-between gap-3 border-b pb-2">
      <h3 className="text-meta font-mono text-meta uppercase">{title}</h3>
      {aside}
    </div>
  );
}

/**
 * The template asks for columns the sheet no longer has. Said plainly, with
 * the tokens named and the one way out as a button — never a status colour.
 */
function Severed({ tokens, onReconcile }: { tokens: string[]; onReconcile: () => void }) {
  return (
    <div role="status" className="border-edge flex flex-col gap-3 rounded-card border px-3.5 pt-3 pb-3.5">
      <p className="text-ink flex items-center gap-2 font-mono text-meta font-bold uppercase">
        <FiAlertCircle className="size-3.5 shrink-0" aria-hidden />
        {tokens.length === 1 ? "a column went missing" : `${tokens.length} columns went missing`}
      </p>
      <p className="text-prose font-sans text-body leading-snug normal-case">
        The template uses{" "}
        {tokens.map((t, i) => (
          <span key={t}>
            <code className="text-ink font-mono text-label tracking-normal">&lt;{t}&gt;</code>
            {i < tokens.length - 2 ? ", " : i === tokens.length - 2 ? " and " : ""}
          </span>
        ))}
        , which this sheet doesn’t have. The poster shows {tokens.length === 1 ? "it" : "them"} raw until matched.
      </p>
      <Button variant="outline" className="w-full" onClick={onReconcile}>
        match columns
      </Button>
    </div>
  );
}

/* ── the edit timeline ──────────────────────────────────────────────────────
   Newest at the top, a thin rule running down through a node per step, and
   the sheet as it was loaded at the foot. Rolling back undoes a step and every
   step above it, so pointing at `ROLL BACK` strikes through exactly what would
   go. It is two taps, like delete. */

function Timeline({ data, onRollback }: { data: MergeData; onRollback: (id: string) => void }) {
  const history = data.history ?? [];
  const [aim, setAim] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  useDisarm(armed !== null, () => setArmed(null));

  const target = armed ?? aim;
  const aimIndex = target ? history.findIndex((e) => e.id === target) : -1;
  const full = history.length >= TIMELINE_LIMIT;

  return (
    <div className="flex flex-col gap-2">
      <SubHead
        title="edits"
        aside={<span className="text-meta font-mono text-meta tabular-nums">{history.length ? pad(history.length) : "—"}</span>}
      />

      {history.length === 0 ? (
        <p className="text-meta font-sans text-body leading-snug normal-case">
          Click any value to adjust a single row. Every change lands here, and any of them can be rolled back.
        </p>
      ) : null}

      <ol className="relative flex flex-col">
        {/* the rule the nodes hang on */}
        {history.length ? <span className="bg-hairline-faint absolute top-2 bottom-2 left-[3px] w-px" aria-hidden /> : null}

        {[...history].reverse().map((entry, r) => {
          const i = history.length - 1 - r;
          const doomed = aimIndex !== -1 && i >= aimIndex;
          const isArmed = armed === entry.id;
          return (
            <li key={entry.id} className="group relative flex gap-3 py-2">
              <span
                className={cn(
                  "relative mt-[5px] size-[7px] shrink-0 rounded-full border transition-colors duration-200",
                  doomed ? "border-indigo bg-paper" : r === 0 ? "border-ink bg-ink" : "border-edge bg-paper",
                )}
                aria-hidden
              />
              <div className={cn("flex min-w-0 flex-1 flex-col gap-1 transition-opacity duration-200", doomed && "opacity-55")}>
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "text-ink min-w-0 truncate font-mono text-meta uppercase",
                      doomed && "decoration-indigo line-through",
                    )}
                  >
                    {headline(entry)}
                  </span>
                  <time className="text-meta shrink-0 font-mono text-meta tabular-nums" dateTime={entry.at}>
                    {clock(entry.at)}
                  </time>
                </div>
                <Detail entry={entry} />
              </div>
              <TextButton
                onClick={() => (isArmed ? (setArmed(null), setAim(null), onRollback(entry.id)) : setArmed(entry.id))}
                onPointerEnter={() => setAim(entry.id)}
                onPointerLeave={() => setAim(null)}
                onFocus={() => setAim(entry.id)}
                onBlur={() => setAim(null)}
                aria-label={isArmed ? `confirm: undo ${stepsFrom(data, entry.id)} edits` : "roll back to before this edit"}
                className={cn(
                  "absolute right-0 bottom-2 bg-paper pl-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100",
                  isArmed && "text-indigo opacity-100",
                )}
              >
                {isArmed ? `undo ${pad(stepsFrom(data, entry.id))}?` : "roll back"}
              </TextButton>
            </li>
          );
        })}

        {history.length ? (
          <li className="flex items-center gap-3 pt-2">
            <span className="border-edge size-[7px] shrink-0 rotate-45 border" aria-hidden />
            <span className="text-meta font-mono text-meta uppercase">
              {full ? "earlier edits are kept as is" : "as loaded"}
            </span>
          </li>
        ) : null}
      </ol>
    </div>
  );
}

function headline(entry: DataEdit): string {
  switch (entry.kind) {
    case "change":
      return `row ${pad(entry.row + 1)}`;
    case "add":
      return `added row ${pad(entry.row + 1)}`;
    case "remove":
      return `removed row ${pad(entry.row + 1)}`;
    case "reload":
      return "reloaded sheet";
    case "remap":
      return "matched columns";
  }
}

function Detail({ entry }: { entry: DataEdit }) {
  const line = "flex min-w-0 items-baseline gap-2 font-mono text-meta";
  switch (entry.kind) {
    case "change":
      return (
        <>
          {Object.entries(entry.changes).map(([field, [from, to]]) => (
            // Before and after wrap rather than truncate: the point of the entry
            // is the exact change, and the pane is narrow.
            <p key={field} className="line-clamp-3 font-mono text-meta break-words">
              <span className="text-meta mr-2 uppercase">{field}</span>
              <s className="text-meta tracking-normal decoration-[rgba(246,245,255,0.34)]">{flat(from) || "empty"}</s>
              <FiArrowRight className="text-meta mx-1.5 inline size-2.5 align-[-1px]" aria-hidden />
              <span className="text-label tracking-normal">{flat(to) || "empty"}</span>
            </p>
          ))}
        </>
      );
    case "add":
    case "remove":
      return (
        <p className={cn(line, "text-label tracking-normal")}>
          <span className={cn("min-w-0 truncate", entry.kind === "remove" && "text-meta line-through")}>
            {rowTitle(entry.values, Object.keys(entry.values)) || "empty row"}
          </span>
        </p>
      );
    case "reload":
      return (
        <p className={cn(line, "text-label")}>
          <span className="min-w-0 truncate tracking-normal">{entry.source ?? "sheet"}</span>
          <span className="text-meta shrink-0 uppercase tabular-nums">
            {pad(entry.before.rows.length)} → {pad(entry.count)} rows
          </span>
        </p>
      );
    case "remap":
      return (
        <>
          {Object.entries(entry.map).map(([from, to]) => (
            <p key={from} className={cn(line, "text-label tracking-normal")}>
              <s className="text-meta min-w-0 truncate decoration-[rgba(246,245,255,0.34)]">&lt;{from}&gt;</s>
              <FiArrowRight className="text-meta size-2.5 shrink-0 self-center" aria-hidden />
              <span className="min-w-0 truncate">&lt;{to}&gt;</span>
            </p>
          ))}
        </>
      );
  }
}

const flat = (s: string) => s.replace(/\n/g, " ⏎ ");

/** `14:32` today, `09.18 14:32` otherwise. */
function clock(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return d.toDateString() === new Date().toDateString() ? time : `${p(d.getMonth() + 1)}.${p(d.getDate())} ${time}`;
}

/** Two-tap confirmations stand down after three and a half seconds of nothing. */
function useDisarm(armed: boolean, disarm: () => void) {
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(disarm, 3500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);
}
