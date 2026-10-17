// src/main/review/GitDirWatcher.ts
import { existsSync, type FSWatcher, watch } from 'node:fs';
import path from 'node:path';

/** Files in a worktree's git dir that change on commit, amend, reset, checkout and staging. */
const WATCHED = new Set(['HEAD', 'index', 'ORIG_HEAD']);

type Entry = {
  watchers: FSWatcher[];
  count: number;
  timer: NodeJS.Timeout | null;
};

/**
 * Watches the git dir of a worktree (DocsWatcher ignores `.git`), reference-counted per target like
 * DocsWatcher, and reports changes debounced into one call per burst.
 */
export class GitDirWatcher {
  private readonly entries = new Map<string, Entry>();
  private readonly starting = new Map<string, Promise<boolean>>();

  constructor(
    private readonly gitDir: (worktree: string) => Promise<string>,
    private readonly emit: (target: string) => void,
    private readonly debounceMs = 300,
  ) {}

  async start(target: string, worktree: string): Promise<boolean> {
    const e = this.entries.get(target);
    if (e) {
      e.count++;
      return true;
    }
    const pending = this.starting.get(target);
    if (pending) {
      const ok = await pending;
      const now = this.entries.get(target);
      if (ok && now) now.count++;
      return ok && Boolean(now);
    }
    const p = this.open(target, worktree);
    this.starting.set(target, p);
    try {
      return await p;
    } finally {
      this.starting.delete(target);
    }
  }

  private async open(target: string, worktree: string): Promise<boolean> {
    let dir: string;
    try {
      dir = await this.gitDir(worktree);
    } catch {
      return false;
    }
    const entry: Entry = { watchers: [], count: 1, timer: null };
    const fire = () => {
      entry.timer ??= setTimeout(() => {
        entry.timer = null;
        this.emit(target);
      }, this.debounceMs);
    };
    const add = (folder: string, names: Set<string>) => {
      const w = watch(folder);
      w.on('change', (_ev, name) => {
        if (name && names.has(String(name))) fire();
      });
      w.on('error', () => this.close(target));
      entry.watchers.push(w);
    };
    try {
      add(dir, WATCHED);
      const logs = path.join(dir, 'logs');
      if (existsSync(logs)) add(logs, new Set(['HEAD']));
    } catch {
      for (const w of entry.watchers) w.close();
      return false;
    }
    this.entries.set(target, entry);
    return true;
  }

  stop(target: string): void {
    const e = this.entries.get(target);
    if (e && --e.count <= 0) this.close(target);
  }

  /** Closes one target whatever its count (its DocsWatcher stopped, so the holders fall back to polling). */
  stopTarget(target: string): void {
    this.close(target);
  }

  stopTask(taskId: string): void {
    const prefix = `${taskId}#`;
    for (const key of [...this.entries.keys()])
      if (key === taskId || key.startsWith(prefix)) this.close(key);
  }

  stopAll(): void {
    for (const key of [...this.entries.keys()]) this.close(key);
  }

  private close(target: string): void {
    const e = this.entries.get(target);
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    for (const w of e.watchers) w.close();
    this.entries.delete(target);
  }
}
