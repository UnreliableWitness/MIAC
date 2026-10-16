# Faster task setup and APM agent packages

Date: 2026-10-16. Status: approved by the owner (options A + B for `npm ci`, the APM plan as proposed).

## Problem

A new task waits for its setup commands (by default `npm ci`) before any terminal opens. On a real repo that is the
slowest part of starting a task, and Claude Code does not need `node_modules` to start reading and talking.

Repos that use [APM](https://microsoft.github.io/apm/) (Agent Package Manager, `apm.yml`) need `apm install` to put
their skills, prompts and MCP servers into the harness folders (`.claude/`, `.github/`, ...) of a fresh worktree.

## A. Setup commands run in the background

- The setup pipeline no longer runs the setup commands itself. The "Start terminals" step opens the task's tabs plus a
  **Setup** tab (a `run` terminal, last in the row) that runs the commands one after another in the worktree and stops
  at the first failure. The task is ready as soon as the terminals start.
- The Setup tab prints each command before running it. Its exit shows like any run tab (exit code, Restart).
- A Setup tab is never restarted by itself: a reopen leaves the old one out (a remade worktree gets a fresh Setup tab
  from the setup pipeline), and after an app relaunch it keeps the Restart button like other run tabs.
- The tab stores its commands (`TerminalDef.setupCommands`); `Platform.setupCommands(cmds)` turns them into one
  command for a pty: `set -e` and the lines on macOS, a `& { ... }` block per command with an exit-code check on
  PowerShell.

## B. Clone `node_modules` from the main checkout

- When the setup commands include `npm ci` and the platform can clone a folder cheaply (`Platform.cloneDir`), a step
  "Clone node_modules" runs after Copy local files.
- It clones `<repo>/node_modules` into the worktree only when that folder is up to date for the worktree's
  `package-lock.json`: every package in npm's hidden lockfile (`node_modules/.package-lock.json`) is in the lockfile
  with the same version, resolved URL and integrity, and every lockfile package missing from it is optional (other
  platforms' binaries). Lockfiles with workspaces or links never match. Otherwise the step ends with "out of date,
  npm ci installs" and nothing is copied (a clone would be thrown away by `npm ci`).
- At the terminals step, when the worktree's `node_modules` matches its lockfile, `npm ci` is left out of the Setup
  tab. This check reads the worktree, so a retry from a later step gets the same answer.
- macOS: one APFS `clonefile(2)` call on the folder, through JavaScript for Automation (`osascript -l JavaScript`,
  ships with macOS). Measured on MIAC (74 000 files, 786 MB): clonefile 1.1 s, `cp -cR` 8.4 s (it clones file by
  file), `npm ci` with a warm cache 9 s. The clone goes to `node_modules.miac-clone` and is renamed when complete; a
  failure (another volume, for example) is a warning and `npm ci` runs. Windows: no `cloneDir` for now (NTFS has no
  cheap clone; Dev Drive block cloning is a later option), so the step is not planned and `npm ci` runs as before,
  in the Setup tab.
- Root lifecycle scripts (`postinstall`, `prepare`) do not run for a cloned `node_modules`; what they wrote in the
  main checkout is cloned with it.

## APM

- A step "Install agent packages" runs after Write task file and before the terminals (Claude reads its skills and
  MCP servers when it starts), when the repo has an `apm.yml` and there is at least one target.
- Targets: the harnesses of the tabs setup opens: Claude Code `claude`, Copilot CLI `copilot`, OpenCode `opencode`.
  `.miac.yml` can override: `apm: false` turns the step off, `apm: [claude, cursor]` sets the targets.
- It runs `apm install --target <t>` once per target in the worktree (the docs only show comma lists for
  `init` and `compile`).
- `apm` not on the PATH (`apm --version` fails): the step ends as a warning and setup goes on. A failing install fails
  the step, with Retry.
- Tabs added later with + do not trigger an install.

## Out of scope

Dev Drive block cloning on Windows; installing apm; a `.miac.yml` switch to run setup commands before the terminals.
