import type { Found } from '../../shared/secrets';

/** Sources that are not files ("user secrets", "launch profile Prd"). */
const NOT_A_FILE = /^(user secrets|launch profile )/;

/**
 * The untracked files discovery found values in, repo-relative with `/`. Tracked config stays readable: agents
 * need to edit it, and its values are in git already.
 */
export function untrackedSecretFiles(found: Found[]): string[] {
  return [
    ...new Set(
      found
        .filter((f) => !f.tracked && !NOT_A_FILE.test(f.source))
        .map((f) => f.source),
    ),
  ];
}

const isAbsolute = (p: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p);

/** Claude Code reads a Windows path as POSIX: `C:\x\y` is `/c/x/y`. */
const posix = (p: string) =>
  p
    .replace(/^([a-zA-Z]):/, (_, d: string) => `/${d.toLowerCase()}`)
    .replace(/\\/g, '/');

const quoted = (p: string) => (/\s/.test(p) ? `"${p}"` : p);

/** The commands an agent prints a file with. */
const PRINTERS = ['cat', 'type', 'Get-Content'] as const;

/**
 * Claude Code `permissions.deny` rules for secret files: `Read` plus the three print commands. A relative path is
 * relative to the tab's folder (`./`); an absolute one (another worktree of a multi-repo task) uses `//`.
 */
export function denyRulesFor(paths: string[]): string[] {
  return paths.flatMap((p) => {
    const read = isAbsolute(p) ? `/${posix(p)}` : `./${p}`;
    return [
      `Read(${read})`,
      ...PRINTERS.map(
        (c) => `Bash(${c} ${quoted(isAbsolute(p) ? posix(p) : p)})`,
      ),
    ];
  });
}

/** OpenCode's `permission` entries for the same files. */
export function opencodePermission(paths: string[]): {
  read: Record<string, 'deny'>;
  bash: Record<string, 'deny'>;
} {
  const read: Record<string, 'deny'> = {};
  const bash: Record<string, 'deny'> = {};
  for (const p of paths) read[p] = 'deny';
  for (const p of paths)
    for (const c of PRINTERS) bash[`${c} ${quoted(p)}*`] = 'deny';
  return { read, bash };
}
