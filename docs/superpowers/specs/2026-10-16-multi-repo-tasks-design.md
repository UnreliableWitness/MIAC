# Tasks that span several repos (issue #48)

## Why

A task starts in one repo: Start on the Sprint page takes the first repo linked to the work item's connection (`SprintScreen.tsx:271`), and New task has a single repo dropdown. Often that guess is wrong, or the work turns out to need two or three repos. You only learn this while investigating, inside the task's Claude Code session, and you keep working in that session because it holds the context. Claude then creates a worktree in the other repo itself.

MIAC does not notice any of this. At Finish it pushes and opens a draft PR for the original repo only (in the case that prompted the issue: the wrong project) and leaves the other worktrees behind.

The repos cannot be chosen up front. MIAC has to find out during the session which repos the task really touched, and treat each of them as part of the task.

## Goals

- MIAC discovers, while the task runs, every repo where the task's work happened, including repos not registered in MIAC.
- Each discovered worktree becomes part of the task: visible in the task, usable for new terminals and the Docs tab, and handled by Finish, the Done page and Reopen.
- Finish offers a draft PR per repo that has changes, all linked to the same work item, and offers to drop a worktree with no changes (typically the wrong first guess) without pushing it.
- Claude is told how to create worktrees in other repos so detection is reliable.

## Non-goals

- Choosing several repos at task creation. (Choosing a better *first* repo at Start is a separate improvement, not part of this.)
- Moving the Claude session to another folder. Claude tabs keep the cwd they started with.
- Running another repo's `.miac.yml` setup commands when Claude creates a worktree there mid-session (Claude or the user can run them). Reopen does run them, see below.
- Splitting cost per repo. Cost stays per task, as now (usage is keyed by task id, `telemetryEnv.ts`).

## Anti-goals (a failure even if it works)

- Attaching a repo that Claude only *read* (searching another codebase for reference is common). Only writes count.
- Pushing or opening a PR for a repo with no changes.
- Cleanup removing a worktree that holds uncommitted or unpushed work without the same warning Finish gives today for the home worktree.
- Silent attach the user cannot undo: a wrongly detected worktree must be removable from the task.

## Terms

- **Home workspace**: the worktree MIAC created at task start (today's `repoId`, `branch`, `worktreePath`, `baseRef`, `baseSha`). It stays the task's home: Claude tabs' cwd, the default for new terminals and Docs.
- **Workspace**: one repo + branch + worktree belonging to the task. The home workspace is one; detected or manually added ones are the others.

## Steering Claude

`claudeContext(task)` (`handlers.ts:379`) and `.miac/task.md` (`renderTaskMd`, `naming.ts`) get one more instruction:

> If this task needs changes in another repository, do not edit that repository's main checkout. Create a worktree there on this task's branch: `git -C <repo> worktree add <repo>.worktrees/<slug> -b <branch> <base>` (use the repo's default branch as base, from `origin` when it exists). MIAC picks it up automatically.

The path follows MIAC's own layout (`worktreeRoot`, `paths.ts`). The same branch name everywhere is what the branch scan matches on.

## Detection

Two sources, merged. Both only *propose* workspaces; the rules in "Joining" decide.

### 1. Claude session logs

Every Claude tab of the task has a `sessionId`; its log is `~/.claude/projects/<folder>/<sessionId>.jsonl` (`claudeSessions.ts`). Read the task's logs incrementally (remember the byte offset per file) and collect paths from `tool_use` blocks:

- **Writes:** `file_path` of `Edit`, `Write`, `MultiEdit`, `NotebookEdit`.
- **Bash:** `git worktree add <path>` (also with `-C <repo>`), and `git -C <path>` with a writing subcommand (`commit`, `checkout`, `switch`, `add`, `apply`, `stash`, `merge`, `rebase`, `cherry-pick`).

Plain reads (`Read`, `Grep`, `Glob`, read-only Bash) are ignored. Paths are resolved against the tab's cwd. Paths inside the home worktree are ignored.

For every remaining path: find its git top level and its main repo (`git rev-parse --show-toplevel` and `--git-common-dir`). Result: (main repo path, worktree path, branch).

Tabs from before session ids (`--continue`) have no known log: they are skipped. Copilot and OpenCode tabs have no readable log in this design.

### 2. Branch scan

For each registered repo, and each git repo that is a direct sibling folder of a registered repo (one level, folders containing `.git`): `git worktree list --porcelain`, keep worktrees whose branch is the task's branch. This catches work done in shell tabs and in Claude tabs without a session log.

### When

- When a task's page is shown.
- Every 2 minutes while a task is `ready` and the window is focused.
- At the start of Finish (Finish always rescans before showing its list).
- From a "Scan for other repos" command in the task's menu.

Scans run in main, never block the UI, and are cheap when nothing changed (log offsets, and `git worktree list` per repo).

## Joining

A proposed (repo, worktree, branch) joins the task as a workspace when:

- it is not the home workspace and not already a workspace of this task;
- it is not a workspace of another open task;
- the user has not removed it from this task before (kept as `detachedPaths` on the task);
- it is a **worktree**, not the repo's main checkout.

**Main checkout edited directly** (Claude ignored the instruction): do not join. The task shows a warning "Changes made in <repo>'s main checkout (branch <x>)", and Finish lists it as information only, no push, PR or cleanup. MIAC does not touch the main checkout.

On join:

- **Unknown repo:** register it as a Repo (same as adding it in Settings), marked `discovered: true` (new optional `RepoSchema` field, default false). Discovered repos show in Settings (with a "Found in a task" note), in New task and in the scan set, but Start on the Sprint page never picks one on its own: its auto-pick of the first repo linked to the connection skips discovered repos. Clearing the mark in Settings makes it a normal repo. Match a connection from its `origin` URL: an Azure Repos URL (`dev.azure.com/<org>/…`, `<org>.visualstudio.com/…`) whose organization equals a connection's organization. No match: `connectionId` null, so no PR (push only). Base branch: `origin/HEAD`, else `main`, else `master`.
- **Base:** `baseRef` is the repo's base branch (`origin/<base>` when `origin` exists); `baseSha` is the merge base of the worktree's HEAD with that ref.
- **Notice:** a quiet notice in the notice corner: "Added <repo> to this task" with an Undo (= remove from task).

The user can also add one by hand: "Add a worktree…" (task menu and Finish) picks a folder, which must be a worktree of some repo. Same rules, except the main-checkout rule shows an error instead.

**Remove from task** (task strip chip menu, Finish): drops the workspace from the task, records its path in `detachedPaths`, leaves the worktree and branch on disk untouched. The home workspace cannot be removed while the task is open (only dropped at Finish, below).

## Data

`Task` gets:

```ts
extraWorkspaces: Workspace[]   // default []
detachedPaths: string[]        // default []
```

```ts
Workspace = {
  id: string,
  repoId: string,
  branch: string,
  worktreePath: string,
  baseRef: string,
  baseSha: string | null,
  source: 'detected' | 'manual',
  summary: TaskSummary | null,         // set at Finish
  pullRequest: PullRequestRef | null,  // set at Finish
  reopen: { from: string | null } | null,
  dropped: boolean,                    // removed at Finish without a PR because it had no changes
}
```

The home workspace keeps today's flat fields, so existing `tasks.json` files load unchanged through zod defaults and the state stays `version: 1`. A helper `taskWorkspaces(task)` returns `[home, ...extraWorkspaces]` in one shape; handlers that loop over repos use it. The home also gets an optional `homeDropped: boolean` (default false) for the Finish case below.

**Task-level connection** (design call): `Task` gets `connectionId: string | null`, set from the home repo at creation and filled from the home repo on load for older tasks. Every work item operation (start update, usage sync and comment, Done page live state, PR work item link) uses it instead of `repos.get(task.repoId).connectionId`, so dropping or changing the home never moves the work item. A workspace whose repo's connection is a different Azure DevOps organization than the task's still gets its PR, but without a work item link (links do not cross organizations); the PR description carries the work item's URL instead, and Finish says so on that row.

**Home stays put** (design call): the flat fields always describe the original home, also after it is dropped (`homeDropped: true`). The *active* home (Claude tab cwd, Docs default, left-nav grouping, `worktreeMissing`) is computed: the original home unless dropped, else the first non-dropped workspace. Reopen does not rewrite the flat fields.

## Task page while running

- **Task strip:** one chip per workspace (repo name, ahead/behind/changes from `useGitSummary` per worktree). The home chip comes first. A chip's menu: Open in terminal (new shell there), Open folder, Remove from task (not on home).
- **Header breadcrumb hover:** lists every workspace's repo and branch.
- **New terminal menu (`NewTerminalMenu`):** with more than one workspace, each type asks which workspace to start in. `TerminalDef` gets optional `workspaceId`; `spawnTerminal` uses that workspace's worktree as cwd (home when absent). Run chips (`useRepoConfig`) show each workspace's `.miac.yml` `run` entries, grouped by repo.
- **Docs tab:** with more than one workspace, a repo switcher at the top of the file list; one watcher per workspace; new/modified marks against each workspace's `baseSha`. Terminal `path:line` links resolve against the terminal's cwd workspace first, then the others.
- **Left nav:** a task stays grouped under its home repo; it shows a small "+N repos" mark.
- **Claude tabs** (design call): Claude tabs start and resume with `--add-dir <worktree>` for every other workspace of the task, so Claude can edit them without a permission prompt for each file. Workspaces that join mid-session apply from the next start or resume; the running session already reached them, since Claude created them.

## Finish

Finish rescans first, then shows one row per workspace (home first):

- repo, branch, commits ahead of base, uncommitted changes (today's `finishChecks`, per worktree);
- **No changes** (no commits on the branch beyond `baseSha` and a clean worktree): default action "Remove worktree and branch, no PR". This is the wrong-first-repo case, including the home workspace.
- **Changes:** checkbox "Create a draft pull request into <base>" when the repo has an Azure DevOps connection and an Azure Repos `origin` (today's `prAvailability`), else "Push the branch" checkbox. Defaults per repo as today (`miac.ui.pr.<repoId>`).
- Uncommitted-changes warnings per row, as today for the single worktree.
- "Add a worktree…" and per-row "Remove from task".

On Finish, per workspace in order (home first): summary (`finishSummary`), push, PR (find active or create, linked to the task's work item; description with that repo's commits and the **task's** total AI cost line when `writeCostToAdo` is on, marked as the whole task's cost across N repos). PRs open in the browser as today.

**Partial failure:** each workspace keeps its own result. If any push or PR fails, Finish stops before cleanup and shows each row's state; Retry retries only failed rows; "Finish without PR" applies to the failed rows only. Cleanup (remove worktree, prune, delete branch) runs for every workspace once all rows succeeded or were skipped. Dropped workspaces are cleaned up without push.

The work item is updated once per task, as today (Finish does not change its state). The usage comment (`renderUsageComment`) names every branch that was pushed.

## Done page

One section per workspace: repo, branch, pushed, commits, diff stat, PR with live status. Dropped workspaces appear as one line "<repo>: no changes, removed". Duration and cost stay task-level.

## Reopen

Reopen restores every workspace that was not dropped, each with today's logic (`reopen.from` per workspace: local branch, `origin/<branch>`, last commit of its summary, else its base). Each restored workspace runs its repo's `.miac.yml` copies and setup commands through the setup pipeline, as the home does today. If the home was dropped, the first restored workspace becomes the home for terminals and Docs (Claude tabs resume with their original cwd only when that folder exists again; otherwise they start in the new home and continue with `--resume <id>`, which does not depend on cwd).

Setup pipeline: the steps run per workspace (worktree, copy, task file, commands) with the work-item step once. Step state and retry gain a workspace index.

## Telemetry

New events: workspace joined (source: session log, branch scan, manual), workspace removed, finish with N workspaces / N PRs / N dropped. No paths or repo names (main already scrubs them). Update `docs/telemetry.md`.

## Left to the builder

- Exact parsing of Bash commands in session logs (a simple tokenizer is fine; missing an odd form is acceptable since the branch scan backs it up).
- How the incremental log offsets are stored (memory is fine; a full rescan after relaunch is acceptable).
- UI details of chips, the Finish rows and the Docs repo switcher, within the ADO look of the existing screens.
- Whether `taskWorkspaces` callers are migrated all at once or screen by screen, as long as each merged step keeps single-repo tasks working unchanged.

## Testing

- Unit: session log path extraction (writes vs reads, `git worktree add`, `-C`), join rules (main checkout, other task, detached, home), connection matching from `origin` URLs, base resolution, Finish per-row decisions and partial-failure retry, Reopen per workspace, zod load of old `tasks.json`.
- Functional check on the real app (macOS): start a task in repo A, have Claude create a worktree in repo B and commit there, confirm B joins with a notice, Finish with A having no changes: A is dropped without push, B gets a draft PR linked to the work item in the test org, Done shows both, Reopen restores B.
