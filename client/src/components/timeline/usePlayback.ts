import { useCallback, useEffect, useRef, useState } from "react";
import { advance, clamp } from "./model";

export type Playback = {
  time: number;
  setTime: (ms: number) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  loop: boolean;
  setLoop: (loop: boolean) => void;
};

/**
 * A wall-clock playhead for the timeline: requestAnimationFrame advances
 * `time` through `range` (the whole source by default, the trim in clip
 * mode) while playing. Scrubbing may go anywhere in [0, duration]; pressing
 * play from outside the range starts again at its start.
 *
 * The GIF tab uses it as is. The video tab can use it too, or drive the
 * timeline from its <video> element's own clock — the timeline only needs
 * these six values.
 */
export function usePlayback({
  duration,
  range,
  initialLoop = true,
}: {
  duration: number;
  range?: { start: number; end: number };
  initialLoop?: boolean;
}): Playback {
  const start = range?.start ?? 0;
  const end = range?.end ?? duration;
  const [time, setTimeState] = useState(start);
  const [playing, setPlayingState] = useState(false);
  const [loop, setLoop] = useState(initialLoop);

  // The rAF loop reads these rather than re-subscribing on every tick.
  const live = useRef({ time, start, end, duration, loop });
  live.current = { time, start, end, duration, loop };

  const setTime = useCallback((ms: number) => {
    const t = clamp(ms, 0, Math.max(0, live.current.duration));
    live.current.time = t;
    setTimeState(t);
  }, []);

  const setPlaying = useCallback((next: boolean) => {
    if (next) {
      const { time: t, start: s, end: e } = live.current;
      if (t >= e || t < s) {
        live.current.time = s;
        setTimeState(s);
      }
    }
    setPlayingState(next);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const { time: t, start: s, end: e, loop: l } = live.current;
      const next = advance(t, dt, s, e, l);
      live.current.time = next.time;
      setTimeState(next.time);
      if (next.ended) {
        setPlayingState(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // A source that got shorter (frames deleted) takes the playhead with it.
  useEffect(() => {
    setTimeState((t) => clamp(t, 0, Math.max(0, duration)));
  }, [duration]);

  return { time, setTime, playing, setPlaying, loop, setLoop };
}
