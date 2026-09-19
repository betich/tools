import type { PdfAnalysis } from "@tools/shared";
import { Button, Section, Sections } from "@/components/ui";

/**
 * The settings column and the run action — the seam for #9. It gets the
 * analysis so presets can be judged against it, and `busy` while a task is
 * queued or running for this job (the queue takes one at a time per caller).
 * Until #9 wires `onRun`, RUN stays disabled and says why.
 */
export function RunPanel({
  analysis,
  busy,
  onRun,
}: {
  analysis: PdfAnalysis | null;
  busy: boolean;
  onRun?: () => void;
}) {
  return (
    <Sections>
      <Section title="settings">
        <p className="text-meta text-body font-sans normal-case">
          Presets, image quality and the passes to run will sit here. For now the file is only analysed.
        </p>
      </Section>
      <div className="flex flex-col gap-3">
        <Button disabled={!analysis || busy || !onRun} onClick={onRun} className="w-full">
          run
        </Button>
      </div>
    </Sections>
  );
}
