import { useCallback, useRef, useState } from "react";
import { FiPlus } from "react-icons/fi";
import type { MergeParams } from "@tools/shared";
import { Dropzone } from "@/components/Dropzone";
import { Button, Section, Sections } from "@/components/ui";
import { useToast } from "@/hooks/useToast";
import { pad } from "@/lib/format";
import { FileList } from "./FileList";
import { PageOptions } from "./PageOptions";
import { PagePreview } from "./PagePreview";
import { ACCEPT, mergeParams, useMergeFiles } from "./useMergeFiles";

const FORMATS = "pdf · jpg · png · webp · avif · gif · heic · tiff";

/**
 * Files on the left in the order they will be joined, the selected one's page
 * options under them, and that page drawn on the right. Only mounted while the
 * api answers, since every file starts uploading as soon as it is added.
 *
 * `onMerge` is the seam for #17: it receives the request once every file is
 * on the server. Without it the button stays disabled.
 */
export function MergeWorkbench({ onMerge }: { onMerge?: (params: MergeParams) => void }) {
  const files = useMergeFiles();
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const add = useCallback(
    (list: File[]) => {
      const { added, refused } = files.add(list);
      if (refused.length) toast(refused.length === 1 ? `${refused[0]} is not a pdf or an image` : `${refused.length} files skipped — not pdfs or images`);
      if (added[0]) setSelected((s) => s ?? added[0]!);
    },
    [files, toast],
  );

  const { entries } = files;
  const index = entries.findIndex((e) => e.key === selected);
  const entry = index >= 0 ? entries[index]! : null;
  const params = mergeParams(entries);
  const stopped = entries.filter((e) => e.upload.phase === "failed").length;
  const waiting = entries.filter((e) => e.upload.phase === "queued" || e.upload.phase === "uploading").length;
  const images = entries.filter((e) => e.kind !== "pdf").length;

  const remove = (key: string) => {
    if (key === selected) {
      const at = entries.findIndex((e) => e.key === key);
      setSelected(entries[at + 1]?.key ?? entries[at - 1]?.key ?? null);
    }
    files.remove(key);
  };

  if (entries.length === 0) {
    return (
      <Dropzone
        onFiles={add}
        accept={ACCEPT}
        cta="choose files"
        label="or drop PDFs and images here"
        hint={FORMATS}
        className="min-h-64"
      />
    );
  }

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Sections>
        <Section
          title={`files · ${pad(entries.length)}`}
          aside={
            <Button variant="outline" size="sm" onClick={() => picker.current?.click()}>
              <FiPlus className="size-3" aria-hidden />
              add
            </Button>
          }
        >
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            aria-label="add files"
            onChange={(e) => {
              add(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <FileList
            entries={entries}
            selected={selected}
            onSelect={setSelected}
            onMove={files.move}
            onMoveTo={files.moveTo}
            onRemove={remove}
            onRetry={files.retry}
          />
          <Dropzone onFiles={add} accept={ACCEPT} label="drop more files here" className="py-5" />
        </Section>

        <PageOptions
          entry={entry}
          images={images}
          onChange={(change) => entry && files.setLayout(entry.key, change)}
          onApplyToAll={() => entry && files.layoutToAll(entry.key)}
        />
      </Sections>

      <div className="flex flex-col gap-6 lg:sticky lg:top-20">
        <PagePreview entry={entry} index={index} count={entries.length} />

        <div className="border-hairline-faint flex flex-wrap items-center justify-between gap-4 border-t pt-5">
          <p className="text-meta font-mono text-meta uppercase tabular-nums" aria-live="polite">
            {stopped
              ? `${pad(stopped)} ${stopped === 1 ? "upload" : "uploads"} stopped`
              : waiting
              ? `${pad(waiting)} ${waiting === 1 ? "file" : "files"} still uploading`
              : `${pad(entries.length)} ${entries.length === 1 ? "file" : "files"} · one pdf`}
          </p>
          <Button disabled={!params || !onMerge} onClick={() => params && onMerge?.(params)}>
            merge
          </Button>
        </div>
      </div>
    </div>
  );
}
