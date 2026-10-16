# Tasks across repos (issue #48)

Date: 2026-10-16. Brainstorm: `2026-10-16-multi-repo-tasks-brainstorm.md`. Owner decisions (approach B and every suggested default):
1. **Approach B:** one task folder that holds one git worktree per repo; Claude runs in the task folder.
2. **Start picker:** Start uses the last repo used for that project and says so on the button ("Start in api"); a dropdown next to it changes the repo.
3. **Task folders** live in a setting "Tasks folder", default `~/miac/tasks` (`%USERPROFILE%\miac\tasks` on Windows). Folder names stay short for Windows path length.
4. **Single-repo tasks use a task folder too**, so there is one model. A generated `CLAUDE.md` imports the repo's own instructions.
5. **Repos from another Azure DevOps connection** cannot be added. A repo with no connection can (it gets no PR).
6. **Removing a repo with work** (commits or uncommitted changes) is allowed after a confirm that names the counts. The branch is kept unless "Delete branch" is ticked.
7. **A running Claude learns about an added or removed repo** through a one-line note typed into its prompt without Enter.
8. **Same branch name in every repo**, from the first repo's `.miac.yml` template.
9. **No repo groups** for now.
10. **Old tasks stay single-repo** and keep working: Resume, Reopen, Finish and the Done page.

Built in three steps, each one shippable alone:
1. Choose the repo on Start, remembering the last one per project.
2. The task folder, with Add repo, Remove repo and Move (add one, remove another).
3. Finish, Reopen and Done per repo: one draft PR per repo that has commits, all linked to the same work item, and the cost shown once.

## Step 1: choose the repo on Start

**Sprint page.** For a connection with one linked repo, Start is unchanged. With more than one:
- The Start button reads **"Start in <repo>"**, where the repo is the last one used to start a task for this connection, else the first linked repo.
- A chevron button next to it (`aria-label` "Choose the repo for <work item>") opens a menu of the connection's repos. Picking one starts the task in that repo straight away and remembers it.
- The remembered repo is per connection, in renderer `localStorage` (`miac.ui.startRepo.<connectionId>`), like the PR choice. A remembered repo that is gone or no longer linked falls back to the first linked repo.

**New task.** The repo select defaults to the remembered repo of the work item's connection when the page is opened from the Sprint page without a repo; creating a task from New task remembers its repo for its connection.

## Step 2: the task folder

### Layout

```
<Tasks folder>/<id>-<short slug>/       the task folder (Task.folder)
  CLAUDE.md                             written by MIAC
  .miac/task.md                         written by MIAC
  <repo dir>/                           one git worktree per repo, all on the same branch
```

- Folder name: `<work item id>-<slug of the title, at most 20 characters>`, or the slug of a blank task's name. Repo dir: the repo name as a slug, at most 20 characters, made unique in the task with `-2`, `-3`.
- An existing folder at that path fails the create, as today.
- `Tasks folder` is the setting `tasksFolder` (null = the default). Settings, Appearance, gets a "Tasks folder" field with Browse.

### Model

`Task` keeps every field it has. New fields:
- `folder: string | null`. Null for tasks from before this change: their worktree is their folder.
- `worktrees: TaskWorktree[]`, empty for old tasks. Each entry: `repoId`, `dir`, `path`, `branch`, `baseRef`, `baseSha`, `status` (`setting-up`, `ready`, `setup-failed`), `copy`, `commands`, `summary`, `pullRequest`, `reopen`.

For a folder task the top-level fields mean:
- `repoId`: the home repo (the first, or the first one left after a removal). It decides the task's connection, nav group and Sprint row, as today.
- `worktreePath`: the task folder (the cwd of Claude, Copilot and OpenCode; the Docs root; Open in VS Code).
- `branch`, `baseRef`: the home repo's. `baseSha`, `summary` and `pullRequest` stay null (they live per worktree).

One shared helper, `worktreesOf(task)`, returns the worktrees of any task. For an old task it builds the single entry from the top-level fields, so per-repo code (checks, Finish, Reopen, Done) is written once.

`TerminalDef` gets an optional `repoId`: the tab runs in that repo's worktree. Without it, it runs in the task folder.

### Create and setup

`tasks:create` makes a folder task with one worktree. The setup plan holds a list of repos, and the steps are:

| Step | Per | Detail |
|---|---|---|
| Fetch base | repo | `<dir>: origin/main` |
| Create branch and worktree | repo | `<dir>: <branch>` |
| Update work item | task | as today |
| Copy local files | repo | from the repo into its worktree |
| Write task files | task | `CLAUDE.md, .miac/task.md` in the task folder |
| Setup commands | repo | run in that repo's worktree, detail `in <dir>` |
| Start terminals | task | Claude and Copilot in the folder, the shell in the home repo |

Old tasks keep the old steps (task file in `.miac/` of the worktree, excluded in git). Folder tasks need no `.git/info/exclude` entry.

**`CLAUDE.md`** (rewritten after every repo change):
```
# MIAC task: Task 5: Store the address

This folder is a MIAC task. Each folder below is a git worktree of one repo, all on branch `feature/5-store-the-address`:

- `api/`: repo api, from `origin/main`
- `web/`: repo web, from `origin/main`

Make each change in the repo it belongs to, and run git inside that repo's folder. Task notes: .miac/task.md.

@api/CLAUDE.md
```
The `@` imports list only the repos that have a `CLAUDE.md`.

**Claude context** (`--append-system-prompt`) for a folder task names the repos, their folders and the branch, says the details are in `CLAUDE.md` and `.miac/task.md`, and keeps "wait for the user's instructions".

### Add repo

A **Repos** button in the task row (folder tasks only) opens the task's **Repos page**, a full page:
- the task's repos: dir, branch, base, status, ahead and uncommitted counts, and **Remove**;
- **Add a repo**: repo (the repos not in the task whose connection is the task's, or none), base (`origin/<base>` or `<base>`), copy and setup commands from that repo's `.miac.yml`, and **Replace** (none, or one of the task's repos). **Add repo** starts it.

`tasks:addRepo(taskId, { repoId, baseRef, copy, commands, replaces })`:
- refuses old tasks, a repo already in the task, a repo of another connection, an existing branch in that repo, and a second change while one repo is still setting up;
- adds the entry as `setting-up` and runs that repo's steps (fetch, worktree, copy, task files, commands) in the background; the task stays `ready` and its terminals keep running;
- the Setup page shows it (`{ kind: 'setup', taskId, repoId }`), with Retry from the failed step and **Remove repo** (instead of Cancel);
- on success: types the note into every running Claude tab, and when `replaces` is set removes that repo (as Remove without force; when it has work, the note says it was kept).

### Remove repo

`tasks:removeRepo(taskId, repoId, { force, deleteBranch })`:
- refuses the last repo (Finish the task instead) and old tasks;
- without `force`, refuses a repo with commits or uncommitted changes with `REPO_HAS_WORK: <n> commits, <m> uncommitted changes`; the Repos page then asks "Remove <dir> with <counts>? The work is lost unless the branch is kept." with **Remove anyway**;
- closes the tabs bound to that repo, stops the Docs watcher (Windows cannot delete a watched folder), removes the worktree (forced when `force`), prunes, deletes the branch when asked;
- drops the entry, makes the next repo the home repo when the home repo went, rewrites the task files and types the note into the Claude tabs.

**Move** is Add with Replace.

**Note** typed into Claude (no Enter): `MIAC: repo web was added to this task in ./web (branch feature/x). CLAUDE.md lists the task's repos.` or `MIAC: repo api was removed from this task. CLAUDE.md lists the task's repos.`

### Terminals, Docs, header

- The + menu shows "Shell in <dir>" per repo for a folder task with more than one repo; the Run chips come from every repo's `.miac.yml`, named `<dir>: <name>` when there is more than one repo. Tab labels show `· <dir>` for repo-bound tabs when the task has more than one repo.
- Docs lists the task folder: `.miac/task.md`, `CLAUDE.md`, then each repo's Markdown under `<dir>/`, with new/modified badges against that repo's `baseSha`. Terminal links resolve against the tab's cwd (`docs:resolve` takes the terminal id).
- The taskbar's git line adds up all repos; the task details card in the header lists each repo's ahead and changed counts and shows the task folder.

## Step 3: Finish, Reopen and Done per repo

### Finish

`tasks:finishChecks` adds `repos`: per repo `repoId`, `dir`, `branch`, `uncommitted`, `unpushed`, `commits` (since its base). `tasks:prAvailability` adds `repos` with availability and target per repo. The top-level fields stay (the totals and the home repo) for old callers.

The Finish page shows one block of safety checks per repo (headed by the dir when there is more than one) and, under Clean up, one **"Create a draft pull request for <dir> into <target>"** per repo. It is ticked when the repo has commits and the last Finish of that repo asked for a PR; repos without commits cannot get one.

`FinishOptions.pullRequestRepos: string[]` names the repos to make a PR for (`createPullRequest: true` alone still means the home repo, for old tasks). Finish:
1. records a summary per worktree;
2. for each repo in `pullRequestRepos`, home repo first: push, create the draft PR (or link the active one) linked to the work item, store it on that worktree at once, then open every PR in the browser at the end. A failure stops before cleanup with `Pull request not created: <dir>: <reason>`; PRs already made stay, and Retry goes on with the rest (an active PR for the branch is linked, not made twice);
3. cleans up: terminals, every worktree, every branch, then MIAC's own files in the task folder (`CLAUDE.md`, `.miac/`) and the folder itself when it is empty. Nothing else in the folder is deleted.

PR description per repo: that repo's commits, a line "Part of a change across <n> repos: api (`branch`), web (`branch`)" when there are several, and the cost line in the home repo's PR only (when writing cost to Azure DevOps is on).

### Reopen

- The folder and every worktree still there: back to ready with its tabs, as today.
- Otherwise each missing worktree is restored with today's rules (local branch, else `origin/<branch>`, else the last commit of its summary, else its base when it had no commits); a repo that cannot be restored fails the reopen with its name. The setup restores every worktree, rewrites the task files, and restores the tabs; Claude resumes in the task folder.
- Cancel of a failed reopen removes the worktrees it made and puts the task back to Done.

### Done page

One **Repos** section with a block per repo: dir, branch and push state, PR with its live status, changes and commits. Duration, AI cost, write-back and the live work item state show once. Old tasks look as today. `tasks:prStatus(taskId, repoId?)` refreshes one repo's PR.

## Unchanged

- Cost: one task id, one OTLP tag, one Copilot file, one set of `Custom.AI*` values, one usage comment.
- Work item on start: moved and assigned once, at the first repo's setup.
- Old tasks: their layout, setup steps, Resume, Reopen, Finish and Done page.

## Telemetry

New events, no names or paths: `task.repoAdded { replaces, ok }`, `task.repoRemoved { forced, deleteBranch }`, `task.startRepoChosen { repos }`. `task.finished` gains `repos`, `pr.created`/`pr.linked` are sent per PR. `docs/telemetry.md` lists them.

## Decisions made during build

- PR descriptions name the other repos and branches instead of linking the other PRs: the work item already links every PR, and this needs no second write to Azure DevOps.
- The cost line goes only into the home repo's PR, so the amount is never counted twice.
- One repo change at a time per task; Finish waits while a repo is setting up.
- The last repo of a task cannot be removed.
- New task still creates a task with one repo; more come through Add repo.
- Add and Remove live on one full Repos page (no dialogs, #15).
- The header's git line adds up all repos; the per-repo view is on the details card and the Repos page.
- `.miac/task.md` is written once and never rewritten (it holds the user's notes); only `CLAUDE.md` follows repo changes.
- "Work" in a repo counts commits since its base and every uncommitted file, untracked ones too. A copied `.env` or build output that the repo does not ignore therefore counts, and a Move then keeps the old repo and says why.
- A repo whose own setup failed can be removed without the work confirm.
- Each typed note ends with a space, so two notes the user has not sent yet do not run together.
- With a single repo, the + menu says "Shell", and the shell still opens in that repo's worktree.
- Every PR made by one Finish opens in the browser, also when a later one fails.
