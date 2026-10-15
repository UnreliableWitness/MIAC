import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../../shared/types';
import type { TaskUsage } from '../../shared/usage';
import { AdoClient } from '../services/AdoClient';
import { startAdoServer, type AdoServer } from '../test-helpers/adoServer';
import { UsageSync } from './UsageSync';

let server: AdoServer;
beforeEach(async () => {
  server = await startAdoServer();
});
afterEach(() => server.close());

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  repoId: 'r1',
  name: '',
  workItem: { id: '1', type: 'Issue', title: 'Checkout', url: null },
  slug: '1-checkout',
  branch: 'feature/1-checkout',
  worktreePath: '/w',
  baseRef: 'origin/main',
  baseSha: null,
  status: 'ready',
  setup: {
    copy: false,
    commands: [],
    startClaude: false,
    openShell: false,
    openCopilot: false,
  },
  terminals: [],
  createdAt: '2026-10-14T08:00:00.000Z',
  finishedAt: null,
  usageSyncedAt: null,
  usageSyncError: null,
  usageCommentId: null,
  summary: null,
  ...over,
});
const usage: TaskUsage = {
  taskId: 't1',
  sessions: [],
  recent: [],
  unpricedRequests: 0,
  usdToEur: 0.92,
  billable: { costUsd: 10, costEur: 9.2, tokens: 5000 },
  byTool: {
    'claude-code': { costUsd: 10, costEur: 9.2, sessions: 1, tokens: 5000 },
    'copilot-cli': { costUsd: 0, costEur: 0, sessions: 0, tokens: 0 },
  },
};

function setup(initial: Task = task(), changed: string[] = ['t1']) {
  const tasks = new Map([[initial.id, initial]]);
  const ran: string[] = [];
  const client = new AdoClient(`${server.url}/org`, async () => 'pat');
  const sync = new UsageSync({
    task: (id) => tasks.get(id)!,
    tasks: () => [...tasks.values()],
    target: (t) =>
      t.repoId === 'r1' ? { connectionId: 'c1', project: 'MIAC' } : null,
    client: () => client,
    run: (id, fn) => {
      ran.push(id);
      return fn();
    },
    usage: () => usage,
    changedSince: () => changed,
    patchTask: async (id, patch) => {
      tasks.set(id, { ...tasks.get(id)!, ...patch });
    },
  });
  server.route('GET', '/org/MIAC/_apis/wit/workitemtypes', {
    body: {
      value: [
        {
          name: 'Issue',
          fields: [
            { referenceName: 'System.Title' },
            { referenceName: 'Custom.AICost' },
            { referenceName: 'Custom.AITokens' },
          ],
        },
        { name: 'Task', fields: [{ referenceName: 'System.Title' }] },
      ],
    },
  });
  server.route('PATCH', '/org/_apis/wit/workitems/1', { body: { id: 1 } });
  server.route('POST', '/org/MIAC/_apis/wit/workItems/1/comments', {
    body: { id: 77 },
  });
  return { sync, tasks, ran };
}
const patches = () => server.requests.filter((r) => r.method === 'PATCH');
const comments = () => server.requests.filter((r) => r.method === 'POST');

describe('UsageSync', () => {
  it('writes only the fields the type has and posts the comment once', async () => {
    const { sync, tasks, ran } = setup();
    const r = await sync.syncTask('t1', { comment: true });
    expect(r).toEqual({
      ok: true,
      fieldsWritten: ['Custom.AICost', 'Custom.AITokens'],
      fieldsMissing: ['Custom.AICostClaude', 'Custom.AICostCopilot'],
      commentPosted: true,
      error: null,
    });
    expect(JSON.parse(patches()[0].body)).toEqual([
      { op: 'add', path: '/fields/Custom.AICost', value: 9.2 },
      { op: 'add', path: '/fields/Custom.AITokens', value: 5000 },
    ]);
    expect(tasks.get('t1')).toMatchObject({
      usageCommentId: 77,
      usageSyncError: null,
    });
    expect(tasks.get('t1')!.usageSyncedAt).not.toBeNull();
    expect(ran).toEqual(['c1']);
    const again = await sync.syncTask('t1', { comment: true });
    expect(again.commentPosted).toBe(false);
    expect(comments()).toHaveLength(1);
  });
  it('never posts twice when two syncs overlap', async () => {
    const { sync } = setup();
    await Promise.all([
      sync.syncTask('t1', { comment: true }),
      sync.syncTask('t1', { comment: true }),
    ]);
    expect(comments()).toHaveLength(1);
  });
  it('skips the field write when the type has none of the fields', async () => {
    const { sync, tasks } = setup(
      task({ workItem: { id: '1', type: 'Task', title: 'x', url: null } }),
    );
    const r = await sync.syncTask('t1');
    expect(r).toMatchObject({
      ok: true,
      fieldsWritten: [],
      commentPosted: false,
    });
    expect(patches()).toHaveLength(0);
    expect(tasks.get('t1')!.usageSyncedAt).toBeNull();
  });
  it('stores a write failure on the task instead of throwing', async () => {
    const { sync, tasks } = setup();
    server.route('PATCH', '/org/_apis/wit/workitems/1', {
      status: 403,
      body: {},
    });
    const r = await sync.syncTask('t1', { comment: true });
    expect(r).toMatchObject({
      ok: false,
      error:
        'The token cannot write work items (needs Work Items: Read & write)',
    });
    expect(tasks.get('t1')!.usageSyncError).toBe(
      'The token cannot write work items (needs Work Items: Read & write)',
    );
  });
  it('refuses tasks without a work item or connection', async () => {
    const { sync } = setup(task({ workItem: null }));
    expect(await sync.syncTask('t1')).toMatchObject({
      ok: false,
      error: 'This task has no work item in a connected Azure DevOps project',
    });
    const other = setup(task({ repoId: 'r2' }));
    expect((await other.sync.syncTask('t1')).ok).toBe(false);
  });
  it('hourly sync only touches tasks whose usage changed', async () => {
    const { sync } = setup(task(), []);
    await sync.syncChanged();
    expect(patches()).toHaveLength(0);
    const changed = setup(task(), ['t1']);
    await changed.sync.syncChanged();
    expect(patches()).toHaveLength(1);
    expect(comments()).toHaveLength(0);
  });
  it('reports field presence per work item type', async () => {
    const { sync } = setup();
    expect(await sync.fieldsStatus('c1', 'MIAC')).toEqual({
      connectionId: 'c1',
      types: [
        {
          type: 'Issue',
          present: ['Custom.AICost', 'Custom.AITokens'],
          missing: ['Custom.AICostClaude', 'Custom.AICostCopilot'],
        },
        {
          type: 'Task',
          present: [],
          missing: [
            'Custom.AICost',
            'Custom.AICostClaude',
            'Custom.AICostCopilot',
            'Custom.AITokens',
          ],
        },
      ],
    });
  });
});
