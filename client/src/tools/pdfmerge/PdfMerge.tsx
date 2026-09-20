import { NeedsServer } from "@/components/NeedsServer";
import { Shell } from "@/components/Shell";
import { MergeWorkbench } from "./MergeWorkbench";

/**
 * A room, like the merge editor: from a laptop up it takes exactly the
 * viewport between the top bar and the rail, and the page never scrolls. The
 * title and what the tool does sit in the toolbar across the top, so every
 * panel underneath is on screen at once.
 */
export function PdfMerge() {
  return (
    <Shell width="workspace">
      <header className="border-hairline-faint mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-4 lg:mb-0 lg:shrink-0 lg:px-6 lg:py-2.5 xl:px-7">
        <h1 className="text-ink text-title shrink-0 font-mono font-bold uppercase">pdf merge</h1>
        <span className="text-meta text-small hidden font-mono sm:inline" aria-hidden>
          /
        </span>
        <p className="text-label text-body min-w-0 font-sans normal-case">
          PDFs and images in, one PDF out, in the order you set. Files are uploaded, joined by the server, and deleted
          within the hour.
        </p>
      </header>

      <NeedsServer what="Merging into a PDF" className="mx-5 mb-10 lg:mx-6 lg:my-6 xl:mx-7">
        <MergeWorkbench />
      </NeedsServer>
    </Shell>
  );
}
