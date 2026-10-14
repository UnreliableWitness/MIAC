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
  it('starts claude with a quoted prompt', () => {
    expect(p.claudeCommand("Work item 1: it's done")).toEqual({
      command: '/bin/zsh',
      args: ['-l', '-c', "exec claude 'Work item 1: it'\\''s done'"],
    });
  });
  it('starts Copilot CLI through a login shell', () => {
    expect(p.copilotCommand()).toEqual({
      command: '/bin/zsh',
      args: ['-l', '-c', 'exec copilot'],
    });
  });
  it('opens VS Code', () => {
    expect(p.editorCommand('/src/x')).toEqual({
      command: 'code',
      args: ['/src/x'],
    });
  });
  it('falls back to /bin/zsh when SHELL is unset', () => {
    expect(darwinPlatform({}).interactiveShell().command).toBe('/bin/zsh');
  });
});
