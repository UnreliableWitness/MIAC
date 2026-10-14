# MIAC design mockups

Copied from the design canvas on 2026-10-14: https://claude.ai/artifact/4kbfLSRgmPYqtrJWZ6yoMJ
The canvas is the source of truth; these are a snapshot for reference while building.

Each `mockups/*.dc.html` is one screen as HTML with inline styles plus a small `class Component` script
holding the sample data. They use the canvas's `<x-dc>` / `{{hole}}` / `<sc-for>` template format, so they
don't render standalone in a browser; read them for layout, copy, colors and data shapes, or open the canvas link to see them.
`mockups/canvas.json` lists the screens and their order.

| File | Screen |
|---|---|
| `Main.dc.html` | 1. Workspace: task list per repo, task header with AI cost, terminal tabs (Claude Code, PowerShell, dev) |
| `NewTask.dc.html` | 2. New task from a work item: pick item, repo, base, branch, setup and start options |
| `Setup.dc.html` | 3. Task setup running: step list plus live log (worktree, copy .env, npm ci, build) |
| `Done.dc.html` | 4. Finish task: safety checks, final AI usage to work item, clean up worktree/branch |
| `Settings.dc.html` | 5. Settings: repos and `.miac.yml`, Azure DevOps connection, rate table and currency |
| `Usage.dc.html` | 6. Task AI usage: per-session tokens and cost, custom fields and comment on the work item |
| `Invoicing.dc.html` | 7. AI cost per customer for invoicing, per period, with CSV export |

Visual language: dark UI (`#15171a` ground, `#1b1e23` panels, `#2a2e35` borders), amber accent `#f0a443`,
IBM Plex Sans for UI, JetBrains Mono for code, ids, paths and money.
