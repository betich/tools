import { ClipTimeline, type ClipTimelineProps } from "./ClipTimeline";
import { FramesTimeline, type FramesTimelineProps } from "./FramesTimeline";
import type { TimelineFrame } from "./model";

export type TimelineProps<F extends TimelineFrame = TimelineFrame> = FramesTimelineProps<F> | ClipTimelineProps;

/**
 * The shared timeline for the GIF and video tabs: one transport, one ruler,
 * one playhead and one set of keys, over either a strip of frames
 * (`mode="frames"`) or a continuous clip with trim handles (`mode="clip"`).
 *
 * It is fully controlled. The tab owns the frames or trim (through
 * `useHistory`, so drags are one undo step), the playhead (through
 * `usePlayback`, or its own <video> clock) and the pictures (through a
 * `ThumbnailProvider`, off the main thread). The timeline owns only what is
 * on screen: zoom, scroll, selection and the drag in progress.
 *
 * Keys, on the window unless `hotkeys={false}`: space play/pause, ←/→ step a
 * frame, delete removes the selected frames, escape clears the selection,
 * I/O set the trim (clip), cmd/ctrl-z undo, shift-cmd-z or ctrl-y redo.
 */
export function Timeline<F extends TimelineFrame>(props: TimelineProps<F>) {
  return props.mode === "frames" ? <FramesTimeline {...props} /> : <ClipTimeline {...props} />;
}
