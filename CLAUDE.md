# MIAC — "Me, I'm Counting"

Named after a Culture ship. A desktop app for running development tasks as isolated workspaces, with AI cost tracking per task.

## What it does

- **Task = worktree + branch + terminals**, tied to an Azure DevOps work item.
  - Create a git worktree and branch from a work item.
  - Run per-repo setup (e.g. `npm ci`) after creating the worktree.
  - Open the task's terminals: Claude Code, GitHub Copilot, PowerShell, dev server.
  - Clean up the worktree and branch when the task is done.
- **AI cost tracking per task.**
  - Track Claude Code and Copilot token usage per task, using OpenTelemetry tagged with the task id.
  - Price usage with our own rate table, in EUR.
  - Log the cost on the work item via custom fields plus a comment.
  - Why: we use consumption-based licences and invoice customers for AI cost.

## Tech

- Electron + xterm.js + node-pty.
- **Must run on Windows** (primary target). Keep paths, shells (PowerShell) and node-pty builds Windows-first.

## Conventions

- Per-repo setup file: `.miac.yml` (setup commands, terminals, dev server, etc.).
- CLI entry point: `miac start <workitem>`.

## External resources

- Design doc and mocks (design canvas): https://claude.ai/artifact/4kbfLSRgmPYqtrJWZ6yoMJ
- Azure DevOps project: https://dev.azure.com/unreliablewitness/MIAC
  - Access needs a PAT. Never paste a PAT in chat or commit it; read it from the environment or a credential store.

## Status

- No code repo exists yet (as of 2026-10-14).
