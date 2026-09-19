import { framesKeepAlpha } from "./settings";

let answer: Promise<boolean> | null = null;

/**
 * Whether this browser can carry the key's alpha into a VP9 WebM. Asked once.
 *
 * It walks the export's own path: the keyer hands Mediabunny RGBA
 * `VideoFrame`s built from read-back pixels, and Mediabunny splits each
 * one's alpha plane in a worker (`copyTo`) and encodes it as a second VP9
 * stream — dropping it without a word when the frame's format has none. So
 * the probe builds such a frame, half clear and half opaque, and reads it
 * back. Whether VP9 itself encodes is the codec probe's question.
 */
export function probeAlpha(): Promise<boolean> {
  return (answer ??= run().catch(() => false));
}

const W = 4;
const H = 2;

async function run(): Promise<boolean> {
  if (typeof VideoFrame === "undefined" || typeof VideoEncoder === "undefined" || typeof Worker === "undefined")
    return false;
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const opaque = i % W < W / 2;
    data.set([255, 255, 255, opaque ? 255 : 0], i * 4);
  }
  const frame = new VideoFrame(data, { format: "RGBA", codedWidth: W, codedHeight: H, timestamp: 0 });
  try {
    let back: Uint8Array | null = null;
    if (frame.format === "RGBA") {
      back = new Uint8Array(frame.allocationSize());
      await frame.copyTo(back);
    }
    return framesKeepAlpha(frame.format, back);
  } finally {
    frame.close();
  }
}
