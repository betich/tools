/// <reference lib="webworker" />
/**
 * Fixture thumbnails for the timeline demo, drawn off the main thread the
 * way the real tabs will: a grey field whose tone walks with the frame or
 * the time, with the frame number or timestamp printed on it.
 */
export type FixtureRequest = { id: number; label: string; tone: number; width: number; height: number };
export type FixtureResponse = { id: number; bitmap: ImageBitmap };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (e: MessageEvent<FixtureRequest>) => {
  const { id, label, tone, width, height } = e.data;
  const canvas = new OffscreenCanvas(width * 2, height * 2);
  const ctx = canvas.getContext("2d")!;
  const l = 18 + Math.round(tone * 52);
  const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  g.addColorStop(0, `hsl(242 20% ${l}%)`);
  g.addColorStop(1, `hsl(242 12% ${Math.max(6, l - 14)}%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.beginPath();
  ctx.arc(canvas.width * (0.2 + tone * 0.6), canvas.height / 2, canvas.height * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `${Math.round(canvas.height * 0.28)}px ui-monospace, monospace`;
  ctx.textBaseline = "top";
  ctx.fillText(label, 8, 8);
  const bitmap = canvas.transferToImageBitmap();
  scope.postMessage({ id, bitmap } satisfies FixtureResponse, [bitmap]);
};
