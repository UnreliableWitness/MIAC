import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { DELETED_HASH } from '../../shared/review';
import { GitClient } from '../services/GitClient';
import {
  cleanupTempRepos,
  commitFile,
  git,
  makeRepo,
} from '../test-helpers/gitRepo';
import {
  assertRelPath,
  EMPTY_TREE,
  listCommits,
  listFiles,
  MAX_CONTENT,
  NoBaseError,
  parseNameStatus,
  parseNumstat,
  rangeFor,
  readContent,
  readSide,
} from './reviewGit';

const client = new GitClient();
afterAll(cleanupTempRepos);

/** A repo on branch `task` from `main`, with one commit, one staged, one unstaged and one untracked change. */
function taskRepo() {
  const repo = makeRepo();
  commitFile(repo, 'keep.ts', 'one\ntwo\nthree\n');
  commitFile(repo, 'old-name.ts', 'moved content\nline 2\nline 3\n');
  commitFile(repo, 'gone.ts', 'bye\n');
  const base = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', '-b', 'task');
  commitFile(repo, 'committed.ts', 'c1\nc2\n', 'add committed');
  git(repo, 'mv', 'old-name.ts', 'new-name.ts');
  git(repo, 'rm', '-q', 'gone.ts');
  git(repo, 'commit', '-q', '-m', 'rename and delete');
  writeFileSync(path.join(repo, 'keep.ts'), 'one\nTWO\nthree\n');
  writeFileSync(path.join(repo, 'staged.ts'), 's\n');
  git(repo, 'add', 'staged.ts');
  writeFileSync(path.join(repo, 'untracked.ts'), 'u1\nu2\nu3\n');
  return { repo, base };
}

describe('parsers', () => {
  it('reads -z name-status with renames', () => {
    expect(
      parseNameStatus('M\0a.ts\0R087\0old.ts\0new.ts\0A\0b c.ts\0'),
    ).toEqual([
      { status: 'M', path: 'a.ts' },
      { status: 'R', path: 'new.ts', oldPath: 'old.ts' },
      { status: 'A', path: 'b c.ts' },
    ]);
  });
  it('reads -z numstat with renames and binaries', () => {
    const m = parseNumstat(
      '3\t1\ta.ts\0' + '2\t0\t\0old.ts\0new.ts\0' + '-\t-\tlogo.png\0',
    );
    expect(m.get('a.ts')).toEqual({ added: 3, removed: 1, binary: false });
    expect(m.get('new.ts')).toEqual({ added: 2, removed: 0, binary: false });
    expect(m.get('logo.png')).toEqual({ added: 0, removed: 0, binary: true });
  });
});

describe('assertRelPath', () => {
  it('refuses absolute paths, parent folders and NUL', () => {
    for (const bad of ['/etc/passwd', '../x', 'a/../../x', 'a\0b', '', 'C:\\x'])
      expect(() => assertRelPath(bad)).toThrow('Outside the worktree');
    expect(() => assertRelPath('src/a b.ts')).not.toThrow();
  });
});

describe('listFiles', () => {
  it('All: committed, staged, unstaged and untracked together, sorted', async () => {
    const { repo, base } = taskRepo();
    const files = await listFiles(
      client,
      repo,
      await rangeFor(client, repo, { kind: 'all' }, base),
    );
    expect(files.map((f) => [f.status, f.path, f.oldPath])).toEqual([
      ['A', 'committed.ts', undefined],
      ['D', 'gone.ts', undefined],
      ['M', 'keep.ts', undefined],
      ['R', 'new-name.ts', 'old-name.ts'],
      ['A', 'staged.ts', undefined],
      ['A', 'untracked.ts', undefined],
    ]);
    const keep = files.find((f) => f.path === 'keep.ts')!;
    expect([keep.added, keep.removed]).toEqual([1, 1]);
    const untracked = files.find((f) => f.path === 'untracked.ts')!;
    expect(untracked.added).toBe(3);
    expect(files.find((f) => f.path === 'gone.ts')!.hash).toBe(DELETED_HASH);
    expect(keep.hash).toBe(git(repo, 'hash-object', 'keep.ts').trim());
  });

  it('Uncommitted: only what is not in HEAD', async () => {
    const { repo, base } = taskRepo();
    const files = await listFiles(
      client,
      repo,
      await rangeFor(client, repo, { kind: 'uncommitted' }, base),
    );
    expect(files.map((f) => f.path)).toEqual([
      'keep.ts',
      'staged.ts',
      'untracked.ts',
    ]);
  });

  it('Commit: one commit, hashes from the commit', async () => {
    const { repo, base } = taskRepo();
    const sha = git(repo, 'rev-list', '--reverse', `${base}..HEAD`)
      .trim()
      .split('\n')[0];
    const files = await listFiles(
      client,
      repo,
      await rangeFor(
        client,
        repo,
        { kind: 'commits', workspaceId: 'home', from: sha, to: sha },
        base,
      ),
    );
    expect(files.map((f) => f.path)).toEqual(['committed.ts']);
    expect(files[0].hash).toBe(
      git(repo, 'rev-parse', `${sha}:committed.ts`).trim(),
    );
  });

  it('a root commit diffs against the empty tree', async () => {
    const repo = makeRepo();
    const root = git(repo, 'rev-list', '--max-parents=0', 'HEAD').trim();
    const range = await rangeFor(
      client,
      repo,
      { kind: 'commits', workspaceId: 'home', from: root, to: root },
      null,
    );
    expect(range.from).toBe(EMPTY_TREE);
    expect((await listFiles(client, repo, range)).map((f) => f.path)).toEqual([
      'README.md',
    ]);
  });

  it('All without a base throws NoBaseError', async () => {
    const repo = makeRepo();
    await expect(
      rangeFor(client, repo, { kind: 'all' }, null),
    ).rejects.toBeInstanceOf(NoBaseError);
  });

  it('odd file names: spaces, unicode, a leading dash', async () => {
    const repo = makeRepo();
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    mkdirSync(path.join(repo, 'my docs'));
    writeFileSync(path.join(repo, 'my docs', 'ünï côde.md'), 'x\n');
    writeFileSync(path.join(repo, '-dash.ts'), 'y\n');
    commitFile(repo, 'README.md', '# changed\n');
    const files = await listFiles(client, repo, { from: base, to: null });
    expect(files.map((f) => f.path)).toEqual([
      '-dash.ts',
      'README.md',
      'my docs/ünï côde.md',
    ]);
    for (const f of files) expect(f.hash).toMatch(/^[0-9a-f]{40,64}$/);
  });

  it('hashes many files in chunks', async () => {
    const repo = makeRepo();
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    for (let i = 0; i < 450; i++)
      writeFileSync(path.join(repo, `f${i}.txt`), `${i}\n`);
    const spy = vi.spyOn(client, 'run');
    const files = await listFiles(client, repo, { from: base, to: null });
    expect(files).toHaveLength(450);
    const hashCalls = spy.mock.calls.filter(([, args]) =>
      args.includes('hash-object'),
    );
    expect(hashCalls).toHaveLength(3);
    spy.mockRestore();
  });

  it('marks a binary untracked file', async () => {
    const repo = makeRepo();
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    writeFileSync(path.join(repo, 'logo.bin'), Buffer.from([0, 1, 2, 0, 3]));
    const [f] = await listFiles(client, repo, { from: base, to: null });
    expect(f).toMatchObject({ path: 'logo.bin', binary: true, added: 0 });
  });
});

describe('listCommits', () => {
  it('lists the branch commits newest first, none without a base', async () => {
    const { repo, base } = taskRepo();
    const commits = await listCommits(client, repo, base);
    expect(commits.map((c) => c.subject)).toEqual([
      'rename and delete',
      'add committed',
    ]);
    expect(commits[0].sha).toMatch(/^[0-9a-f]{40}$/);
    expect(commits[0].author).toBe('MIAC tests');
    expect(await listCommits(client, repo, null)).toEqual([]);
  });
});

describe('readContent', () => {
  it('reads base and working tree sides, renames from the old path', async () => {
    const { repo, base } = taskRepo();
    const range = { from: base, to: null };
    const files = await listFiles(client, repo, range);
    const keep = await readContent(
      client,
      repo,
      range,
      files.find((f) => f.path === 'keep.ts')!,
    );
    expect(keep).toMatchObject({
      before: 'one\ntwo\nthree\n',
      after: 'one\nTWO\nthree\n',
      binary: false,
      tooLarge: false,
    });
    const renamed = await readContent(
      client,
      repo,
      range,
      files.find((f) => f.path === 'new-name.ts')!,
    );
    expect(renamed.before).toBe('moved content\nline 2\nline 3\n');
    const gone = await readContent(
      client,
      repo,
      range,
      files.find((f) => f.path === 'gone.ts')!,
    );
    expect(gone).toMatchObject({ before: 'bye\n', after: '' });
    const added = await readContent(
      client,
      repo,
      range,
      files.find((f) => f.path === 'untracked.ts')!,
    );
    expect(added.before).toBe('');
  });

  it('sends no text for a file over the limit', async () => {
    const repo = makeRepo();
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    writeFileSync(path.join(repo, 'big.txt'), 'x'.repeat(MAX_CONTENT + 1));
    const range = { from: base, to: null };
    const [f] = await listFiles(client, repo, range);
    const c = await readContent(client, repo, range, f);
    expect(c).toMatchObject({
      before: null,
      after: null,
      tooLarge: true,
      afterSize: MAX_CONTENT + 1,
    });
  });

  it('readSide reads a ref or the disk and is null when absent', async () => {
    const { repo, base } = taskRepo();
    expect(await readSide(client, repo, base, 'keep.ts')).toBe(
      'one\ntwo\nthree\n',
    );
    expect(await readSide(client, repo, null, 'keep.ts')).toBe(
      'one\nTWO\nthree\n',
    );
    expect(await readSide(client, repo, null, 'gone.ts')).toBeNull();
    expect(await readSide(client, repo, base, 'nope.ts')).toBeNull();
  });
});
