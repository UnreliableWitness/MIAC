# MIAC Windows Support (sub-project 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MIAC runs on Windows. That means:
- a Windows `Platform`;
- a test suite that passes on macOS and Windows;
- CI on both that builds `MIAC-Setup.exe`;
- Azure Artifact Signing that switches on when repo variables exist.

**Architecture:**
- `src/main/platform/windows.ts` implements `Platform` with PowerShell. Claude Code and Copilot CLI are resolved on PATH: an `.exe` is started directly, and a shim goes through PowerShell with the prompt in an env var. `Command` gains optional `env`.
- File stores rename with a retry, and git worktree commands set `core.longpaths`.
- Tests use portable shell helpers.
- `.github/workflows/ci.yml` runs a macOS + Windows matrix. The Windows job also packages, and signs through `@electron/windows-sign`'s `hookModulePath` when signing variables are present.

**Tech Stack:** Existing stack (Electron 44 / Forge 8 / Vitest 5). `@electron/windows-sign` 2.1 and `electron-winstaller` are already installed through Forge. Azure Artifact Signing client (NuGet) and `azure/login` run in CI only.

**Spec:** `docs/superpowers/specs/2026-10-14-windows-support-design.md`

## Global Constraints

- Windows shell: `pwsh` if found on PATH, else `powershell.exe`. Shell label `PowerShell`.
- `shellCommand(cmd)` args: `['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; & { <cmd> }; if ($LASTEXITCODE) { exit $LASTEXITCODE }"]`.
- `interactiveShell()` args: `['-NoLogo']`.
- Claude and Copilot resolution:
  - `.exe` found: started directly, with the prompt as the single argument (Claude) or no arguments (Copilot).
  - `.cmd`, `.bat` or `.ps1` found: `[shell, '-NoLogo', '-NoProfile', '-Command', '& claude $env:MIAC_CLAUDE_PROMPT']`, with `env: { MIAC_CLAUDE_PROMPT: prompt }`. Copilot uses `& copilot`.
  - Not found: `[shell, '-NoLogo', '-NoProfile', '-Command', 'claude']`, so PowerShell shows "not recognized".
- Editor: `[shell, '-NoLogo', '-NoProfile', '-Command', "& code '<path with ' doubled>'"]`. `launch` uses `windowsHide: true`.
- Git `worktree add/remove/prune` run with `-c core.longpaths=true` on every OS.
- `renameWithRetry`: retries on `EPERM`, `EBUSY` and `EACCES` with waits of 50, 100, 200, 400 and 800 ms, then rethrows.
- CI:
  - Node 24, matrix `macos-latest` and `windows-latest`.
  - Signing only when all six variables are set (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `ARTIFACT_SIGNING_ENDPOINT`, `ARTIFACT_SIGNING_ACCOUNT`, `ARTIFACT_SIGNING_PROFILE`) **and** the event is a push to `main` or a `v*` tag. Never on pull requests.
  - Timestamp server `http://timestamp.acs.microsoft.com`, SHA256.
- Installer: `MIAC-Setup.exe`. Squirrel `name: 'miac'`. Keep `package.json` `productName` as it is, so the userData folder (`miac`) does not move.
- Core services must not import electron. Sources must be pure ASCII: use `String.fromCharCode` or JSX entities, never `\u` escapes. Run `npm run lint:fix` before commits.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018pN36d8qmj82BVJLA1wM2L
  ```

## Review Focus

1. **A work item title with `'` and `"`** reaches Claude Code intact on Windows, through both the `.exe` path and the shim path. Pinned in Task 1 (unit tests on the exact args and env).
2. **A failing setup command in PowerShell** (native non-zero exit, or a PowerShell error such as a missing command) fails the setup step. Pinned in Task 1 (wrapper text) and Task 3 (a real process on whichever OS runs the test).
3. **A store write while Defender holds the file** succeeds after a retry and does not lose data. Pinned in Task 2 (an injected rename that fails twice with EBUSY).
4. **Pull requests from forks never get signing.** Pinned in Task 4 (workflow `if:` conditions, reviewed as text).
5. **A signing run that fails** fails the job, so an unsigned installer is not published from it. Pinned in Task 4 (`signtool verify` step, and no `continue-on-error`).

---

### Task 1: Windows platform module

**Files:**
- Create: `src/main/platform/windows.ts`, `src/main/platform/which.ts`, `src/main/platform/windows.test.ts`, `src/main/platform/which.test.ts`
- Modify: `src/main/platform/Platform.ts` (Command gains `env?`), `src/main/platform/index.ts`, `src/main/ipc/handlers.ts` (`spawnTerminal` merges `cmd.env`), `src/main/services/SetupRunner.ts` (merges `cmd.env`), `src/main.ts` (`launch`: `windowsHide: true`, env merge)

**Interfaces:**
- Produces:
  - `type Command = { command: string; args: string[]; env?: Record<string, string> }`
  - `windowsPlatform(env: NodeJS.ProcessEnv, deps: { which: (name: string) => string | null }): Platform`
  - `which(name: string, env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean, platform?: NodeJS.Platform): string | null`

- [ ] **Step 1: Write the failing tests**

`src/main/platform/windows.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { windowsPlatform } from './windows';

const WRAP = (cmd: string) => `$ErrorActionPreference = 'Stop'; & { ${cmd} }; if ($LASTEXITCODE) { exit $LASTEXITCODE }`;
const make = (found: Record<string, string>) => windowsPlatform({}, { which: (n) => found[n] ?? null });

describe('windowsPlatform', () => {
  it('prefers pwsh and falls back to Windows PowerShell', () => {
    expect(make({ pwsh: 'C:\\pwsh\\pwsh.exe' }).interactiveShell()).toEqual({ command: 'C:\\pwsh\\pwsh.exe', args: ['-NoLogo'] });
    expect(make({}).interactiveShell()).toEqual({ command: 'powershell.exe', args: ['-NoLogo'] });
    expect(make({}).shellLabel).toBe('PowerShell');
  });

  it('runs setup commands so failures give a non-zero exit', () => {
    expect(make({}).shellCommand('npm ci')).toEqual({ command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WRAP('npm ci')] });
  });

  it('starts a native claude.exe directly with the prompt as one argument', () => {
    const prompt = `Work on Issue 3: Coupon field ignores O'Brien style "names"`;
    expect(make({ claude: 'C:\\Users\\d\\.local\\bin\\claude.exe' }).claudeCommand(prompt)).toEqual({ command: 'C:\\Users\\d\\.local\\bin\\claude.exe', args: [prompt] });
  });

  it('starts an npm shim through PowerShell with the prompt in an env var', () => {
    const prompt = `it's "quoted"; $(rm -rf x)`;
    expect(make({ claude: 'C:\\npm\\claude.cmd' }).claudeCommand(prompt)).toEqual({
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-Command', '& claude $env:MIAC_CLAUDE_PROMPT'],
      env: { MIAC_CLAUDE_PROMPT: prompt },
    });
  });

  it('lets PowerShell report a missing claude', () => {
    expect(make({}).claudeCommand('x')).toEqual({ command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', 'claude'] });
  });

  it('starts copilot the same way', () => {
    expect(make({ copilot: 'C:\\c\\copilot.exe' }).copilotCommand()).toEqual({ command: 'C:\\c\\copilot.exe', args: [] });
    expect(make({ copilot: 'C:\\npm\\copilot.cmd' }).copilotCommand()).toEqual({ command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', '& copilot'] });
  });

  it('opens VS Code with a quoted path', () => {
    expect(make({}).editorCommand("C:\\src\\o'brien.worktrees\\3-x")).toEqual({ command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', "& code 'C:\\src\\o''brien.worktrees\\3-x'"] });
  });
});
```

`src/main/platform/which.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { which } from './which';

describe('which', () => {
  it('walks PATH with PATHEXT on Windows-style env', () => {
    const files = new Set(['C:\\b\\claude.CMD', 'C:\\a\\pwsh.exe']);
    const env = { PATH: 'C:\\a;C:\\b', PATHEXT: '.COM;.EXE;.CMD' };
    const exists = (p: string) => files.has(p);
    expect(which('pwsh', env, exists, 'win32')).toBe('C:\\a\\pwsh.exe');
    expect(which('claude', env, exists, 'win32')).toBe('C:\\b\\claude.CMD');
    expect(which('nope', env, exists, 'win32')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --project main src/main/platform`
Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

`src/main/platform/which.ts`:
```ts
import { statSync } from 'node:fs';
import path from 'node:path';

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Finds an executable on PATH. On Windows each PATHEXT extension is tried, upper and lower case. */
export function which(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = isFile,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const dirs = (env.PATH ?? env.Path ?? '').split(win ? ';' : ':').filter(Boolean);
  const exts = win ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      for (const candidate of win ? [ext, ext.toLowerCase()] : [ext]) {
        const full = p.join(dir, name + candidate);
        if (exists(full)) return full;
      }
    }
  }
  return null;
}
```

`src/main/platform/windows.ts`:
```ts
import type { Command, Platform } from './Platform';

const psQuote = (s: string): string => `'${s.replaceAll("'", "''")}'`;

/** Windows: PowerShell 7 if installed, else Windows PowerShell 5.1. */
export function windowsPlatform(_env: NodeJS.ProcessEnv, deps: { which: (name: string) => string | null }): Platform {
  const shell = deps.which('pwsh') ?? 'powershell.exe';
  const ps = (command: string): Command => ({ command: shell, args: ['-NoLogo', '-NoProfile', '-Command', command] });

  /** Native .exe runs directly (node-pty quotes args for ConPTY); shims go through PowerShell. */
  const tool = (name: string, args: string[], promptEnv?: string): Command => {
    const found = deps.which(name);
    if (found && found.toLowerCase().endsWith('.exe')) return { command: found, args };
    if (!found) return ps(name);
    if (promptEnv !== undefined) return { ...ps(`& ${name} $env:MIAC_CLAUDE_PROMPT`), env: { MIAC_CLAUDE_PROMPT: promptEnv } };
    return ps(`& ${name}`);
  };

  return {
    shellLabel: 'PowerShell',
    interactiveShell: () => ({ command: shell, args: ['-NoLogo'] }),
    shellCommand: (cmd) => ({
      command: shell,
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; & { ${cmd} }; if ($LASTEXITCODE) { exit $LASTEXITCODE }`],
    }),
    claudeCommand: (prompt) => tool('claude', [prompt], prompt),
    copilotCommand: () => tool('copilot', []),
    editorCommand: (p) => ps(`& code ${psQuote(p)}`),
  };
}
```
Check the "missing claude" case against the test: `ps('claude')`, which gives `-Command claude`. That matches.

`src/main/platform/Platform.ts`: `export type Command = { command: string; args: string[]; env?: Record<string, string> };`. Add a doc comment saying that `env` is merged over the process environment by every caller that starts the command.

`src/main/platform/index.ts`: on `win32`, return `windowsPlatform(env, { which: (n) => which(n, env) })`, and remove the throw. Re-export `windowsPlatform` and `which`.

Merge `cmd.env` wherever commands start:
- `handlers.ts` `spawnTerminal`: `env: { ...telemetryEnv(...), ...cmd.env }`.
- `SetupRunner.runCommand`: `env: { ...process.env, ...cmd.env }`, taking `env` from the destructured `shellCommand` result.
- `main.ts` `launch`: `spawn(cmd.command, cmd.args, { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...cmd.env } })`.

- [ ] **Step 4: Run the tests, the suite, typecheck and lint**

Run: `npx vitest run --project main src/main/platform && npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/platform src/main/ipc/handlers.ts src/main/services/SetupRunner.ts src/main.ts
git commit -m "feat: Windows platform with PowerShell, native-exe launch and PATH lookup"
```

---

### Task 2: Long paths for worktrees and rename retry for stores

**Files:**
- Create: `src/main/fsRetry.ts`, `src/main/fsRetry.test.ts`
- Modify: `src/main/services/GitClient.ts` (+ test), `src/main/services/TaskStore.ts`, `src/main/services/ConnectionStore.ts`, `src/main/usage/JsonFileStore.ts`, `src/main/usage/UsageStore.ts`

**Interfaces:**
- Produces `renameWithRetry(from: string, to: string, rename?: (a: string, b: string) => Promise<void>, wait?: (ms: number) => Promise<void>): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`src/main/fsRetry.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { renameWithRetry } from './fsRetry';

const err = (code: string) => Object.assign(new Error(code), { code });

describe('renameWithRetry', () => {
  it('retries EBUSY/EPERM/EACCES with backoff, then succeeds', async () => {
    const waits: number[] = [];
    let calls = 0;
    await renameWithRetry('a', 'b', async () => {
      calls++;
      if (calls < 3) throw err(calls === 1 ? 'EBUSY' : 'EPERM');
    }, async (ms) => { waits.push(ms); });
    expect(calls).toBe(3);
    expect(waits).toEqual([50, 100]);
  });
  it('rethrows after five retries', async () => {
    const waits: number[] = [];
    await expect(renameWithRetry('a', 'b', async () => { throw err('EACCES'); }, async (ms) => { waits.push(ms); })).rejects.toThrow('EACCES');
    expect(waits).toEqual([50, 100, 200, 400, 800]);
  });
  it('does not retry other errors', async () => {
    let calls = 0;
    await expect(renameWithRetry('a', 'b', async () => { calls++; throw err('ENOENT'); }, async () => {})).rejects.toThrow('ENOENT');
    expect(calls).toBe(1);
  });
});
```

Add to `src/main/services/GitClient.test.ts` a test that wraps the client's runner, or spies on `execFile`, whichever the file already uses. It must assert that `worktreeAdd`, `worktreeRemove` and `worktreePrune` pass `-c core.longpaths=true` before `worktree`. If `GitClient` has no injectable runner, assert behaviour instead: `worktreeAdd` still creates the worktree in a temp repo, and `git config --get core.longpaths` is not written to the repo, because the setting is per-command. Then check the args in the review.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --project main src/main/fsRetry.test.ts src/main/services/GitClient.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/main/fsRetry.ts`:
```ts
import { promises as fs } from 'node:fs';

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const WAITS = [50, 100, 200, 400, 800];

/** fs.rename that rides out short locks held by antivirus or indexers (common on Windows). */
export async function renameWithRetry(
  from: string,
  to: string,
  rename: (a: string, b: string) => Promise<void> = fs.rename,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (!RETRYABLE.has(code) || attempt >= WAITS.length) throw e;
      await wait(WAITS[attempt]);
    }
  }
}
```

Replace each `fs.rename(...)` call in `TaskStore.ts`, `ConnectionStore.ts`, `JsonFileStore.ts` and `UsageStore.ts` with `renameWithRetry(...)`. That covers both the tmp-to-file rename and the corrupt-backup rename.

`GitClient.ts`: the `worktree add`, `remove` and `prune` arg lists become `['-c', 'core.longpaths=true', 'worktree', ...]`.

- [ ] **Step 4: Run the tests, the suite, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main
git commit -m "feat: long paths for git worktrees and rename retry for all stores"
```

---

### Task 3: A test suite that runs on Windows

**Files:**
- Create: `src/main/test-helpers/shell.ts`, `src/main/test-helpers/shell.test.ts`
- Modify: `src/main/ipc/handlers.test.ts`, `src/main/services/SetupRunner.test.ts`, `src/main/services/TerminalManager.test.ts`, `src/main/test-helpers/gitRepo.ts`, and any other test that hard-codes `/bin/sh`, POSIX paths or `\n`-only output (search with `grep -rn "/bin/sh\|darwinPlatform\|'/tmp\|sleep \|echo " src --include='*.test.ts'`)

**Interfaces:**
- Produces (`src/main/test-helpers/shell.ts`):
  - `testPlatform(): Platform`
  - `echoCmd(text: string): string`
  - `sleepCmd(seconds: number): string`
  - `envRef(name: string): string`
  - `failCmd(code: number): string`
  - `isWindows: boolean`

- [ ] **Step 1: Write the helper and its test**

`src/main/test-helpers/shell.ts`:
```ts
import { darwinPlatform } from '../platform/darwin';
import type { Platform } from '../platform/Platform';
import { which } from '../platform/which';
import { windowsPlatform } from '../platform/windows';

export const isWindows = process.platform === 'win32';

/** The real platform for this OS, with a fast shell on macOS (/bin/sh, no login profile surprises). */
export const testPlatform = (): Platform =>
  isWindows ? windowsPlatform(process.env, { which: (n) => which(n) }) : darwinPlatform({ SHELL: '/bin/sh' });

/** Command lines in the syntax of testPlatform().shellCommand. */
export const echoCmd = (text: string): string => (isWindows ? `Write-Output '${text.replaceAll("'", "''")}'` : `echo '${text.replaceAll("'", "'\\''")}'`);
export const sleepCmd = (seconds: number): string => (isWindows ? `Start-Sleep -Seconds ${seconds}` : `sleep ${seconds}`);
export const envRef = (name: string): string => (isWindows ? `$env:${name}` : `$${name}`);
export const failCmd = (code: number): string => (isWindows ? `cmd /c exit ${code}` : `exit ${code}`);
```

`src/main/test-helpers/shell.test.ts` runs on the current OS, so CI covers both:
- `echoCmd('a b')` through `testPlatform().shellCommand` prints `a b`;
- `failCmd(3)` exits with 3;
- a missing command exits non-zero;
- `envRef('MIAC_X')` prints the value set in env.

Use `child_process.spawnSync` with the returned command and args.

- [ ] **Step 2: Convert the POSIX-only tests**

- Replace `darwinPlatform({ SHELL: '/bin/sh' })` with `testPlatform()`.
- Replace inline shell snippets with the helpers. For example, `'echo dev-server-up; sleep 30'` becomes `` `${echoCmd('dev-server-up')}; ${sleepCmd(30)}` `` (`;` separates statements in both shells).
- Replace `$VAR` with `envRef('VAR')`.
- Interactive-shell tests that type `exit\r` keep working, because `exit` works in both.
- Buffer assertions use `toContain` (ConPTY adds `\r\n` and escape codes).
- A test that cannot be made portable gets `it.skipIf(isWindows)('...', ...)` with a comment explaining why. Keep the count small and list every skip in the report.
- `gitRepo.ts`: after `git init`, run `git config core.autocrlf false` so content comparisons match on Windows. Temp paths use `os.tmpdir()`.
- Telemetry env test (`handlers.test.ts`): the echo line uses `envRef('OTEL_RESOURCE_ATTRIBUTES')` and the same for the endpoint, so `T=...` expectations hold on both.

- [ ] **Step 3: Run the whole suite on macOS**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS on macOS. Windows is proven by CI in Task 4 and the controller's run in Task 5.

- [ ] **Step 4: Commit**

```bash
git add src
git commit -m "test: portable shell helpers so the suite runs on macOS and Windows"
```

---

### Task 4: Packaging, signing hook, CI workflow and Windows checklist

**Files:**
- Modify: `forge.config.mts`
- Create: `tools/windows-sign/sign.cjs`, `tools/windows-sign/README.md`, `.github/workflows/ci.yml`, `docs/windows-checklist.md`
- Modify: `README.md` (one "Windows" section pointing to the checklist and the CI artifact)

**Interfaces:**
- Consumes: env vars set by CI:
  - `ARTIFACT_SIGNING_ENDPOINT`, `ARTIFACT_SIGNING_ACCOUNT`, `ARTIFACT_SIGNING_PROFILE`;
  - `SIGNTOOL_PATH` (full path to the Windows SDK x64 `signtool.exe`);
  - `ARTIFACT_SIGNING_DLIB` (full path to `Azure.CodeSigning.Dlib.dll`);
  - `ARTIFACT_SIGNING_METADATA` (path to the `metadata.json` CI writes).

- [ ] **Step 1: Forge config**

In `forge.config.mts`:
```ts
const signing = process.env.ARTIFACT_SIGNING_ENDPOINT
  ? { hookModulePath: path.resolve(process.cwd(), 'tools/windows-sign/sign.cjs') }
  : undefined;
```
(Forge runs from the project root; `import path from 'node:path'`.)

- `packagerConfig`: `{ asar: true, executableName: 'MIAC', ...(signing ? { windowsSign: signing } : {}) }`.
- `new MakerSquirrel({ name: 'miac', setupExe: 'MIAC-Setup.exe', ...(signing ? { windowsSign: signing } : {}) })`.

`MakerSquirrel` spreads its config into `electron-winstaller`, which accepts `windowsSign`. Check that the installed `electron-winstaller` `lib/options.d.ts` has `windowsSign`; it was confirmed present during planning.

- [ ] **Step 2: Signing hook**

`tools/windows-sign/sign.cjs`:
```js
// Called by @electron/windows-sign for every file (hookModulePath). Signs with Azure Artifact Signing.
// Credentials come from the Azure CLI login done by the CI workflow (azure/login with OIDC); the dlib
// resolves them per call, so long builds do not hit an expired token.
const { execFileSync } = require('node:child_process');

module.exports = function sign(file) {
  const signtool = process.env.SIGNTOOL_PATH;
  const dlib = process.env.ARTIFACT_SIGNING_DLIB;
  const metadata = process.env.ARTIFACT_SIGNING_METADATA;
  if (!signtool || !dlib || !metadata) throw new Error('Signing requested but SIGNTOOL_PATH, ARTIFACT_SIGNING_DLIB or ARTIFACT_SIGNING_METADATA is missing');
  execFileSync(signtool, ['sign', '/v', '/fd', 'SHA256', '/tr', 'http://timestamp.acs.microsoft.com', '/td', 'SHA256', '/dlib', dlib, '/dmdf', metadata, file], { stdio: 'inherit' });
};
```

`tools/windows-sign/README.md`: what the hook does, the env vars it reads, and that it only runs in CI. Point to the spec's owner setup section.

- [ ] **Step 3: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: ['**']
    tags: ['v*']
  pull_request:

permissions:
  contents: read

jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test

  windows-installer:
    needs: test
    runs-on: windows-latest
    permissions:
      contents: write
      id-token: write
    env:
      SIGN: ${{ github.event_name == 'push' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')) && vars.AZURE_CLIENT_ID != '' && vars.AZURE_TENANT_ID != '' && vars.AZURE_SUBSCRIPTION_ID != '' && vars.ARTIFACT_SIGNING_ENDPOINT != '' && vars.ARTIFACT_SIGNING_ACCOUNT != '' && vars.ARTIFACT_SIGNING_PROFILE != '' }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Azure login (OIDC)
        if: env.SIGN == 'true'
        uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
      - name: Prepare signing tools
        if: env.SIGN == 'true'
        shell: pwsh
        run: |
          nuget install Microsoft.ArtifactSigning.Client -OutputDirectory "$env:RUNNER_TEMP\as" -ExcludeVersion
          $dlib = Get-ChildItem "$env:RUNNER_TEMP\as" -Recurse -Filter Azure.CodeSigning.Dlib.dll | Where-Object FullName -match 'x64' | Select-Object -First 1
          $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe | Where-Object FullName -match '\\x64\\' | Sort-Object FullName -Descending | Select-Object -First 1
          $meta = "$env:RUNNER_TEMP\metadata.json"
          @{ Endpoint = "${{ vars.ARTIFACT_SIGNING_ENDPOINT }}"; CodeSigningAccountName = "${{ vars.ARTIFACT_SIGNING_ACCOUNT }}"; CertificateProfileName = "${{ vars.ARTIFACT_SIGNING_PROFILE }}"; ExcludeCredentials = @('ManagedIdentityCredential','EnvironmentCredential','WorkloadIdentityCredential','SharedTokenCacheCredential','VisualStudioCredential','VisualStudioCodeCredential','AzurePowerShellCredential','AzureDeveloperCliCredential','InteractiveBrowserCredential') } | ConvertTo-Json | Set-Content $meta
          "ARTIFACT_SIGNING_DLIB=$($dlib.FullName)" >> $env:GITHUB_ENV
          "SIGNTOOL_PATH=$($signtool.FullName)" >> $env:GITHUB_ENV
          "ARTIFACT_SIGNING_METADATA=$meta" >> $env:GITHUB_ENV
          "ARTIFACT_SIGNING_ENDPOINT=${{ vars.ARTIFACT_SIGNING_ENDPOINT }}" >> $env:GITHUB_ENV
      - run: npm run make
      - name: Verify signature
        if: env.SIGN == 'true'
        shell: pwsh
        run: |
          $setup = Get-ChildItem out/make/squirrel.windows -Recurse -Filter MIAC-Setup.exe | Select-Object -First 1
          & $env:SIGNTOOL_PATH verify /pa /v $setup.FullName
          if ($LASTEXITCODE) { exit $LASTEXITCODE }
      - name: Summary
        shell: pwsh
        run: |
          if ($env:SIGN -eq 'true') { "Windows installer: **signed** with Azure Artifact Signing" >> $env:GITHUB_STEP_SUMMARY }
          else { "Windows installer: **unsigned** (signing variables not set, or not a push to main / v* tag)" >> $env:GITHUB_STEP_SUMMARY }
      - uses: actions/upload-artifact@v4
        with:
          name: MIAC-Setup-${{ github.sha }}
          path: out/make/squirrel.windows/**/MIAC-Setup.exe
          if-no-files-found: error
      - name: Release
        if: startsWith(github.ref, 'refs/tags/v')
        shell: pwsh
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          $setup = Get-ChildItem out/make/squirrel.windows -Recurse -Filter MIAC-Setup.exe | Select-Object -First 1
          gh release create "${{ github.ref_name }}" $setup.FullName --title "MIAC ${{ github.ref_name }}" --generate-notes
```
Notes for the implementer:
- Verify the NuGet package id at implementation time: `Microsoft.ArtifactSigning.Client`, or the older `Microsoft.Trusted.Signing.Client`. Use whichever exists on nuget.org (one `WebFetch` of `https://www.nuget.org/packages/Microsoft.ArtifactSigning.Client`). Note the result in the report.
- The signing path cannot be executed until the owner's Azure setup exists. Review it as text.
- Do not add `continue-on-error` anywhere.

- [ ] **Step 4: Checklist and README**

`docs/windows-checklist.md`: copy the spec's "Manual Windows checklist" verbatim. Add a header line explaining where to download the installer: GitHub, then the Actions run, then the `MIAC-Setup-<sha>` artifact, or the Release for tags. `README.md` gets a short "Windows" section linking to it.

- [ ] **Step 5: Local checks**

Run: `npm test && npm run typecheck && npm run lint`, then on macOS `npx electron-forge package`. That checks the config still loads and packages for darwin (Squirrel cannot run on macOS). Expected: PASS, packaged app under `out/`. Then delete `out/`.

- [ ] **Step 6: Commit**

```bash
git add forge.config.mts tools/windows-sign .github/workflows/ci.yml docs/windows-checklist.md README.md
git commit -m "build: Windows installer, Azure Artifact Signing hook and CI on macOS and Windows"
```

---

### Task 5: Prove it on Windows CI (controller)

- [ ] **Step 1:** Push the feature branch. The owner chose CI-based testing for this slice, and pushing a feature branch only triggers CI. Watch the workflow with `gh run watch` or `gh run view`.
- [ ] **Step 2:** If the Windows test job fails, collect the failing tests from `gh run view --log-failed` into a findings file and dispatch one fix subagent with it. Repeat at most 3 rounds. Each round gets a scoped re-review. Then rule on anything left (skip with a reason or park).
- [ ] **Step 3:** Confirm the `windows-installer` job produced `MIAC-Setup-<sha>` and the summary says "unsigned". Download it with `gh run download` and check it is a PE file over 50 MB.
- [ ] **Step 4:** Update `CLAUDE.md` Status:
  - sub-project 5 Windows support;
  - the CI artifact;
  - signing switches on with the six variables;
  - the manual checklist is pending on real hardware;
  - first signed build pending Azure validation.
  
  Commit.
