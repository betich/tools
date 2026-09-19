import type { MergeOutput } from "@tools/shared";
import { Field, Input, Section, Toggle } from "@/components/ui";

/**
 * What the joined PDF says about itself: its title, a bookmark for each file,
 * page labels, and whether images other than JPEGs
 * are recompressed. The title is left empty to mean "the default", which the
 * placeholder spells out, so it follows the first file when the order changes.
 */
export function OutputOptions({
  output,
  fallbackTitle,
  onChange,
}: {
  output: MergeOutput;
  /** The first file's name without its extension — what an empty title becomes. */
  fallbackTitle: string;
  onChange: (change: Partial<MergeOutput>) => void;
}) {
  const title = output.title ?? "";
  const effective = title.trim() || fallbackTitle;
  return (
    <Section title="output">
      <Field label="title" hint={`saved as ${effective}.pdf`} changed={title.trim() !== ""}>
        <Input
          value={title}
          placeholder={fallbackTitle}
          spellCheck={false}
          maxLength={200}
          onChange={(e) => onChange({ title: e.target.value === "" ? null : e.target.value })}
        />
      </Field>

      <div className="flex flex-col gap-3">
        <Toggle checked={output.bookmarks} onChange={(bookmarks) => onChange({ bookmarks })} label="a bookmark per file" />
        <Toggle checked={output.pageLabels} onChange={(pageLabels) => onChange({ pageLabels })} label="page labels" />
        <Toggle
          checked={output.compressImages}
          onChange={(compressImages) => onChange({ compressImages })}
          label="compress images"
        />
      </div>

      <p className="text-prose font-sans text-body normal-case">
        JPEGs go in byte for byte.{" "}
        {output.compressImages
          ? "Other images are recompressed, which makes the file smaller and loses a little detail."
          : "Other images are stored without loss, which can make the file large."}
        {output.bookmarks ? " A PDF's own bookmarks nest under its file's." : ""}
      </p>
    </Section>
  );
}
