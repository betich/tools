import { useCallback, useEffect, useRef, useState } from "react";
import type { Playback } from "@/components/timeline";
import type { Trim } from "@/components/timeline/model";

/**
 * The timeline's playhead, driven by a <video> element's own clock, so the
 * preview plays with sound and at the chosen speed. Plays inside the trim;
 * at the out point it loops back to the in point, or stops.
 *
 * Same six values as `usePlayback`, which the tab falls back to when the
 * browser can't play the file itself.
 */
export function useVideoClock(
  video: HTMLVideoElement | null,
  { duration, trim, speed, muted }: { duration: number; trim: Trim; speed: number; muted: boolean },
): Playback {
  const [time, setTimeState] = useState(trim.in);
  const [playing, setPlayingState] = useState(false);
  const [loop, setLoop] = useState(true);

  const live = useRef({ trim, loop, duration });
  live.current = { trim, loop, duration };

  useEffect(() => {
    if (!video) return;
    video.playbackRate = speed;
    // The export's sound rises with the speed, so the preview's does too.
    video.preservesPitch = false;
  }, [video, speed]);

  useEffect(() => {
    if (video) video.muted = muted;
  }, [video, muted]);

  const setTime = useCallback(
    (ms: number) => {
      const t = Math.min(Math.max(0, ms), live.current.duration);
      setTimeState(t);
      if (video) video.currentTime = t / 1000;
    },
    [video],
  );

  const setPlaying = useCallback(
    (next: boolean) => {
      if (!video) return;
      if (!next) {
        video.pause();
        setPlayingState(false);
        return;
      }
      const { trim: tr } = live.current;
      const t = video.currentTime * 1000;
      if (t < tr.in || t >= tr.out - 1) video.currentTime = tr.in / 1000;
      video.play().then(
        () => setPlayingState(true),
        () => setPlayingState(false),
      );
    },
    [video],
  );

  useEffect(() => {
    if (!video) return;
    const onPause = () => setPlayingState(false);
    video.addEventListener("pause", onPause);
    return () => video.removeEventListener("pause", onPause);
  }, [video]);

  useEffect(() => {
    if (!video || !playing) return;
    let raf = 0;
    const tick = () => {
      const { trim: tr, loop: l } = live.current;
      const t = video.currentTime * 1000;
      if (t >= tr.out || video.ended) {
        if (l) {
          video.currentTime = tr.in / 1000;
          if (video.paused) void video.play();
          setTimeState(tr.in);
        } else {
          video.pause();
          setTimeState(tr.out);
          return;
        }
      } else {
        setTimeState(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video, playing]);

  return { time, setTime, playing, setPlaying, loop, setLoop };
}
