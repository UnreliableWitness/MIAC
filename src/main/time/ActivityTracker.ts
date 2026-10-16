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
    this.closeNow();
    this.task = taskId;
    this.openIfCounting();
  }

  setFocused(focused: boolean): void {
    if (focused === this.focused) return;
    this.closeNow();
    this.focused = focused;
    this.openIfCounting();
  }

  suspend(): void {
    this.closeNow();
    this.suspended = true;
  }

  /** Wake or unlock: counting may start again at the next tick. */
  resume(): void {
    this.suspended = false;
  }

  tick(): void {
    if (this.closeIfIdle()) return;
    this.openIfCounting();
  }

  /**
   * Writes the open interval up to where the current idle period began (now when the user is active) and keeps
   * counting from there, so a break that later reaches the limit is trimmed to its start, not to this flush.
   */
  flush(): void {
    if (!this.open || this.closeIfIdle()) return;
    const { taskId, start } = this.open;
    const end = Math.max(start, this.d.now() - this.d.idleSeconds() * 1000);
    this.closeAt(end);
    this.open = { taskId, start: end };
  }

  /** Closes at now, or where idleness began when the limit was crossed since the last tick. */
  private closeNow(): void {
    if (!this.closeIfIdle()) this.closeAt(this.d.now());
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
