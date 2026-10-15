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
   - the installer (`MIAC-Setup.exe`) and the Start menu entry show the Mind dial icon.
10. **Shortcuts.** While a PowerShell terminal has focus, `Ctrl+0` opens the Usage tab, `Ctrl+1..9` switch terminals and `Ctrl+Shift+F` toggles Focus. `Ctrl+C` still interrupts the running command.

If a setup command or a shim fails with "running scripts is disabled on this system": MIAC passes `-ExecutionPolicy Bypass`, but an execution policy set by Group Policy overrides it. Ask IT, or install claude and copilot as native `.exe` builds.
