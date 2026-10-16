import type { Interval } from '../../shared/time';

interface Deps {
  now: () => number;
  idleSeconds: () => number;
  idleLimitSeconds: () => number;
  onInterval: (taskId: string, iv: Interval) => void;
}

const MIN_INTERVAL_MS = 1000;

/**
 * Turns focus, the task on screen and system idle time into intervals per task.
 * Pure logic: the clock and idle values are injected, main wires the timers.
 */
export class ActivityTracker {
  private task: string | null = null;
  private focused = false;
  private suspended = false;
  private open: { taskId: string; start: number } | null = null;

  constructor(private readonly d: Deps) {}

  setTask(taskId: string | null): void {
    if (taskId === this.task) return;
    this.closeAt(this.d.now());
    this.task = taskId;
    this.openIfCounting();
  }

  setFocused(focused: boolean): void {
    if (focused === this.focused) return;
    this.closeAt(this.d.now());
    this.focused = focused;
    this.openIfCounting();
  }

  suspend(): void {
    this.closeAt(this.d.now());
    this.suspended = true;
  }

  tick(): void {
    // A tick after a suspend is the first sign of life: counting may resume.
    this.suspended = false;
    if (this.closeIfIdle()) return;
    this.openIfCounting();
  }

  flush(): void {
    if (!this.open || this.closeIfIdle()) return;
    const now = this.d.now();
    const { taskId } = this.open;
    this.closeAt(now);
    this.open = { taskId, start: now };
  }

  private idle(): boolean {
    return this.d.idleSeconds() >= this.d.idleLimitSeconds();
  }

  /** Ends the open interval where idleness began; true when it did. */
  private closeIfIdle(): boolean {
    if (!this.open || !this.idle()) return false;
    const end = this.d.now() - this.d.idleSeconds() * 1000;
    this.closeAt(Math.max(this.open.start, end));
    return true;
  }

  private openIfCounting(): void {
    if (this.open || this.suspended) return;
    if (this.focused && this.task !== null && !this.idle()) {
      this.open = { taskId: this.task, start: this.d.now() };
    }
  }

  private closeAt(end: number): void {
    const o = this.open;
    if (!o) return;
    this.open = null;
    if (end - o.start >= MIN_INTERVAL_MS)
      this.d.onInterval(o.taskId, [o.start, end]);
  }
}
