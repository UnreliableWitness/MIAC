# MIAC — "Me, I'm Counting"

[![CI](https://github.com/UnreliableWitness/MIAC/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/UnreliableWitness/MIAC/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/UnreliableWitness/MIAC?include_prereleases&sort=semver)](https://github.com/UnreliableWitness/MIAC/releases) ![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS-blue) ![Electron](https://img.shields.io/badge/Electron-44.7.2-47848F?logo=electron&logoColor=white)

Named after a Culture ship. A desktop app for running development tasks as isolated workspaces, with AI cost tracking per task.

## What it does

- **Task = worktree + branch + terminals**, tied to an Azure DevOps work item.
  - Create a git worktree and branch from a work item.
  - Run per-repo setup (e.g. `npm ci`) after creating the worktree.
  - Open the task's terminals: Claude Code, GitHub Copilot, PowerShell, dev server.
  - Clean up the worktree and branch when the task is done.
- **AI cost tracking per task.**
  - Track Claude Code and Copilot token usage per task via OpenTelemetry, tagged with the task id.
  - Price usage with the official list prices, in EUR.
  - Log the cost on the work item via custom fields plus a comment.

## Tech

- Electron + xterm.js + node-pty.
- Windows is the primary target.

## Conventions

- Per-repo setup file: `.miac.yml` (setup commands, terminals, dev server, etc.).
- CLI entry point: `miac start <workitem>`.

## Status

Working app (Electron, macOS for development, Windows as the release target): task workspaces, Azure DevOps work items and per-task AI cost tracking are in place. Run with `npm start`; checks are `npm test`, `npm run typecheck` and `npm run lint`.

## Windows

The Windows installer (`MIAC-Setup.exe`) is built by CI. Get it from the Actions run (artifact `MIAC-Setup-<sha>`) or, for `v*` tags, from the GitHub Release. Verify a build with [docs/windows-checklist.md](docs/windows-checklist.md). Signing details are in `tools/windows-sign/README.md`.
