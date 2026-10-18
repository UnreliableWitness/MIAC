import {
  mkdirSync,
  promises as fsp,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { GitClient } from '../services/GitClient';
import {
  cleanupTempRepos,
  commitFile,
  git,
  makeRepo,
} from '../test-helpers/gitRepo';
import {
  isInside,
  listDocs,
  MAX_DOC_BYTES,
  readAsset,
  readDoc,
  resolveInWorktree,
  resolveLink,
} from './worktreeFiles';

afterAll(() => cleanupTempRepos());
const gc = new GitClient();
const canSymlink = process.platform !== 'win32';

describe('isInside', () => {
  it('accepts the root and children, rejects siblings and parents', () => {
    expect(isInside('/a/wt', '/a/wt', path.posix)).toBe(true);
    expect(isInside('/a/wt', '/a/wt/x/y.md', path.posix)).toBe(true);
    expect(isInside('/a/wt', '/a/wt2/y.md', path.posix)).toBe(false);
    expect(isInside('/a/wt', '/a/y.md', path.posix)).toBe(false);
  });
  it('is case-insensitive for Windows paths', () => {
    expect(isInside('C:\\Src\\WT', 'c:\\src\\wt\\a.md', path.win32)).toBe(true);
    expect(isInside('C:\\Src\\WT', 'C:\\Src\\WT2\\a.md', path.win32)).toBe(
      false,
    );
  });
});

describe('resolveInWorktree', () => {
  it('resolves a relative file and an absolute path inside', async () => {
    const repo = makeRepo();
    const abs = await resolveInWorktree(repo, 'README.md');
    expect(abs.endsWith('README.md')).toBe(true);
    expect(await resolveInWorktree(repo, path.join(repo, 'README.md'))).toBe(
      abs,
    );
  });
  it.each(['../outside.md', '/etc/hosts', '', 'a\0b.md'])(
    'rejects %j as outside the worktree',
    async (rel) => {
      const repo = makeRepo();
      writeFileSync(path.join(path.dirname(repo), 'outside.md'), 'x');
      await expect(resolveInWorktree(repo, rel)).rejects.toThrow(
        'Outside the worktree',
      );
    },
  );
  it('rejects a missing file and a directory as not found', async () => {
    const repo = makeRepo();
    mkdirSync(path.join(repo, 'docs'));
    await expect(resolveInWorktree(repo, 'nope.md')).rejects.toThrow(
      'Not found',
    );
    await expect(resolveInWorktree(repo, 'docs')).rejects.toThrow('Not found');
  });
  it.runIf(canSymlink)('rejects a symlink that points outside', async () => {
    const repo = makeRepo();
    const out = path.join(os.tmpdir(), `shellie-out-${Date.now()}.md`);
    writeFileSync(out, 'secret');
    symlinkSync(out, path.join(repo, 'link.md'));
    await expect(resolveInWorktree(repo, 'link.md')).rejects.toThrow(
      'Outside the worktree',
    );
  });
  it.runIf(canSymlink)('accepts a symlink that stays inside', async () => {
    const repo = makeRepo();
    symlinkSync(path.join(repo, 'README.md'), path.join(repo, 'alias.md'));
    expect(await resolveInWorktree(repo, 'alias.md')).toBe(
      await resolveInWorktree(repo, 'README.md'),
    );
  });
});

describe('listDocs', () => {
  it('lists tracked and untracked Markdown, skips ignored, pins the task file, flags changes', async () => {
    const repo = makeRepo();
    commitFile(repo, '.gitignore', 'node_modules/\n');
    mkdirSync(path.join(repo, 'docs'));
    commitFile(repo, 'docs/old.md', 'old\n');
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    writeFileSync(path.join(repo, 'docs/old.md'), 'changed\n');
    mkdirSync(path.join(repo, 'notes'));
    writeFileSync(path.join(repo, 'notes/ü plan.md'), 'new\n');
    mkdirSync(path.join(repo, 'node_modules/pkg'), { recursive: true });
    writeFileSync(path.join(repo, 'node_modules/pkg/README.md'), 'x');
    writeFileSync(path.join(repo, 'code.ts'), 'x');
    mkdirSync(path.join(repo, '.shellie'));
    writeFileSync(path.join(repo, '.shellie/task.md'), '# task');
    git(repo, 'config', 'core.excludesFile', '/dev/null');
    writeFileSync(path.join(repo, '.git/info/exclude'), '.shellie/\n');

    const files = await listDocs(gc, repo, base);
    expect(files).toEqual([
      { path: '.shellie/task.md', changed: null },
      { path: 'README.md', changed: null },
      { path: 'docs/old.md', changed: 'modified' },
      { path: 'notes/ü plan.md', changed: 'new' },
    ]);
  });
  it('has no change flags without a base', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, 'new.md'), 'x');
    const files = await listDocs(gc, repo, null);
    expect(files.every((f) => f.changed === null)).toBe(true);
  });
  it('caps the list at 2000 files', async () => {
    const repo = makeRepo();
    mkdirSync(path.join(repo, 'many'));
    for (let i = 0; i < 2005; i++)
      writeFileSync(path.join(repo, 'many', `f${i}.md`), '');
    expect((await listDocs(gc, repo, null)).length).toBe(2000);
  });
  it('stats at most 2000 listed files plus the task file', async () => {
    const repo = makeRepo();
    mkdirSync(path.join(repo, 'many'));
    for (let i = 0; i < 2100; i++)
      writeFileSync(
        path.join(repo, 'many', `f${String(i).padStart(4, '0')}.md`),
        '',
      );
    const stat = vi.spyOn(fsp, 'stat');
    try {
      const files = await listDocs(gc, repo, null);
      expect(files).toHaveLength(2000);
      expect(files[0].path).toBe('README.md');
      expect(files.at(-1)!.path).toBe('many/f1998.md');
      expect(stat.mock.calls.length).toBeLessThanOrEqual(2001);
    } finally {
      stat.mockRestore();
    }
  });
});

describe('reads', () => {
  it('reads a document and refuses one over 2 MB', async () => {
    const repo = makeRepo();
    expect((await readDoc(repo, 'README.md')).text).toBe('# test\n');
    writeFileSync(path.join(repo, 'big.md'), 'x'.repeat(MAX_DOC_BYTES + 1));
    await expect(readDoc(repo, 'big.md')).rejects.toThrow('Too large');
  });
  it('returns images as data URLs and refuses other types', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, 'a.png'), Buffer.from([0x89, 0x50]));
    writeFileSync(path.join(repo, 'b.svg'), '<svg/>');
    expect(await readAsset(repo, 'a.png')).toBe('data:image/png;base64,iVA=');
    expect(await readAsset(repo, 'b.svg')).toMatch(
      /^data:image\/svg\+xml;base64,/,
    );
    await expect(readAsset(repo, 'README.md')).rejects.toThrow('Not an image');
  });
  it('resolves links to md and other files, null for anything else', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, 'x.ts'), '');
    expect(await resolveLink(repo, './README.md')).toEqual({
      path: 'README.md',
      kind: 'md',
    });
    expect(await resolveLink(repo, path.join(repo, 'x.ts'))).toEqual({
      path: 'x.ts',
      kind: 'file',
    });
    expect(await resolveLink(repo, '../nope.ts')).toBeNull();
    expect(await resolveLink(repo, 'missing.md')).toBeNull();
  });
});
