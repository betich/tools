import { FiChevronDown, FiChevronUp, FiCopy, FiEye, FiEyeOff, FiTrash2 } from "react-icons/fi";
import type { MergeData, TextLayer } from "@tools/shared";
import { Dropzone } from "@/components/Dropzone";
import { Chip, Empty, IconButton, Section, TextButton, Toggle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { pad } from "@/lib/format";

export function LayersPanel({
  layers,
  selectedId,
  onSelect,
  onAdd,
  onToggle,
  onDuplicate,
  onRemove,
  onReorder,
}: {
  layers: TextLayer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onToggle: (id: string, visible: boolean) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (id: string, direction: -1 | 1) => void;
}) {
  return (
    <Section title="layers" aside={<TextButton onClick={onAdd}>add text</TextButton>}>
      {layers.length === 0 ? (
        <Empty>no layers yet</Empty>
      ) : (
        <ul className="flex flex-col">
          {/* Topmost layer paints last, so the list reads top-down like the stack. */}
          {[...layers].reverse().map((layer, i) => (
            <li
              key={layer.id}
              className={cn(
                "border-wash flex items-center gap-2 border-b py-2 last:border-b-0",
                layer.id === selectedId && "text-indigo",
              )}
            >
              <IconButton
                label={layer.visible ? "hide" : "show"}
                onClick={() => onToggle(layer.id, !layer.visible)}
                className="shrink-0"
              >
                {layer.visible ? <FiEye className="size-3.5" /> : <FiEyeOff className="size-3.5" />}
              </IconButton>

              <button
                type="button"
                onClick={() => onSelect(layer.id)}
                className={cn(
                  "min-w-0 flex-1 cursor-pointer truncate text-left font-mono text-label tracking-normal transition-colors duration-200",
                  layer.id === selectedId ? "text-ink" : "text-label hover:text-indigo",
                  !layer.visible && "opacity-50",
                )}
              >
                <span className="text-meta mr-2.5 text-meta tabular-nums">{pad(layers.length - i)}</span>
                {layer.text.trim() ? layer.text.replace(/\n/g, " ").slice(0, 28) : layer.name}
              </button>

              <span className="flex shrink-0 items-center gap-2">
                <IconButton label="move up" onClick={() => onReorder(layer.id, 1)}>
                  <FiChevronUp className="size-3.5" />
                </IconButton>
                <IconButton label="move down" onClick={() => onReorder(layer.id, -1)}>
                  <FiChevronDown className="size-3.5" />
                </IconButton>
                <IconButton label="duplicate" onClick={() => onDuplicate(layer.id)}>
                  <FiCopy className="size-3.5" />
                </IconButton>
                <IconButton label="delete" onClick={() => onRemove(layer.id)}>
                  <FiTrash2 className="size-3.5" />
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function DataPanel({
  data,
  usedFields,
  rowIndex,
  showValues,
  onFile,
  onSample,
  onClear,
  onStep,
  onShowValues,
}: {
  data: MergeData;
  usedFields: string[];
  rowIndex: number;
  showValues: boolean;
  onFile: (file: File) => void;
  onSample: () => void;
  onClear: () => void;
  onStep: (direction: -1 | 1) => void;
  onShowValues: (v: boolean) => void;
}) {
  const missing = usedFields.filter((f) => !data.fields.some((d) => d.toLowerCase() === f.toLowerCase()));

  return (
    <Section
      title="data"
      aside={
        data.rows.length > 0 ? (
          <TextButton onClick={onClear}>clear</TextButton>
        ) : (
          <TextButton onClick={onSample}>use sample</TextButton>
        )
      }
    >
      {data.rows.length === 0 ? (
        <Dropzone
          onFiles={(files) => files[0] && onFile(files[0])}
          accept=".csv,.tsv,.xlsx,.xls,text/csv"
          multiple={false}
          label="drop a csv or xlsx"
          hint="first row is the header"
          className="py-6"
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {data.fields.map((field) => (
              <Chip key={field} className={cn(!usedFields.some((u) => u.toLowerCase() === field.toLowerCase()) && "opacity-50")}>
                &lt;{field}&gt;
              </Chip>
            ))}
          </div>

          {missing.length > 0 ? (
            <p className="text-meta font-mono text-meta uppercase">
              not in this sheet: {missing.map((f) => `<${f}>`).join(" ")}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-4">
            <Toggle checked={showValues} onChange={onShowValues} label="show values" />
            <div className="flex items-center gap-3">
              <TextButton onClick={() => onStep(-1)} aria-label="previous row">
                ←
              </TextButton>
              <span className="text-ink font-mono text-label tabular-nums">
                {pad(Math.min(rowIndex, data.rows.length - 1) + 1)} / {pad(data.rows.length)}
              </span>
              <TextButton onClick={() => onStep(1)} aria-label="next row">
                →
              </TextButton>
            </div>
          </div>

          <ul className="flex flex-col gap-1">
            {data.fields.map((field) => (
              <li key={field} className="flex items-baseline">
                <span className="text-meta font-mono text-meta uppercase">{field}</span>
                <span className="leader" aria-hidden />
                <span className="text-ink max-w-[55%] truncate font-mono text-label tracking-normal">
                  {data.rows[Math.min(rowIndex, data.rows.length - 1)]?.[field] || "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
