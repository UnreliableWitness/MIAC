import { describe, expect, it } from 'vitest';
import { shimSafePrompt, windowsPlatform } from './windows';

const WRAP = (cmd: string) =>
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
const RUN_WRAP = (cmd: string) =>
  ['& {', cmd, '}', 'if ($LASTEXITCODE) { exit $LASTEXITCODE }'].join('\n');
const make = (found: Record<string, string>) =>
  windowsPlatform({}, { which: (n) => found[n] ?? null });

describe('windowsPlatform', () => {
  it('prefers pwsh and falls back to Windows PowerShell', () => {
    expect(make({ pwsh: 'C:\\pwsh\\pwsh.exe' }).interactiveShell()).toEqual({
      command: 'C:\\pwsh\\pwsh.exe',
      args: ['-NoLogo', '-ExecutionPolicy', 'Bypass'],
    });
    expect(make({}).interactiveShell()).toEqual({
      command: 'powershell.exe',
      args: ['-NoLogo', '-ExecutionPolicy', 'Bypass'],
    });
    expect(make({}).shellLabel).toBe('PowerShell');
  });

  it('runs setup commands so failures give a non-zero exit', () => {
    expect(make({}).shellCommand('npm ci')).toEqual({
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-ExecutionPolicy',
        'Bypass',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        WRAP('npm ci'),
      ],
    });
  });

  it('keeps a trailing comment in a setup command from swallowing the wrapper', () => {
    const args = make({}).shellCommand('npm ci # install').args;
    expect(args.at(-1)).toBe(WRAP('npm ci # install'));
    expect(args.at(-1)).toContain('npm ci # install\n}');
  });

  it('runs terminal commands without the setup pipe, so the console stays a console', () => {
    expect(make({}).runCommand('npm run dev')).toEqual({
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-ExecutionPolicy',
        'Bypass',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        RUN_WRAP('npm run dev'),
      ],
    });
    const text = make({}).runCommand('npm run dev # dev').args.at(-1);
    expect(text).toContain('npm run dev # dev\n}');
    expect(text).not.toContain('2>&1');
    expect(text).not.toContain('ForEach-Object');
  });

  it('starts a native claude.exe directly with the context as one argument', () => {
    const prompt = `Work on Issue 3: Coupon field ignores O'Brien style "names"`;
    expect(
      make({ claude: 'C:\\Users\\d\\.local\\bin\\claude.exe' }).claudeCommand(
        prompt,
      ),
    ).toEqual({
      command: 'C:\\Users\\d\\.local\\bin\\claude.exe',
      args: ['--append-system-prompt', prompt],
    });
  });

  it('starts an npm shim through PowerShell with the context in an env var', () => {
    const prompt = `it's "quoted" & <b> | 50% ^x`;
    expect(
      make({ claude: 'C:\\npm\\claude.cmd' }).claudeCommand(prompt),
    ).toEqual({
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-ExecutionPolicy',
        'Bypass',
        '-NoProfile',
        '-Command',
        "& claude '--append-system-prompt' $env:MIAC_CLAUDE_PROMPT",
      ],
      env: { MIAC_CLAUDE_PROMPT: "it's 'quoted' b 50 x" },
    });
  });

  it('passes session flags before the prompt to claude.exe and a shim', () => {
    expect(
      make({ claude: 'C:\\bin\\claude.exe' }).claudeCommand('go', [
        '--session-id',
        'abc',
      ]).args,
    ).toEqual(['--session-id', 'abc', '--append-system-prompt', 'go']);
    expect(
      make({ claude: 'C:\\bin\\claude.exe' }).claudeCommand(null, [
        '--resume',
        'abc',
      ]).args,
    ).toEqual(['--resume', 'abc']);
    expect(
      make({ claude: 'C:\\npm\\claude.cmd' })
        .claudeCommand('go', ['--session-id', 'abc'])
        .args.at(-1),
    ).toBe(
      "& claude '--session-id' 'abc' '--append-system-prompt' $env:MIAC_CLAUDE_PROMPT",
    );
    const resume = make({ claude: 'C:\\npm\\claude.cmd' }).claudeCommand(null, [
      '--continue',
    ]);
    expect(resume.args.at(-1)).toBe("& claude '--continue'");
    expect(resume.env).toBeUndefined();
  });

  it('lets PowerShell report a missing claude', () => {
    expect(make({}).claudeCommand('x')).toEqual({
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-ExecutionPolicy',
        'Bypass',
        '-NoProfile',
        '-Command',
        'claude',
      ],
    });
  });

  it('starts copilot the same way', () => {
    expect(make({ copilot: 'C:\\c\\copilot.exe' }).copilotCommand()).toEqual({
      command: 'C:\\c\\copilot.exe',
      args: [],
    });
    expect(make({ copilot: 'C:\\npm\\copilot.cmd' }).copilotCommand()).toEqual({
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-ExecutionPolicy',
        'Bypass',
        '-NoProfile',
        '-Command',
        '& copilot',
      ],
    });
  });

  it('opens VS Code with a quoted path', () => {
    expect(
      make({ code: 'C:\\VS\\bin\\code.cmd' }).editorCommand(
        "C:\\src\\o'brien.worktrees\\3-x",
      ),
    ).toEqual({
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-ExecutionPolicy',
        'Bypass',
        '-NoProfile',
        '-Command',
        "& code 'C:\\src\\o''brien.worktrees\\3-x'",
      ],
    });
  });

  it('quotes typographic single quotes in paths, which PowerShell also treats as quotes', () => {
    const [l, r, low, rev] = [0x2018, 0x2019, 0x201a, 0x201b].map((c) =>
      String.fromCharCode(c),
    );
    const p = `C:\\src\\o${r}brien ${l}x${low}${rev}`;
    expect(
      make({ code: 'C:\\VS\\bin\\code.cmd' }).editorCommand(p).args.at(-1),
    ).toBe(
      `& code 'C:\\src\\o${r}${r}brien ${l}${l}x${low}${low}${rev}${rev}'`,
    );
  });

  it('opens VS Code at a file and line with quoted paths', () => {
    const cmd = make({ code: 'C:\\VS\\bin\\code.cmd' }).editorGotoCommand(
      'C:\\src\\wt',
      "C:\\src\\wt\\o'b.md",
      4,
    );
    expect(cmd.args.at(-1)).toContain(
      "& code 'C:\\src\\wt' -g 'C:\\src\\wt\\o''b.md:4:1'",
    );
  });

  it('reports a missing VS Code clearly', () => {
    expect(() => make({}).editorCommand('C:\\x')).toThrow(
      'VS Code (code) is not on PATH',
    );
  });

  it('shimSafePrompt strips quotes and cmd metacharacters', () => {
    expect(shimSafePrompt(`a "b" & c | <d> ^ 5%`)).toBe("a 'b' c d 5");
  });
});
