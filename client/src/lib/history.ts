/**
 * Undo/redo for one value, with the gesture rule built in: a drag is one
 * step, however many frames it previews.
 *
 * - `set` records a step and replaces the value (a click, a typed value).
 * - `snapshot` marks the start of a gesture. The value as it is now becomes
 *   the step to go back to — but only once the gesture actually changes
 *   something, so a click that doesn't move leaves no empty step.
 * - `preview` replaces the value with no step of its own (every pointer move).
 *
 * Plain class, no React: the hook wraps it, and keeping the bookkeeping out
 * of state updaters is what keeps StrictMode's double-invoked updaters from
 * recording every step twice.
 */
export class History<T> {
  present: T;
  private past: T[] = [];
  private future: T[] = [];
  /** The value at gesture start, until the gesture's first change records it. */
  private pending: { value: T } | null = null;

  constructor(
    initial: T,
    private readonly limit = 50,
  ) {
    this.present = initial;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  set(next: T): void {
    // A pending snapshot equals the present (a gesture's first change
    // records it), so recording the present covers both cases.
    this.pending = null;
    if (next === this.present) return;
    this.record(this.present);
    this.present = next;
  }

  snapshot(): void {
    this.pending = { value: this.present };
  }

  preview(next: T): void {
    if (next === this.present) return;
    if (this.pending) {
      this.record(this.pending.value);
      this.pending = null;
    }
    this.present = next;
  }

  undo(): boolean {
    this.pending = null;
    const prev = this.past.pop();
    if (prev === undefined) return false;
    this.future.push(this.present);
    this.present = prev;
    return true;
  }

  redo(): boolean {
    this.pending = null;
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.present);
    this.present = next;
    return true;
  }

  /** Replace the value and forget every step — a new file was loaded. */
  reset(value: T): void {
    this.past = [];
    this.future = [];
    this.pending = null;
    this.present = value;
  }

  private record(value: T): void {
    this.past.push(value);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
}
