import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { SetupEvent } from '../../shared/types';
import { darwinPlatform } from '../platform/darwin';
import { addOrigin, cleanupTempRepos, makeRepo } from '../test-helpers/gitRepo';
import { GitClient } from './GitClient';
import {
  ensureExcluded,
  planSteps,
  SetupRunner,
  type SetupPlan,
} from './SetupRunner';

afterAll(cleanupTempRepos);

const git = new GitClient();
const runner = new SetupRunner(git, darwinPlatform({ SHELL: '/bin/sh' }));

function plan(repo: string, over: Partial<SetupPlan> = {}): SetupPlan {
  return {
    taskId: 'task1',
    repoPath: repo,
    worktreePath: path.join(path.dirname(repo), 'repo.worktrees', 'x'),
    branch: 'feature/x',
    baseRef: 'main',
    copy: [],
    commands: [],
    taskMd: '# Task\n',
    startTerminalsLabel: null,
    ...over,
  };
}

function collect() {
  const events: SetupEvent[] = [];
  return { events, onEvent: (e: SetupEvent) => events.push(e) };
}

describe('planSteps', () => {
  it('lists fetch, worktree, optional copy, task file, each command and optional terminals', () => {
    const steps = planSteps(
      plan('/r', {
        copy: ['.env'],
        commands: ['npm ci', 'npm run build'],
        startTerminalsLabel: 'Claude Code, zsh',
      }),
    );
    expect(steps.map((s) => s.kind)).toEqual([
      'fetch',
      'worktree',
      'copy',
      'task-file',
      'command',
      'command',
      'terminals',
    ]);
    expect(steps[4]).toEqual({
      kind: 'command',
      label: 'npm ci',
      detail: 'in worktree',
      command: 'npm ci',
    });
    expect(planSteps(plan('/r')).map((s) => s.kind)).toEqual([
      'fetch',
      'worktree',
      'task-file',
    ]);
  });
});

describe('SetupRunner', () => {
  it('creates the worktree, copies files, writes the task file, runs commands and starts terminals', async () => {
    const repo = makeRepo();
    addOrigin(repo);
    writeFileSync(path.join(repo, '.env'), 'SECRET=1');
    const p = plan(repo, {
      baseRef: 'origin/main',
      copy: ['.env', '.env.local'],
      commands: ['echo building > built.txt'],
      startTerminalsLabel: 'zsh',
    });
    const { events, onEvent } = collect();
    let started = false;
    const result = await runner.run(p, {
      onEvent,
      startTerminals: async () => {
        started = true;
      },
    });

    expect(result).toEqual({ ok: true });
    expect(started).toBe(true);
    expect(readFileSync(path.join(p.worktreePath, '.env'), 'utf8')).toBe(
      'SECRET=1',
    );
    expect(
      readFileSync(path.join(p.worktreePath, 'built.txt'), 'utf8').trim(),
    ).toBe('building');
    expect(
      readFileSync(path.join(p.worktreePath, '.miac', 'task.md'), 'utf8'),
    ).toBe('# Task\n');
    expect(
      readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8'),
    ).toContain('.miac/');
    expect(await git.summary(p.worktreePath, 'origin/main')).toMatchObject({
      files: [
        { status: '?', path: '.env' },
        { status: '?', path: 'built.txt' },
      ],
    });

    const stepEvents = events.filter((e) => e.type === 'step');
    expect(
      stepEvents.filter((e) => e.type === 'step' && e.status === 'done'),
    ).toHaveLength(6);
    expect(
      events.some(
        (e) => e.type === 'log' && e.line.includes('skipped .env.local'),
      ),
    ).toBe(true);
    expect(events.at(-1)).toEqual({
      taskId: 'task1',
      type: 'finished',
      ok: true,
    });
  });

  it('stops at a failing command, keeps the worktree and reports the step', async () => {
    const repo = makeRepo();
    const p = plan(repo, { commands: ['echo before', 'exit 3', 'echo never'] });
    const { events, onEvent } = collect();
    const result = await runner.run(p, {
      onEvent,
      startTerminals: async () => {},
    });
    expect(result).toEqual({ ok: false, failedStep: 4 });
    expect(existsSync(p.worktreePath)).toBe(true);
    const failed = events.find(
      (e) => e.type === 'step' && e.status === 'failed',
    );
    expect(failed).toMatchObject({
      index: 4,
      detail: expect.stringContaining('code 3'),
    });
    expect(events.some((e) => e.type === 'log' && e.line === 'before')).toBe(
      true,
    );
    expect(events.some((e) => e.type === 'log' && e.line === 'never')).toBe(
      false,
    );
  });

  it('retries from a step, marking earlier steps done without re-running them', async () => {
    const repo = makeRepo();
    const p = plan(repo, { commands: ['echo one >> log.txt', 'exit 1'] });
    await runner.run(p, { onEvent: () => {}, startTerminals: async () => {} });
    const fixed = {
      ...p,
      commands: ['echo one >> log.txt', 'echo two >> log.txt'],
    };
    const { events, onEvent } = collect();
    const result = await runner.run(fixed, {
      onEvent,
      startTerminals: async () => {},
      fromStep: 4,
    });
    expect(result).toEqual({ ok: true });
    expect(readFileSync(path.join(p.worktreePath, 'log.txt'), 'utf8')).toBe(
      'one\ntwo\n',
    );
    expect(
      events
        .filter((e) => e.type === 'step' && e.index < 4)
        .every((e) => e.type === 'step' && e.status === 'done'),
    ).toBe(true);
  });

  it('reports a git failure on the worktree step', async () => {
    const repo = makeRepo();
    const p = plan(repo, { baseRef: 'does-not-exist' });
    const { events, onEvent } = collect();
    const result = await runner.run(p, {
      onEvent,
      startTerminals: async () => {},
    });
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(1);
    const failed = events.find(
      (e) => e.type === 'step' && e.status === 'failed',
    );
    expect(failed).toMatchObject({
      index: 1,
      detail: expect.stringMatching(/invalid reference|not a valid|fatal/i),
    });
    expect(
      events.some(
        (e) =>
          e.type === 'log' &&
          !e.line.startsWith('$ git worktree add') &&
          /invalid reference|not a valid|fatal/i.test(e.line),
      ),
    ).toBe(true);
  });

  it('rejects a fromStep outside the plan', async () => {
    const repo = makeRepo();
    await expect(
      runner.run(plan(repo), {
        onEvent: () => {},
        startTerminals: async () => {},
        fromStep: 99,
      }),
    ).rejects.toThrow('Cannot retry from step 99: the plan has 3 steps');
  });

  it('skips copy entries that escape the repository or worktree', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, '.env'), 'SECRET=1');
    writeFileSync(path.join(path.dirname(repo), 'outside.txt'), 'x');
    const p = plan(repo, { copy: ['../outside.txt', '/etc/hosts', '.env'] });
    const { events, onEvent } = collect();
    const result = await runner.run(p, {
      onEvent,
      startTerminals: async () => {},
    });
    expect(result).toEqual({ ok: true });
    const lines = events.flatMap((e) => (e.type === 'log' ? [e.line] : []));
    expect(lines).toContain('skipped ../outside.txt (outside the repository)');
    expect(lines).toContain('skipped /etc/hosts (outside the repository)');
    expect(readFileSync(path.join(p.worktreePath, '.env'), 'utf8')).toBe(
      'SECRET=1',
    );
    expect(
      existsSync(path.join(path.dirname(p.worktreePath), 'outside.txt')),
    ).toBe(false);
    expect(existsSync(path.join(p.worktreePath, 'hosts'))).toBe(false);
  });
});

describe('ensureExcluded', () => {
  it('adds the pattern exactly once under concurrent calls', async () => {
    const repo = makeRepo();
    await Promise.all(
      Array.from({ length: 5 }, () => ensureExcluded(git, repo, '.miac/')),
    );
    const text = readFileSync(
      path.join(repo, '.git', 'info', 'exclude'),
      'utf8',
    );
    expect(text.split('\n').filter((l) => l.trim() === '.miac/')).toHaveLength(
      1,
    );
    expect(text.endsWith('\n')).toBe(true);
  });
});
