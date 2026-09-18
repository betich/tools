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
];

export const tools = new Elysia().get("/api/tools", () => registry);
