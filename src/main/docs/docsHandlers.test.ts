import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../shared/types';
import type { Command } from '../platform/Platform';
import { GitClient } from '../services/GitClient';
import { cleanupTempRepos, git, makeRepo } from '../test-helpers/gitRepo';
import { DocsWatcher } from './DocsWatcher';
import { allowedLink, createDocsHandlers } from './docsHandlers';

afterAll(() => cleanupTempRepos());

function setup(status: Task['status'] = 'ready') {
  const repo = makeRepo();
  const task = { id: 't1', status, worktreePath: repo, baseSha: null } as Task;
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

describe('docs handlers: task folder', () => {
  function folderSetup() {
    const api = makeRepo('api');
    const folder = path.dirname(api);
    git(folder, 'clone', '-q', api, 'web');
    const base = git(api, 'rev-parse', 'HEAD').trim();
    mkdirSync(path.join(api, 'docs'));
    writeFileSync(path.join(api, 'docs', 'plan.md'), '# plan\n');
    writeFileSync(path.join(folder, 'CLAUDE.md'), '# task\n');
    mkdirSync(path.join(folder, '.miac'));
    writeFileSync(path.join(folder, '.miac', 'task.md'), 'notes\n');
    const task = {
      id: 't1',
      status: 'ready',
      worktreePath: folder,
      folder,
      baseSha: null,
      worktrees: [
        { repoId: 'r1', dir: 'api', path: api, baseSha: base, status: 'ready' },
        {
          repoId: 'r2',
          dir: 'web',
          path: path.join(folder, 'web'),
          baseSha: null,
          status: 'ready',
        },
      ],
      terminals: [{ id: 'sh', kind: 'shell', label: 'zsh', repoId: 'r1' }],
    } as unknown as Task;
    const h = createDocsHandlers({
      taskById: () => task,
      git: new GitClient(),
      editorGoto: () => ({ command: 'code', args: [] }),
      launch: async () => undefined,
      openExternal: async () => undefined,
      revealFile: () => undefined,
      watcher: new DocsWatcher(() => undefined),
      event: () => undefined,
    });
    return { h, folder };
  }

  it('lists the task files and each repo’s Markdown under its folder, with badges per repo', async () => {
    const { h } = folderSetup();
    expect((await h['docs:list']('t1')).files).toEqual([
      { path: '.miac/task.md', changed: null },
      { path: 'CLAUDE.md', changed: null },
      { path: 'api/README.md', changed: null },
      { path: 'api/docs/plan.md', changed: 'new' },
      { path: 'web/README.md', changed: null },
    ]);
    expect((await h['docs:read']('t1', 'api/docs/plan.md')).text).toBe(
      '# plan\n',
    );
  });

  it('resolves a path printed in a terminal against that terminal’s repo', async () => {
    const { h } = folderSetup();
    expect(await h['docs:resolve']('t1', 'docs/plan.md', 'sh')).toEqual({
      path: 'api/docs/plan.md',
      kind: 'md',
    });
    expect(await h['docs:resolve']('t1', 'web/README.md')).toEqual({
      path: 'web/README.md',
      kind: 'md',
    });
    expect(await h['docs:resolve']('t1', '../../x.md', 'sh')).toBeNull();
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
