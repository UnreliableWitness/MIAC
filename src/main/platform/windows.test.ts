import { describe, expect, it } from 'vitest';
import { windowsPlatform } from './windows';

const WRAP = (cmd: string) =>
  `$ErrorActionPreference = 'Stop'; & { ${cmd} }; if ($LASTEXITCODE) { exit $LASTEXITCODE }`;
const make = (found: Record<string, string>) =>
  windowsPlatform({}, { which: (n) => found[n] ?? null });

describe('windowsPlatform', () => {
  it('prefers pwsh and falls back to Windows PowerShell', () => {
    expect(make({ pwsh: 'C:\\pwsh\\pwsh.exe' }).interactiveShell()).toEqual({
      command: 'C:\\pwsh\\pwsh.exe',
      args: ['-NoLogo'],
    });
    expect(make({}).interactiveShell()).toEqual({
      command: 'powershell.exe',
      args: ['-NoLogo'],
    });
    expect(make({}).shellLabel).toBe('PowerShell');
  });

  it('runs setup commands so failures give a non-zero exit', () => {
    expect(make({}).shellCommand('npm ci')).toEqual({
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        WRAP('npm ci'),
      ],
    });
  });

  it('starts a native claude.exe directly with the prompt as one argument', () => {
    const prompt = `Work on Issue 3: Coupon field ignores O'Brien style "names"`;
    expect(
      make({ claude: 'C:\\Users\\d\\.local\\bin\\claude.exe' }).claudeCommand(
        prompt,
      ),
    ).toEqual({
      command: 'C:\\Users\\d\\.local\\bin\\claude.exe',
      args: [prompt],
    });
  });

  it('starts an npm shim through PowerShell with the prompt in an env var', () => {
    const prompt = `it's "quoted"; $(rm -rf x)`;
    expect(
      make({ claude: 'C:\\npm\\claude.cmd' }).claudeCommand(prompt),
    ).toEqual({
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        '& claude $env:MIAC_CLAUDE_PROMPT',
      ],
      env: { MIAC_CLAUDE_PROMPT: prompt },
    });
  });

  it('lets PowerShell report a missing claude', () => {
    expect(make({}).claudeCommand('x')).toEqual({
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-Command', 'claude'],
    });
  });

  it('starts copilot the same way', () => {
    expect(make({ copilot: 'C:\\c\\copilot.exe' }).copilotCommand()).toEqual({
      command: 'C:\\c\\copilot.exe',
      args: [],
    });
    expect(make({ copilot: 'C:\\npm\\copilot.cmd' }).copilotCommand()).toEqual({
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-Command', '& copilot'],
    });
  });

  it('opens VS Code with a quoted path', () => {
    expect(make({}).editorCommand("C:\\src\\o'brien.worktrees\\3-x")).toEqual({
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        "& code 'C:\\src\\o''brien.worktrees\\3-x'",
      ],
    });
  });
});
