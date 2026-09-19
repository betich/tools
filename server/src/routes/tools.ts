import { Elysia } from "elysia";
import type { ToolMeta } from "@tools/shared";

/**
 * The launchpad reads this so a new tool appears on the grid without a client
 * deploy. The client ships the same list as a fallback for offline use.
 */
export const registry: ToolMeta[] = [
  {
    id: "squoosh",
    name: "squoosh",
    blurb: "compress and convert images in the browser. webp, avif, jpeg, png — nothing is uploaded.",
    href: "/squoosh",
    index: "01",
    status: "live",
  },
  {
    id: "mail-merge",
    name: "mail merge",
    blurb: "a base image, a text layer, a spreadsheet. render one card per row and download the set.",
    href: "/mail-merge",
    index: "02",
    status: "live",
  },
  {
    id: "pdf-compress",
    name: "pdf compress",
    blurb: "shrink a pdf by re-encoding its images and trimming what it carries. runs on the server.",
    href: "/pdf-compress",
    index: "03",
    status: "wip",
  },
  {
    id: "pdf-merge",
    name: "pdf merge",
    blurb: "pdfs and images in, one pdf out, in the order you set. runs on the server.",
    href: "/pdf-merge",
    index: "04",
    status: "wip",
  },
  {
    id: "media2media",
    name: "media2media",
    blurb: "convert images, video and gifs in the browser. nothing is uploaded.",
    href: "/media2media",
    index: "05",
    status: "wip",
  },
];

export const tools = new Elysia().get("/api/tools", () => registry);
