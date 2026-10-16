import { watch, type FSWatcher } from 'node:fs';

const IGNORED = /(^|\/)(node_modules|\.git)(\/|$)/;

/** One recursive watcher per task worktree, shared by every open Docs tab, with changes debounced into one event. */
export class DocsWatcher {
  private readonly entries = new Map<
    string,
    {
      w: FSWatcher;
      count: number;
      pending: Set<string>;
      timer: NodeJS.Timeout | null;
    }
  >();

  constructor(
    private readonly emit: (taskId: string, paths: string[]) => void,
    private readonly debounceMs = 150,
    /** A watcher stopped by an error or stopTask while holders may still count on it. */
    private readonly onStopped: (taskId: string) => void = () => {},
  ) {}

  /** False when the platform cannot watch the folder; the renderer then polls. */
  start(taskId: string, dir: string): boolean {
    const e = this.entries.get(taskId);
    if (e) {
      e.count++;
      return true;
    }
    let w: FSWatcher;
    try {
      w = watch(dir, { recursive: true });
    } catch {
      return false;
    }
    const entry = {
      w,
      count: 1,
      pending: new Set<string>(),
      timer: null as NodeJS.Timeout | null,
    };
    w.on('change', (_ev, name) => {
      if (!name) return;
      const rel = String(name).split('\\').join('/');
      if (IGNORED.test(rel)) return;
      entry.pending.add(rel);
      entry.timer ??= setTimeout(() => {
        entry.timer = null;
        const paths = [...entry.pending];
        entry.pending.clear();
        this.emit(taskId, paths);
      }, this.debounceMs);
    });
    w.on('error', () => this.stopTask(taskId));
    this.entries.set(taskId, entry);
    return true;
  }

  stop(taskId: string): void {
    const e = this.entries.get(taskId);
    if (e && --e.count <= 0) this.close(taskId);
  }

  /** Stops the task's watcher whatever its count, and reports it so the holders fall back to polling. */
  stopTask(taskId: string): void {
    if (this.close(taskId)) this.onStopped(taskId);
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.close(id);
  }

  private close(taskId: string): boolean {
    const e = this.entries.get(taskId);
    if (!e) return false;
    if (e.timer) clearTimeout(e.timer);
    e.w.close();
    this.entries.delete(taskId);
    return true;
  }

  active(taskId: string): boolean {
    return this.entries.has(taskId);
  }
}
