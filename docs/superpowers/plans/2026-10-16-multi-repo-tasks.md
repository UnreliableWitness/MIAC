# Tasks across repos: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task can hold worktrees of several repos in one task folder, so a wrong repo can be swapped and a change across repos is one task, one Claude conversation and one cost.

**Architecture:**
- `Task` keeps its fields and gains `folder` and `worktrees[]`; `worktreesOf(task)` (shared) gives one list for old and new tasks, `patchWorktree` writes back to the right place.
- `SetupRunner` takes a plan with a list of repos and task files; the same runner makes a whole task, adds one repo, or restores a reopened task.
- Main handlers gain `tasks:addRepo`, `tasks:removeRepo`; Finish, Reopen, checks, PR status and Docs loop over `worktreesOf`.
- The renderer gets a Repos page, a Start split button, and per-repo blocks on Finish and Done.

**Tech Stack:** Electron, React 19, zustand, zod, Vitest with Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-16-multi-repo-tasks-design.md`

## Global Constraints

- Old tasks (`folder === null`) keep their behaviour exactly; every existing test keeps passing unchanged in meaning.
- All paths are built with `node:path`; no shell strings. Task folder names at most `<id>-` + 20 slug characters, repo dirs at most 20.
- Errors: `REPO_HAS_WORK: <n> commits, <m> uncommitted changes`, `Pull request not created: <dir>: <reason>` (the Finish page keys on `Pull request not created: `).
- Typed notes into Claude never contain a newline.
- Telemetry carries no names or paths. Update `docs/telemetry.md`.
- Checks after each step: `npm test`, `npm run typecheck`, `npm run lint` (format with `npx oxfmt`).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Old tasks.** A stored task without `folder`/`worktrees` loads, resumes, finishes and reopens as before (TaskStore and handler tests with a legacy fixture).
2. **Claude's cwd never changes** for a folder task: Add and Remove do not touch the Claude tab; Reopen resumes in the same folder.
3. **Remove with work** never deletes anything without `force` (handler test).
4. **Finish with a failing second PR** keeps the first PR, leaves the task ready with its worktrees, and Retry links the first instead of making it again.
5. **Windows:** the Docs watcher stops before a worktree is removed; terminals in a removed repo are killed first.

---

## File map

| File | Responsibility |
|---|---|
| `src/renderer/uiPrefs.ts` | `readStartRepo`, `writeStartRepo` |
| `src/renderer/startTask.ts`, `screens/SprintScreen.tsx`, `screens/NewTaskScreen.tsx` | Start split button, remembered repo |
| `src/shared/types.ts` | `TaskWorktree`, `Task.folder`, `Task.worktrees`, `TerminalDef.repoId`, checks and options |
| `src/shared/tasks.ts` (new) | `worktreesOf`, `patchWorktree`, `isFolderTask`, `repoDir`, `folderName` |
| `src/shared/naming.ts` | `claudeContext` and `renderTaskMd` for folder tasks, `renderClaudeMd` |
| `src/shared/usage.ts` | `tasksFolder` setting |
| `src/main/paths.ts` | `defaultTasksFolder` |
| `src/main/services/SetupRunner.ts` | multi-repo plan and steps |
| `src/main/services/GitClient.ts` | `commitsSince` |
| `src/main/services/azureRepos.ts` | `prDescription` with `related` |
| `src/main/ipc/handlers.ts` | create, addRepo, removeRepo, terminals cwd, finish, reopen, checks, PR |
| `src/main/docs/*` | task folder listing, resolve against a terminal's cwd |
| `src/shared/ipc.ts` | new channels |
| `src/renderer/screens/ReposScreen.tsx` (new) | the Repos page |
| `src/renderer/screens/SetupScreen.tsx` | repo-scoped setup |
| `src/renderer/components/TerminalTabs.tsx`, `NewTerminalMenu.tsx`, `HeaderBar.tsx` | Repos button, per-repo shells and runs, git per repo |
| `src/renderer/screens/FinishScreen.tsx`, `DoneTaskPage.tsx` | per-repo blocks |
| `src/renderer/screens/SettingsScreen.tsx` | Tasks folder |
| `docs/telemetry.md`, `CLAUDE.md` | docs |

---

## Step 1: choose the repo on Start

### Task 1.1: remembered start repo
- [ ] Test `readStartRepo`/`writeStartRepo` in `uiPrefs.test.tsx` (per connection key, best effort).
- [ ] Implement in `uiPrefs.ts`.

### Task 1.2: Start split button
- [ ] Tests in `SprintScreen.test.tsx`: one linked repo keeps "Start"; two repos show "Start in <last>", the chevron menu lists both, picking one creates the task in it and remembers it; a remembered repo that is unlinked falls back to the first.
- [ ] Implement in `SprintScreen.tsx` (menu like `NewTerminalMenu`), call `writeStartRepo` on start; telemetry `task.startRepoChosen`.
- [ ] New task: default repo from the remembered one; remember on create (`NewTaskScreen.test.tsx`).
- [ ] Checks, commit "feat: choose the repo on Start, remembering the last one per project".

## Step 2: task folder, Add repo, Remove repo

### Task 2.1: model and helpers
- [ ] Tests: legacy task parses with `folder: null`, `worktrees: []`; `worktreesOf` builds one entry for a legacy task; `patchWorktree` writes top-level fields for legacy and the entry for folder tasks; `folderName` and `repoDir` are short and unique.
- [ ] Implement `types.ts`, `shared/tasks.ts`.

### Task 2.2: naming
- [ ] Tests: `claudeContext` and `renderTaskMd` unchanged for legacy; folder versions list repos; `renderClaudeMd` imports only listed repos.

### Task 2.3: SetupRunner with repos
- [ ] Rework tests to the new plan shape; legacy plan yields today's steps and labels; a two-repo plan yields per-repo steps with dir details; task files are written into the folder without an exclude entry; commands run in each worktree.

### Task 2.4: create a folder task
- [ ] Handler tests: create makes `folder` under the tasks folder, one worktree entry, Claude in folder, shell bound to the repo; the plan writes `CLAUDE.md`; cancel removes worktrees, branches and MIAC files.
- [ ] Settings: `tasksFolder` (null default), `defaultTasksFolder`.

### Task 2.5: addRepo and removeRepo
- [ ] Handler tests: add refuses legacy, duplicate, other connection, busy; runs repo steps; marks ready; types the note; `replaces` removes the old one. Remove refuses last, refuses work without force with `REPO_HAS_WORK`, kills bound terminals, stops docs watcher before removal, promotes home repo, deletes branch only when asked.
- [ ] Retry and removal of a failed added repo.

### Task 2.6: terminals, docs, header
- [ ] Terminal cwd by `repoId`; `terminals:open` validates it.
- [ ] Docs: list across repos, resolve against terminal cwd.
- [ ] `tasks:gitSummary` adds per-repo entries.

### Task 2.7: renderer
- [ ] Repos page (tests: list, add with replace, remove with confirm), Repos button, SetupScreen with `repoId`, + menu shells per repo, run chips per repo, tab suffix, details card, Settings field.
- [ ] Checks, launch the app with a throwaway user-data folder and assert Add and Remove; commit "feat: task folders with Add repo, Remove repo and Move".

## Step 3: Finish, Reopen and Done per repo

### Task 3.1: checks and availability per repo
- [ ] `commitsSince` in GitClient; `finishChecks.repos`, `prAvailability.repos`.

### Task 3.2: Finish per repo
- [ ] Handler tests: two repos, PR for the one with commits; failure on the second keeps the first; retry links; cost line only in home PR; related line; cleanup removes all worktrees and MIAC files, keeps foreign files.

### Task 3.3: Reopen per repo
- [ ] Handler tests: folder intact goes ready; missing worktrees restored per repo; unrecoverable names the repo; cancel goes back to Done.

### Task 3.4: Finish and Done pages
- [ ] FinishScreen per-repo checks and PR boxes; DoneTaskPage repo blocks with live PR status; legacy pages unchanged.
- [ ] Telemetry doc, CLAUDE.md status line, checks, commit "feat: finish, reopen and done per repo with one draft PR per repo".
