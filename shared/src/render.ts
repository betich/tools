import { resolve } from "./merge";
import type { Fill, Fit, MergeDoc, MergeRow, TextLayer } from "./types";

/**
 * The slice of Canvas2D this renderer touches. Typed structurally so the exact
 * same code runs against the browser's CanvasRenderingContext2D and the
 * server's @napi-rs/canvas context — the preview and the exported file are
 * produced by one implementation, so they cannot drift.
 */
export interface Ctx2D {
  canvas: { width: number; height: number };
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(img: never, dx: number, dy: number, dw: number, dh: number): void;
  measureText(text: string): { width: number; fontBoundingBoxAscent?: number; fontBoundingBoxDescent?: number };
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: string;
  globalAlpha: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

export interface RenderImage {
  width: number;
  height: number;
}

export type RenderOptions = {
  /** Decoded base image, if the doc has one. */
  base?: RenderImage | null;
  /** Row to substitute into `<field>` tokens; null renders the raw template. */
  row?: MergeRow | null;
  /** Skip clearing — useful when compositing onto an existing surface. */
  skipClear?: boolean;
};

const TRANSPARENT = "transparent";

export function renderDoc(ctx: Ctx2D, doc: MergeDoc, opts: RenderOptions = {}): void {
  const { width, height, background } = doc.canvas;
  const row = opts.row ?? null;

  if (!opts.skipClear) ctx.clearRect(0, 0, width, height);
  if (background && background !== TRANSPARENT) {
    ctx.save();
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  if (doc.base && opts.base) drawBase(ctx, opts.base, doc.base.fit, width, height);

  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    drawTextLayer(ctx, layer, row);
  }
}

function drawBase(ctx: Ctx2D, img: RenderImage, fit: Fit, cw: number, ch: number): void {
  const r = fitRect(img.width, img.height, cw, ch, fit);
  ctx.save();
  ctx.drawImage(img as never, r.x, r.y, r.w, r.h);
  ctx.restore();
}

export function fitRect(iw: number, ih: number, cw: number, ch: number, fit: Fit) {
  if (fit === "stretch" || iw <= 0 || ih <= 0) return { x: 0, y: 0, w: cw, h: ch };
  const scale = fit === "cover" ? Math.max(cw / iw, ch / ih) : Math.min(cw / iw, ch / ih);
  const w = iw * scale;
  const h = ih * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

// ───────────────────────────────────────────────────────── inline colour runs

/**
 * `[[#FFE19B]]NANO[[/]]` paints that span in its own colour while inheriting
 * every other property of the layer. It exists because one line of type often
 * carries two colours — "Intania 90 **NANO**" — and splitting that into two
 * layers would break centring the moment the text changes length.
 */
const SPAN = /\[\[(#[0-9a-fA-F]{3,8}|\/)\]\]/g;

type Token = { text: string; color?: string; newline?: boolean };

export function stripSpans(text: string): string {
  return text.replace(SPAN, "");
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const stack: string[] = [];
  let cursor = 0;

  const emit = (chunk: string) => {
    if (!chunk) return;
    const color = stack.at(-1);
    for (const part of chunk.split(/(\n|[ \t]+)/)) {
      if (part === "") continue;
      if (part === "\n") tokens.push({ text: "", newline: true });
      else tokens.push({ text: part, color });
    }
  };

  for (const match of text.matchAll(SPAN)) {
    emit(text.slice(cursor, match.index));
    if (match[1] === "/") stack.pop();
    else stack.push(match[1]!);
    cursor = match.index + match[0].length;
  }
  emit(text.slice(cursor));
  return tokens;
}

// ---------------------------------------------------------------- text layers

function drawTextLayer(ctx: Ctx2D, layer: TextLayer, row: MergeRow | null): void {
  let text = resolve(layer.text, row);
  if (layer.uppercase) text = upper(text);
  if (!stripSpans(text).trim()) return;

  const tokens = tokenize(text);
  const { font } = layer;
  const size = fitSize(ctx, layer, tokens);
  const lineH = size * font.lineHeight;
  const spacing = font.letterSpacing * (size / font.size);

  ctx.save();
  ctx.globalAlpha = clamp(layer.opacity, 0, 1);
  ctx.textAlign = "left";
  setFont(ctx, layer, size);
  const middle = middleShift(ctx, size);

  const lines = wrap(ctx, tokens, layer.width, spacing);
  const blockH = lines.length * lineH;

  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  if (layer.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  const top =
    layer.vAlign === "top"
      ? layer.y
      : layer.vAlign === "bottom"
        ? layer.y + layer.height - blockH
        : layer.y + (layer.height - blockH) / 2;

  const paint = resolveFill(ctx, layer.fill, layer.x, top, layer.width, blockH);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const w = measureLine(ctx, line, spacing);
    const x =
      layer.align === "left" ? layer.x : layer.align === "right" ? layer.x + layer.width - w : layer.x + (layer.width - w) / 2;
    const y = top + i * lineH + lineH / 2 + middle;

    if (layer.shadow) {
      ctx.shadowColor = layer.shadow.color;
      ctx.shadowBlur = layer.shadow.blur;
      ctx.shadowOffsetX = layer.shadow.offsetX;
      ctx.shadowOffsetY = layer.shadow.offsetY;
    }

    if (layer.stroke && layer.stroke.width > 0) {
      ctx.lineJoin = "round";
      ctx.lineWidth = layer.stroke.width * 2; // strokes straddle the path; double for a true outer edge
      ctx.strokeStyle = layer.stroke.color;
      drawLine(ctx, line, x, y, spacing, "stroke", null);
    }

    clearShadow(ctx);
    drawLine(ctx, line, x, y, spacing, "fill", paint);
  }

  ctx.restore();
}

/**
 * How far below a line's centre its alphabetic baseline sits. This is the
 * browser's `textBaseline = "middle"`, computed by hand: Chrome takes the
 * middle of the font's ascent/descent scaled to one em, Skia the middle of the
 * raw ascent/descent — identical for most Latin faces, but a Thai face with
 * tall metrics (IBM Plex Sans Thai: 1.12 / 0.53 em) lands ~10% of the size
 * lower on the server. Both engines report the same font box, so the maths is
 * done once, here, from those numbers. Rounded as Chrome rounds them.
 */
function middleShift(ctx: Ctx2D, size: number): number {
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText("Hg");
  const ascent = Math.round(m.fontBoundingBoxAscent ?? 0);
  const descent = Math.round(m.fontBoundingBoxDescent ?? 0);
  if (ascent + descent <= 0) {
    ctx.textBaseline = "middle";
    return 0;
  }
  return (size * (ascent - descent)) / (2 * (ascent + descent));
}

function setFont(ctx: Ctx2D, layer: TextLayer, size: number): void {
  const { font } = layer;
  const style = font.italic ? "italic " : "";
  ctx.font = `${style}${font.weight} ${size}px ${familyStack(layer)}`;
}

function familyStack(layer: TextLayer): string {
  const names = [layer.font.family, ...(layer.font.fallbacks ?? []).map((f) => f.family), "Roboto Mono", "monospace"];
  const seen = new Set<string>();
  return names
    .filter((n) => n && !seen.has(n) && seen.add(n))
    .map((f) => (/[^a-zA-Z0-9-]/.test(f) ? `"${f}"` : f))
    .join(", ");
}

/** Shrink type until the wrapped block fits the layer box. */
function fitSize(ctx: Ctx2D, layer: TextLayer, tokens: Token[]): number {
  const base = layer.font.size;
  if (!layer.autoFit.enabled) return base;
  const min = Math.max(1, layer.autoFit.minSize);

  let size = base;
  while (size > min) {
    setFont(ctx, layer, size);
    const spacing = layer.font.letterSpacing * (size / base);
    const lines = wrap(ctx, tokens, layer.width, spacing);
    const fitsHeight = lines.length * size * layer.font.lineHeight <= layer.height;
    const fitsWidth = lines.every((l) => measureLine(ctx, l, spacing) <= layer.width + 0.5);
    if (fitsHeight && fitsWidth) return size;
    size -= size > 40 ? 2 : 1;
  }
  return min;
}

function wrap(ctx: Ctx2D, tokens: Token[], maxWidth: number, spacing: number): Token[][] {
  const lines: Token[][] = [];
  let line: Token[] = [];

  const push = () => {
    while (line.length > 0 && !line[line.length - 1]!.text.trim()) line.pop();
    lines.push(line);
    line = [];
  };

  for (const token of tokens) {
    if (token.newline) {
      push();
      continue;
    }
    const next = [...line, token];
    if (line.length > 0 && measureLine(ctx, next, spacing) > maxWidth) {
      push();
      if (token.text.trim()) line.push(token);
    } else {
      line.push(token);
    }
  }
  push();
  return lines;
}

function measureLine(ctx: Ctx2D, line: Token[], spacing: number): number {
  let width = 0;
  for (let i = 0; i < line.length; i++) {
    width += measure(ctx, line[i]!.text, spacing);
    if (spacing && i < line.length - 1) width += spacing;
  }
  return width;
}

function measure(ctx: Ctx2D, text: string, spacing: number): number {
  const w = ctx.measureText(text).width;
  return spacing ? w + spacing * Math.max(0, [...text].length - 1) : w;
}

function drawLine(ctx: Ctx2D, line: Token[], x: number, y: number, spacing: number, mode: "fill" | "stroke", paint: unknown): void {
  let cursor = x;
  for (let i = 0; i < line.length; i++) {
    const token = line[i]!;
    if (mode === "fill") ctx.fillStyle = token.color ?? paint;
    drawTracked(ctx, token.text, cursor, y, spacing, mode);
    cursor += measure(ctx, token.text, spacing);
    if (spacing && i < line.length - 1) cursor += spacing;
  }
}

/**
 * Letter spacing is applied by hand rather than via `ctx.letterSpacing`, which
 * is unevenly supported — doing the arithmetic here keeps the browser preview
 * and the server render pixel-identical.
 */
function drawTracked(ctx: Ctx2D, text: string, x: number, y: number, spacing: number, mode: "fill" | "stroke"): void {
  if (!spacing) {
    if (mode === "fill") ctx.fillText(text, x, y);
    else ctx.strokeText(text, x, y);
    return;
  }
  let cursor = x;
  for (const ch of text) {
    if (mode === "fill") ctx.fillText(ch, cursor, y);
    else ctx.strokeText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
}

function resolveFill(ctx: Ctx2D, fill: Fill, x: number, y: number, w: number, h: number): unknown {
  if (fill.type === "solid") return fill.color;
  const rad = ((fill.angle - 90) * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const half = (Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))) / 2;
  const g = ctx.createLinearGradient(cx - Math.cos(rad) * half, cy - Math.sin(rad) * half, cx + Math.cos(rad) * half, cy + Math.sin(rad) * half);
  const stops = [...fill.stops].sort((a, b) => a.offset - b.offset);
  if (stops.length === 0) return "#000000";
  for (const s of stops) g.addColorStop(clamp(s.offset, 0, 1), s.color);
  return g;
}

/** Uppercasing must not eat the span markers. */
function upper(text: string): string {
  return text.replace(/(\[\[[^\]]*\]\])|([^[]+)/g, (_, marker: string | undefined, body: string | undefined) =>
    marker ?? (body ?? "").toUpperCase(),
  );
}

function clearShadow(ctx: Ctx2D): void {
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
