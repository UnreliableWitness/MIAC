// src/main/editors/EditorService.test.ts
import { describe, expect, it, vi } from 'vitest';
import { defaultEditorPrefs, type EditorPrefs } from '../../shared/editors';
import type { Command } from '../platform/Platform';
import { EditorService } from './EditorService';

const DEVENV = 'C:\\VS\\devenv.exe';

function make(
  o: {
    installed?: Record<string, string>;
    solutions?: string[];
    dotnet?: boolean;
    prefs?: EditorPrefs;
  } = {},
) {
  let prefs = o.prefs ?? defaultEditorPrefs();
  const launch = vi.fn(async (_c: Command) => undefined);
  const event = vi.fn();
  const detect = vi.fn(
    async () => o.installed ?? { vscode: 'code', visualstudio: DEVENV },
  );
  const service = new EditorService({
    platform: {
      editorCommand: (p) => ({ command: 'code', args: [p] }),
      editorGotoCommand: (wt, f, l, c) => ({
        command: 'code',
        args: [wt, '-g', `${f}:${l ?? 1}:${c ?? 1}`],
      }),
    },
    detect,
    scan: async () => ({
      solutions: o.solutions ?? [],
      dotnet: o.dotnet ?? false,
    }),
    prefs: () => prefs,
    savePrefs: async (p) => {
      prefs = p;
    },
    launch,
    event,
  });
  return { service, launch, event, detect, prefs: () => prefs };
}

describe('EditorService', () => {
  it('lists installed editors and detects once until asked again', async () => {
    const { service, detect } = make();
    expect(await service.choices()).toEqual([
      { id: 'vscode', label: 'VS Code' },
      { id: 'visualstudio', label: 'Visual Studio' },
    ]);
    await service.choices();
    expect(detect).toHaveBeenCalledTimes(1);
    await service.choices(true);
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('opens a .NET worktree’s solution in Visual Studio and reports it', async () => {
    const { service, launch, event } = make({
      solutions: ['App.sln'],
      dotnet: true,
    });
    await service.openFolder('r1', '/wt');
    expect(launch.mock.calls[0][0]).toEqual({
      command: DEVENV,
      args: [expect.stringContaining('App.sln')],
    });
    expect(event).toHaveBeenCalledWith('editor.opened', {
      editor: 'visualstudio',
      at: 'folder',
    });
  });

  it('remembers a picked solution per repo, and refuses one that is not in the worktree', async () => {
    const { service, prefs } = make({
      solutions: ['A.sln', 'B.sln'],
      dotnet: true,
    });
    expect((await service.options('r1', '/wt')).solution).toBe('A.sln');
    await service.openFolder('r1', '/wt', { solution: 'B.sln' });
    expect(prefs().repos.r1).toEqual({ editor: null, solution: 'B.sln' });
    expect((await service.options('r1', '/wt')).solution).toBe('B.sln');
    await expect(
      service.openFolder('r1', '/wt', { solution: '../evil.sln' }),
    ).rejects.toThrow('Unknown solution');
  });

  it('a one-off editor from the menu does not change the choice', async () => {
    const { service, launch, prefs } = make({ dotnet: true });
    await service.openFolder('r1', '/wt', { editorId: 'vscode' });
    expect(launch.mock.calls[0][0]).toEqual({ command: 'code', args: ['/wt'] });
    expect(prefs()).toEqual(defaultEditorPrefs());
  });

  it('opens a file at a line in either editor', async () => {
    const { service, launch, event } = make();
    await service.openFile('r1', '/wt', '/wt/a.ts', 3, 2);
    expect(launch.mock.calls[0][0]).toEqual({
      command: 'code',
      args: ['/wt', '-g', '/wt/a.ts:3:2'],
    });
    await service.openFile(
      'r1',
      '/wt',
      '/wt/a.cs',
      9,
      undefined,
      'visualstudio',
    );
    expect(launch.mock.calls[1][0]).toEqual({
      command: DEVENV,
      args: ['/edit', '/wt/a.cs', '/command', 'Edit.GoTo 9'],
    });
    expect(event).toHaveBeenLastCalledWith('editor.opened', {
      editor: 'visualstudio',
      at: 'file',
    });
  });

  it('says so when no editor is installed', async () => {
    const { service } = make({ installed: {} });
    expect((await service.options('r1', '/wt')).chosen).toBeNull();
    await expect(service.openFolder('r1', '/wt')).rejects.toThrow(
      'No editor found',
    );
  });
});
