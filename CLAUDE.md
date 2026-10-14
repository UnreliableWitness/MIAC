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

- Sub-project 1 (app shell and task lifecycle) merged 2026-10-14 (PR #1). Sub-project 2 (Azure DevOps connections and work item picker) merged 2026-10-14 (PR #2). Sub-project 3 (AI usage capture, pricing and work item write-back) merged 2026-10-14 (PR #3). Sub-project 4 (official prices only) merged 2026-10-14 (PR #4). Sub-project 5 (Windows support) merged 2026-10-14 (PR #5): Windows `Platform` (PowerShell 7 or 5.1), CI on macOS + Windows (`.github/workflows/ci.yml`) building `MIAC-Setup.exe` as a run artifact, Azure Artifact Signing that switches on when the six repo/environment variables exist (owner setup steps in `docs/superpowers/specs/2026-10-14-windows-support-design.md`).
- Run with `npm start`; checks are `npm test`, `npm run typecheck`, `npm run lint`. Run `npm install` after pulling: a `postinstall` step fixes node-pty's spawn-helper permissions.
- Build order: (1) app shell and task lifecycle, done; (2) Azure DevOps integration, done (read-only: connections, picker, header link); (3) usage capture and pricing, done (Claude Code via OTLP receiver on 127.0.0.1:4319, Copilot CLI via per-task file, official-price rate table, EUR, fields + comment on the work item); (4) official prices only, done: all amounts use the built-in official rate table and USD to EUR 0.92, no local rates or markup, so every teammate writes identical numbers. Invoicing is done by managers with Azure DevOps queries on the `Custom.AI*` fields (filter by area path and Closed Date). Reconciliation against Anthropic and GitHub billing is deferred to a later sub-project. (5) Windows support, done (PR #5). Next: (6) winget distribution (manifest in microsoft/winget-pkgs pointing at the GitHub Release installer, best after signing is live), paired with Squirrel auto-update and delta updates.
- Azure DevOps test project `unreliablewitness/MIAC` (Basic process, Sprint 1) has seeded items 1-4 from `tools/ado/seed-test-items.mjs`. PAT for dev scripts lives in the macOS Keychain (account `miac`, service `miac-ado-unreliablewitness`); the app itself stores connections in `connections.json`, encrypted with safeStorage.
- Known gaps carried forward: Windows verified by CI only, manual checklist `docs/windows-checklist.md` pending on real hardware; first signed build pending Azure identity validation; a running setup cannot be cancelled; nav rows show only the branch; New task defaults the base to `origin/<base>` even without an `origin` remote; no app icon yet (Gemini key needed, see `tools/art/README.md`); the app does not yet write work item state; Copilot CLI capture is unverified (built from docs and synthetic fixtures, no licence to test); the test project uses the inherited process `Basic (MIAC)` with the four `Custom.AI*` fields; usage recorded before sub-project 4 keeps the rate it was priced with (including custom rates), and usage stored as unpriced is not repriced when an update adds the model.
- Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`.
