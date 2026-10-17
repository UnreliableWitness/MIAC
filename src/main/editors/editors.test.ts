// src/main/editors/editors.test.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  detectEditors,
  scanProject,
  visualStudioFile,
  visualStudioFolder,
} from './editors';

const VSWHERE =
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
const DEVENV = 'C:\\VS\\Common7\\IDE\\devenv.exe';

describe('detectEditors', () => {
  it('macOS: VS Code as before (code), never Visual Studio', async () => {
    const execFile = vi.fn();
    expect(
      await detectEditors({
        platform: 'darwin',
        env: {},
        which: () => null,
        exists: () => false,
        execFile,
      }),
    ).toEqual({ vscode: 'code' });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('Windows: VS Code when code is on PATH, Visual Studio through vswhere', async () => {
    const execFile = vi.fn(async () => `${DEVENV}\r\n`);
    const found = await detectEditors({
      platform: 'win32',
      env: { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
      which: (n) => (n === 'code' ? 'C:\\bin\\code.cmd' : null),
      exists: (p) => p === VSWHERE || p === DEVENV,
      execFile,
    });
    expect(found).toEqual({ vscode: 'code', visualstudio: DEVENV });
    expect(execFile).toHaveBeenCalledWith(VSWHERE, [
      '-latest',
      '-property',
      'productPath',
      '-nologo',
    ]);
  });

  it('Windows: nothing when neither is installed or vswhere fails', async () => {
    expect(
      await detectEditors({
        platform: 'win32',
        env: {},
        which: () => null,
        exists: (p) => p === VSWHERE,
        execFile: async () => {
          throw new Error('boom');
        },
      }),
    ).toEqual({});
  });
});

describe('scanProject', () => {
  it('finds solutions at the root and one folder down, root first; .csproj marks .NET', async () => {
    const wt = mkdtempSync(path.join(os.tmpdir(), 'miac-ed-'));
    writeFileSync(path.join(wt, 'App.sln'), '');
    mkdirSync(path.join(wt, 'tools'));
    writeFileSync(path.join(wt, 'tools', 'Tools.slnx'), '');
    mkdirSync(path.join(wt, 'node_modules', 'x'), { recursive: true });
    writeFileSync(path.join(wt, 'node_modules', 'x', 'No.sln'), '');
    mkdirSync(path.join(wt, 'a', 'deep'), { recursive: true });
    writeFileSync(path.join(wt, 'a', 'deep', 'Deep.sln'), '');
    expect(await scanProject(wt)).toEqual({
      solutions: ['App.sln', path.join('tools', 'Tools.slnx')],
      dotnet: true,
    });
  });

  it('a .csproj alone is .NET without solutions; a plain repo is neither', async () => {
    const a = mkdtempSync(path.join(os.tmpdir(), 'miac-ed-'));
    mkdirSync(path.join(a, 'src'));
    writeFileSync(path.join(a, 'src', 'Api.csproj'), '');
    expect(await scanProject(a)).toEqual({ solutions: [], dotnet: true });
    const b = mkdtempSync(path.join(os.tmpdir(), 'miac-ed-'));
    writeFileSync(path.join(b, 'package.json'), '{}');
    expect(await scanProject(b)).toEqual({ solutions: [], dotnet: false });
  });
});

describe('Visual Studio commands', () => {
  it('opens the worktree’s own solution, else the folder', () => {
    expect(visualStudioFolder(DEVENV, 'C:\\wt', 'App.sln')).toEqual({
      command: DEVENV,
      args: [path.join('C:\\wt', 'App.sln')],
    });
    expect(visualStudioFolder(DEVENV, 'C:\\wt', null)).toEqual({
      command: DEVENV,
      args: ['C:\\wt'],
    });
  });
  it('opens a file in the running instance and goes to the line', () => {
    expect(visualStudioFile(DEVENV, 'C:\\wt\\a.cs', 42)).toEqual({
      command: DEVENV,
      args: ['/edit', 'C:\\wt\\a.cs', '/command', 'Edit.GoTo 42'],
    });
    expect(visualStudioFile(DEVENV, 'C:\\wt\\a.cs')).toEqual({
      command: DEVENV,
      args: ['/edit', 'C:\\wt\\a.cs'],
    });
  });
});
