import type { Environment, LeakState } from '../../shared/secrets';
import { LeakMatcher } from './LeakMatcher';

export type LeakWatchDeps = {
  /** Every environment's stored values for these repos (the union). */
  values: (
    repoIds: string[],
  ) => { name: string; value: string; env: Environment }[];
  /** The values found in files git tracks in the repo: in git already, so agents reading them are no news. */
  tracked: (repoId: string) => Promise<Set<string>>;
  /** The task's repos (home and joined ones), null for an unknown task. */
  repoIdsOf: (taskId: string) => string[] | null;
  /** A tab's state changed: a new name showed up, or its input was paused or resumed. Names only. */
  onLeak: (terminalId: string, state: LeakState) => void;
  /** Telemetry: a name new to a tab showed up; its environment and whether it paused the tab. Never the name. */
  detected?: (env: Environment, paused: boolean) => void;
};

/**
 * Watches agent tabs' output for stored values: masks them as `[NAME]`, tells the renderer once per name per tab,
 * and pauses a tab's input when a Production value shows up. Values come from every environment of the task's
 * repos; values git tracks already are masked but raise nothing. The matchers hold plaintext in memory only.
 */
export class LeakWatch {
  private readonly matchers = new Map<
    string,
    { key: string; matcher: LeakMatcher }
  >();
  private readonly trackedByRepo = new Map<string, Set<string>>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly states = new Map<string, LeakState>();
  /** Bumped by invalidate, so a tracked-file look started before it is not kept. */
  private generation = 0;

  constructor(private readonly d: LeakWatchDeps) {}

  /** Looks up the tracked values of the task's repos, so the first output of a new tab is judged with them. */
  async prepare(taskId: string): Promise<void> {
    const repoIds = this.d.repoIdsOf(taskId) ?? [];
    if (this.d.values(repoIds).length === 0) return;
    await Promise.all(repoIds.map((r) => this.loadTracked(r)));
    this.matchers.delete(taskId);
  }

  /** Stored secrets changed: matchers and tracked values are built again on the next output. */
  invalidate(): void {
    this.generation++;
    this.matchers.clear();
    this.trackedByRepo.clear();
    this.loading.clear();
  }

  /** The output filter for agent tabs (TerminalManager's OutputFilter). */
  filter(
    o: { id: string; taskId: string },
    data: string,
    carry: string,
    final: boolean,
  ): { text: string; carry: string } {
    const r = this.matcherFor(o.taskId).mask(data, carry, final);
    // Values in a tracked file are masked like any other but raise nothing: they are in git already.
    const loud = r.hits.filter((h) => !h.quiet);
    if (loud.length > 0) this.hit(o.id, loud);
    return { text: r.text, carry: r.carry };
  }

  state(terminalId: string): LeakState | null {
    const s = this.states.get(terminalId);
    return s ? { names: [...s.names], paused: s.paused } : null;
  }

  isPaused(terminalId: string): boolean {
    return this.states.get(terminalId)?.paused ?? false;
  }

  resume(terminalId: string): void {
    const s = this.states.get(terminalId);
    if (!s?.paused) return;
    s.paused = false;
    this.d.onLeak(terminalId, this.state(terminalId)!);
  }

  /** The tab is closed, stopped or started again: its notices go with it, and its view clears them. */
  forget(terminalId: string): void {
    if (this.states.delete(terminalId))
      this.d.onLeak(terminalId, { names: [], paused: false });
  }

  /** The task finished: its matcher (plaintext) is not kept. */
  dropTask(taskId: string): void {
    this.matchers.delete(taskId);
  }

  private hit(id: string, hits: { name: string; env: Environment }[]): void {
    const s = this.states.get(id) ?? { names: [], paused: false };
    this.states.set(id, s);
    let changed = false;
    for (const h of hits) {
      const isNew = !s.names.includes(h.name);
      if (isNew) {
        s.names.push(h.name);
        changed = true;
      }
      const pauses = h.env === 'production' && !s.paused;
      if (pauses) {
        s.paused = true;
        changed = true;
      }
      if (isNew) this.d.detected?.(h.env, pauses);
    }
    if (changed) this.d.onLeak(id, this.state(id)!);
  }

  private matcherFor(taskId: string): LeakMatcher {
    const repoIds = this.d.repoIdsOf(taskId) ?? [];
    const key = repoIds.join('\0');
    const cached = this.matchers.get(taskId);
    if (cached && cached.key === key) return cached.matcher;
    const values = this.d.values(repoIds);
    const quiet = new Set<string>();
    if (values.length > 0)
      for (const r of repoIds) {
        const t = this.trackedByRepo.get(r);
        if (t) for (const v of t) quiet.add(v);
        else
          // Until it is known, every value raises a notice; the matcher is built again once it is.
          void this.loadTracked(r).then(() => {
            if (this.matchers.get(taskId)?.matcher === matcher)
              this.matchers.delete(taskId);
          });
      }
    const matcher = LeakMatcher.from(values, { quiet });
    this.matchers.set(taskId, { key, matcher });
    return matcher;
  }

  private loadTracked(repoId: string): Promise<void> {
    if (this.trackedByRepo.has(repoId)) return Promise.resolve();
    let p = this.loading.get(repoId);
    if (!p) {
      const gen = this.generation;
      p = this.d
        .tracked(repoId)
        .catch(() => {
          // Never with the error: it could name a file's contents. Nothing is exempt then.
          console.warn('[secrets] could not look for tracked secret files');
          return new Set<string>();
        })
        .then((set) => {
          if (gen !== this.generation) return;
          this.trackedByRepo.set(repoId, set);
          this.loading.delete(repoId);
        });
      this.loading.set(repoId, p);
    }
    return p;
  }
}
