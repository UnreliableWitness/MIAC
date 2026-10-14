import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  addOrigin,
  cleanupTempRepos,
  commitFile,
  git,
  makeRepo,
} from '../test-helpers/gitRepo';
import { GitClient, GitError } from './GitClient';

const client = new GitClient();

afterAll(cleanupTempRepos);

describe('GitClient', () => {
  it('finds the toplevel and returns null outside a repo', async () => {
    const repo = makeRepo();
    expect(await client.toplevel(repo)).toBe(repo);
    expect(await client.toplevel(path.join(repo, '..'))).toBeNull();
  });

  it('reports branch existence and validity', async () => {
    const repo = makeRepo();
    expect(await client.branchExists(repo, 'main')).toBe(true);
    expect(await client.branchExists(repo, 'feature/x')).toBe(false);
    expect(
      await client.validBranchName(repo, 'feature/48213-save-address'),
    ).toBe(true);
    expect(await client.validBranchName(repo, 'bad name')).toBe(false);
    expect(await client.validBranchName(repo, 'bad..name')).toBe(false);
    expect(await client.validBranchName(repo, '-bad')).toBe(false);
    expect(await client.validBranchName(repo, '@{-1}')).toBe(false);
    expect(await client.validBranchName(repo, 'feature/trailing/')).toBe(false);
  });

  it('adds a worktree on a new branch from a base ref, then removes it', async () => {
    const repo = makeRepo();
    const wt = path.join(path.dirname(repo), 'repo.worktrees', 'x');
    await client.worktreeAdd(repo, {
      branch: 'feature/x',
      path: wt,
      baseRef: 'main',
    });
    expect(existsSync(path.join(wt, 'README.md'))).toBe(true);
    expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(
      'feature/x',
    );
    await client.worktreeRemove(repo, wt, true);
    expect(existsSync(wt)).toBe(false);
    await client.deleteBranch(repo, 'feature/x');
    expect(await client.branchExists(repo, 'feature/x')).toBe(false);
  });

  it('wraps failures in GitError with stderr', async () => {
    const repo = makeRepo();
    await expect(
      client.worktreeAdd(repo, {
        branch: 'y',
        path: path.join(repo, '..', 'y'),
        baseRef: 'nope',
      }),
    ).rejects.toBeInstanceOf(GitError);
    await expect(
      client.worktreeAdd(repo, {
        branch: 'y',
        path: path.join(repo, '..', 'y'),
        baseRef: 'nope',
      }),
    ).rejects.toThrow(/nope/);
  });

  it('fetches when the base ref names a known remote, and skips otherwise', async () => {
    const repo = makeRepo();
    expect(await client.fetch(repo, 'main')).toBe(false);
    expect(await client.fetch(repo, 'origin/main')).toBe(false);
    addOrigin(repo);
    expect(await client.fetch(repo, 'origin/main')).toBe(true);
    expect(await client.remotes(repo)).toEqual(['origin']);
  });

  it('summarises ahead, behind and changed files with an upstream', async () => {
    const repo = makeRepo();
    addOrigin(repo);
    commitFile(repo, 'a.txt', 'a');
    commitFile(repo, 'b.txt', 'b');
    writeFileSync(path.join(repo, 'README.md'), 'changed');
    writeFileSync(path.join(repo, 'new.txt'), 'new');
    const s = await client.summary(repo, 'origin/main');
    expect(s.branch).toBe('main');
    expect(s.hasUpstream).toBe(true);
    expect(s.ahead).toBe(2);
    expect(s.behind).toBe(0);
    expect(s.files).toEqual([
      { status: 'M', path: 'README.md' },
      { status: '?', path: 'new.txt' },
    ]);
  });

  it('counts commits since the base ref when there is no upstream', async () => {
    const repo = makeRepo();
    const wt = path.join(path.dirname(repo), 'wt');
    await client.worktreeAdd(repo, {
      branch: 'feature/z',
      path: wt,
      baseRef: 'main',
    });
    git(wt, 'config', 'user.email', 'tests@miac.local');
    git(wt, 'config', 'user.name', 'MIAC tests');
    commitFile(wt, 'z.txt', 'z');
    const s = await client.summary(wt, 'main');
    expect(s.branch).toBe('feature/z');
    expect(s.hasUpstream).toBe(false);
    expect(s.ahead).toBe(1);
    expect(s.files).toEqual([]);
  });

  it('reports HEAD for a detached worktree', async () => {
    const repo = makeRepo();
    const wt = path.join(path.dirname(repo), 'wt3');
    await client.worktreeAdd(repo, {
      branch: 'feature/d',
      path: wt,
      baseRef: 'main',
    });
    git(wt, 'checkout', '-q', '--detach');
    const s = await client.summary(wt, 'main');
    expect(s.branch).toBe('HEAD');
    expect(s.hasUpstream).toBe(false);
  });

  it('reports the branch name in a repo with no commits', async () => {
    const repo = makeRepo();
    const empty = path.join(path.dirname(repo), 'empty');
    git(path.dirname(repo), 'init', '-q', '-b', 'main', 'empty');
    const s = await client.summary(empty, 'main');
    expect(s.branch).toBe('main');
    expect(s.files).toEqual([]);
  });

  it('gives a non-empty reason when git cannot be spawned', async () => {
    const err = await client
      .run('/nonexistent-dir-miac', ['status'])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as GitError).message).toMatch(/ENOENT|spawn|no such file/i);
    expect((err as GitError).message.length).toBeGreaterThan(
      'git status failed'.length + 5,
    );
  });

  it('returns the common git dir for a worktree', async () => {
    const repo = makeRepo();
    const wt = path.join(path.dirname(repo), 'wt2');
    await client.worktreeAdd(repo, {
      branch: 'feature/c',
      path: wt,
      baseRef: 'main',
    });
    expect(await client.commonDir(wt)).toBe(path.join(repo, '.git'));
  });

  it('runs worktree add, remove and prune with core.longpaths on every OS', async () => {
    const repo = makeRepo();
    const wt = path.join(path.dirname(repo), 'longpaths');
    const spy = vi.spyOn(client, 'run');
    await client.worktreeAdd(repo, {
      branch: 'feature/lp',
      path: wt,
      baseRef: 'main',
    });
    await client.worktreeRemove(repo, wt, true);
    await client.worktreePrune(repo);
    const argsPerCall = spy.mock.calls.map(([, args]) => args);
    spy.mockRestore();
    expect(argsPerCall).toEqual([
      [
        '-c',
        'core.longpaths=true',
        'worktree',
        'add',
        '-b',
        'feature/lp',
        wt,
        'main',
      ],
      ['-c', 'core.longpaths=true', 'worktree', 'remove', '--force', wt],
      ['-c', 'core.longpaths=true', 'worktree', 'prune'],
    ]);
  });
});
