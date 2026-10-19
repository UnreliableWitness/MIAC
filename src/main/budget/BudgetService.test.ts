import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BudgetRecord } from '../../shared/budget';
import { defaultBudgetSettings } from '../../shared/budget';
import type { Rate } from '../../shared/usage';
import { BudgetService, inShellieFor } from './BudgetService';
import { BudgetStore } from './BudgetStore';

const opus = {
  id: 'anthropic-opus-5-5',
  label: 'Opus',
  match: ['claude-opus-5-5'],
  minInputTokens: 0,
  fast: false,
  inputPerM: 4,
  cachedInputPerM: 0.2,
  cacheWritePerM: 5,
  cacheWrite1hPerM: 8,
  outputPerM: 20,
} as Rate;
const rec = (id: string, eurMillions = 1): BudgetRecord => ({
  id,
  tool: 'claude-code',
  sessionId: 's',
  model: 'claude-opus-5-5',
  provider: 'anthropic',
  at: new Date(2026, 9, 10, 9).toISOString(),
  cwd: null,
  fast: false,
  inputTokens: eurMillions * 1e6,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
});

async function setup(records: BudgetRecord[], budget: number | null = 5) {
  const store = new BudgetStore(
    path.join(mkdtempSync(path.join(os.tmpdir(), 'bsv-')), 'budget.json'),
    () => [opus],
  );
  await store.load();
  const notify = vi.fn();
  const changed = vi.fn();
  const claudeRead = vi.fn(async () => ({ records, cursors: {}, found: true }));
  const svc = new BudgetService({
    store,
    claude: { read: claudeRead },
    openCode: { read: () => ({ records: [], cursor: 0, found: false }) },
    settings: () => ({ ...defaultBudgetSettings(), monthlyEur: budget }),
    inShellie: () => false,
    now: () => new Date(2026, 9, 19, 12),
    changed,
    notify,
  });
  return { svc, store, notify, changed, claudeRead };
}

describe('BudgetService', () => {
  it('runs one pass at a time', async () => {
    const { svc, claudeRead } = await setup([]);
    await Promise.all([svc.pass(), svc.pass()]);
    expect(claudeRead).toHaveBeenCalledTimes(1);
  });

  it('broadcasts only when something changed', async () => {
    const { svc, changed } = await setup([rec('cc:a')]);
    await svc.pass();
    await svc.pass();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('fires each alert once per month, also after a restart', async () => {
    const { svc, store, notify } = await setup([rec('cc:a', 2)], 4); // 2M input at $4 = $8 → ~€7.36 > €4
    await svc.pass();
    await svc.pass();
    expect(notify.mock.calls.map((c) => c[0].title)).toEqual([
      'Claude budget: 80% used',
      'Claude budget: on pace to go over',
      'Claude budget: used up',
    ]);
    expect(store.value.alerts['2026-10-01']).toEqual([
      'at80',
      'forecastOver',
      'at100',
    ]);
  });

  it('records sources and builds the view', async () => {
    const { svc } = await setup([rec('cc:a')]);
    await svc.pass();
    const v = svc.view(0);
    expect(v.sources).toEqual({ claudeCode: true, openCode: false });
    expect(v.spentEur).toBeGreaterThan(0);
  });
});

describe('inShellieFor', () => {
  const task = {
    id: 't',
    worktreePath: '/w/a',
    extraWorkspaces: [
      { id: 'x', repoId: 'r2', worktreePath: '/w/b', dropped: false },
    ],
    terminals: [{ id: '1', kind: 'claude', label: 'C', sessionId: 'S1' }],
    closedTerminals: [{ id: '2', kind: 'claude', label: 'C', sessionId: 'S2' }],
  } as never;
  const f = inShellieFor(() => [task]);
  const r = (o: Partial<BudgetRecord>) => ({ ...rec('x'), ...o });
  it('matches Claude Code by session id, open or closed tab', () => {
    expect(f(r({ sessionId: 'S1' }))).toBe(true);
    expect(f(r({ sessionId: 'S2' }))).toBe(true);
    expect(f(r({ sessionId: 'other' }))).toBe(false);
  });
  it('matches OpenCode by working directory inside any task worktree', () => {
    expect(f(r({ tool: 'opencode', cwd: '/w/b/src' }))).toBe(true);
    expect(f(r({ tool: 'opencode', cwd: '/elsewhere' }))).toBe(false);
  });
});
