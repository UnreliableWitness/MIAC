import type { DiscoveredFile } from './discover';

/**
 * What agents are kept from: the untracked files discovery found values in (repo-relative with `/`, or absolute for
 * .NET user secrets) and each `secrets` folder as a `dir/**` glob. Tracked config stays readable: agents need to
 * edit it, and its values are in git already.
 */
export function denyTargets(r: {
  files: DiscoveredFile[];
  secretDirs: string[];
}): string[] {
  return [
    ...new Set([
      ...r.files.filter((f) => !f.tracked).map((f) => f.path),
      ...r.secretDirs.map((d) => `${d}/**`),
    ]),
  ];
}

const isAbsolute = (p: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p);

/** Claude Code reads a Windows path as POSIX: `C:\x\y` is `/c/x/y`. */
const posix = (p: string) =>
  p
    .replace(/^([a-zA-Z]):/, (_, d: string) => `/${d.toLowerCase()}`)
    .replace(/\\/g, '/');

const quoted = (p: string) => (/\s/.test(p) ? `"${p}"` : p);

/** `Read(...)` takes gitignore patterns: a literal `[ ] * ? ! #` or edge space needs a backslash. */
const gitignoreEscape = (p: string) =>
  p.replace(/[[\]*?!#\\]/g, '\\$&').replace(/^ | $/g, '\\ ');

/** The commands an agent prints a file with. */
const PRINTERS = ['cat', 'type', 'Get-Content'] as const;

const GLOB = /\/\*\*$/;

/**
 * Claude Code `permissions.deny` rules for secret files: `Read` plus the three print commands as prefix rules
 * (`Bash(cat p:*)`). A relative path is relative to the tab's folder (`./`); an absolute one (another worktree of a
 * multi-repo task, user secrets) uses `//`. A `dir/**` glob gets the Read rule only.
 */
export function denyRulesFor(paths: string[]): string[] {
  return paths.flatMap((p) => {
    const abs = isAbsolute(p);
    const shown = abs ? posix(p) : p;
    const glob = GLOB.test(p);
    const body = gitignoreEscape(glob ? shown.replace(GLOB, '') : shown);
    const read = `${abs ? '/' : './'}${body}${glob ? '/**' : ''}`;
    return [
      `Read(${read})`,
      ...(GLOB.test(p)
        ? []
        : PRINTERS.map((c) => `Bash(${c} ${quoted(shown)}:*)`)),
    ];
  });
}

/**
 * OpenCode's `permission` entries for the same files. Patterns are matched against the path relative to the
 * project, so the tab's own files stay relative; a path outside it is absolute (checked against opencode 1.19.3).
 */
export function opencodePermission(paths: string[]): {
  read: Record<string, 'deny'>;
  bash: Record<string, 'deny'>;
} {
  const read: Record<string, 'deny'> = {};
  const bash: Record<string, 'deny'> = {};
  for (const p of paths) read[p] = 'deny';
  for (const p of paths)
    if (!GLOB.test(p))
      for (const c of PRINTERS) bash[`${c} ${quoted(p)}*`] = 'deny';
  return { read, bash };
}
