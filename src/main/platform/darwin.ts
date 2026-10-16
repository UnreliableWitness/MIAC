import path from 'node:path';
import type { Command, Platform } from './Platform';
import { shellQuote } from './shellQuote';

export function darwinPlatform(env: NodeJS.ProcessEnv): Platform {
  const shell = env.SHELL && env.SHELL.length > 0 ? env.SHELL : '/bin/zsh';
  const login = (args: string[]): Command => ({
    command: shell,
    args: ['-l', ...args],
  });
  return {
    shellLabel: path.basename(shell),
    interactiveShell: () => login([]),
    shellCommand: (cmd) => login(['-c', cmd]),
    runCommand: (cmd) => login(['-c', cmd]),
    claudeCommand: (context, flags = []) =>
      login([
        '-c',
        [
          'exec claude',
          ...[
            ...flags,
            ...(context === null ? [] : ['--append-system-prompt', context]),
          ].map(shellQuote),
        ].join(' '),
      ]),
    copilotCommand: () => login(['-c', 'exec copilot']),
    editorCommand: (p) => ({ command: 'code', args: [p] }),
    editorGotoCommand: (wt, f, line, col) => ({
      command: 'code',
      args: [wt, '-g', `${f}:${line ?? 1}:${col ?? 1}`],
    }),
  };
}
