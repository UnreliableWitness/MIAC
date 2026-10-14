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
- Electron Forge (Vite + React + TypeScript), Vitest.
- **Windows is the release target**, but development happens on macOS first (decided 2026-10-14). All shell, path and spawn logic goes behind the `Platform` interface so the Windows implementation is a module swap, not a rewrite.

## Conventions

- Per-repo setup file: `.miac.yml` (setup commands, terminals, dev server, etc.).
- CLI entry point: `miac start <workitem>`.

## External resources

- Design doc and mocks (design canvas): https://claude.ai/artifact/4kbfLSRgmPYqtrJWZ6yoMJ
  - Local snapshot of the 7 mockup screens: `design/mockups/`, see `design/README.md` for what each screen shows. Use them as the UI reference.
- Azure DevOps project: https://dev.azure.com/unreliablewitness/MIAC
  - Access needs a PAT. Never paste a PAT in chat or commit it; read it from the environment or a credential store.
  - MIAC must support multiple Azure DevOps organizations (connections), each repo linked to one.
- GitHub repo: https://github.com/UnreliableWitness/MIAC

## Status

- Sub-project 1 (app shell and task lifecycle) merged 2026-10-14 (PR #1). Runs from `npm start`; `npm test`, `npm run typecheck`, `npm run lint` are the checks.
- Build order: (1) app shell and task lifecycle, done; (2) Azure DevOps integration; (3) usage capture and pricing; (4) invoicing and reconciliation.
- Known gaps carried forward: a running setup cannot be cancelled; nav rows show only the branch; no app icon yet (Gemini key needed, see `tools/art/README.md`); Windows `Platform` not implemented.
- Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`.
