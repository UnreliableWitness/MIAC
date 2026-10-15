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
  it('returns toplevel and commonDir in native path form', async () => {
    const c = new GitClient();
    const spy = vi.spyOn(c, 'run').mockResolvedValue('C:/x/y\n');
    expect(await c.toplevel('/anywhere')).toBe(path.resolve('C:/x/y'));
    expect(await c.commonDir('/anywhere')).toBe(
      path.resolve('/anywhere', 'C:/x/y'),
    );
    spy.mockRestore();
  });

  it('worktreeRemove retries while Windows still holds the folder', async () => {
    const waits: number[] = [];
    const c = new GitClient(async (ms) => {
      waits.push(ms);
    });
    let calls = 0;
    const spy = vi.spyOn(c, 'run').mockImplementation(async (_cwd, args) => {
      calls++;
      if (calls === 1)
        throw new GitError(
          args,
          "error: failed to delete 'C:/w': Permission denied",
          128,
        );
      if (calls === 2)
        throw new GitError(
          args,
          "error: failed to delete 'C:/w': Directory not empty",
          128,
        );
      return '';
    });
    await c.worktreeRemove('/repo', '/w', true);
    expect(calls).toBe(3);
    expect(waits).toEqual([50, 100]);
    spy.mockRestore();
  });

  it('worktreeRemove keeps retrying for about 5 s before giving up', async () => {
    const waits: number[] = [];
    const c = new GitClient(async (ms) => {
      waits.push(ms);
    });
    const spy = vi.spyOn(c, 'run').mockImplementation(async (_cwd, args) => {
      throw new GitError(
        args,
        "error: failed to delete 'C:/w': Permission denied",
        128,
      );
    });
    await expect(c.worktreeRemove('/repo', '/w', true)).rejects.toThrow(
      /Permission denied/,
    );
    expect(waits).toEqual([50, 100, 200, 400, 800, 1600, 1850]);
    expect(waits.reduce((a, b) => a + b, 0)).toBe(5000);
    spy.mockRestore();
  });

  it('worktreeRemove does not retry other failures', async () => {
    const waits: number[] = [];
    const c = new GitClient(async (ms) => {
      waits.push(ms);
    });
    const spy = vi.spyOn(c, 'run').mockImplementation(async (_cwd, args) => {
      throw new GitError(args, "fatal: '/w' is not a working tree", 128);
    });
    await expect(c.worktreeRemove('/repo', '/w', true)).rejects.toThrow(
      /not a working tree/,
    );
    expect(waits).toEqual([]);
    spy.mockRestore();
  });

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
        '--no-track',
        '-b',
        'feature/lp',
        wt,
        'main',
      ],
      ['rev-parse', 'HEAD'],
      ['-c', 'core.longpaths=true', 'worktree', 'remove', '--force', wt],
      ['-c', 'core.longpaths=true', 'worktree', 'prune'],
    ]);
  });

  it('summarises a finished branch: commits since the merge base, diff stat, local', async () => {
    const repo = makeRepo();
    const wt = path.join(path.dirname(repo), 'wt-sum');
    await client.worktreeAdd(repo, {
      branch: 'feature/sum',
      path: wt,
      baseRef: 'main',
    });
    // main moves on after the branch left it; that must not count.
    commitFile(repo, 'later.txt', 'later\n');
    commitFile(wt, 'a.txt', 'one\ntwo\n', 'Add a');
    writeFileSync(path.join(wt, 'README.md'), 'changed\n');
    git(wt, 'commit', '-q', '-am', 'Change the readme');
    const s = await client.finishSummary(wt, {
      baseRef: 'main',
      baseSha: null,
      branch: 'feature/sum',
    });
    expect(s.commitCount).toBe(2);
    expect(s.commits.map((c) => c.subject)).toEqual([
      'Add a',
      'Change the readme',
    ]);
    expect(s.commits[0].sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(s).toMatchObject({
      filesChanged: 2,
      insertions: 3,
      deletions: 1,
      pushed: false,
      upstream: null,
    });
  });

  it('worktreeAdd returns the commit the branch starts from', async () => {
    const repo = makeRepo();
    const wt = path.join(path.dirname(repo), 'wt-sha');
    const sha = await client.worktreeAdd(repo, {
      branch: 'feature/sha',
      path: wt,
      baseRef: 'main',
    });
    expect(sha).toBe(git(repo, 'rev-parse', 'main').trim());
  });

  it('measures from the recorded base commit, so a merged and fetched PR still lists its commits', async () => {
    const repo = makeRepo();
    const wt = path.join(path.dirname(repo), 'wt-merged');
    const baseSha = await client.worktreeAdd(repo, {
      branch: 'feature/merged',
      path: wt,
      baseRef: 'main',
    });
    commitFile(wt, 'a.txt', 'one\n', 'Add a');
    // The PR completes with a merge commit, and main is pulled: HEAD is now an ancestor of the base.
    git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge PR', 'feature/merged');
    const fallback = await client.finishSummary(wt, {
      baseRef: 'main',
      baseSha: null,
      branch: 'feature/merged',
    });
    expect(fallback.commitCount).toBe(0);
    const s = await client.finishSummary(wt, {
      baseRef: 'main',
      baseSha,
      branch: 'feature/merged',
    });
    expect(s).toMatchObject({
      baseKnown: true,
      commitCount: 1,
      commits: [{ subject: 'Add a' }],
      filesChanged: 1,
      insertions: 1,
    });
  });

  it('lists no commits when neither the recorded base nor the base ref resolves', async () => {
    const repo = makeRepo();
    for (let i = 0; i < 3; i++)
      git(repo, 'commit', '-q', '--allow-empty', '-m', `Old ${i}`);
    const s = await client.finishSummary(repo, {
      baseRef: 'origin/gone',
      baseSha: '0123456789abcdef0123456789abcdef01234567',
      branch: 'main',
    });
    expect(s).toMatchObject({
      baseKnown: false,
      commits: [],
      commitCount: 0,
      filesChanged: 0,
    });
  });

  it('does not make the base the upstream of a worktree branch made from origin/<base>', async () => {
    const repo = makeRepo();
    addOrigin(repo);
    const wt = path.join(path.dirname(repo), 'wt-notrack');
    await client.worktreeAdd(repo, {
      branch: 'feature/notrack',
      path: wt,
      baseRef: 'origin/main',
    });
    expect(() => git(wt, 'rev-parse', '--abbrev-ref', '@{u}')).toThrow();
    commitFile(wt, 'a.txt', 'a\n');
    const s = await client.finishSummary(wt, {
      baseRef: 'origin/main',
      baseSha: null,
      branch: 'feature/notrack',
    });
    expect(s).toMatchObject({ pushed: false, upstream: null });
    expect((await client.summary(wt, 'origin/main')).ahead).toBe(1);
  });

  it('counts a branch pushed without -u as pushed, by looking at origin/<branch>', async () => {
    const repo = makeRepo();
    addOrigin(repo);
    const wt = path.join(path.dirname(repo), 'wt-pushed');
    await client.worktreeAdd(repo, {
      branch: 'feature/pushed',
      path: wt,
      baseRef: 'origin/main',
    });
    // An upstream set to the base (old tasks, or a user's own config) must not decide the answer.
    git(wt, 'branch', '--set-upstream-to=origin/main');
    commitFile(wt, 'a.txt', 'a\n');
    git(wt, 'push', '-q', 'origin', 'feature/pushed');
    const s = await client.finishSummary(wt, {
      baseRef: 'origin/main',
      baseSha: null,
      branch: 'feature/pushed',
    });
    expect(s).toMatchObject({
      pushed: true,
      upstream: 'origin/feature/pushed',
    });
    commitFile(wt, 'b.txt', 'b\n');
    expect(
      await client.finishSummary(wt, {
        baseRef: 'origin/main',
        baseSha: null,
        branch: 'feature/pushed',
      }),
    ).toMatchObject({ pushed: false, upstream: 'origin/feature/pushed' });
  });

  it('reports a pushed branch with its upstream, and caps the list at 50 commits', async () => {
    const repo = makeRepo();
    addOrigin(repo);
    git(repo, 'checkout', '-q', '-b', 'feature/many');
    for (let i = 1; i <= 52; i++)
      git(repo, 'commit', '-q', '--allow-empty', '-m', `Step ${i}`);
    git(repo, 'push', '-q', '-u', 'origin', 'feature/many');
    const s = await client.finishSummary(repo, {
      baseRef: 'origin/main',
      baseSha: null,
      branch: 'feature/many',
    });
    expect(s.commitCount).toBe(52);
    expect(s.commits).toHaveLength(50);
    // The newest 50, shown oldest first.
    expect(s.commits[0].subject).toBe('Step 3');
    expect(s.commits[49].subject).toBe('Step 52');
    expect(s).toMatchObject({
      filesChanged: 0,
      pushed: true,
      upstream: 'origin/feature/many',
    });
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'Not pushed');
    expect(
      (
        await client.finishSummary(repo, {
          baseRef: 'origin/main',
          baseSha: null,
          branch: 'feature/many',
        })
      ).pushed,
    ).toBe(false);
  });
});
