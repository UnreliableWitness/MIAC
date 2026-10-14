# MIAC sub-project 1: app shell and task lifecycle

Date: 2026-10-14
Status: approved in conversation, awaiting written review

## Context

MIAC ("Me, I'm Counting") is a desktop app for a consultancy that bills customers for AI usage. A task is a git worktree, a branch and a set of terminals, tied to an Azure DevOps work item. MIAC captures Claude Code and GitHub Copilot token usage per task, prices it with the team's own rate table in EUR, and writes the result to the work item so cost rolls up per customer for invoicing.

The UI reference is the seven mockup screens in `design/mockups/` (see `design/README.md`). This document covers only the first sub-project. The full product is split into four sub-projects that build on each other:

1. **App shell and task lifecycle** (this spec): Electron app, repo registry, `.miac.yml`, create worktree and branch, run setup, terminals, finish and clean up.
2. **Azure DevOps integration**: multiple connections (organization URL, project, credential), each repo linked to one connection; PAT auth; work item picker; start Claude Code with the work item; set work item state; PR link.
3. **Usage capture and pricing**: embedded OTLP receiver, sessions tagged per task, rate table, usage screen, custom fields and comment on the work item.
4. **Invoicing and reconciliation**: per-customer roll-up across connections, CSV export, reconciliation against Anthropic and GitHub billing.

## Decisions carried into this slice

- **Platform**: develop and test on macOS first. Windows remains the release target, so all shell, path and spawn logic lives behind a `Platform` interface with a macOS implementation now and a Windows implementation later.
- **Stack**: Electron Forge with the Vite + React + TypeScript template. Forge owns the node-pty rebuild and, later, Windows packaging.
- **Multiple Azure DevOps organizations** are a requirement for sub-project 2. The repo record already carries a nullable `connectionId` so no migration is needed.
- **Task source** in this slice: a blank task with a name, or a typed work item id, type and title. Sub-project 2 replaces typing with a picker.
- Worktrees live in a sibling folder `<repo>.worktrees/<slug>`, as in the mockups.
- App state is one JSON file in Electron's user data folder, validated with zod.
- MIAC writes `.miac/task.md` into the worktree and adds `.miac/` to the worktree's `.git/info/exclude`.
- This slice runs from source with `npm start`. Packaging and the `miac` CLI come later.
- Styling is plain CSS with variables for the mockup palette and fonts. No component library.

## Architecture

### Processes

- **Main process** hosts the services and the IPC handlers. It is the only place that touches the filesystem, git and ptys.
- **Preload** exposes one typed `window.miac` API: request/response calls and event subscriptions. Context isolation on, node integration off.
- **Renderer** is React with a small store. It holds no business state of its own, only what main pushes.

### Core services

Each service is one file with one job and no Electron imports, so it can be unit tested with Vitest.

| Service | Responsibility |
|---|---|
| `RepoRegistry` | Registered repos (id, name, path, baseBranch, connectionId). Validates the path is a git repo. |
| `MiacConfig` | Loads and validates `.miac.yml` from a repo. Applies defaults when the file is missing. |
| `GitClient` | Thin wrapper over the `git` CLI: fetch, worktree add/remove, branch delete, status summary, ahead/behind. Returns parsed objects. |
| `SetupRunner` | Runs a task's setup steps in order, streams output, emits step state changes. |
| `TerminalManager` | Spawns ptys with node-pty keyed by task id and terminal id, cwd is the worktree. Emits data and exit, supports resize and kill. |
| `TaskStore` | Persists repos and tasks to `state.json`, loads on start, writes atomically (write temp file, then rename). |
| `Platform` | Default shell, how to spawn `claude`, path quirks. macOS now, Windows later. |

### Data model (persisted)

```ts
type Repo = {
  id: string;
  name: string;
  path: string;
  baseBranch: string;        // e.g. "main"
  connectionId: string | null;
  miacYmlFound: boolean;
};

type WorkItemRef = { id: string; type: "User Story" | "Bug" | "Task"; title: string };

type TerminalDef = { id: string; kind: "claude" | "shell" | "run"; label: string; command?: string };

type Task = {
  id: string;
  repoId: string;
  name: string;
  workItem: WorkItemRef | null;
  slug: string;
  branch: string;
  worktreePath: string;
  baseRef: string;           // e.g. "origin/main"
  status: "setting-up" | "ready" | "setup-failed" | "finishing" | "done";
  setup: { copy: boolean; commands: string[]; startClaude: boolean; openShell: boolean };
  terminals: TerminalDef[];
  createdAt: string;
  finishedAt: string | null;
};
```

Not persisted: pty handles, live output, git status. These are recomputed.

### `.miac.yml`

```yaml
base: main
branch: "{type}/{id}-{slug}"
copy: [.env, .env.local]
setup:
  - npm ci
  - npm run build
run:
  dev: npm run dev
  test: npm test
  lint: npm run lint
```

Defaults when the file is missing: base `main`, branch `{type}/{id}-{slug}`, setup `npm ci` if `package-lock.json` exists otherwise none, no copy list, no run commands.

Branch template variables: `{type}` is `feature` for User Story and blank tasks and `bugfix` for Bug; `{id}` is the work item id; `{slug}` is a kebab-case slug of the title or task name, max 40 characters. Blank tasks with no id render `{id}-` as empty, so the default template yields `feature/<slug>`.

## Flows

### Create task

1. New task dialog collects: repo, base ref, either a name or a work item id, type and title, branch (prefilled from the template, editable), which setup steps to run (copy files and each setup command, each a checkbox), and which terminals to open (Claude Code, PowerShell/shell).
2. On create, main validates that the branch does not exist and the worktree folder does not exist, writes the task as `setting-up`, and navigates to the Setup screen.
3. `SetupRunner` executes: fetch base ref, `git worktree add -b <branch> <path> <baseRef>`, copy listed files from the main repo working tree, write `.miac/task.md` and the exclude entry, run each selected setup command in the worktree, then start the selected terminals.
4. Step state and log lines stream to the renderer. Setup continues if the user navigates away.
5. On success the task becomes `ready` and the app opens the workspace for it.

`.miac/task.md` contains the work item id, type and title (or the task name), the branch and the worktree path. Claude Code is started as `claude "<first prompt>"` where the prompt is "Work item <id>: <title>. Details are in .miac/task.md." For blank tasks it is "Task: <name>. Details are in .miac/task.md."

### Workspace

- Left nav: tasks grouped by repo, each row shows id, title, a status dot, git summary and a cost placeholder. Done tasks sit in a collapsed group.
- Header: work item badge or task name, branch, ahead/behind, changed-file count, worktree path, Open in VS Code (`code <worktreePath>`), Finish task. The AI cost tile renders with a placeholder until sub-project 3.
- Terminal tabs: one xterm instance per pty. New terminal opens the default shell. Run buttons come from `run:` in `.miac.yml` and open a new tab running that command. Tab dot colour reflects running/exited.
- Git summary refreshes on an interval and when a terminal tab emits a newline containing `git ` (cheap heuristic, acceptable for this slice).

### Finish task

1. The dialog runs the safety checks: uncommitted changes (list of files), unpushed commits (count), running terminals. Commit and Push buttons run `git commit` and `git push` in a shell tab, so the user keeps control.
2. The AI usage block is hidden in this slice.
3. Cleanup checkboxes: close terminals, remove worktree, delete local branch.
4. Confirm sets `finishing`, kills terminals, runs `git worktree remove --force` when selected, `git branch -D` when selected, then marks the task `done` with `finishedAt`. Keep task returns to the workspace.

### Settings

Only the Repositories section works in this slice: add a folder (native dialog), see whether `.miac.yml` was found, view the effective config, remove a repo. The Azure DevOps, AI cost and Terminals sections render as disabled placeholders so the layout matches the mockup.

## Error handling

- A failing setup step stops the run, marks the task `setup-failed`, keeps the worktree, and offers Retry (from the failed step) or Cancel and remove (worktree and branch).
- Git errors show stderr in the setup log or in a toast. No silent failures.
- When a pty exits, the tab shows the exit code and a Restart button.
- On launch, tasks whose worktree folder is missing are flagged in the list, not deleted.
- State file writes are atomic.
- A repo whose path no longer exists is shown with a warning and its tasks are read-only.

## Testing

- Vitest unit tests for every core service. `GitClient` and `SetupRunner` run against temporary real git repos created in the test; git itself is not mocked.
- `TerminalManager` gets a smoke test that spawns `sh -c "echo hi"` and asserts on data and exit.
- IPC handlers are tested by calling them directly with a fake service bundle.
- Renderer: Testing Library tests for the New task form (branch prefill, validation) and the Finish dialog (checks and cleanup options). No end-to-end suite in this slice.

## Out of scope for this slice

Azure DevOps, usage capture, pricing, invoicing, notifications, the search box, the `miac` CLI, packaging, Windows implementation of `Platform`.
