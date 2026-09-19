import { FiChevronDown, FiChevronUp, FiCopy, FiEye, FiEyeOff, FiTrash2 } from "react-icons/fi";
import type { TextLayer } from "@tools/shared";
import { Empty, IconButton, Section, TextButton } from "@/components/ui";
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
                  "text-label min-w-0 flex-1 cursor-pointer truncate text-left font-mono tracking-normal transition-colors duration-200",
                  layer.id === selectedId ? "text-ink" : "text-label hover:text-indigo",
                  !layer.visible && "opacity-50",
                )}
              >
                <span className="text-meta text-meta mr-2.5 tabular-nums">{pad(layers.length - i)}</span>
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
                <IconButton label="delete" data-tip-pos="top-right" onClick={() => onRemove(layer.id)}>
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
