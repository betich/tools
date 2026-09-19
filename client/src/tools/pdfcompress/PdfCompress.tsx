import { NeedsServer } from "@/components/NeedsServer";
import { PageHead, Shell } from "@/components/Shell";
import { CompressWorkbench } from "./CompressWorkbench";

export function PdfCompress() {
  return (
    <Shell width="page">
      <PageHead
        title="pdf compress"
        note="Shrink a PDF by re-encoding its images and trimming what it carries. The file is uploaded, worked on by the server, and deleted within the hour."
      />
      <NeedsServer what="Compressing a PDF">
        <CompressWorkbench />
      </NeedsServer>
    </Shell>
  );
}
