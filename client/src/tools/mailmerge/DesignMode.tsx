import { TextButton } from "@/components/ui";
import { pad } from "@/lib/format";
import { OwnMark } from "./OwnMark";

/**
 * What an edit on the stage changes: the main design, which every row follows,
 * or this row's own layout. Sits under the poster, where the eye already is
 * when it decides to nudge something.
 */
export function DesignMode({
  rowMode,
  index,
  hasRows,
  own,
  onChange,
}: {
  rowMode: boolean;
  index: number;
  hasRows: boolean;
  /** The current row already has a layout of its own. */
  own: boolean;
  onChange: (rowMode: boolean) => void;
}) {
  return (
    <div role="group" aria-label="what edits change" className="flex min-w-0 items-center gap-4">
      <TextButton active={!rowMode} aria-pressed={!rowMode} onClick={() => onChange(false)}>
        main design
      </TextButton>
      <TextButton
        active={rowMode}
        aria-pressed={rowMode}
        disabled={!hasRows}
        onClick={() => onChange(true)}
        className="tooltip flex items-center gap-1.5 whitespace-nowrap"
        data-tip={hasRows ? "move and size things for this row only" : "load a sheet to lay out one row"}
      >
        {own ? <OwnMark /> : null}
        row {pad(index + 1)} only
      </TextButton>
    </div>
  );
}
