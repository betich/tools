import type { ToolMeta } from "@tools/shared";

export type ClientTool = ToolMeta & {
  /** Bento span on the launchpad grid, at `md` and up. */
  span: string;
  /** Single-key shortcut from the index page. */
  key: string;
  tagline: string;
};

/**
 * Mirrors `/api/tools` so the launchpad renders instantly and still works with
 * the server down; the fetched list wins when it arrives.
 */
export const registry: ClientTool[] = [
  {
    id: "squoosh",
    name: "squoosh",
    blurb: "Compress and convert images without leaving the page. The webp, avif, jpeg and png codecs run as wasm in a worker, so nothing is uploaded anywhere.",
    tagline: "image compression",
    href: "/squoosh",
    index: "01",
    status: "live",
    span: "md:col-span-4 md:row-span-2",
    key: "1",
  },
  {
    id: "mail-merge",
    name: "mail merge",
    blurb: "A base image, text layers, and a spreadsheet. Render one image per row, then take the whole set as a zip.",
    tagline: "bulk image generator",
    href: "/mail-merge",
    index: "02",
    status: "live",
    span: "md:col-span-2 md:row-span-2",
    key: "2",
  },
];

/** Things on the list, not yet on the bench. */
export const backlog = ["favicon set", "og image composer", "clipboard history", "unit scratchpad"];
