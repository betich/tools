import gifskiEncode from "gifski-wasm";
import { repeatCount } from "../model";
import { setGifRepeat } from "./loop";
import type { Encoder } from "./types";

/**
 * GIF through gifski (AGPL-3.0, like this repo). Per-frame delays and
 * transparency; the wasm build takes `quality` only, which also sets how
 * lossy it is. Its `repeat` writes "forever" for anything but 0 (no loop
 * block — play once), so a finite count is patched in afterwards.
 */
export const gifski: Encoder = async (anim, options) => {
  let { frames, delays } = anim;
  // gifski wants two frames at least; a still is its one frame shown twice.
  if (frames.length === 1) {
    frames = [frames[0]!, frames[0]!];
    delays = [delays[0]!, delays[0]!];
  }
  const repeat = repeatCount(anim.plays);
  const gif = await gifskiEncode({
    frames,
    width: anim.width,
    height: anim.height,
    frameDurations: delays,
    quality: options.quality,
    repeat: repeat === null ? 0 : undefined,
  });
  return repeat !== null && repeat > 0 ? setGifRepeat(gif, repeat) : gif;
};
