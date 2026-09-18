import type { ToolMeta } from "@tools/shared";

export type ClientTool = ToolMeta & {
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
    blurb:
      "Compress and convert images without leaving the page. The webp, avif, jpeg and png codecs run as wasm in a worker, so nothing is uploaded anywhere.",
    tagline: "image compression",
    href: "/squoosh",
    index: "01",
    status: "live",
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
    key: "2",
  },
];
