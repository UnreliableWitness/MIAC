# MIAC sub-project 5: Windows support

Date: 2026-10-14
Status: design approved in conversation, awaiting written review
Builds on: sub-projects 1-4 (merged, PR #1-#4)

## Context

Windows is MIAC's release target, but sub-projects 1-4 were built and tested on macOS. All shell, path and spawn logic sits behind the `Platform` interface (`src/main/platform/`). On `win32`, `createPlatform` throws today. This slice:
- implements Windows;
- makes the test suite run on Windows;
- adds CI on macOS and Windows that builds a Windows installer;
- signs that installer with Azure Artifact Signing once the owner's Azure setup exists.

The owner tests by downloading the CI-built installer onto a real Windows machine. Development stays on macOS.

## Scope

In:
- A `windowsPlatform` module, and `createPlatform` returning it on `win32`.
- Windows-safe process starting for Claude Code, Copilot CLI, setup commands and the editor.
- `core.longpaths` for git worktree commands.
- A retry on `EPERM`/`EBUSY` for the atomic rename in every JSON store.
- A test suite that passes on macOS and Windows.
- GitHub Actions CI:
  - a macOS + Windows matrix: lint, typecheck, test;
  - the Windows installer as an artifact;
  - a GitHub Release on `v*` tags.
- Squirrel installer `MIAC-Setup.exe`.
- Azure Artifact Signing in CI, switched on by repo variables.
- A manual test checklist for Windows.

Out:
- Auto-update.
- App icon (still needs the Gemini key).
- Linux.
- A WSL or Git Bash shell option.
- macOS signing and notarization.

## Research facts (2026-10-14)

- Azure Trusted Signing is now **Azure Artifact Signing**: $9.99 a month for 5,000 signatures per certificate profile.
- It needs **Organization** identity validation: an Organization-type billing account whose legal name matches the business register. Validation takes about 1-20 business days. The EU is eligible.
- Microsoft's signing tooling runs on Windows. CI authenticates with GitHub OIDC (`id-token: write`) and a federated credential. The identity needs the "Artifact Signing Certificate Profile Signer" role.
- Projects signing Electron apps this way hook `signtool` plus the Artifact Signing client library (`/dlib` with a `metadata.json`) into the packager's per-file signing step, and fetch credentials per file so tokens do not expire mid-build.
- Changing the signing identity after the first signed release breaks auto-update chains. Choose the publisher (the validated company name) once.

## Design

### Platform: `src/main/platform/windows.ts`

`windowsPlatform(env, deps)`, where `deps` contains `which(name): string | null`, a PATH and PATHEXT lookup that can be injected so tests run on any OS.

- **Shell:** `pwsh` if `which('pwsh')` finds it, otherwise `powershell.exe`. `shellLabel` is `PowerShell`.
- **`interactiveShell()`:** `{ command: shell, args: ['-NoLogo', '-ExecutionPolicy', 'Bypass'] }`.
- Every PowerShell arg list carries `-ExecutionPolicy Bypass`, so npm `.ps1` shims run on machines with the default Restricted policy. A Group Policy execution policy still overrides it.
- **`shellCommand(cmd)`:**
  - Runs `{ command: shell, args: ['-NoLogo', '-ExecutionPolicy', 'Bypass', '-NoProfile', '-NonInteractive', '-Command', wrapped] }`, where `wrapped` is (`psSetupWrapper`):
    ```
    $miacFailed = $false
    & {
    <cmd>
    } 2>&1 | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) {
        if ("$($_.FullyQualifiedErrorId)" -notlike 'NativeCommandError*') { $miacFailed = $true }
        [Console]::Error.WriteLine("$_")
      } else { $_ }
    }
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    if ($miacFailed) { exit 1 }
    ```
  - A failing native command passes on its exit code; a cmdlet error or a missing command gives exit 1, so the setup step fails as on macOS.
  - Native stderr never fails the step. Windows PowerShell 5.1 wraps native stderr in `NativeCommandError` records when output is redirected, and `$ErrorActionPreference = 'Stop'` made those terminating (`npm ci` printing `npm warn` failed). Those records are passed through as text. `$?` is not used: it stays true after `& { ... }` even when an error was written inside.
  - The command sits on its own lines, so a trailing `# comment` does not swallow the rest of the wrapper.
  - `&&` and `||` need PowerShell 7; 5.1 rejects them.
  - The user's PATH comes from the environment. No profile is needed.
  - Used by SetupRunner only (output to pipes).
- **`runCommand(cmd)`:** for `run` terminals in a pty (the dev server) and the packaged smoke check. Same args, with `wrapped` (`psRunWrapper`):
    ```
    & {
    <cmd>
    }
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    ```
  - No pipe: the program keeps the console, so it sees a TTY, UTF-8 output is not decoded through the OEM code page, and logs are not block-buffered. In a real console 5.1 does not wrap native stderr. A `throw` exits 1. On macOS `runCommand` equals `shellCommand`.
- **`claudeCommand(prompt)`:** resolve `which('claude')`.
  - `.exe` (native installer): `{ command: <full path>, args: [prompt] }`. node-pty quotes the argument for ConPTY, so quotes in work item titles survive.
  - `.cmd`/`.bat`/`.ps1` shim (npm install): `{ command: shell, args: ['-NoLogo', '-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', '& claude $env:MIAC_CLAUDE_PROMPT'] }`. The prompt goes in the env var `MIAC_CLAUDE_PROMPT`, so it is never parsed as PowerShell.
  - The `.cmd` shim re-parses its arguments through cmd.exe, so `shimSafePrompt` sanitises the prompt first: `"` becomes `'`, and `& | < > ^ %` are dropped. Title quotes survive intact only with a native `claude.exe`.
  - Not found: run the shell with `claude` anyway, so the tab shows PowerShell's "not recognized" message.
  - This needs a small `Command` extension, `env?: Record<string, string>`, merged by `TerminalManager.spawn` and the setup runner.
- **`copilotCommand()`:** the same resolution for `copilot`, with no prompt.
- **`editorCommand(path)`:** `{ command: shell, args: ['-NoLogo', '-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', "& code '<quoted path>'"] }`. `psQuote` doubles `'` and the typographic single quotes U+2018 to U+201B, which PowerShell also treats as quotes. When `which('code')` finds nothing it throws "VS Code (code) is not on PATH", which the Open in VS Code action shows. `main.ts` `launch` passes `windowsHide: true`.
- **`createPlatform`** returns `windowsPlatform(process.env, { which: realWhich })` on `win32`. `realWhich` walks `PATH` with `PATHEXT` (`.COM;.EXE;.BAT;.CMD` by default).

### Git

`GitClient` adds `-c core.longpaths=true` to `worktree add`, `worktree remove` and `worktree prune` on every OS. It is harmless on macOS.

- Every `child_process` call in the app passes `windowsHide: true` (git, setup commands, launch), so no console window flashes. A source-scan test (`src/main/windowsHide.test.ts`) enforces it.
- `worktreeRemove` retries with the same 50 to 800 ms backoff when git reports the folder in use (`Permission denied`, `Directory not empty`, `being used by another process`, `EBUSY`).

### Terminals and processes

- `TerminalManager.spawn` passes `useConptyDll: true` on Windows: node-pty uses its bundled `conpty.dll` and `OpenConsole.exe`. The default system-ConPTY kill path calls `child_process.fork` for a console process list; with the RunAsNode fuse off, that fork relaunches `MIAC.exe`. The conpty.dll kill path does not fork. node-pty is pinned to `1.2.0-beta.15`: 1.1.0 has an unsynchronized global pty handle list on Windows (microsoft/node-pty#921, fixed in 1.2.0-beta.13), and a pty exiting while another is spawned, resized or killed can crash the process with an access violation (0xC0000005). The pin keeps the `useConptyDll` reason intact: the beta still forks on the system-ConPTY kill path.
- `kill` and `killAllForTask` return promises that resolve when the pty exits, or after 3 s. Finish and Cancel setup await them before `git worktree remove`, because Windows will not remove a folder that is a running process's cwd.
- `main.ts` takes `app.requestSingleInstanceLock()`. A second instance quits before `boot()`, and the first one focuses its window.

### File stores

A shared helper `renameWithRetry(from, to)` retries `fs.rename` on `EPERM`, `EBUSY` and `EACCES`, up to 5 times with 50, 100, 200, 400 and 800 ms waits, then rethrows. It is used by:
- `TaskStore`
- `ConnectionStore`
- `JsonFileStore` (settings)
- `UsageStore` (`billable.json`)

### Tests

- `windows.test.ts`:
  - runs on every OS with a fake `which`;
  - covers pwsh present and missing, claude `.exe` versus `.cmd`, a prompt with `'` and `"`, the editor path with `'`, copilot, and the `shellCommand` wrapper text.
- `src/main/test-helpers/shell.ts` exports portable helpers for tests that start real processes:
  - `testPlatform()`: darwin with `/bin/sh` on macOS; on Windows the real `windowsPlatform`, so tests exercise the PowerShell wrapper;
  - `echoCmd(text)`, `sleepCmd(seconds)`, `envRef(name)`, so a test can write a command once.
- `handlers.test.ts`, `SetupRunner.test.ts` and `TerminalManager.test.ts` use these helpers.
  - A test that cannot be made portable gets `it.skipIf(process.platform === 'win32')` with a one-line reason.
  - No test is deleted.
- Git tests set `core.autocrlf=false` in their temp repos so output comparisons match on Windows.
- `scripts/fix-node-pty-perms.mjs` stays as it is. It already does nothing on Windows, because there is no `spawn-helper`.
- A Windows-only block in `shell.test.ts` runs the setup wrapper under both `powershell.exe` (5.1) and `pwsh`: native stderr with exit 0 succeeds, `cmd /c exit 3` exits 3, a missing command and `Write-Error` fail, a silenced error does not, a trailing comment is harmless, `throw` exits 1 and native stdout passes through intact. A Windows-only block in `TerminalManager.test.ts` runs `runCommand` in ConPTY: a U+279C marker from node arrives intact, node sees a TTY, native stderr with exit 0 succeeds, a native exit code and `throw` are passed on.

### CI: `.github/workflows/ci.yml`

- **Triggers:** `push` (all branches), `pull_request`, tags `v*`.
- **Matrix:** `macos-latest`, `windows-latest`, Node 24. Each job runs `npm ci`, `npm run lint`, `npm run typecheck` and `npm test`. The macOS job then runs `npx electron-forge package` and the smoke check.
- **Smoke check:** `node tools/forge/smoke.mjs` starts the packaged executable with `MIAC_SMOKE=1`. In that mode `main.ts` skips the single-instance lock and `boot()` (no window, no stores), spawns one pty through `TerminalManager` with the platform's `shellCommand`, prints `MIAC_SMOKE_OK` and exits 0 when the output and a clean exit arrive, else exits 1 (20 s limit inside the app). The script fails on a missing marker, a non-zero exit, or no exit within 60 s: a main bundle that cannot load shows a modal error dialog and never exits on its own. Both Windows jobs run it after `make`.
- **Two Windows jobs, both after the tests:**
  - `windows-installer`: runs on pull requests and on pushes to branches other than `main` and `v*` tags. It has `contents: read` only and never signs. It runs `npm run make`, uploads `out/make/squirrel.windows/**/MIAC-Setup.exe` as the artifact `MIAC-Setup-<sha>`, and the summary says it is unsigned because this is not main or a tag.
  - `windows-release`: runs on pushes to `main` and `v*` tags, in the GitHub environment `release`, with `contents: write` and `id-token: write`. It builds and uploads the same artifact, and on `v*` tags it creates a GitHub Release with the installer attached. When signing is off, that release is a prerelease titled `MIAC <tag> (unsigned)`.
- **Signing** (only in `windows-release`):
  - It runs only when all six variables below are set. If not, the job builds unsigned and the summary names the missing variables.
  - Before `make`, CI logs in with `azure/login` (OIDC, `allow-no-subscriptions: true`). The federated credential trusts the environment `release`, so a pull request can never obtain a token.
  - The Azure CLI token from OIDC cannot be refreshed; it lasts about 60 to 90 minutes, so a signing build must finish inside that window.
  - CI then exports the variables that the Forge signing hook reads.
  - After `make`, `signtool verify /pa /v` runs on every `*.exe` under `out/` (the packaged `MIAC.exe`, node-pty's `OpenConsole.exe` under `app.asar.unpacked`, and `MIAC-Setup.exe`), and any failure fails the job. The packager's signer walks the whole app folder (`.exe`, `.dll`, `.node`), so the node-pty binaries are signed with the rest. This is needed because the nested signer in `electron-winstaller` swallows hook errors.
  - In the signing job, every action is pinned to a full commit SHA.

### Packaging and signing: `forge.config.mts`

- `packagerConfig`: `executableName: 'MIAC'`, and `windowsSign` when signing is enabled.
  - `ignore` is `keepInPackage` (`tools/forge/packageFilter.mjs`): `/.vite`, plus node-pty's `package.json`, `lib` and the prebuilds for the host platform and arch (no `.pdb`, no sources, no `binding.gyp`, so Forge's rebuild leaves the N-API prebuilds alone). The Vite plugin's default keeps only `/.vite`, but `node-pty` is external to the main bundle and is required at runtime. Its only dependency, `node-addon-api`, is build-only.
  - `asar: { unpack: '**/node_modules/node-pty/**' }`: the `.node` files, `spawn-helper` (macOS), the conpty worker script, `conpty.dll` and `OpenConsole.exe` must be real files on disk.
- `MakerSquirrel`: `{ name: 'miac', setupExe: 'MIAC-Setup.exe', windowsSign }` when signing is enabled. The Squirrel id stays lowercase `miac`, matching `package.json` `name`, so installs and future updates share one id.
- `windowsSign` uses a hook module, `tools/windows-sign/sign.cjs`, called for each file. For each file it runs:
  ```
  signtool sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib <Azure.CodeSigning.Dlib.dll> /dmdf <metadata.json> <file>
  ```
  - `metadata.json` is written by CI from `ARTIFACT_SIGNING_ENDPOINT`, `ARTIFACT_SIGNING_ACCOUNT` and `ARTIFACT_SIGNING_PROFILE`.
  - The dlib comes from the Artifact Signing client NuGet package, which CI installs.
  - `signtool` comes from the Windows SDK on the runner.
- Signing is enabled when `process.env.ARTIFACT_SIGNING_ENDPOINT` is set at make time. Local `npm run make` on macOS or Windows stays unsigned.

### Owner setup for signing (Azure portal, about 30 minutes plus validation)

1. **Create an Artifact Signing account.** In the Azure subscription, first register the `Microsoft.CodeSigning` resource provider (Subscription > Resource providers). Then create an Artifact Signing account in West Europe.
2. **Request identity validation.** On the account, assign yourself the **Artifact Signing Identity Verifier** role (Access control (IAM)); without it the validation page is read-only. Then open Identity validation, choose **Organization**, and submit the company's legal details. Approval takes 1-20 business days.
3. **Create a certificate profile.** After approval, create a **Public Trust** certificate profile. Note the account endpoint (for example `https://weu.codesigning.azure.net`), the account name and the profile name.
4. **Create the CI identity.**
   - In Microsoft Entra ID, create an app registration `miac-ci-signing`.
   - In GitHub, open the repo, then Settings > Environments, and create an environment named `release`. Under deployment branches and tags, allow branch `main` and tags matching `v*`.
   - Add one federated credential to the app registration: GitHub Actions, repo `UnreliableWitness/MIAC`, entity type **Environment**, value `release` (subject `repo:UnreliableWitness/MIAC:environment:release`). This replaces separate branch and tag credentials.
5. **Grant signing rights.** On the certificate profile, assign the role **Artifact Signing Certificate Profile Signer** to `miac-ci-signing`.
6. **Add the variables.** In GitHub, add these either at repo level (Settings > Secrets and variables > Actions > Variables) or as environment variables of `release`:
   - `AZURE_CLIENT_ID`
   - `AZURE_TENANT_ID`
   - `AZURE_SUBSCRIPTION_ID`
   - `ARTIFACT_SIGNING_ENDPOINT`
   - `ARTIFACT_SIGNING_ACCOUNT`
   - `ARTIFACT_SIGNING_PROFILE`

   No secret is stored: OIDC replaces the client secret.

The validated company name becomes the publisher Windows shows. Choose it once.

### Manual Windows checklist (`docs/windows-checklist.md`)

1. Download `MIAC-Setup.exe` from the CI run or release and run it. Note whether SmartScreen warns (expected while unsigned) and whether the publisher shows (signed).
2. **Settings:**
   - add a git repo;
   - add an Azure DevOps connection;
   - check that the receiver shows "Listening on 127.0.0.1:4319".
3. **Create a task** from a work item, with a setup command (for example `npm ci`). Check:
   - the setup log streams;
   - the worktree appears next to the repo as `<repo>.worktrees\<slug>`;
   - `npm ci` warnings (stderr) do not fail the step, on PowerShell 7 and on Windows PowerShell 5.1;
   - a setup command that uses `&&` needs PowerShell 7 (`pwsh`); Windows PowerShell 5.1 rejects it, so use `;` or install PowerShell 7.
4. **Terminals.** The PowerShell tab opens. Claude Code starts with the task prompt. Copilot CLI starts, if it is installed.
   - Title quotes are intact only for a native `claude.exe`. For an npm-installed claude (a `.cmd` shim), `"` becomes `'` and `& | < > ^ %` are dropped from the prompt; that is expected.
5. **Usage.** Ask Claude something. Within about 10 s the cost tile and the Usage screen show the usage.
6. **Open in VS Code.** It opens the worktree, with no stray console window.
7. **Finish** with all boxes ticked. Check that:
   - the worktree folder and branch are removed;
   - the work item has the fields and the comment.
8. **Restart the app.** State, connections and usage are kept. Starting MIAC a second time while it runs focuses the open window instead of opening another.

If a setup command or a shim fails with "running scripts is disabled on this system": MIAC passes `-ExecutionPolicy Bypass`, but an execution policy set by Group Policy overrides it. Ask IT, or install claude and copilot as native `.exe` builds.

## Error handling

- `claude` or `copilot` not on PATH: the tab shows PowerShell's error and the user can restart it after installing. There is no crash.
- `pwsh` missing: `powershell.exe` is used.
- Rename locked for more than about 1.5 s: the original error is thrown, and the existing callers report it as today.
- Signing variables partly set: signing stays off and the summary names the missing ones.
- Signing set but failing: the job fails. An unsigned build is never published from a signing run.

## Open items

- The first signed build can only be verified after the owner's identity validation and setup. Until then CI proves the unsigned path.
- Real Windows behaviour (ConPTY, PowerShell quoting, Defender locks) is verified by the manual checklist, not by the controller.
