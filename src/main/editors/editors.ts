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

/** An environment variable by name, any case (a copied env is a plain object, not Windows' case-blind one). */
function envVar(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  return key === undefined ? undefined : env[key];
}

const W = path.win32;
const uniq = (xs: string[]) =>
  xs.filter(
    (x, i) => xs.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i,
  );

/** Program Files (x86) first (where every Visual Studio installer puts vswhere), then Program Files. */
function programFiles(env: NodeJS.ProcessEnv): string[] {
  return uniq(
    [
      envVar(env, 'ProgramFiles(x86)'),
      'C:\\Program Files (x86)',
      envVar(env, 'ProgramFiles'),
      envVar(env, 'ProgramW6432'),
      'C:\\Program Files',
    ].filter((p): p is string => Boolean(p)),
  );
}

/** Every instance, including prerelease (Insiders/Preview) and incomplete ones plain `-latest` leaves out. */
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

type VsInstance = {
  productPath?: string;
  installationVersion?: string;
  isLaunchable?: boolean;
};

const versionParts = (v: string | undefined) =>
  (v ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0);
function compareVersions(a: string | undefined, b: string | undefined): number {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The newest instance whose devenv.exe is on disk, launchable ones first (Build Tools have no devenv). */
function bestDevenv(
  instances: VsInstance[],
  exists: (p: string) => boolean,
): string | null {
  const usable = instances.filter(
    (i) =>
      typeof i.productPath === 'string' &&
      /devenv\.exe$/i.test(i.productPath) &&
      exists(i.productPath),
  );
  usable.sort(
    (a, b) =>
      Number(b.isLaunchable !== false) - Number(a.isLaunchable !== false) ||
      compareVersions(b.installationVersion, a.installationVersion),
  );
  return usable[0]?.productPath ?? null;
}

async function fromVswhere(d: DetectDeps): Promise<string | null> {
  const candidates = uniq([
    ...programFiles(d.env).map((pf) =>
      W.join(pf, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    ),
    ...[d.which('vswhere')].filter((p): p is string => Boolean(p)),
  ]).filter((p) => d.exists(p));
  for (const vswhere of candidates) {
    try {
      const parsed: unknown = JSON.parse(
        await d.execFile(vswhere, VSWHERE_ARGS),
      );
      const exe = Array.isArray(parsed)
        ? bestDevenv(parsed as VsInstance[], d.exists)
        : null;
      if (exe) return exe;
    } catch {
      // An old vswhere (before -utf8 / -format json): its plain query still finds a stable install.
      try {
        const out = await d.execFile(vswhere, [
          '-latest',
          '-property',
          'productPath',
          '-nologo',
        ]);
        const exe = out.trim().split(/\r?\n/)[0]?.trim();
        if (exe && d.exists(exe)) return exe;
      } catch {
        /* try the next one */
      }
    }
  }
  return null;
}

/** The App Paths entry the installer registers for devenv.exe. */
async function fromRegistry(d: DetectDeps): Promise<string | null> {
  const reg = W.join(
    envVar(d.env, 'SystemRoot') ?? 'C:\\Windows',
    'System32',
    'reg.exe',
  );
  try {
    const out = await d.execFile(reg, [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\devenv.exe',
      '/ve',
    ]);
    const m = /REG_(?:EXPAND_)?SZ\s+"?([^"\r\n]+?)"?\s*$/m.exec(out);
    const exe = m?.[1]?.trim();
    return exe && d.exists(exe) ? exe : null;
  } catch {
    return null;
  }
}

/** Default install folders, newest first (Visual Studio 2026 installs as "18"). */
function fromKnownFolders(d: DetectDeps): string | null {
  const versions = ['18', '2022', '2019', '2017'];
  const editions = [
    'Enterprise',
    'Professional',
    'Community',
    'Insiders',
    'Preview',
  ];
  for (const version of versions)
    for (const pf of programFiles(d.env))
      for (const edition of editions) {
        const exe = W.join(
          pf,
          'Microsoft Visual Studio',
          version,
          edition,
          'Common7',
          'IDE',
          'devenv.exe',
        );
        if (d.exists(exe)) return exe;
      }
  return null;
}

/**
 * What is installed. macOS keeps today's behaviour (VS Code through `code`, not checked). Windows: VS Code
 * when `code` is on PATH; Visual Studio (any edition and channel, the newest) from vswhere, else the registry,
 * else its default folders (#94).
 */
export async function detectEditors(d: DetectDeps): Promise<Installed> {
  if (d.platform !== 'win32') return { vscode: 'code' };
  const found: Installed = {};
  if (d.which('code')) found.vscode = 'code';
  const vs =
    (await fromVswhere(d)) ?? (await fromRegistry(d)) ?? fromKnownFolders(d);
  if (vs) found.visualstudio = vs;
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
  'testresults',
]);
const SOLUTION = /\.slnx?$/i;
const PROJECT = /\.csproj$/i;

/** Solutions and .NET projects in the worktree root and up to two folders down (build and dependency folders skipped). */
export async function scanProject(
  worktree: string,
): Promise<{ solutions: string[]; dotnet: boolean }> {
  const byDepth: string[][] = [[], [], []];
  let dotnet = false;
  const read = async (dir: string) => {
    try {
      return await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  const walk = async (rel: string, depth: number): Promise<void> => {
    for (const e of await read(path.join(worktree, rel))) {
      const name = rel ? path.join(rel, e.name) : e.name;
      if (e.isFile()) {
        if (SOLUTION.test(e.name)) byDepth[depth].push(name);
        if (PROJECT.test(e.name)) dotnet = true;
      } else if (
        depth < 2 &&
        e.isDirectory() &&
        !e.name.startsWith('.') &&
        !SKIP.has(e.name.toLowerCase())
      )
        await walk(name, depth + 1);
    }
  };
  await walk('', 0);
  const solutions = byDepth.flatMap((xs) => xs.sort());
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
