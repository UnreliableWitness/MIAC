// src/main/editors/editors.test.ts
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  type DetectDeps,
  detectEditors,
  scanProject,
  systemDetectDeps,
  visualStudioFile,
  visualStudioFolder,
} from './editors';

const VSWHERE =
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
const DEVENV = 'C:\\VS\\Common7\\IDE\\devenv.exe';
const VSWHERE_ARGS = [
  '-all',
  '-products',
  '*',
  '-prerelease',
  '-format',
  'json',
  '-utf8',
  '-nologo',
];
const instance = (
  productPath: string,
  o: Partial<{
    installationVersion: string;
    isLaunchable: boolean;
    isComplete: boolean;
    isPrerelease: boolean;
  }> = {},
) => ({
  productPath,
  installationVersion: '18.10.12224.181',
  isComplete: true,
  isLaunchable: true,
  isPrerelease: false,
  ...o,
});
const vswhereJson = (instances: unknown[]) => JSON.stringify(instances);

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
    const execFile = vi.fn(async () => vswhereJson([instance(DEVENV)]));
    const found = await detectEditors({
      platform: 'win32',
      env: { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
      which: (n) => (n === 'code' ? 'C:\\bin\\code.cmd' : null),
      exists: (p) => p === VSWHERE || p === DEVENV,
      execFile,
    });
    expect(found).toEqual({ vscode: 'code', visualstudio: DEVENV });
    expect(execFile).toHaveBeenCalledWith(VSWHERE, VSWHERE_ARGS);
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

  // #94: Visual Studio was installed but the menu offered VS Code only.
  describe('Visual Studio that plain `vswhere -latest` misses (#94)', () => {
    const win = (o: Partial<DetectDeps> & { files: string[] }): DetectDeps => ({
      platform: 'win32',
      env: {
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
        ProgramFiles: 'C:\\Program Files',
        SystemRoot: 'C:\\Windows',
      },
      which: () => null,
      exists: (p) => o.files.includes(p),
      execFile: async () => {
        throw new Error('not here');
      },
      ...o,
    });
    const INSIDERS =
      'C:\\Program Files\\Microsoft Visual Studio\\18\\Insiders\\Common7\\IDE\\devenv.exe';

    it('finds a prerelease (Insiders) or not yet launchable install: asks for every product and prerelease', async () => {
      // vswhere hides these without -prerelease / -all; with them it lists them.
      const execFile = vi.fn(async (_f: string, args: string[]) =>
        args.includes('-prerelease') && args.includes('-all')
          ? vswhereJson([
              instance(INSIDERS, {
                isPrerelease: true,
                isLaunchable: false,
                isComplete: false,
              }),
            ])
          : '',
      );
      expect(
        (await detectEditors(win({ files: [VSWHERE, INSIDERS], execFile })))
          .visualstudio,
      ).toBe(INSIDERS);
    });

    it('takes the newest launchable devenv, skipping Build Tools (no productPath) and missing files', async () => {
      const VS22 =
        'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\IDE\\devenv.exe';
      const VS26 =
        'C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\Common7\\IDE\\devenv.exe';
      const GONE = 'C:\\Gone\\devenv.exe';
      const execFile = async () =>
        vswhereJson([
          instance(VS22, { installationVersion: '17.14.1' }),
          {
            ...instance('', { installationVersion: '18.9.0' }),
            productPath: undefined,
          },
          instance(GONE, { installationVersion: '19.0.0' }),
          instance(VS26, { installationVersion: '18.10.3' }),
          instance(INSIDERS, {
            installationVersion: '18.11.0',
            isLaunchable: false,
          }),
        ]);
      expect(
        (
          await detectEditors(
            win({ files: [VSWHERE, VS22, VS26, INSIDERS], execFile }),
          )
        ).visualstudio,
      ).toBe(VS26);
    });

    it('reads the environment case-insensitively and also looks for vswhere under Program Files', async () => {
      const PF_VSWHERE =
        'D:\\Apps\\Microsoft Visual Studio\\Installer\\vswhere.exe';
      const execFile = vi.fn(async () => vswhereJson([instance(DEVENV)]));
      const found = await detectEditors(
        win({
          env: { PROGRAMFILES: 'D:\\Apps' },
          files: [PF_VSWHERE, DEVENV],
          execFile,
        }),
      );
      expect(found.visualstudio).toBe(DEVENV);
      expect(execFile).toHaveBeenCalledWith(PF_VSWHERE, VSWHERE_ARGS);
    });

    it('falls back to the old vswhere query when JSON output is not supported', async () => {
      const execFile = vi.fn(async (_f: string, args: string[]) => {
        if (args.includes('json')) throw new Error('unknown -utf8');
        return `${DEVENV}\r\n`;
      });
      expect(
        (await detectEditors(win({ files: [VSWHERE, DEVENV], execFile })))
          .visualstudio,
      ).toBe(DEVENV);
    });

    it('without vswhere: the registry App Paths entry for devenv.exe', async () => {
      const REG = 'C:\\Windows\\System32\\reg.exe';
      const execFile = vi.fn(async (f: string) => {
        if (f !== REG) throw new Error('no');
        return [
          '',
          'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\devenv.exe',
          `    (Default)    REG_SZ    "${INSIDERS}"`,
          '',
        ].join('\r\n');
      });
      expect(
        (await detectEditors(win({ files: [INSIDERS], execFile })))
          .visualstudio,
      ).toBe(INSIDERS);
    });

    it('without vswhere or registry: the known install folders (2026 is "18")', async () => {
      const COMMUNITY =
        'C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\Common7\\IDE\\devenv.exe';
      expect(
        (await detectEditors(win({ files: [COMMUNITY] }))).visualstudio,
      ).toBe(COMMUNITY);
    });
  });

  // Real detection on the Windows runner, which has Visual Studio installed.
  it.runIf(process.platform === 'win32' && existsSync(VSWHERE))(
    'Windows runner: finds the installed Visual Studio for real',
    async () => {
      const found = await detectEditors(systemDetectDeps());
      expect(found.visualstudio).toMatch(/devenv\.exe$/i);
      expect(existsSync(found.visualstudio ?? '')).toBe(true);
    },
  );
});

describe('scanProject', () => {
  it('finds solutions at the root and below, root first, not in dependency folders; .csproj marks .NET', async () => {
    const wt = mkdtempSync(path.join(os.tmpdir(), 'shellie-ed-'));
    writeFileSync(path.join(wt, 'App.sln'), '');
    mkdirSync(path.join(wt, 'tools'));
    writeFileSync(path.join(wt, 'tools', 'Tools.slnx'), '');
    mkdirSync(path.join(wt, 'node_modules', 'x'), { recursive: true });
    writeFileSync(path.join(wt, 'node_modules', 'x', 'No.sln'), '');
    mkdirSync(path.join(wt, 'a', 'deep', 'deeper'), { recursive: true });
    writeFileSync(path.join(wt, 'a', 'deep', 'deeper', 'Deep.sln'), '');
    expect(await scanProject(wt)).toEqual({
      solutions: ['App.sln', path.join('tools', 'Tools.slnx')],
      dotnet: true,
    });
  });

  it('finds a solution two folders down (src/App/App.sln), after the shallower ones (#94)', async () => {
    const wt = mkdtempSync(path.join(os.tmpdir(), 'shellie-ed-'));
    mkdirSync(path.join(wt, 'src', 'Dxp'), { recursive: true });
    writeFileSync(path.join(wt, 'src', 'Dxp', 'Dxp.sln'), '');
    mkdirSync(path.join(wt, 'tools'));
    writeFileSync(path.join(wt, 'tools', 'Tools.sln'), '');
    mkdirSync(path.join(wt, 'src', 'Dxp', 'bin', 'Debug'), { recursive: true });
    writeFileSync(path.join(wt, 'src', 'Dxp', 'bin', 'No.sln'), '');
    mkdirSync(path.join(wt, 'a', 'b', 'c'), { recursive: true });
    writeFileSync(path.join(wt, 'a', 'b', 'c', 'TooDeep.sln'), '');
    expect(await scanProject(wt)).toEqual({
      solutions: [
        path.join('tools', 'Tools.sln'),
        path.join('src', 'Dxp', 'Dxp.sln'),
      ],
      dotnet: true,
    });
  });

  it('a .csproj alone is .NET without solutions; a plain repo is neither', async () => {
    const a = mkdtempSync(path.join(os.tmpdir(), 'shellie-ed-'));
    mkdirSync(path.join(a, 'src'));
    writeFileSync(path.join(a, 'src', 'Api.csproj'), '');
    expect(await scanProject(a)).toEqual({ solutions: [], dotnet: true });
    const b = mkdtempSync(path.join(os.tmpdir(), 'shellie-ed-'));
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
