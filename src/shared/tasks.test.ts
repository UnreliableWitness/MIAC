import { describe, expect, it } from 'vitest';
import {
  folderName,
  isFolderTask,
  patchWorktree,
  repoDir,
  terminalCwd,
  worktreesOf,
} from './tasks';
import { StateSchema, type Task, type TaskWorktree } from './types';

const legacy: Task = {
  id: 't1',
  repoId: 'r1',
  name: '',
  workItem: { id: '5', type: 'Task', title: 'Store it', url: null },
  slug: '5-store-it',
  branch: 'feature/5-store-it',
  worktreePath: '/src/webshop.worktrees/5-store-it',
  baseRef: 'origin/main',
  baseSha: 'abc',
  status: 'ready',
  setup: {
    copy: true,
    commands: ['npm ci'],
    startClaude: true,
    openShell: true,
    openCopilot: false,
  },
  terminals: [],
  createdAt: '2026-10-16T08:00:00.000Z',
  finishedAt: null,
  usageSyncedAt: null,
  usageSyncError: null,
  usageCommentId: null,
  summary: null,
  pullRequest: null,
  closedTerminals: [],
  reopen: null,
};

const wt = (over: Partial<TaskWorktree>): TaskWorktree => ({
  repoId: 'r1',
  dir: 'api',
  path: '/tasks/5-store-it/api',
  branch: 'feature/5-store-it',
  baseRef: 'origin/main',
  baseSha: null,
  status: 'ready',
  copy: true,
  commands: [],
  summary: null,
  pullRequest: null,
  reopen: null,
  ...over,
});

const folder: Task = {
  ...legacy,
  worktreePath: '/tasks/5-store-it',
  baseSha: null,
  folder: '/tasks/5-store-it',
  worktrees: [
    wt({}),
    wt({ repoId: 'r2', dir: 'web', path: '/tasks/5-store-it/web' }),
  ],
};

describe('stored tasks', () => {
  it('loads a task from before multi-repo tasks as a single-repo task', () => {
    const { folder: _, worktrees: __, ...old } = folder;
    const state = StateSchema.parse({
      version: 1,
      repos: [],
      tasks: [{ ...old, worktreePath: legacy.worktreePath }],
    });
    const t = state.tasks[0];
    expect(isFolderTask(t)).toBe(false);
    expect(worktreesOf(t)).toHaveLength(1);
  });
  it('keeps the worktrees of a folder task with their defaults', () => {
    const state = StateSchema.parse({
      version: 1,
      repos: [],
      tasks: [
        {
          ...folder,
          worktrees: [
            {
              repoId: 'r1',
              dir: 'api',
              path: '/tasks/5-store-it/api',
              branch: 'b',
              baseRef: 'main',
            },
          ],
        },
      ],
    });
    expect(state.tasks[0].worktrees?.[0]).toEqual({
      repoId: 'r1',
      dir: 'api',
      path: '/tasks/5-store-it/api',
      branch: 'b',
      baseRef: 'main',
      baseSha: null,
      status: 'ready',
      copy: true,
      commands: [],
      summary: null,
      pullRequest: null,
      reopen: null,
    });
  });
});

describe('worktreesOf', () => {
  it('builds the one worktree of an old task from its own fields', () => {
    expect(worktreesOf(legacy)).toEqual([
      {
        repoId: 'r1',
        dir: '',
        path: '/src/webshop.worktrees/5-store-it',
        branch: 'feature/5-store-it',
        baseRef: 'origin/main',
        baseSha: 'abc',
        status: 'ready',
        copy: true,
        commands: ['npm ci'],
        summary: null,
        pullRequest: null,
        reopen: null,
      },
    ]);
  });
  it('maps an old task that is setting up or failed', () => {
    expect(worktreesOf({ ...legacy, status: 'setup-failed' })[0].status).toBe(
      'setup-failed',
    );
    expect(worktreesOf({ ...legacy, status: 'done' })[0].status).toBe('ready');
  });
  it('returns the list of a folder task', () => {
    expect(worktreesOf(folder).map((w) => w.dir)).toEqual(['api', 'web']);
  });
});

describe('patchWorktree', () => {
  it('writes an old task’s own fields', () => {
    const t = structuredClone(legacy);
    patchWorktree(t, 'r1', { baseSha: 'def', summary: null, dir: 'x' });
    expect(t.baseSha).toBe('def');
    expect('dir' in t).toBe(false);
  });
  it('writes the entry of a folder task', () => {
    const t = structuredClone(folder);
    patchWorktree(t, 'r2', { baseSha: 'def' });
    expect(t.worktrees?.[1].baseSha).toBe('def');
    expect(t.worktrees?.[0].baseSha).toBeNull();
  });
});

describe('terminalCwd', () => {
  it('runs repo tabs in their worktree and the rest in the task folder', () => {
    expect(terminalCwd(folder, { repoId: 'r2' })).toBe('/tasks/5-store-it/web');
    expect(terminalCwd(folder, {})).toBe('/tasks/5-store-it');
    expect(terminalCwd(folder, { repoId: 'gone' })).toBe('/tasks/5-store-it');
    expect(terminalCwd(legacy, { repoId: 'r1' })).toBe(legacy.worktreePath);
  });
});

describe('names', () => {
  it('keeps task folder names short', () => {
    expect(
      folderName(
        {
          id: '48231',
          type: 'User Story',
          title: 'Show estimated delivery date on product page',
          url: null,
        },
        '',
      ),
    ).toBe('48231-show-estimated-deliv');
    expect(folderName(null, 'Spike: a much longer name than needed')).toBe(
      'spike-a-much-longer',
    );
  });
  it('makes repo folders unique within the task', () => {
    expect(repoDir('Web Shop', [])).toBe('web-shop');
    expect(repoDir('web-shop', ['web-shop'])).toBe('web-shop-2');
    expect(repoDir('web-shop', ['web-shop', 'web-shop-2'])).toBe('web-shop-3');
    expect(repoDir('!!!', [])).toBe('repo');
  });
});
