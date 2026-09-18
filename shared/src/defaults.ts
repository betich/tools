import type { Fill, MergeDoc, TextLayer } from "./types";

export const INK = "#111827";
export const INDIGO = "#4845DA";

export function uid(prefix = "l"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export const solid = (color: string): Fill => ({ type: "solid", color });

export function newTextLayer(partial: Partial<TextLayer> = {}): TextLayer {
  return {
    id: uid(),
    name: "text",
    kind: "text",
    text: "<name>",
    x: 120,
    y: 120,
    width: 760,
    height: 160,
    rotation: 0,
    align: "center",
    vAlign: "middle",
    opacity: 1,
    visible: true,
    locked: false,
    font: {
      family: "Roboto Mono",
      weight: 700,
      italic: false,
      size: 72,
      lineHeight: 1.2,
      letterSpacing: 0,
      source: { kind: "google", family: "Roboto Mono", variant: "700" },
    },
    fill: solid(INK),
    stroke: null,
    shadow: null,
    autoFit: { enabled: true, minSize: 16 },
    uppercase: false,
    ...partial,
  };
}

export function newDoc(name = "untitled"): MergeDoc {
  return {
    version: 1,
    name,
    canvas: { width: 1000, height: 1000, background: "#FFFFFF" },
    base: null,
    layers: [newTextLayer()],
  };
}
