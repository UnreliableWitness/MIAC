import { describe, expect, it } from 'vitest';
import { diagnoseExit, EARLY_EXIT_MS } from './terminalFailure';

/** What OpenCode 1.19 prints for an agent file whose `tools` is a Claude Code style string (#109). */
const INVALID_AGENT =
  '\x1b[91m\x1b[1mError: \x1b[0mConfiguration is invalid at C:\\Projects\\DXP.worktrees\\test\\.opencode\\agents\\dxp-wiki-explorer.md\r\n' +
  '\u21b3 Expected object | undefined, got "Read, Glob, Grep, Bash" tools\r\n';

describe('diagnoseExit', () => {
  it('explains an OpenCode configuration error and offers to start without the project config (#109)', () => {
    const f = diagnoseExit({
      kind: 'opencode',
      exitCode: 1,
      output: INVALID_AGENT,
      runMs: 1200,
    });
    expect(f).toMatchObject({
      reason: 'invalid-config',
      file: 'C:\\Projects\\DXP.worktrees\\test\\.opencode\\agents\\dxp-wiki-explorer.md',
      detail: 'Expected object | undefined, got "Read, Glob, Grep, Bash" tools',
      canSkipProjectConfig: true,
    });
    expect(f?.title).toBe('OpenCode could not read its configuration');
    expect(f?.hint).toMatch(/dxp-wiki-explorer\.md/);
  });

  it('finds the error after the TUI start-up sequences OpenCode writes in a pty', () => {
    // Captured from `opencode` 1.19.3 in a pty on macOS, shortened.
    const tui =
      '\x1b[?2031h\x1b]10;?\x07\x1b]11;?\x07\x1b[>0q\x1b[6n\x1bP+q4d73\x1b\\\x1b[?1016$p' +
      '\x1b]99;i=opentui-notifications:p=?;\x1b\\\x1b]1337;Capabilities\x1b\\\x1b[?1049h\x1b[?1049l' +
      '\x1b]0;\x07\x1b]12;default\x07\x1b]112\x07\x1b[0 q\x1b[?25h' +
      'Configuration is invalid at /Users/x/repo/.opencode/agents/wiki.md\n' +
      '↳ Expected object | undefined, got "Read, Glob, Grep, Bash" tools\n';
    expect(
      diagnoseExit({ kind: 'opencode', exitCode: 1, output: tui, runMs: 700 }),
    ).toMatchObject({
      reason: 'invalid-config',
      file: '/Users/x/repo/.opencode/agents/wiki.md',
      detail: 'Expected object | undefined, got "Read, Glob, Grep, Bash" tools',
    });
  });

  it.each([
    ['opencode', 127, 'zsh:1: command not found: opencode\r\n'],
    [
      'claude',
      1,
      "claude : The term 'claude' is not recognized as the name of a cmdlet, function, script file, or operable program.\r\n",
    ],
    [
      'copilot',
      1,
      "copilot: The term 'copilot' is not recognized as a name of a cmdlet, function, script file, or executable program.\r\n",
    ],
  ] as const)('tells that %s is not installed', (kind, exitCode, output) => {
    const f = diagnoseExit({ kind, exitCode, output, runMs: 300 });
    expect(f?.reason).toBe('missing-cli');
    expect(f?.title).toMatch(/is not installed or not on PATH/);
    expect(f?.hint).toMatch(/install/i);
    expect(f?.canSkipProjectConfig).toBeFalsy();
  });

  it('reports an agent that stopped soon after it started, with its last line of output', () => {
    const f = diagnoseExit({
      kind: 'claude',
      exitCode: 3,
      output: 'starting\r\n\x1b[31mError: something broke\x1b[0m\r\n\r\n',
      runMs: 2000,
    });
    expect(f).toMatchObject({
      reason: 'crashed',
      title: 'Claude Code stopped right after it started (exit code 3)',
      detail: 'Error: something broke',
    });
  });

  it('leaves normal exits, late exits and non-agent tabs alone', () => {
    expect(
      diagnoseExit({ kind: 'opencode', exitCode: 0, output: '', runMs: 100 }),
    ).toBeNull();
    expect(
      diagnoseExit({
        kind: 'claude',
        exitCode: 1,
        output: 'bye',
        runMs: EARLY_EXIT_MS + 1,
      }),
    ).toBeNull();
    expect(
      diagnoseExit({
        kind: 'shell',
        exitCode: 127,
        output: 'command not found: foo',
        runMs: 10,
      }),
    ).toBeNull();
    expect(
      diagnoseExit({ kind: 'run', exitCode: 1, output: 'boom', runMs: 10 }),
    ).toBeNull();
  });

  it('still recognises a missing program or a bad config after a long run', () => {
    expect(
      diagnoseExit({
        kind: 'opencode',
        exitCode: 1,
        output: INVALID_AGENT,
        runMs: EARLY_EXIT_MS * 10,
      })?.reason,
    ).toBe('invalid-config');
  });
});
