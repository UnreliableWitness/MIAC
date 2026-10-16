import { describe, expect, it } from 'vitest';
import { darwinPlatform } from './darwin';

describe('darwinPlatform', () => {
  const p = darwinPlatform({ SHELL: '/bin/zsh' });
  it('opens a login shell for interactive tabs', () => {
    expect(p.interactiveShell()).toEqual({ command: '/bin/zsh', args: ['-l'] });
    expect(p.shellLabel).toBe('zsh');
  });
  it('runs a command through a login shell so PATH is loaded', () => {
    expect(p.shellCommand('npm run dev')).toEqual({
      command: '/bin/zsh',
      args: ['-l', '-c', 'npm run dev'],
    });
  });
  it('runs a terminal command the same way as a setup command', () => {
    expect(p.runCommand('npm run dev')).toEqual({
      command: '/bin/zsh',
      args: ['-l', '-c', 'npm run dev'],
    });
  });
  it('starts claude with the task appended to its system prompt, quoted', () => {
    expect(p.claudeCommand("Work item 1: it's done")).toEqual({
      command: '/bin/zsh',
      args: [
        '-l',
        '-c',
        "exec claude '--append-system-prompt' 'Work item 1: it'\\''s done'",
      ],
    });
  });
  it('passes session flags first, and no context when resuming', () => {
    expect(p.claudeCommand('go', ['--session-id', 'abc'])).toEqual({
      command: '/bin/zsh',
      args: [
        '-l',
        '-c',
        "exec claude '--session-id' 'abc' '--append-system-prompt' 'go'",
      ],
    });
    expect(p.claudeCommand(null, ['--continue'])).toEqual({
      command: '/bin/zsh',
      args: ['-l', '-c', "exec claude '--continue'"],
    });
  });
  it('starts Copilot CLI through a login shell', () => {
    expect(p.copilotCommand()).toEqual({
      command: '/bin/zsh',
      args: ['-l', '-c', 'exec copilot'],
    });
  });
  it('starts OpenCode through a login shell', () => {
    expect(p.opencodeCommand()).toEqual({
      command: '/bin/zsh',
      args: ['-l', '-c', 'exec opencode'],
    });
  });
  it('opens VS Code', () => {
    expect(p.editorCommand('/src/x')).toEqual({
      command: 'code',
      args: ['/src/x'],
    });
  });
  it('opens VS Code at a file and line in the worktree window', () => {
    expect(p.editorGotoCommand('/wt', '/wt/a.md', 12, 3)).toEqual({
      command: 'code',
      args: ['/wt', '-g', '/wt/a.md:12:3'],
    });
    expect(p.editorGotoCommand('/wt', '/wt/a.md').args[2]).toBe('/wt/a.md:1:1');
  });
  it('falls back to /bin/zsh when SHELL is unset', () => {
    expect(darwinPlatform({}).interactiveShell().command).toBe('/bin/zsh');
  });
});
