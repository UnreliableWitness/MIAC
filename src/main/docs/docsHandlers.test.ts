import { realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../shared/types';
import type { Command } from '../platform/Platform';
import { GitClient } from '../services/GitClient';
import {
  cleanupTempRepos,
  git as gitOut,
  makeRepo,
} from '../test-helpers/gitRepo';
import { DocsWatcher } from './DocsWatcher';
import { allowedLink, createDocsHandlers } from './docsHandlers';

afterAll(() => cleanupTempRepos());

function setup(status: Task['status'] = 'ready') {
  const repo = makeRepo();
  const task = {
    id: 't1',
    status,
    worktreePath: repo,
    baseSha: null,
    homeDropped: false,
    extraWorkspaces: [],
  } as unknown as Task;
  const launch = vi.fn(async (_cmd: Command) => undefined);
  const openExternal = vi.fn(async () => undefined);
  const revealFile = vi.fn();
  const watcher = new DocsWatcher(() => undefined);
  const h = createDocsHandlers({
    taskById: () => task,
    git: new GitClient(),
    editorGoto: (wt, f, l, c) => ({
      command: 'code',
      args: [wt, '-g', `${f}:${l ?? 1}:${c ?? 1}`],
    }),
    launch,
    openExternal,
    revealFile,
    watcher,
    event: () => undefined,
  });
  return { repo, h, launch, openExternal, revealFile, watcher };
}

describe('docs handlers', () => {
  it('lists and reads for a ready task', async () => {
    const { h } = setup();
    expect((await h['docs:list']('t1')).files.map((f) => f.path)).toEqual([
      'README.md',
    ]);
    expect((await h['docs:read']('t1', 'README.md')).text).toBe('# test\n');
  });
  it('refuses a task that is not ready', async () => {
    const { h } = setup('done');
    await expect(h['docs:list']('t1')).rejects.toThrow(
      'Cannot read docs of a task that is done',
    );
  });
  it('opens the editor at the file and line through the platform', async () => {
    const { h, launch, repo } = setup();
    await h['docs:openInEditor']('t1', 'README.md', 3, 2);
    const call = launch.mock.calls[0][0];
    expect(call.args[2]).toBe(
      `${realpathSync(path.join(repo, 'README.md'))}:3:2`,
    );
  });
  it('refuses to reveal or open outside the worktree', async () => {
    const { h, revealFile } = setup();
    await expect(h['docs:reveal']('t1', '../x')).rejects.toThrow(
      'Outside the worktree',
    );
    expect(revealFile).not.toHaveBeenCalled();
  });
  it('watch on/off reports live', async () => {
    const { h, watcher } = setup();
    expect(await h['docs:watch']('t1', true)).toEqual({ live: true });
    expect(watcher.active('t1')).toBe(true);
    await h['docs:watch']('t1', false);
    expect(watcher.active('t1')).toBe(false);
  });
});

describe('docs handlers across workspaces', () => {
  function multi() {
    const home = makeRepo('home');
    const extra = makeRepo('extra');
    writeFileSync(path.join(extra, 'only-extra.md'), '# extra\n');
    const task = {
      id: 't1',
      status: 'ready',
      worktreePath: home,
      baseSha: null,
      homeDropped: false,
      extraWorkspaces: [
        {
          id: 'w2',
          repoId: 'r2',
          branch: 'b',
          worktreePath: extra,
          baseRef: 'main',
          baseSha: gitOut(extra, 'rev-parse', 'HEAD').trim(),
          source: 'detected',
          dropped: false,
        },
      ],
    } as unknown as Task;
    const h = createDocsHandlers({
      taskById: () => task,
      git: new GitClient(),
      editorGoto: (wt, f) => ({ command: 'code', args: [wt, f] }),
      launch: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      revealFile: vi.fn(),
      watcher: new DocsWatcher(() => undefined),
      event: () => undefined,
    });
    return { h, extra };
  }
  it('lists an extra workspace marked against its own base', async () => {
    const { h } = multi();
    const files = (await h['docs:list']('t1#w2')).files;
    expect(files.map((f) => f.path).sort()).toEqual([
      'README.md',
      'only-extra.md',
    ]);
    expect(files.find((f) => f.path === 'only-extra.md')?.changed).toBe('new');
    expect(files.find((f) => f.path === 'README.md')?.changed).toBeNull();
    expect((await h['docs:list']('t1')).files.map((f) => f.path)).toEqual([
      'README.md',
    ]);
  });
  it('resolves a link that exists only in an extra workspace', async () => {
    const { h } = multi();
    expect(await h['docs:resolve']('t1', 'only-extra.md')).toEqual({
      path: 'only-extra.md',
      kind: 'md',
      workspaceId: 'w2',
    });
    expect(await h['docs:resolve']('t1', 'README.md')).toEqual({
      path: 'README.md',
      kind: 'md',
    });
    expect(await h['docs:resolve']('t1', 'nope.md')).toBeNull();
    expect(await h['docs:resolve']('t1#w2', 'README.md')).toMatchObject({
      workspaceId: 'w2',
    });
  });
});

describe('allowedLink', () => {
  it.each([
    ['https://example.com/a?b=1', true],
    ['http://localhost:5173/', true],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['https://user:pw@example.com', false],
    ['not a url', false],
  ])('%s -> %s', (url, ok) => expect(allowedLink(url)).toBe(ok));
});
