import type {
  AlertKind,
  BudgetRecord,
  BudgetSettings,
} from '../../shared/budget';
import { budgetMonth, dayKey } from '../../shared/budget';
import { type BudgetView, budgetView } from '../../shared/budgetView';
import type { Task } from '../../shared/types';
import { taskWorkspaces } from '../../shared/workspaces';
import { isInside } from '../paths';
import type { BudgetStore } from './BudgetStore';
import type { ClaudeTranscriptReader } from './claudeTranscripts';
import type { OpenCodeReader } from './openCode';

const ALERT_TEXT: Record<AlertKind, string> = {
  at80: 'Claude budget: 80% used',
  forecastOver: 'Claude budget: on pace to go over',
  at100: 'Claude budget: used up',
};

export type BudgetServiceDeps = {
  store: BudgetStore;
  claude: { read: ClaudeTranscriptReader['read'] };
  openCode: { read: OpenCodeReader['read'] };
  settings: () => BudgetSettings;
  inShellie: (r: BudgetRecord) => boolean;
  now?: () => Date;
  changed: () => void;
  notify: (n: { title: string; body: string }) => void;
  telemetry?: (kind: AlertKind) => void;
};

const eur = (n: number) => `€${n.toFixed(2)}`;

/** Reads Claude Code and OpenCode usage into the budget rollup, on a timer and on demand, and raises the budget alerts. */
export class BudgetService {
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly d: BudgetServiceDeps) {}

  private now() {
    return this.d.now?.() ?? new Date();
  }

  pass(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run() {
    const s = this.d.settings();
    const f = this.d.store.value;
    const claude = await this.d.claude.read(f.claudeCursors);
    let oc: { records: BudgetRecord[]; cursor: number; found: boolean };
    try {
      oc = this.d.openCode.read(f.openCodeCursor);
    } catch (err) {
      console.warn('[budget] OpenCode database not readable this pass', err);
      oc = { records: [], cursor: f.openCodeCursor, found: f.sources.openCode };
    }
    const changed = await this.d.store.apply({
      records: [...claude.records, ...oc.records],
      inShellie: this.d.inShellie,
      now: this.now(),
      monthStartDay: s.monthStartDay,
      claudeCursors: claude.cursors,
      openCodeCursor: oc.cursor,
      sources: { claudeCode: claude.found, openCode: oc.found },
    });
    const v = this.view(0);
    const monthKey = v.startDay;
    for (const kind of v.alertsDue) {
      await this.d.store.markAlert(monthKey, kind);
      this.d.notify({
        title: ALERT_TEXT[kind],
        body: `${eur(v.spentEur)} of ${eur(v.budgetEur ?? 0)} spent${v.forecastEur !== null ? `, on pace for ${eur(v.forecastEur)}` : ''}.`,
      });
      this.d.telemetry?.(kind);
    }
    if (changed) this.d.changed();
  }

  view(monthOffset: number): BudgetView {
    const s = this.d.settings();
    const f = this.d.store.value;
    const now = this.now();
    const monthKey = dayKey(
      budgetMonth(now, s.monthStartDay, monthOffset).start,
    );
    return budgetView({
      days: f.days,
      settings: s,
      now,
      monthOffset,
      fired: f.alerts[monthKey] ?? [],
      sources: f.sources,
    });
  }

  start(intervalMs = 30_000) {
    void this.pass();
    this.timer ??= setInterval(() => void this.pass(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** In Shellie: a Claude Code session one of the tasks' Claude tabs ran, or OpenCode working inside a task's worktree. */
export function inShellieFor(
  tasks: () => Task[],
): (r: BudgetRecord) => boolean {
  return (r) => {
    const all = tasks();
    if (r.tool === 'claude-code')
      return all.some((t) =>
        [...t.terminals, ...t.closedTerminals].some(
          (x) => x.sessionId === r.sessionId,
        ),
      );
    const cwd = r.cwd;
    return (
      !!cwd &&
      all.some((t) =>
        taskWorkspaces(t).some(
          (w) => !!w.worktreePath && isInside(w.worktreePath, cwd),
        ),
      )
    );
  };
}
