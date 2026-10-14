import type { Command, Platform } from './Platform';

/** Makes a prompt safe to pass through a .cmd/.bat shim: no quotes or cmd.exe metacharacters. */
export function shimSafePrompt(s: string): string {
  return s
    .replaceAll('"', "'")
    .replace(/[&|<>^%]/g, '')
    .replace(/ {2,}/g, ' ');
}

const psQuote = (s: string): string => `'${s.replaceAll("'", "''")}'`;

/** Windows: PowerShell 7 if installed, else Windows PowerShell 5.1. */
export function windowsPlatform(
  _env: NodeJS.ProcessEnv,
  deps: { which: (name: string) => string | null },
): Platform {
  const shell = deps.which('pwsh') ?? 'powershell.exe';
  const ps = (command: string): Command => ({
    command: shell,
    args: [
      '-NoLogo',
      '-ExecutionPolicy',
      'Bypass',
      '-NoProfile',
      '-Command',
      command,
    ],
  });

  /** Native .exe runs directly (node-pty quotes args for ConPTY); shims go through PowerShell. */
  const tool = (name: string, args: string[], promptEnv?: string): Command => {
    const found = deps.which(name);
    if (found && found.toLowerCase().endsWith('.exe'))
      return { command: found, args };
    if (!found) return ps(name);
    if (promptEnv !== undefined)
      return {
        ...ps(`& ${name} $env:MIAC_CLAUDE_PROMPT`),
        env: { MIAC_CLAUDE_PROMPT: shimSafePrompt(promptEnv) },
      };
    return ps(`& ${name}`);
  };

  return {
    shellLabel: 'PowerShell',
    interactiveShell: () => ({
      command: shell,
      args: ['-NoLogo', '-ExecutionPolicy', 'Bypass'],
    }),
    shellCommand: (cmd) => ({
      command: shell,
      args: [
        '-NoLogo',
        '-ExecutionPolicy',
        'Bypass',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$ErrorActionPreference = 'Stop'; & { ${cmd} }; if ($LASTEXITCODE) { exit $LASTEXITCODE }`,
      ],
    }),
    claudeCommand: (prompt) => tool('claude', [prompt], prompt),
    copilotCommand: () => tool('copilot', []),
    editorCommand: (p) => ps(`& code ${psQuote(p)}`),
  };
}
