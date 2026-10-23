import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BudgetRecord } from '../../shared/budget';
import { vendorOf } from '../../shared/budget';
import type { CostRecord } from '../../shared/ledger';
import { LEVEL_RANK } from '../../shared/ledger';
import type { UsageEvent, UsageRecord } from '../../shared/usage';
import type { FileCursor } from '../budget/claudeTranscripts';
import type { ClaudeTranscriptReader } from '../budget/claudeTranscripts';
import type { OpenCodeReader } from '../budget/openCode';
import { budgetRecordsFromUsage } from '../budget/usageRecords';
import { renameWithRetry } from '../fsRetry';
import { OFFICIAL_RATES } from '../pricing/officialRates';
import { modelLabeler } from '../pricing/RateTable';
import { type AttributionContext, attribute, merge } from './attribute';
import type { LedgerStore } from './LedgerStore';
import { priceRecord } from './price';

export type LedgerServiceDeps = {
  store: LedgerStore;
  claude: { read: ClaudeTranscriptReader['read'] };
  openCode: { read: OpenCodeReader['read'] };
  /** The usage store's records: Copilot CLI requests and PR-summary runs enter the ledger from here. */
  usageRecords: () => UsageRecord[];
  context: () => AttributionContext;
  isBillable: (taskId: string, sessionId: string) => boolean;
  developer: () => string | null;
  version: string;
  /** OpenCode requests attributed to a task, for the Usage tab (the usage store dedupes by id). */
  toUsage: (e: UsageEvent) => void;
  changed: () => void;
};

type Cursors = { claude: Record<string, FileCursor>; openCode: number };
/** What attribution and billable need that the record leaves out (never sent): session, folder, task id. */
type Input = { id: string; s: string; c: string | null; t?: string };

const label = modelLabeler(OFFICIAL_RATES);

const asBudget = (r: CostRecord, i: Input): BudgetRecord => ({
  id: r.id,
  tool: r.tool,
  sessionId: i.s,
  model: r.model,
  provider: r.provider,
  at: r.at,
  cwd: i.c,
  fast: r.fast,
  ...(i.t ? { taskId: i.t } : {}),
  inputTokens: r.inputTokens,
  outputTokens: r.outputTokens,
  cacheReadTokens: r.cacheReadTokens,
  cacheWrite5mTokens: r.cacheWrite5mTokens,
  cacheWrite1hTokens: r.cacheWrite1hTokens,
});

async function writeAtomic(file: string, text: string) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await renameWithRetry(tmp, file);
}

/**
 * Fills the cost ledger: every request the transcripts, OpenCode and the usage store have, priced and
 * attributed. Its readers keep their own cursors (`cursors.json`, first run reads everything); the
 * inputs attribution needs stay local in `inputs.jsonl`, so stored records can move up later.
 */
export class LedgerService {
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private loaded: Promise<void> | null = null;
  private cursors: Cursors = { claude: {}, openCode: 0 };
  private readonly inputs = new Map<string, Input>();
  /** The attribution context of the last pass; stored records are re-attributed when it changes. */
  private lastKey: string | null = null;
  private readonly sentToUsage = new Set<string>();
  private firstPass = true;

  constructor(private readonly d: LedgerServiceDeps) {}

  private get cursorsFile() {
    return path.join(this.d.store.dir, 'cursors.json');
  }
  private get inputsFile() {
    return path.join(this.d.store.dir, 'inputs.jsonl');
  }

  private async load() {
    await this.d.store.load();
    try {
      const raw = JSON.parse(
        await fs.readFile(this.cursorsFile, 'utf8'),
      ) as Partial<Cursors>;
      this.cursors = {
        claude: raw.claude && typeof raw.claude === 'object' ? raw.claude : {},
        openCode: typeof raw.openCode === 'number' ? raw.openCode : 0,
      };
    } catch {
      this.cursors = { claude: {}, openCode: 0 };
    }
    let text = '';
    try {
      text = await fs.readFile(this.inputsFile, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const i = JSON.parse(line) as Input;
        if (typeof i.id === 'string' && typeof i.s === 'string')
          this.inputs.set(i.id, i);
      } catch {
        // A torn line is skipped; the file is rewritten below.
      }
    }
    // A last line without its newline is a torn write: rewrite so the next append starts clean.
    if (text.length > 0 && !text.endsWith('\n'))
      await writeAtomic(
        this.inputsFile,
        [...this.inputs.values()].map((i) => `${JSON.stringify(i)}\n`).join(''),
      );
  }

  pass(): Promise<void> {
    this.running ??= this.run()
      .catch((err) => {
        console.warn('[ledger] pass failed', err);
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  /** Billable comes from the usage store for a task's session; a task Shellie no longer has keeps what it had. */
  private billableOf(r: CostRecord, i: Input, ctx: AttributionContext) {
    const a = r.attribution;
    if (a.level !== 'task') return true;
    if (!ctx.byId.has(a.taskId)) return r.billable;
    return this.d.isBillable(a.taskId, i.s);
  }

  private build(
    r: BudgetRecord,
    ctx: AttributionContext,
    developer: string | null,
  ): CostRecord {
    const p = priceRecord(OFFICIAL_RATES, r.model, r.fast, r);
    return {
      id: r.id,
      tool: r.tool,
      provider: r.provider,
      vendor: vendorOf(r),
      model: r.model,
      modelLabel: label(r.model),
      at: r.at,
      fast: r.fast,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheWrite5mTokens: r.cacheWrite5mTokens,
      cacheWrite1hTokens: r.cacheWrite1hTokens,
      costUsd: p?.costUsd ?? null,
      costEur: p?.costEur ?? null,
      rateId: p?.rateId ?? null,
      billable: true,
      attribution: attribute(r, ctx),
      developer,
      shellieVersion: this.d.version,
    };
  }

  private async run() {
    await (this.loaded ??= this.load());
    const store = this.d.store;
    const claude = await this.d.claude.read(this.cursors.claude);
    let oc: { records: BudgetRecord[]; cursor: number };
    try {
      oc = this.d.openCode.read(this.cursors.openCode);
    } catch (err) {
      console.warn('[ledger] OpenCode database not readable this pass', err);
      oc = { records: [], cursor: this.cursors.openCode };
    }
    let extra: BudgetRecord[] = [];
    try {
      extra = budgetRecordsFromUsage(this.d.usageRecords());
    } catch (err) {
      console.warn('[ledger] usage store not readable this pass', err);
    }
    const ctx = this.d.context();
    const developer = this.d.developer();
    const out = new Map<string, CostRecord>();
    const fresh: Input[] = [];
    for (const r of [...claude.records, ...oc.records, ...extra]) {
      let input = this.inputs.get(r.id);
      if (!input) {
        input = {
          id: r.id,
          s: r.sessionId,
          c: r.cwd,
          ...(r.taskId ? { t: r.taskId } : {}),
        };
        this.inputs.set(r.id, input);
        fresh.push(input);
      }
      const m = merge(
        out.get(r.id) ?? store.get(r.id),
        this.build(r, ctx, developer),
      );
      out.set(r.id, { ...m, billable: this.billableOf(m, input, ctx) });
    }
    // Stored records the readers did not bring again: move up when the context changed, re-apply billable.
    const reattribute = ctx.key !== this.lastKey;
    for (const prev of store.all()) {
      if (out.has(prev.id)) continue;
      const input = this.inputs.get(prev.id);
      if (!input) continue;
      let rec = prev;
      if (reattribute && prev.attribution.level !== 'task') {
        const a = attribute(asBudget(prev, input), ctx);
        if (LEVEL_RANK[a.level] > LEVEL_RANK[prev.attribution.level])
          rec = { ...rec, attribution: a };
      }
      const billable = this.billableOf(rec, input, ctx);
      if (billable !== rec.billable) rec = { ...rec, billable };
      if (rec.developer === null && developer !== null)
        rec = { ...rec, developer };
      // A Shellie update may bring a rate for a model that had none.
      if (this.firstPass && rec.costEur === null) {
        const p = priceRecord(OFFICIAL_RATES, rec.model, rec.fast, rec);
        if (p) rec = { ...rec, ...p };
      }
      if (rec !== prev) out.set(prev.id, rec);
    }
    if (fresh.length > 0) {
      await fs.mkdir(store.dir, { recursive: true });
      await fs.appendFile(
        this.inputsFile,
        fresh.map((i) => `${JSON.stringify(i)}\n`).join(''),
        'utf8',
      );
    }
    const changed = await store.upsert([...out.values()]);
    const next: Cursors = { claude: claude.cursors, openCode: oc.cursor };
    if (JSON.stringify(next) !== JSON.stringify(this.cursors)) {
      await fs.mkdir(store.dir, { recursive: true });
      await writeAtomic(this.cursorsFile, JSON.stringify(next));
      this.cursors = next;
    }
    for (const r of this.firstPass ? store.all() : out.values()) {
      const a = r.attribution;
      if (r.tool !== 'opencode' || a.level !== 'task') continue;
      if (this.sentToUsage.has(r.id)) continue;
      const input = this.inputs.get(r.id);
      if (!input) continue;
      this.sentToUsage.add(r.id);
      this.d.toUsage({
        id: r.id,
        taskId: a.taskId,
        tool: 'opencode',
        sessionId: input.s,
        model: r.model,
        at: r.at,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheWriteTokens: r.cacheWrite5mTokens + r.cacheWrite1hTokens,
        fast: r.fast,
      });
    }
    this.lastKey = ctx.key;
    this.firstPass = false;
    if (changed.length > 0) this.d.changed();
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
