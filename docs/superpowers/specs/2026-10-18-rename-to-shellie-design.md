# Rename MIAC to Shellie

Goal: the app, its repo and its Azure resources are called Shellie. Nobody loses tasks, settings or connections in the switch, and repos with a `.miac.yml` keep working.

Scope: everything a user or developer sees, the code names, the GitHub repo, the Azure DevOps test project, the App Insights resource, the dev Keychain entry and the local checkout folder. Out of scope: the historical specs and plans in `docs/superpowers/` and the mockups in `design/mockups/` keep the name they were written with; the Azure Artifact Signing account and its variables keep their names (nobody sees them).

## Names

- `package.json`: `name` `shellie`, `productName` `Shellie`. Forge: `executableName` `Shellie`, Squirrel `name` `shellie`, `setupExe` `Shellie-Setup.exe`, icons `assets/icon/shellie*` (the four SVG sources, `.ico` and `.icns` are renamed, not redrawn; `npm run icons` writes the new names).
- Window titles, splash, app menu, About, notices, release titles (`Shellie vX.Y.Z`, `(unsigned)` kept), CI artifact names `Shellie-Setup-<sha>`, README, CLAUDE.md, `docs/telemetry.md`, `docs/windows-checklist.md`.
- Code names follow: `MiacConfig` becomes `ShellieConfig`, identifiers and comments that say MIAC say Shellie. Internal identifiers go too: the preload global `window.miac` becomes `window.shellie`, the IPC event prefix, the telemetry channel, the Monaco theme and URI scheme, temp-file suffixes, CSV export names (`shellie-usage-<slug>.csv`, `shellie-time-<slug>.csv`) and the App Insights SDK tag. User-facing text that names the app says Shellie.
- Environment variables `MIAC_*` become `SHELLIE_*` (`SHELLIE_TELEMETRY`, `SHELLIE_TASK_ID`, `SHELLIE_CLAUDE_PROMPT`, `SHELLIE_SMOKE`, ...). `MIAC_TELEMETRY=0` is still honoured for one release so a scripted opt-out keeps working.
- `UPDATE_REPO` `UnreliableWitness/Shellie`; the installer `iconUrl` points at `UnreliableWitness/Shellie/main/assets/icon/shellie.ico`.

## Setup file

- `.shellie.yml` is the per-repo setup file. When a repo has no `.shellie.yml` but has `.miac.yml`, that file is read, with the same schema. When both exist, `.shellie.yml` wins and `.miac.yml` is ignored.
- Every place that reads or names the file goes through one helper (`configFileFor(dir)` next to `ShellieConfig`), so Finish, reopen, extra repos and the Docs tab agree.
- Settings and docs mention `.shellie.yml` only; the fallback is silent.

## Telemetry tag

- Agent processes get `OTEL_RESOURCE_ATTRIBUTES=shellie.task.id=<id>`.
- The OTLP receiver takes `shellie.task.id`, else `miac.task.id`, so Claude sessions started by MIAC before the update (still running, or resumed with their old env) are still counted.
- The Copilot per-task file and any other file or folder named after the app use `shellie` in new tasks; existing tasks keep reading the paths they recorded.

## Data migration

`src/main/migrateFromMiac.ts`, called first in `boot()`, before `SettingsStore` loads.

- Old folder: `path.join(app.getPath('appData'), 'miac')` (macOS `~/Library/Application Support/miac`, Windows `%APPDATA%\miac`). New folder: `app.getPath('userData')` (`.../Shellie`).
- Runs when the old folder has a `state.json` or `connections.json` and the new folder has neither. Otherwise it does nothing (fresh install, or already migrated).
- Copies `settings.json`, `state.json`, `connections.json`, `home.json`, `telemetry-id`, and the folders `usage/`, `review/` plus every other app-owned file or folder in the old root. It skips Chromium's own entries (`Cache`, `Code Cache`, `GPUCache`, `blob_storage`, `Cookies*`, `Local Storage`, `Session Storage`, `Dawn*`, `Graphite*`, `DIPS`, `Trust Tokens*`, `Shared Dictionary`, `Network Persistent State`, `Preferences`, `DevToolsActivePort`, `declarative_performance_observer*`), with one exception on Windows: `Local State`, which holds the DPAPI-protected safeStorage key.
- The old folder is never changed or deleted. Copies are written to a temp name and renamed, so an interrupted migration leaves no half-written `state.json` and runs again next start.
- A `migrated-from-miac.json` marker (time, what was copied, token result) is written last.

### Tokens

- Windows: safeStorage's key lives in `Local State`, protected by DPAPI for the Windows user; copied along, the tokens decrypt as before. Nothing else to do.
- macOS: the key is the Keychain item service `miac Safe Storage`, account `miac Key`; Shellie gets its own `Shellie Safe Storage`. After the copy, and only when `connections.json` has connections:
  1. Read the old password with `security find-generic-password -w -s "miac Safe Storage" -a "miac Key"` (macOS shows one access prompt for Shellie).
  2. Decrypt each `tokenCiphertext` with Chromium's macOS scheme: strip the `v10` prefix, AES-128-CBC, key = PBKDF2-HMAC-SHA1(password, `saltysalt`, 1003 iterations, 16 bytes), IV = 16 spaces, PKCS#7 padding.
  3. Encrypt again with `safeStorage.encryptString` and write `connections.json` atomically.
- If the prompt is refused, `security` fails, or a token does not decrypt: the connection is kept with its old ciphertext and `status: 'unauthorized'`, so the existing "Stored token could not be decrypted; enter it again" path asks for the PAT. One failing connection does not stop the others.
- The old Keychain item is left alone.

### Telemetry

- One `migration.miac` event: `copied` (count), `tokens` (`migrated` / `partial` / `refused` / `none`), `ms`. No paths or names. Listed in `docs/telemetry.md`.

## Outside the code (in this order)

1. App Insights: create resource group `shellie-telemetry` and workspace-based Application Insights `shellie-app` in the same region as `miac-app`; set the repo variable `APPINSIGHTS_CONNECTION_STRING` to its connection string. `miac-app` and `miac-telemetry` stay until the owner says they can go.
2. GitHub: `gh repo rename Shellie`; update the local `origin` URL. GitHub redirects the old URL, so open links and existing clones keep working.
3. The code change as one PR from `main`; green CI; owner merges. The merge releases the first Shellie version (next minor) under the new repo.
4. Azure DevOps: rename project `unreliablewitness/MIAC` to `Shellie` through the REST API (`PATCH _apis/projects/{id}`); its team `MIAC Team` to `Shellie Team`. Update `tools/ado/` defaults, docs and the Azure DevOps MCP config if it names the project. Local connections that store the project name `MIAC` are edited by hand in Settings (the test connection only).
5. Dev Keychain entry: add account `shellie`, service `shellie-ado-unreliablewitness` with the same PAT; switch `tools/` and docs; delete the old entry after a script has used the new one.
6. Move `~/Projects/MIAC` to `~/Projects/Shellie` and the Claude Code memory folder with it. Last, since this session runs in the old folder.

## Existing installs

- macOS (dev builds only): next launch is Shellie, migration as above.
- Windows: the Squirrel id changes, so installed MIAC builds get no update to Shellie. Each user installs `Shellie-Setup.exe` once (data migrates on its first start) and uninstalls MIAC from Apps & features. MIAC's last release stays on GitHub.

## Testing

- Unit: migration runs only when it should; Chromium cache entries are skipped; `Local State` copied on Windows only; atomic copy; marker written last; token re-encryption with a known Chromium test vector (encrypt with the scheme in the test, decrypt in the code); refused prompt and a bad ciphertext each leave that connection `unauthorized` and the others migrated.
- Unit: `.shellie.yml` wins over `.miac.yml`, `.miac.yml` is read alone; OTLP picks `shellie.task.id` and `miac.task.id`; `MIAC_TELEMETRY=0` still turns telemetry off.
- `npm test`, `npm run typecheck`, `npm run lint`; `git grep -i miac` lists only the allowed leftovers (historical docs, mockups, the fallbacks and the migration).
- Live on this Mac: launch Shellie with the existing `miac` data; tasks, settings and usage are there; the test connection works after the one Keychain prompt; Sprint and Home load.
