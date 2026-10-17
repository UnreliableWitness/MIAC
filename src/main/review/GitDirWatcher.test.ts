// src/main/review/GitDirWatcher.test.ts
import { afterAll, describe, expect, it, vi } from 'vitest';
import { GitClient } from '../services/GitClient';
import {
  cleanupTempRepos,
  commitFile,
  makeRepo,
} from '../test-helpers/gitRepo';
import { GitDirWatcher } from './GitDirWatcher';

afterAll(cleanupTempRepos);
const client = new GitClient();

describe('GitDirWatcher', () => {
  it('reports a commit once, debounced, and stops when the last holder leaves', async () => {
    const repo = makeRepo();
    const emit = vi.fn();
    const w = new GitDirWatcher((wt) => client.gitDir(wt), emit, 50);
    expect(await w.start('t1', repo)).toBe(true);
    expect(await w.start('t1', repo)).toBe(true);
    commitFile(repo, 'a.txt', 'a\n');
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('t1'), {
      timeout: 3000,
    });
    await new Promise((r) => setTimeout(r, 120));
    expect(emit).toHaveBeenCalledTimes(1);
    w.stop('t1');
    w.stop('t1');
    emit.mockClear();
    commitFile(repo, 'b.txt', 'b\n');
    await new Promise((r) => setTimeout(r, 300));
    expect(emit).not.toHaveBeenCalled();
  });

  it('is false for a folder that is not a git worktree', async () => {
    const w = new GitDirWatcher(
      (wt) => client.gitDir(wt),
      () => undefined,
    );
    expect(await w.start('t1', '/definitely/not/here')).toBe(false);
  });

  it('stopTask closes the task and its workspaces, stopTarget one target', async () => {
    const a = makeRepo('a');
    const emit = vi.fn();
    const w = new GitDirWatcher((wt) => client.gitDir(wt), emit, 20);
    await w.start('t1', a);
    await w.start('t1#ws2', a);
    await w.start('t2', a);
    w.stopTarget('t2');
    w.stopTask('t1');
    commitFile(a, 'x.txt', 'x\n');
    await new Promise((r) => setTimeout(r, 300));
    expect(emit).not.toHaveBeenCalled();
  });
});
