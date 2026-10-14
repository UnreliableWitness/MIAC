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
    claudeCommand: (prompt) =>
      login(['-c', `exec claude ${shellQuote(prompt)}`]),
    copilotCommand: () => login(['-c', 'exec copilot']),
    editorCommand: (p) => ({ command: 'code', args: [p] }),
  };
}
