import type { Command, Platform } from './Platform';

/** Makes a prompt safe to pass through a .cmd/.bat shim: no quotes or cmd.exe metacharacters. */
export function shimSafePrompt(s: string): string {
  return s
    .replaceAll('"', "'")
    .replace(/[&|<>^%]/g, '')
    .replace(/ {2,}/g, ' ');
}

/** PowerShell treats U+2018..U+201B like an ASCII single quote inside '...' strings, so double them too. */
const SINGLE_QUOTES = new RegExp(
  `['${[0x2018, 0x2019, 0x201a, 0x201b].map((c) => String.fromCharCode(c)).join('')}]`,
  'g',
);
export const psQuote = (s: string): string =>
  `'${s.replace(SINGLE_QUOTES, (q) => q + q)}'`;

/**
 * Runs a setup command line and turns its outcome into an exit code, the same on PowerShell 5.1 and 7.
 * Fails with the last native exit code, or with 1 when a cmdlet error or a missing command was reported.
 * Native stderr never fails the command: 5.1 wraps it in NativeCommandError records when output is
 * redirected, so those are passed through to stderr as text and not counted (no $ErrorActionPreference
 * = 'Stop', which would make them terminating). `$?` is not used: it stays true after `& { ... }` even
 * when an error was written inside. The command sits on its own lines so a trailing # comment is harmless.
 */
export const psSetupWrapper = (cmd: string): string =>
  [
    '$miacFailed = $false',
    '& {',
    cmd,
    '} 2>&1 | ForEach-Object {',
    '  if ($_ -is [System.Management.Automation.ErrorRecord]) {',
    `    if ("$($_.FullyQualifiedErrorId)" -notlike 'NativeCommandError*') { $miacFailed = $true }`,
    '    [Console]::Error.WriteLine("$_")',
    '  } else { $_ }',
    '}',
    'if ($LASTEXITCODE) { exit $LASTEXITCODE }',
    'if ($miacFailed) { exit 1 }',
  ].join('\n');

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
        psSetupWrapper(cmd),
      ],
    }),
    claudeCommand: (prompt) => tool('claude', [prompt], prompt),
    copilotCommand: () => tool('copilot', []),
    editorCommand: (p) => {
      if (!deps.which('code')) throw new Error('VS Code (code) is not on PATH');
      return ps(`& code ${psQuote(p)}`);
    },
  };
}
