import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AppSettings,
  Rate,
  SessionSummary,
  TaskUsage,
  UsageEvent,
  UsageRecord,
  UsageTool,
} from '../../shared/usage';
import { priceEvent, round6 } from '../pricing/RateTable';

const TOOLS: UsageTool[] = ['claude-code', 'copilot-cli'];

/** Priced usage records in append-only monthly JSON-lines files, indexed in memory by task. */
export class UsageStore extends EventEmitter<{ changed: [taskId: string] }> {
  private readonly byId = new Map<string, UsageRecord>();
  private readonly byTask = new Map<string, UsageRecord[]>();
  private readonly lastChange = new Map<string, string>();
  private notBillable = new Map<string, Set<string>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly rates: () => Rate[],
  ) {
    super();
  }

  async load(): Promise<{ damagedLines: number }> {
    let damaged = 0;
    let files: string[] = [];
    try {
      files = (await fs.readdir(this.dir))
        .filter((f) => /^records-\d{4}-\d{2}\.jsonl$/.test(f))
        .sort();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    for (const f of files) {
      const text = await fs.readFile(path.join(this.dir, f), 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line) as UsageRecord;
          if (typeof rec.id !== 'string' || typeof rec.taskId !== 'string')
            throw new Error('bad record');
          this.index(rec);
        } catch {
          damaged++;
        }
      }
    }
    try {
      const raw = JSON.parse(
        await fs.readFile(path.join(this.dir, 'billable.json'), 'utf8'),
      ) as Record<string, string[]>;
      this.notBillable = new Map(
        Object.entries(raw).map(([t, ids]) => [t, new Set(ids)]),
      );
    } catch {
      this.notBillable = new Map();
    }
    return { damagedLines: damaged };
  }

  add(e: UsageEvent): Promise<UsageRecord | null> {
    const run = async () => {
      if (this.byId.has(e.id)) return null;
      const rec: UsageRecord = { ...e, ...priceEvent(this.rates(), e) };
      await fs.mkdir(this.dir, { recursive: true });
      await fs.appendFile(
        path.join(this.dir, `records-${e.at.slice(0, 7)}.jsonl`),
        `${JSON.stringify(rec)}\n`,
        'utf8',
      );
      this.index(rec);
      this.lastChange.set(e.taskId, new Date().toISOString());
      this.emit('changed', e.taskId);
      return rec;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  records(taskId: string): UsageRecord[] {
    return [...(this.byTask.get(taskId) ?? [])].sort((a, b) =>
      a.at.localeCompare(b.at),
    );
  }

  isBillable(taskId: string, sessionId: string): boolean {
    return !this.notBillable.get(taskId)?.has(sessionId);
  }

  async setBillable(
    taskId: string,
    sessionId: string,
    billable: boolean,
  ): Promise<void> {
    const set = this.notBillable.get(taskId) ?? new Set<string>();
    if (billable) set.delete(sessionId);
    else set.add(sessionId);
    this.notBillable.set(taskId, set);
    const obj = Object.fromEntries(
      [...this.notBillable]
        .filter(([, s]) => s.size > 0)
        .map(([t, s]) => [t, [...s]]),
    );
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, 'billable.json');
    await fs.writeFile(`${file}.tmp`, JSON.stringify(obj), 'utf8');
    await fs.rename(`${file}.tmp`, file);
    this.lastChange.set(taskId, new Date().toISOString());
    this.emit('changed', taskId);
  }

  changedSince(iso: string): string[] {
    return [...this.lastChange].filter(([, at]) => at > iso).map(([t]) => t);
  }

  summarize(taskId: string, settings: AppSettings): TaskUsage {
    const sessions = new Map<string, SessionSummary>();
    for (const r of this.records(taskId)) {
      const s = sessions.get(r.sessionId) ?? {
        sessionId: r.sessionId,
        tool: r.tool,
        startedAt: r.at,
        models: [],
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        unpricedRequests: 0,
        billable: this.isBillable(taskId, r.sessionId),
      };
      s.requests++;
      if (!s.models.includes(r.model)) s.models.push(r.model);
      s.inputTokens += r.inputTokens;
      s.outputTokens += r.outputTokens;
      s.cacheReadTokens += r.cacheReadTokens;
      s.cacheWriteTokens += r.cacheWriteTokens;
      if (r.costUsd === null) s.unpricedRequests++;
      else s.costUsd = round6(s.costUsd + r.costUsd);
      sessions.set(r.sessionId, s);
    }
    const list = [...sessions.values()].sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt),
    );
    const factor = settings.usdToEur * (1 + settings.markupPct / 100);
    const tokensOf = (s: SessionSummary) =>
      s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens;
    const billableList = list.filter((s) => s.billable);
    const byTool = Object.fromEntries(
      TOOLS.map((tool) => {
        const ss = billableList.filter((s) => s.tool === tool);
        const costUsd = round6(ss.reduce((n, s) => n + s.costUsd, 0));
        return [
          tool,
          {
            costUsd,
            costEur: round6(costUsd * factor),
            sessions: ss.length,
            tokens: ss.reduce((n, s) => n + tokensOf(s), 0),
          },
        ];
      }),
    ) as TaskUsage['byTool'];
    const costUsd = round6(billableList.reduce((n, s) => n + s.costUsd, 0));
    return {
      taskId,
      sessions: list,
      billable: {
        costUsd,
        costEur: round6(costUsd * factor),
        tokens: billableList.reduce((n, s) => n + tokensOf(s), 0),
      },
      byTool,
      unpricedRequests: list.reduce((n, s) => n + s.unpricedRequests, 0),
      usdToEur: settings.usdToEur,
      markupPct: settings.markupPct,
    };
  }

  private index(rec: UsageRecord): void {
    if (this.byId.has(rec.id)) return;
    this.byId.set(rec.id, rec);
    const list = this.byTask.get(rec.taskId) ?? [];
    list.push(rec);
    this.byTask.set(rec.taskId, list);
  }
}
