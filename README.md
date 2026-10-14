# MIAC — "Me, I'm Counting"

Named after a Culture ship. A desktop app for running development tasks as isolated workspaces, with AI cost tracking per task.

## What it does

- **Task = worktree + branch + terminals**, tied to an Azure DevOps work item.
  - Create a git worktree and branch from a work item.
  - Run per-repo setup (e.g. `npm ci`) after creating the worktree.
  - Open the task's terminals: Claude Code, GitHub Copilot, PowerShell, dev server.
  - Clean up the worktree and branch when the task is done.
- **AI cost tracking per task.**
  - Track Claude Code and Copilot token usage per task via OpenTelemetry, tagged with the task id.
  - Price usage with a configurable rate table, in EUR.
  - Log the cost on the work item via custom fields plus a comment.

## Tech

- Electron + xterm.js + node-pty.
- Windows is the primary target.

## Conventions

- Per-repo setup file: `.miac.yml` (setup commands, terminals, dev server, etc.).
- CLI entry point: `miac start <workitem>`.

## Status

Early design stage. No application code yet.
