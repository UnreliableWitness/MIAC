import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TaskSchema, type Task, type Workspace } from '../../shared/types';
import type { Candidate } from './resolve';
import { joinVerdict } from './join';

const p = (...parts: string[]) => path.resolve('/src', ...parts);

const mkTask = (over: Partial<Task> = {}): Task =>
  TaskSchema.parse({
    id: 't1',
    repoId: 'r1',
    name: 'n',
    workItem: null,
    slug: 's',
    branch: 'feature/a',
    worktreePath: p('home.worktrees', 'a'),
    baseRef: 'main',
    status: 'ready',
    setup: { copy: true, commands: [], startClaude: false, openShell: true },
    terminals: [],
    createdAt: '2026-10-16T00:00:00.000Z',
    finishedAt: null,
    ...over,
  });

const ws = (worktreePath: string): Workspace => ({
  id: 'w',
  repoId: 'r2',
  branch: 'feature/a',
  worktreePath,
  baseRef: 'main',
  baseSha: null,
  source: 'detected',
  summary: null,
  pullRequest: null,
  reopen: null,
  dropped: false,
});

const cand = (
  worktreePath: string,
  over: Partial<Candidate> = {},
): Candidate => ({
  repoPath: p('b'),
  worktreePath,
  branch: 'feature/a',
  mainCheckout: false,
  ...over,
});

describe('joinVerdict', () => {
  const task = mkTask();

  it('joins a worktree of another repo nobody owns', () => {
    expect(joinVerdict(task, [task], cand(p('b.worktrees', 'a')))).toBe('join');
  });

  it('is home for the task its own worktree', () => {
    expect(joinVerdict(task, [task], cand(p('home.worktrees', 'a')))).toBe(
      'home',
    );
  });

  it('is already for an extra of this task', () => {
    const t = mkTask({ extraWorkspaces: [ws(p('b.worktrees', 'a'))] });
    expect(joinVerdict(t, [t], cand(p('b.worktrees', 'a')))).toBe('already');
  });

  it('is detached for a path the user removed', () => {
    const t = mkTask({ detachedPaths: [p('b.worktrees', 'a')] });
    expect(joinVerdict(t, [t], cand(p('b.worktrees', 'a')))).toBe('detached');
  });

  it('is main-checkout for a repo its main checkout', () => {
    expect(
      joinVerdict(task, [task], cand(p('b'), { mainCheckout: true })),
    ).toBe('main-checkout');
  });

  it('is other-task for the home worktree of another open task', () => {
    const other = mkTask({ id: 't2', worktreePath: p('b.worktrees', 'a') });
    expect(joinVerdict(task, [task, other], cand(p('b.worktrees', 'a')))).toBe(
      'other-task',
    );
  });

  it('is other-task for an extra of another open task, even on the same branch name', () => {
    const other = mkTask({
      id: 't2',
      branch: 'feature/a',
      worktreePath: p('c.worktrees', 'a'),
      extraWorkspaces: [ws(p('b.worktrees', 'a'))],
    });
    expect(joinVerdict(task, [task, other], cand(p('b.worktrees', 'a')))).toBe(
      'other-task',
    );
  });

  it('does not let a done task its old path block a join', () => {
    const done = mkTask({
      id: 't2',
      status: 'done',
      worktreePath: p('b.worktrees', 'a'),
    });
    expect(joinVerdict(task, [task, done], cand(p('b.worktrees', 'a')))).toBe(
      'join',
    );
  });

  it('checks home before detached and main checkout', () => {
    const t = mkTask({ detachedPaths: [p('home.worktrees', 'a')] });
    expect(joinVerdict(t, [t], cand(p('home.worktrees', 'a')))).toBe('home');
  });
});
