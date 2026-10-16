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

/**
 * Runs a command line in a pty (a `run` terminal such as the dev server) and passes on the last native
 * exit code. No pipe: the program writes straight to the console, so it sees a TTY, its UTF-8 output
 * is not decoded through the OEM code page and its logs are not block-buffered. In a real console
 * PowerShell 5.1 does not wrap native stderr in error records, so the setup wrapper is not needed here.
 * A `throw` still exits 1 under -Command. The command sits on its own lines (trailing # comments).
 */
export const psRunWrapper = (cmd: string): string =>
  ['& {', cmd, '}', 'if ($LASTEXITCODE) { exit $LASTEXITCODE }'].join('\n');

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
  const nonInteractive = (command: string): Command => ({
    command: shell,
    args: [
      '-NoLogo',
      '-ExecutionPolicy',
      'Bypass',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      command,
    ],
  });

  /** `flags` are MIAC's own tokens (no user text), so they are quoted for PowerShell; a prompt goes through an env var. */
  const tool = (
    name: string,
    flags: string[],
    promptEnv: string | null = null,
  ): Command => {
    const found = deps.which(name);
    if (found && found.toLowerCase().endsWith('.exe'))
      return {
        command: found,
        args: promptEnv === null ? flags : [...flags, promptEnv],
      };
    if (!found) return ps(name);
    const line = [`& ${name}`, ...flags.map(psQuote)];
    if (promptEnv !== null)
      return {
        ...ps([...line, '$env:MIAC_CLAUDE_PROMPT'].join(' ')),
        env: { MIAC_CLAUDE_PROMPT: shimSafePrompt(promptEnv) },
      };
    return ps(line.join(' '));
  };

  return {
    shellLabel: 'PowerShell',
    interactiveShell: () => ({
      command: shell,
      args: ['-NoLogo', '-ExecutionPolicy', 'Bypass'],
    }),
    shellCommand: (cmd) => nonInteractive(psSetupWrapper(cmd)),
    runCommand: (cmd) => nonInteractive(psRunWrapper(cmd)),
    // The context is the value of the last flag, so it can travel in the env var like any prompt.
    claudeCommand: (context, flags = []) =>
      tool(
        'claude',
        context === null ? flags : [...flags, '--append-system-prompt'],
        context,
      ),
    copilotCommand: () => tool('copilot', []),
    opencodeCommand: () => tool('opencode', []),
    editorCommand: (p) => {
      if (!deps.which('code')) throw new Error('VS Code (code) is not on PATH');
      return ps(`& code ${psQuote(p)}`);
    },
    editorGotoCommand: (wt, f, line, col) => {
      if (!deps.which('code')) throw new Error('VS Code (code) is not on PATH');
      return ps(
        `& code ${psQuote(wt)} -g ${psQuote(`${f}:${line ?? 1}:${col ?? 1}`)}`,
      );
    },
  };
}
