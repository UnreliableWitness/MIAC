import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempRepos, makeRepo } from '../test-helpers/gitRepo';
import { GitClient } from './GitClient';
import { RepoRegistry } from './RepoRegistry';
import { TaskStore } from './TaskStore';

/** Scratch folders this test creates itself (state dirs, non-git dirs), removed in afterAll. */
const scratch: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
  cleanupTempRepos();
});

async function registry() {
  const store = new TaskStore(path.join(tempDir('miac-reg-'), 'state.json'));
  await store.load();
  return new RepoRegistry(store, new GitClient());
}

describe('RepoRegistry', () => {
  it('adds a repo with its name, default base and .miac.yml flag', async () => {
    const reg = await registry();
    const repo = makeRepo('webshop');
    const added = await reg.add(repo);
    expect(added).toMatchObject({
      name: 'webshop',
      path: repo,
      baseBranch: 'main',
      connectionId: null,
      miacYmlFound: false,
    });
    expect(reg.list()).toHaveLength(1);
    expect(reg.get(added.id)).toEqual(added);
  });

  it('takes the base branch from .miac.yml', async () => {
    const reg = await registry();
    const repo = makeRepo('api');
    writeFileSync(path.join(repo, '.miac.yml'), 'base: develop\n');
    expect(await reg.add(repo)).toMatchObject({
      baseBranch: 'develop',
      miacYmlFound: true,
    });
  });

  it('normalises a subfolder and a symlink to the toplevel and rejects duplicates', async () => {
    const reg = await registry();
    const repo = makeRepo('webshop');
    mkdirSync(path.join(repo, 'src'));
    const link = path.join(path.dirname(repo), 'link');
    symlinkSync(repo, link);
    const first = await reg.add(path.join(repo, 'src'));
    expect(first.path).toBe(repo);
    await expect(reg.add(repo)).rejects.toThrow(/already/);
    await expect(reg.add(link)).rejects.toThrow(/already/);
    expect(reg.list()).toHaveLength(1);
  });

  it('rejects a folder that is not a git repository', async () => {
    const reg = await registry();
    await expect(reg.add(tempDir('miac-notgit-'))).rejects.toThrow(
      /not a git repository/,
    );
  });

  it('rejects a folder that does not exist', async () => {
    const reg = await registry();
    await expect(
      reg.add(path.join(tempDir('miac-missing-'), 'nope')),
    ).rejects.toThrow(/does not exist/);
  });

  it('rejects a concurrent duplicate add', async () => {
    const reg = await registry();
    const repo = makeRepo('webshop');
    const results = await Promise.allSettled([reg.add(repo), reg.add(repo)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/already/) }),
    );
    expect(reg.list()).toHaveLength(1);
  });

  it('removes a repo and refuses when it still has open tasks', async () => {
    const reg = await registry();
    const repo = await reg.add(makeRepo('webshop'));
    await reg.remove(repo.id);
    expect(reg.list()).toHaveLength(0);
    const again = await reg.add(makeRepo('webshop'));
    await (reg as unknown as { store: TaskStore }).store.update((s) => {
      s.tasks.push({
        id: 't1',
        repoId: again.id,
        name: 'x',
        workItem: null,
        slug: 'x',
        branch: 'b',
        worktreePath: '/w',
        baseRef: 'main',
        status: 'ready',
        setup: {
          copy: false,
          commands: [],
          startClaude: false,
          openShell: false,
          openCopilot: false,
        },
        terminals: [],
        createdAt: 'now',
        finishedAt: null,
        usageSyncedAt: null,
        usageSyncError: null,
        usageCommentId: null,
      });
    });
    await expect(reg.remove(again.id)).rejects.toThrow(/open task/);
  });

  it('links and unlinks a connection', async () => {
    const reg = await registry();
    const repo = await reg.add(makeRepo('webshop'));
    expect((await reg.setConnection(repo.id, 'c1')).connectionId).toBe('c1');
    expect(reg.get(repo.id).connectionId).toBe('c1');
    expect((await reg.setConnection(repo.id, null)).connectionId).toBeNull();
    await expect(reg.setConnection('nope', 'c1')).rejects.toThrow(
      /Unknown repo/,
    );
  });
});
