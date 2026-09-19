import { NeedsServer } from "@/components/NeedsServer";
import { PageHead, Shell } from "@/components/Shell";
import { MergeWorkbench } from "./MergeWorkbench";

export function PdfMerge() {
  return (
    <Shell width="page">
      <PageHead
        title="pdf merge"
        note="PDFs and images in, one PDF out, in the order you set. The files are uploaded, joined by the server, and deleted within the hour."
      />
      <NeedsServer what="Merging into a PDF">
        <MergeWorkbench />
      </NeedsServer>
    </Shell>
  );
}
