import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitClient } from '../services/GitClient';
import { cleanupTempRepos, git, makeRepo } from '../test-helpers/gitRepo';
import { resolveCandidate, scanBranch, siblingRepos } from './resolve';

const client = new GitClient();
afterAll(cleanupTempRepos);

function withWorktree(branch = 'feat/x') {
  const repo = makeRepo();
  const wt = path.join(path.dirname(repo), 'wt');
  git(repo, 'worktree', 'add', '-q', '-b', branch, wt);
  return { repo, wt: realpathSync.native(wt), branch };
}

describe('resolveCandidate', () => {
  it('resolves a file inside a linked worktree', async () => {
    const { repo, wt, branch } = withWorktree();
    writeFileSync(path.join(wt, 'a.txt'), 'x');
    expect(await resolveCandidate(client, path.join(wt, 'a.txt'))).toEqual({
      repoPath: repo,
      worktreePath: wt,
      branch,
      mainCheckout: false,
    });
  });

  it('flags the main checkout', async () => {
    const repo = makeRepo();
    const c = await resolveCandidate(client, path.join(repo, 'README.md'));
    expect(c).toMatchObject({
      repoPath: repo,
      worktreePath: repo,
      branch: 'main',
      mainCheckout: true,
    });
  });

  it('resolves a deleted file whose folder exists, and one in a missing folder', async () => {
    const { wt } = withWorktree();
    expect(
      (await resolveCandidate(client, path.join(wt, 'gone.txt')))?.worktreePath,
    ).toBe(wt);
    expect(
      (await resolveCandidate(client, path.join(wt, 'no', 'such', 'f.txt')))
        ?.worktreePath,
    ).toBe(wt);
  });

  it('ignores a path outside any git repo', async () => {
    const dir = realpathSync.native(
      mkdtempSync(path.join(os.tmpdir(), 'miac-plain-')),
    );
    try {
      expect(
        await resolveCandidate(client, path.join(dir, 'notes.md')),
      ).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('scanBranch', () => {
  it('finds the worktree on the branch and skips a missing repo', async () => {
    const { repo, wt, branch } = withWorktree();
    const missing = path.join(path.dirname(repo), 'nope');
    expect(await scanBranch(client, [missing, repo], branch)).toEqual([
      { repoPath: repo, worktreePath: wt, branch, mainCheckout: false },
    ]);
    expect(await scanBranch(client, [repo], 'other')).toEqual([]);
  });
});

describe('siblingRepos', () => {
  it('returns a sibling repo, not the repo itself or its .worktrees folder', async () => {
    const repo = makeRepo('app');
    const root = path.dirname(repo);
    git(root, 'init', '-q', 'lib');
    git(root, 'init', '-q', 'app.worktrees');
    expect(await siblingRepos([repo])).toEqual([path.join(root, 'lib')]);
  });
});
