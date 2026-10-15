# Manual Windows checklist

Download the installer from GitHub: open the Actions run for the commit, then the `MIAC-Setup-<sha>` artifact. For a `v*` tag, use the Release instead.

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
9. **Splash and icon.** Start the app. Check that:
   - the splash appears centred, plays, shows the boot steps and hands off to the main window;
   - a click or a key press skips it;
   - with Settings > Appearance > "Show splash on start" off, the next start has no splash;
   - the taskbar icon is legible at 100% and 150% display scaling;
   - the 16 px title-bar icon is sharp, not blank or blurry;
   - the installer (`MIAC-Setup.exe`) and the Start menu entry show the Mind dial icon;
   - Settings > Apps > Installed apps (Apps & features) shows the Mind dial icon for MIAC, not the Electron icon. The installer fetches it from `main` on GitHub, so this needs a build after the merge;
   - the main window has no menu bar above the task strip.
10. **Shortcuts.** While a PowerShell terminal has focus, `Ctrl+0` opens the Usage tab, `Ctrl+1..9` switch terminals and `Ctrl+Shift+F` toggles Focus. `Ctrl+C` still interrupts the running command.
    - On a Belgian or French (AZERTY) keyboard, `Ctrl+1` (the `&` key, no Shift) switches to the first terminal and `Ctrl+0` (the `à` key) opens the Usage tab.
11. **Auto-update.** Needs two tag releases, vN and vN+1 (for example `v0.2.0` and `v0.2.1`), each a normal release with `MIAC-Setup.exe`, `RELEASES` and `miac-<version>-full.nupkg` attached.
    - Install vN from its release and start it. Settings shows version N.
    - Publish vN+1. Within about an hour (or restart MIAC and wait 30 s), a notice says the new version is downloaded and a dialog offers Restart now or Later.
    - Pick Later, quit MIAC and start it again from the Start menu: Settings shows version N+1.
    - Repeat with vN+2 and pick Restart now: MIAC closes, restarts and shows version N+2. Open terminals are closed by the restart.
    - The first start after an install (Squirrel's `--squirrel-firstrun`) does not check; the hourly check still does.
    - With `"autoUpdate": false` in `%APPDATA%\miac\settings.json`, no update is downloaded.
    - `https://update.electronjs.org/UnreliableWitness/MIAC/win32-x64/<N>/RELEASES` returns a line naming the vN+1 `.nupkg`.

12. **Terminal rendering.** In a task's PowerShell tab and its Claude Code tab, check that:
    - Claude Code's start-up logo (the block-character mascot) and its rounded input box are drawn cleanly, with no gaps, overlaps or stretched characters.
    - In PowerShell, type a command longer than the window width, then resize the window narrower and wider: the line wraps and unwraps without duplicated or scrambled text. `cls`, `Get-ChildItem` and PSReadLine's grey prediction text look as they do in Windows Terminal.
    - Resizing while Claude Code runs redraws it without leftover fragments.

If a setup command or a shim fails with "running scripts is disabled on this system": MIAC passes `-ExecutionPolicy Bypass`, but an execution policy set by Group Policy overrides it. Ask IT, or install claude and copilot as native `.exe` builds.
