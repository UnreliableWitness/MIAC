// src/main/editors/editors.ts
import { execFile as execFileCb } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { EditorId } from '../../shared/editors';
import type { Command } from '../platform/Platform';
import { which } from '../platform/which';

const execFileAsync = promisify(execFileCb);

/** Editor id → its executable. VS Code is `code`, started through the Platform's editor commands. */
export type Installed = Partial<Record<EditorId, string>>;

export type DetectDeps = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  which: (name: string) => string | null;
  exists: (p: string) => boolean;
  execFile: (file: string, args: string[]) => Promise<string>;
};

export function systemDetectDeps(): DetectDeps {
  return {
    platform: process.platform,
    env: process.env,
    which: (n) => which(n),
    exists: existsSync,
    execFile: async (file, args) =>
      (await execFileAsync(file, args, { windowsHide: true, timeout: 10000 }))
        .stdout,
  };
}

/**
 * What is installed. macOS keeps today's behaviour (VS Code through `code`, not checked). Windows: VS Code
 * when `code` is on PATH; Visual Studio (any edition, the latest) from vswhere, which every installer ships.
 */
export async function detectEditors(d: DetectDeps): Promise<Installed> {
  if (d.platform !== 'win32') return { vscode: 'code' };
  const found: Installed = {};
  if (d.which('code')) found.vscode = 'code';
  const pf = d.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const vswhere = path.win32.join(
    pf,
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  );
  if (d.exists(vswhere)) {
    try {
      const out = await d.execFile(vswhere, [
        '-latest',
        '-property',
        'productPath',
        '-nologo',
      ]);
      const exe = out.trim().split(/\r?\n/)[0]?.trim();
      if (exe && d.exists(exe)) found.visualstudio = exe;
    } catch {
      /* Visual Studio stays absent */
    }
  }
  return found;
}

const SKIP = new Set([
  'node_modules',
  'bin',
  'obj',
  'dist',
  'build',
  'out',
  'packages',
]);
const SOLUTION = /\.slnx?$/i;
const PROJECT = /\.csproj$/i;

/** Solutions and .NET projects in the worktree root and one folder down (build and dependency folders skipped). */
export async function scanProject(
  worktree: string,
): Promise<{ solutions: string[]; dotnet: boolean }> {
  const root: string[] = [];
  const nested: string[] = [];
  let dotnet = false;
  const read = async (dir: string) => {
    try {
      return await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const e of await read(worktree)) {
    if (e.isFile()) {
      if (SOLUTION.test(e.name)) root.push(e.name);
      if (PROJECT.test(e.name)) dotnet = true;
    } else if (
      e.isDirectory() &&
      !e.name.startsWith('.') &&
      !SKIP.has(e.name)
    ) {
      for (const f of await read(path.join(worktree, e.name))) {
        if (!f.isFile()) continue;
        if (SOLUTION.test(f.name)) nested.push(path.join(e.name, f.name));
        if (PROJECT.test(f.name)) dotnet = true;
      }
    }
  }
  const solutions = [...root.sort(), ...nested.sort()];
  return { solutions, dotnet: dotnet || solutions.length > 0 };
}

export function visualStudioFolder(
  exe: string,
  worktree: string,
  solution: string | null,
): Command {
  return {
    command: exe,
    args: [solution ? path.join(worktree, solution) : worktree],
  };
}

/** `/edit` reuses the running Visual Studio; `Edit.GoTo` moves to the line (to verify on Windows hardware). */
export function visualStudioFile(
  exe: string,
  file: string,
  line?: number,
): Command {
  return {
    command: exe,
    args: ['/edit', file, ...(line ? ['/command', `Edit.GoTo ${line}`] : [])],
  };
}
