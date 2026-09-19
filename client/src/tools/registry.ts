import type { ToolMeta } from "@tools/shared";

export type ClientTool = ToolMeta & {
  /** Single-key shortcut from the index page. */
  key: string;
  tagline: string;
  /** Does nothing without the api; its door dims and its page says so while the server is down. */
  needsServer?: boolean;
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
  {
    id: "pdf-compress",
    name: "pdf compress",
    blurb: "Shrink a PDF by re-encoding its images and trimming what it carries. The work happens on the server.",
    tagline: "pdf compression",
    href: "/pdf-compress",
    index: "03",
    status: "wip",
    key: "3",
    needsServer: true,
  },
  {
    id: "pdf-merge",
    name: "pdf merge",
    blurb: "PDFs and images in, one PDF out, in the order you set. The work happens on the server.",
    tagline: "pdf and image merge",
    href: "/pdf-merge",
    index: "04",
    status: "wip",
    key: "4",
    needsServer: true,
  },
  {
    id: "media2media",
    name: "media2media",
    blurb:
      "Convert images, video and GIFs. Every codec runs in this browser, on your own hardware, so nothing is uploaded and the server can be down.",
    tagline: "image, video and gif conversion",
    href: "/media2media",
    index: "05",
    status: "wip",
    key: "5",
  },
];
