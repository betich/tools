import { useSyncExternalStore } from "react";
import { History } from "@/lib/history";
import { FrameStore, type IncomingFrame } from "./frames";
import { emptyDoc, withFrames, type GifDoc } from "./model";

export type GifState = { doc: GifDoc; canUndo: boolean; canRedo: boolean };

/**
 * The GIF being made: the doc with its undo history, and the pixels behind
 * it. It lives at module level, not in the tab, so switching to the image
 * or video tab and back keeps the work, and so other tabs can send frames
 * in (`gifSession.addFrames(...)`, then navigate to `/media2media/gif`).
 *
 * History follows the shared rule: `snapshot` on gesture start, `preview`
 * for every frame of the gesture, `set` for a discrete edit.
 */
export class GifSession {
  readonly store = new FrameStore();
  private history = new History<GifDoc>(emptyDoc());
  private listeners = new Set<() => void>();
  private state: GifState = this.read();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getState = (): GifState => this.state;

  get doc(): GifDoc {
    return this.history.present;
  }

  /**
   * The one way frames arrive, whatever made them. `"replace"` starts a new
   * animation — history is cleared, since the old frames' pixels are freed —
   * while `"append"` adds them after the ones there as one undo step.
   */
  addFrames(incoming: readonly IncomingFrame[], how: "replace" | "append"): void {
    if (incoming.length === 0) return;
    const frames = this.store.admit(incoming);
    if (how === "replace" || this.doc.frames.length === 0) {
      const next = withFrames(this.doc, frames, "replace");
      this.history.reset(next);
      this.store.release(new Set(frames.map((f) => f.id)));
    } else {
      this.history.set(withFrames(this.doc, frames, "append"));
    }
    this.emit();
  }

  /** Forget everything and free the pixels. Settings (loop, background, fit) stay. */
  clear(): void {
    this.history.reset({ ...this.doc, frames: [], size: null });
    this.store.release();
    this.emit();
  }

  set = (next: GifDoc) => {
    this.history.set(next);
    this.emit();
  };

  preview = (next: GifDoc) => {
    this.history.preview(next);
    this.emit();
  };

  snapshot = () => this.history.snapshot();

  undo = () => {
    if (this.history.undo()) this.emit();
  };

  redo = () => {
    if (this.history.redo()) this.emit();
  };

  /** Shorthand for a partial edit that is its own undo step. */
  update = (patch: Partial<GifDoc>) => this.set({ ...this.doc, ...patch });

  private read(): GifState {
    return { doc: this.history.present, canUndo: this.history.canUndo, canRedo: this.history.canRedo };
  }

  private emit() {
    const next = this.read();
    const s = this.state;
    if (next.doc === s.doc && next.canUndo === s.canUndo && next.canRedo === s.canRedo) return;
    this.state = next;
    for (const l of this.listeners) l();
  }
}

export const gifSession = new GifSession();

export function useGifSession(session: GifSession = gifSession): GifState {
  return useSyncExternalStore(session.subscribe, session.getState);
}
