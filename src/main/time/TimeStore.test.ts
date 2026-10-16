import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Task } from '../../shared/types';
import { TimeStore } from './TimeStore';

const file = () =>
  path.join(mkdtempSync(path.join(tmpdir(), 'time-')), 'time.json');
const hours = { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] };

describe('TimeStore', () => {
  it('merges active intervals and emits changed', async () => {
    const s = new TimeStore(file());
    await s.load();
    const seen: string[] = [];
    s.on('changed', (id) => seen.push(id));
    await s.addActive('t', [0, 100]);
    await s.addActive('t', [50, 200]);
    expect(s.activeIntervals('t')).toEqual([[0, 200]]);
    expect(seen).toEqual(['t', 't']);
  });

  it('adds a claude delta ending at endMs', async () => {
    const s = new TimeStore(file());
    await s.load();
    await s.addClaudeActive({
      taskId: 't',
      sessionId: 's',
      endMs: 10_000,
      value: 1.72,
      cumulative: false,
    });
    expect(s.agentIntervals('t')['claude-code']).toEqual([[8280, 10000]]);
  });

  it('diffs cumulative values and treats a drop as a reset', async () => {
    const s = new TimeStore(file());
    await s.load();
    const add = (endMs: number, value: number) =>
      s.addClaudeActive({
        taskId: 't',
        sessionId: 's',
        endMs,
        value,
        cumulative: true,
      });
    const total = () =>
      s.agentIntervals('t')['claude-code'].reduce((n, [a, b]) => n + b - a, 0);
    await add(100_000, 5);
    expect(total()).toBe(5000);
    await add(200_000, 8);
    expect(total()).toBe(8000);
    await add(300_000, 2);
    expect(total()).toBe(10_000);
  });

  it('first baseline wins', async () => {
    const s = new TimeStore(file());
    await s.load();
    await s.recordBaseline('c:12', 5);
    await s.recordBaseline('c:12', 7);
    expect(s.baseline('c:12')).toBe(5);
    expect(s.baseline('c:99')).toBeNull();
  });

  it('summarizes', async () => {
    const s = new TimeStore(file());
    await s.load();
    await s.addActive('t', [0, 60_000]);
    await s.addAgent('t', 'claude-code', [30_000, 90_000]);
    const task = {
      id: 't',
      createdAt: new Date(0).toISOString(),
      finishedAt: new Date(90_000).toISOString(),
      openPeriods: [],
      time: null,
    } as unknown as Task;
    const r = s.summarize(task, hours, 100_000);
    expect(r.activeSeconds).toBe(60);
    expect(r.realisticSeconds).toBe(90);
    expect(r.agentSeconds['claude-code']).toBe(60);
    expect(r.taskId).toBe('t');
  });

  it('keeps data across reload and backs up a corrupt file', async () => {
    const f = file();
    const a = new TimeStore(f);
    await a.load();
    await a.addActive('t', [0, 100]);
    await a.addClaudeActive({
      taskId: 't',
      sessionId: 's',
      endMs: 5000,
      value: 3,
      cumulative: true,
    });
    await a.recordBaseline('k', 4);
    const b = new TimeStore(f);
    expect(await b.load()).toEqual({ recovered: false });
    expect(b.activeIntervals('t')).toEqual([[0, 100]]);
    expect(b.baseline('k')).toBe(4);
    writeFileSync(f, '{nope');
    const c = new TimeStore(f);
    const r = await c.load();
    expect(r.recovered).toBe(true);
    expect(c.activeIntervals('t')).toEqual([]);
  });
});
