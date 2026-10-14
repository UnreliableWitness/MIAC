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
- **`interactiveShell()`:** `{ command: shell, args: ['-NoLogo'] }`.
- **`shellCommand(cmd)`:**
  - Runs `{ command: shell, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', wrapped] }`, where `wrapped` is `$ErrorActionPreference = 'Stop'; & { <cmd> }; if ($LASTEXITCODE) { exit $LASTEXITCODE }`.
  - A failing native command, or a PowerShell error, gives a non-zero exit, so the setup step fails as on macOS.
  - The user's PATH comes from the environment. No profile is needed.
- **`claudeCommand(prompt)`:** resolve `which('claude')`.
  - `.exe` (native installer): `{ command: <full path>, args: [prompt] }`. node-pty quotes the argument for ConPTY, so quotes in work item titles survive.
  - `.cmd`/`.bat`/`.ps1` shim (npm install): `{ command: shell, args: ['-NoLogo', '-NoProfile', '-Command', '& claude $env:MIAC_CLAUDE_PROMPT'] }`. The prompt goes in the env var `MIAC_CLAUDE_PROMPT`, so it is never parsed as PowerShell.
  - Not found: run the shell with `claude` anyway, so the tab shows PowerShell's "not recognized" message.
  - This needs a small `Command` extension, `env?: Record<string, string>`, merged by `TerminalManager.spawn` and the setup runner.
- **`copilotCommand()`:** the same resolution for `copilot`, with no prompt.
- **`editorCommand(path)`:** `{ command: shell, args: ['-NoLogo', '-NoProfile', '-Command', "& code '<path with '' doubled>'"] }`. `main.ts` `launch` passes `windowsHide: true`.
- **`createPlatform`** returns `windowsPlatform(process.env, { which: realWhich })` on `win32`. `realWhich` walks `PATH` with `PATHEXT` (`.COM;.EXE;.BAT;.CMD` by default).

### Git

`GitClient` adds `-c core.longpaths=true` to `worktree add`, `worktree remove` and `worktree prune` on every OS. It is harmless on macOS.

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
  - `testPlatform()`: darwin with `/bin/sh` on macOS; windows with `cmd.exe`-free PowerShell on Windows;
  - `echoCmd(text)`, `sleepCmd(seconds)`, `envRef(name)`, so a test can write a command once.
- `handlers.test.ts`, `SetupRunner.test.ts` and `TerminalManager.test.ts` use these helpers.
  - A test that cannot be made portable gets `it.skipIf(process.platform === 'win32')` with a one-line reason.
  - No test is deleted.
- Git tests set `core.autocrlf=false` in their temp repos so output comparisons match on Windows.
- `scripts/fix-node-pty-perms.mjs` stays as it is. It already does nothing on Windows, because there is no `spawn-helper`.

### CI: `.github/workflows/ci.yml`

- **Triggers:** `push` (all branches), `pull_request`, tags `v*`.
- **Matrix:** `macos-latest`, `windows-latest`, Node 24. Each job runs `npm ci`, `npm run lint`, `npm run typecheck` and `npm test`.
- **Windows job, after the tests:**
  - `npm run make`, which builds the Squirrel installer;
  - uploads `out/make/squirrel.windows/**/MIAC-Setup.exe` as the artifact `MIAC-Setup-<sha>`.
- **Signing:**
  - Runs only when the six repo variables below are set **and** the run is a push to `main` or a `v*` tag. It never runs on pull requests.
  - Before `make`, CI logs in with `azure/login` (OIDC, `permissions: id-token: write`).
  - CI then exports the variables that the Forge signing hook reads.
  - After `make`, `signtool verify /pa /v` on `MIAC-Setup.exe` must succeed, or the job fails.
  - The job summary always states "signed" or "unsigned (signing variables not set)".
- **On `v*` tags:** create a GitHub Release with the installer attached.

### Packaging and signing: `forge.config.mts`

- `packagerConfig`: `name: 'MIAC'`, `executableName: 'MIAC'`, and `windowsSign` when signing is enabled.
- `MakerSquirrel`: `{ name: 'MIAC', setupExe: 'MIAC-Setup.exe', windowsSign }` when signing is enabled.
- `windowsSign` uses a hook module, `tools/windows-sign/sign.cjs`, called for each file. For each file it runs:
  ```
  signtool sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib <Azure.CodeSigning.Dlib.dll> /dmdf <metadata.json> <file>
  ```
  - `metadata.json` is written by CI from `ARTIFACT_SIGNING_ENDPOINT`, `ARTIFACT_SIGNING_ACCOUNT` and `ARTIFACT_SIGNING_PROFILE`.
  - The dlib comes from the Artifact Signing client NuGet package, which CI installs.
  - `signtool` comes from the Windows SDK on the runner.
- Signing is enabled when `process.env.ARTIFACT_SIGNING_ENDPOINT` is set at make time. Local `npm run make` on macOS or Windows stays unsigned.

### Owner setup for signing (Azure portal, about 30 minutes plus validation)

1. **Create an Artifact Signing account.** In an Azure subscription, create an Artifact Signing account in West Europe.
2. **Request identity validation.** In the account, open Identity validation, choose **Organization**, and submit the company's legal details. Approval takes 1-20 business days.
3. **Create a certificate profile.** After approval, create a **Public Trust** certificate profile. Note the account endpoint (for example `https://weu.codesigning.azure.net`), the account name and the profile name.
4. **Create the CI identity.** In Microsoft Entra ID, create an app registration `miac-ci-signing`. Add two federated credentials:
   - GitHub Actions, repo `UnreliableWitness/MIAC`, entity type Branch, value `main`;
   - the same repo, entity type Tag, value `v*`.
5. **Grant signing rights.** On the certificate profile, assign the role **Artifact Signing Certificate Profile Signer** to `miac-ci-signing`.
6. **Add the repo variables.** In GitHub, open the repo, then Settings > Secrets and variables > Actions > Variables, and add:
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
   - the worktree appears next to the repo as `<repo>.worktrees\<slug>`.
4. **Terminals.** The PowerShell tab opens. Claude Code starts with the task prompt, and the title quotes are intact. Copilot CLI starts, if it is installed.
5. **Usage.** Ask Claude something. Within about 10 s the cost tile and the Usage screen show the usage.
6. **Open in VS Code.** It opens the worktree, with no stray console window.
7. **Finish** with all boxes ticked. Check that:
   - the worktree folder and branch are removed;
   - the work item has the fields and the comment.
8. **Restart the app.** State, connections and usage are kept.

## Error handling

- `claude` or `copilot` not on PATH: the tab shows PowerShell's error and the user can restart it after installing. There is no crash.
- `pwsh` missing: `powershell.exe` is used.
- Rename locked for more than about 1.5 s: the original error is thrown, and the existing callers report it as today.
- Signing variables partly set: signing stays off and the summary names the missing ones.
- Signing set but failing: the job fails. An unsigned build is never published from a signing run.

## Open items

- The first signed build can only be verified after the owner's identity validation and setup. Until then CI proves the unsigned path.
- Real Windows behaviour (ConPTY, PowerShell quoting, Defender locks) is verified by the manual checklist, not by the controller.
