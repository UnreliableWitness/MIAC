# Manual Windows checklist

Download the installer from GitHub: open the Actions run for the commit, then the `MIAC-Setup-<sha>` artifact. For a `v*` tag, use the Release instead.

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
