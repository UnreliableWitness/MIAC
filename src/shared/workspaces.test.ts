import { describe, expect, it } from 'vitest';
import { TaskSchema, type Task, type Workspace } from './types';
import {
  activeHome,
  activeWorkspaces,
  pushedBranches,
  taskConnectionId,
  taskWorkspaces,
  workspaceById,
} from './workspaces';

const mkTask = (over: Partial<Task> = {}): Task =>
  TaskSchema.parse({
    id: 't1',
    repoId: 'r1',
    name: 'n',
    workItem: null,
    slug: 's',
    branch: 'feature/a',
    worktreePath: '/wt/a',
    baseRef: 'main',
    status: 'ready',
    setup: { copy: true, commands: [], startClaude: false, openShell: true },
    terminals: [],
    createdAt: '2026-10-16T00:00:00.000Z',
    finishedAt: null,
    ...over,
  });

const extra = (over: Partial<Workspace> = {}): Workspace => ({
  id: 'w2',
  repoId: 'r2',
  branch: 'feature/b',
  worktreePath: '/wt/b',
  baseRef: 'main',
  baseSha: null,
  source: 'detected',
  summary: null,
  pullRequest: null,
  reopen: null,
  dropped: false,
  ...over,
});

describe('workspaces', () => {
  it('a task without extras has one home view with the flat fields', () => {
    const views = taskWorkspaces(mkTask());
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      id: 'home',
      source: 'home',
      repoId: 'r1',
      branch: 'feature/a',
      worktreePath: '/wt/a',
      baseRef: 'main',
      dropped: false,
    });
  });

  it('lists home first, then the extras', () => {
    const t = mkTask({ extraWorkspaces: [extra()] });
    expect(taskWorkspaces(t).map((w) => w.id)).toEqual(['home', 'w2']);
  });

  it('activeHome falls to the first extra when home is dropped', () => {
    const t = mkTask({
      homeDropped: true,
      extraWorkspaces: [extra({ id: 'gone', dropped: true }), extra()],
    });
    expect(activeHome(t).id).toBe('w2');
    expect(activeWorkspaces(t).map((w) => w.id)).toEqual(['w2']);
  });

  it('workspaceById resolves undefined to the active home and rejects unknown ids', () => {
    const t = mkTask({ extraWorkspaces: [extra()] });
    expect(workspaceById(t, undefined).id).toBe('home');
    expect(workspaceById(t, 'w2').repoId).toBe('r2');
    expect(() => workspaceById(t, 'nope')).toThrow('Unknown workspace nope');
  });

  it('taskConnectionId prefers the task, then the home repo, else null', () => {
    const repos = [{ id: 'r1', connectionId: 'c1' }];
    expect(taskConnectionId(mkTask({ connectionId: 'c2' }), repos)).toBe('c2');
    expect(taskConnectionId(mkTask(), repos)).toBe('c1');
    expect(taskConnectionId(mkTask(), [])).toBeNull();
  });

  it('pushedBranches names the pushed branches of the workspaces still in the task, else the home branch', () => {
    const summary = {
      commits: [],
      commitCount: 1,
      filesChanged: 1,
      insertions: 1,
      deletions: 0,
      pushed: true,
      upstream: 'origin/x',
      baseKnown: true,
    };
    expect(pushedBranches(mkTask())).toEqual(['feature/a']);
    const t = mkTask({
      homeDropped: true,
      summary,
      extraWorkspaces: [
        extra({ summary }),
        extra({
          id: 'w3',
          branch: 'feature/c',
          summary: { ...summary, pushed: false },
        }),
      ],
    });
    expect(pushedBranches(t)).toEqual(['feature/b']);
  });
});
