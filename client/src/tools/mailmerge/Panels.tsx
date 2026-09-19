import { FiChevronDown, FiChevronUp, FiCopy, FiEye, FiEyeOff, FiPlus, FiTrash2 } from "react-icons/fi";
import type { TextLayer } from "@tools/shared";
import { Button, IconButton, Section } from "@/components/ui";
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
  const addText = (
    <Button variant="outline" size="sm" onClick={onAdd}>
      <FiPlus className="size-3" aria-hidden />
      add text
    </Button>
  );

  return (
    <Section title={layers.length ? `layers · ${pad(layers.length)}` : "layers"} aside={layers.length ? addText : undefined}>
      {layers.length === 0 ? (
        <div className="border-wash flex flex-col items-start gap-3 rounded-card border border-dashed px-4 py-4">
          <p className="text-prose font-sans text-body normal-case">A text layer is where a column lands on the poster.</p>
          {addText}
        </div>
      ) : (
        <ul className="-mx-1.5 flex flex-col gap-0.5">
          {/* Topmost layer paints last, so the list reads top-down like the stack. */}
          {[...layers].reverse().map((layer, i) => {
            const here = layer.id === selectedId;
            const n = layers.length - i;
            return (
              <li key={layer.id} className="group relative flex items-center">
                <IconButton
                  label={layer.visible ? "hide" : "show"}
                  onClick={() => onToggle(layer.id, !layer.visible)}
                  className={cn("absolute left-2 z-10", !layer.visible && "text-ink")}
                >
                  {layer.visible ? <FiEye className="size-3.5" /> : <FiEyeOff className="size-3.5" />}
                </IconButton>

                <button
                  type="button"
                  onClick={() => onSelect(layer.id)}
                  aria-current={here || undefined}
                  className={cn(
                    "flex min-w-0 flex-1 cursor-pointer items-baseline gap-2.5 rounded-xs py-2 pr-2.5 pl-8 text-left transition-colors duration-200",
                    here ? "bg-surface-high" : "hover:bg-hover-wash",
                    // Room for the controls only where they show.
                    "group-hover:pr-28 group-focus-within:pr-28 [@media(pointer:coarse)]:pr-28",
                    here && "pr-28",
                  )}
                >
                  <span className={cn("shrink-0 font-mono text-micro tabular-nums", here ? "text-indigo" : "text-meta")}>{pad(n)}</span>
                  <span
                    className={cn(
                      "min-w-0 truncate font-mono text-small tracking-normal transition-colors duration-200",
                      here ? "text-ink" : "text-label group-hover:text-indigo",
                      !layer.visible && "opacity-50",
                    )}
                  >
                    {layer.text.trim() ? layer.text.replace(/\n/g, " ") : layer.name}
                  </span>
                </button>

                <span
                  className={cn(
                    "absolute right-2 flex items-center gap-2.5 transition-opacity duration-200",
                    here ? "opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100",
                  )}
                >
                  <IconButton label="move up" onClick={() => onReorder(layer.id, 1)} disabled={n === layers.length}>
                    <FiChevronUp className="size-3.5" />
                  </IconButton>
                  <IconButton label="move down" onClick={() => onReorder(layer.id, -1)} disabled={n === 1}>
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
            );
          })}
        </ul>
      )}
    </Section>
  );
}
