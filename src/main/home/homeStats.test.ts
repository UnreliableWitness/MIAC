import { describe, expect, it } from 'vitest';
import type { Interval } from '../../shared/time';
import type { Task } from '../../shared/types';
import type { UsageRecord } from '../../shared/usage';
import { homeStats, type HomeStatsInput } from './homeStats';

const MON = new Date(2026, 9, 19, 12, 0); // Monday 19 Oct 2026, 12:00 local
const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).getTime();

const task = (id: string, over: Partial<Task> = {}): Task =>
  ({
    id,
    repoId: 'r1',
    connectionId: null,
    workItem: { id: id.replace('t', ''), type: 'Issue', title: id, url: null },
    status: 'ready',
    finishedAt: null,
    pullRequest: null,
    extraWorkspaces: [],
    time: null,
    ...over,
  }) as Task;

const record = (
  taskId: string,
  iso: string,
  costUsd: number,
  tool: UsageRecord['tool'] = 'claude-code',
): UsageRecord =>
  ({
    id: `${taskId}${iso}`,
    taskId,
    tool,
    sessionId: 's',
    at: iso,
    costUsd,
  }) as UsageRecord;

function input(over: Partial<HomeStatsInput> = {}): HomeStatsInput {
  const active: Record<string, Interval[]> = {};
  return {
    period: 'week',
    now: MON,
    tasks: [],
    repos: [{ id: 'r1', connectionId: 'c1' }],
    usage: { records: () => [], isBillable: () => true },
    time: {
      activeIntervals: (id) => active[id] ?? [],
      agentIntervals: () => ({
        'claude-code': [],
        'copilot-cli': [],
        opencode: [],
      }),
      baseline: () => null,
    },
    ...over,
  };
}

describe('homeStats', () => {
  it('week starts Monday: a task finished Sunday 23:30 does not count', () => {
    const s = homeStats(
      input({
        tasks: [
          task('t1', {
            status: 'done',
            finishedAt: new Date(2026, 9, 18, 23, 30).toISOString(),
          }),
          task('t2', {
            status: 'done',
            finishedAt: new Date(2026, 9, 19, 9, 0).toISOString(),
          }),
        ],
      }),
    );
    expect(s.tasksFinished).toBe(1);
  });

  it('sums billable cost in EUR by tool and by connection', () => {
    const records: Record<string, UsageRecord[]> = {
      t1: [
        record('t1', new Date(2026, 9, 19, 9).toISOString(), 10),
        record('t1', new Date(2026, 9, 19, 10).toISOString(), 5, 'copilot-cli'),
        record('t1', new Date(2026, 9, 17, 10).toISOString(), 100), // last week
      ],
      t2: [record('t2', new Date(2026, 9, 19, 9).toISOString(), 1)],
    };
    const s = homeStats(
      input({
        tasks: [task('t1'), task('t2', { repoId: 'gone' })],
        usage: { records: (id) => records[id] ?? [], isBillable: () => true },
      }),
    );
    expect(s.costEur).toBeCloseTo(16 * 0.92);
    expect(s.costByTool['claude-code']).toBeCloseTo(11 * 0.92);
    expect(s.costByTool['copilot-cli']).toBeCloseTo(5 * 0.92);
    expect(s.costByConnection).toEqual([
      { connectionId: 'c1', costEur: expect.closeTo(15 * 0.92) },
      { connectionId: null, costEur: expect.closeTo(0.92) },
    ]);
  });

  it('skips unbillable sessions and unpriced records', () => {
    const s = homeStats(
      input({
        tasks: [task('t1')],
        usage: {
          records: () => [
            record('t1', new Date(2026, 9, 19, 9).toISOString(), 10),
            {
              ...record('t1', new Date(2026, 9, 19, 9).toISOString(), 0),
              costUsd: null,
            },
          ],
          isBillable: () => false,
        },
      }),
    );
    expect(s.costEur).toBe(0);
  });

  it('clips active and agent time to the period', () => {
    const s = homeStats(
      input({
        tasks: [task('t1')],
        time: {
          activeIntervals: () => [[at(18, 23), at(19, 1)]],
          agentIntervals: () => ({
            'claude-code': [[at(19, 9), at(19, 10)]],
            'copilot-cli': [[at(19, 9), at(19, 11)]],
            opencode: [],
          }),
          baseline: () => null,
        },
      }),
    );
    expect(s.activeSeconds).toBe(3600);
    expect(s.agentSeconds).toBe(7200);
  });

  it('accuracy is booked over estimate for finished tasks with both', () => {
    const done = (id: string, booked: number) =>
      task(id, {
        status: 'done',
        finishedAt: new Date(2026, 9, 19, 9).toISOString(),
        time: { bookedSeconds: booked } as Task['time'],
      });
    const s = homeStats(
      input({
        tasks: [done('t1', 3 * 3600), done('t2', 3600), done('t3', 3600)],
        time: {
          activeIntervals: () => [],
          agentIntervals: () => ({
            'claude-code': [],
            'copilot-cli': [],
            opencode: [],
          }),
          baseline: (key) => (key === 'c1:1' ? 2 : key === 'c1:2' ? 2 : null),
        },
      }),
    );
    expect(s.accuracy).toBeCloseTo(4 / 4);
    expect(s.accuracyTasks).toBe(2);
  });

  it('counts PRs of tasks finished in the period, extra workspaces too', () => {
    const s = homeStats(
      input({
        tasks: [
          task('t1', {
            status: 'done',
            finishedAt: new Date(2026, 9, 19, 9).toISOString(),
            pullRequest: { id: 1 } as Task['pullRequest'],
            extraWorkspaces: [
              { pullRequest: { id: 2 } },
              { pullRequest: null },
            ] as Task['extraWorkspaces'],
          }),
        ],
      }),
    );
    expect(s.prsOpened).toBe(2);
  });

  it('empty stores give zeros and no accuracy', () => {
    expect(homeStats(input())).toMatchObject({
      costEur: 0,
      activeSeconds: 0,
      agentSeconds: 0,
      accuracy: null,
      tasksFinished: 0,
      prsOpened: 0,
    });
  });
});
