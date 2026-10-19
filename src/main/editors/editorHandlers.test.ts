// src/main/editors/editorHandlers.test.ts
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { defaultEditorPrefs } from '../../shared/editors';
import { testTask } from '../review/testTask';
import type { Command } from '../platform/Platform';
import { cleanupTempRepos, makeRepo } from '../test-helpers/gitRepo';
import { createEditorHandlers } from './editorHandlers';
import { EditorService } from './EditorService';

afterAll(cleanupTempRepos);

function setup() {
  const repo = makeRepo();
  const launch = vi.fn(async (_cmd: Command) => undefined);
  const editors = new EditorService({
    platform: {
      editorCommand: (p) => ({ command: 'code', args: [p] }),
      editorGotoCommand: (wt, f, l) => ({
        command: 'code',
        args: [wt, '-g', `${f}:${l ?? 1}:1`],
      }),
    },
    detect: async () => ({ vscode: 'code' }),
    scan: async () => ({ solutions: [], dotnet: false }),
    prefs: defaultEditorPrefs,
    savePrefs: async () => undefined,
    launch,
    event: () => undefined,
  });
  const task = testTask({ worktreePath: repo });
  const shown: string[] = [];
  return {
    repo,
    launch,
    shown,
    h: createEditorHandlers({
      taskById: () => task,
      editors,
      showFolder: async (p) => {
        shown.push(p);
      },
    }),
  };
}

describe('editor handlers', () => {
  it('opens the worktree folder in the file manager (#73)', async () => {
    const { h, repo, shown, launch } = setup();
    await h['editor:showFolder']('t1');
    expect(shown).toEqual([repo]);
    expect(launch).not.toHaveBeenCalled();
  });

  it('lists options for the task’s home worktree', async () => {
    const { h } = setup();
    expect((await h['editor:options']('t1')).chosen).toBe('vscode');
  });
  it('opens a file inside the worktree at a line', async () => {
    const { h, launch, repo } = setup();
    await h['editor:openFile']('t1', undefined, 'README.md', 7);
    expect(launch.mock.calls[0][0].args[2]).toBe(
      `${realpathSync(path.join(repo, 'README.md'))}:7:1`,
    );
  });
  it('refuses a file outside the worktree and an unknown editor id', async () => {
    const { h } = setup();
    await expect(
      h['editor:openFile']('t1', undefined, '../x', 1),
    ).rejects.toThrow('Outside the worktree');
    await expect(
      h['editor:openFolder']('t1', undefined, { editorId: 'notepad' as never }),
    ).rejects.toThrow();
  });
});
