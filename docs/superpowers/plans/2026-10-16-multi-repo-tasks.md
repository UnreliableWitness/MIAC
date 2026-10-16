# Multi-repo tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task discovers, during its session, every repo where its work happened (Claude session logs and a branch scan), treats each as a workspace, and Finish, Done and Reopen handle every workspace.

**Architecture:** The home workspace keeps today's flat `Task` fields; other workspaces live in `Task.extraWorkspaces`. A shared helper (`src/shared/workspaces.ts`) gives every caller one shape for all workspaces. Detection lives in `src/main/workspaces/` (pure session-log parser, git-based resolver and branch scan, a detector service that applies the join rules and persists). Handlers loop over workspaces where they used one repo.

**Tech Stack:** Electron, React, TypeScript, zod, Vitest, git CLI via `GitClient`.

**Spec:** `docs/superpowers/specs/2026-10-16-multi-repo-tasks-design.md`

## Global Constraints

- Existing `tasks.json` / state files load unchanged; `StateSchema.version` stays `1`. Every new field has a zod default.
- Single-repo tasks behave exactly as today after every task (all existing tests keep passing).
- Only writes count for detection: `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `git worktree add`, and writing git subcommands (`commit`, `checkout`, `switch`, `add`, `apply`, `stash`, `merge`, `rebase`, `cherry-pick`).
- A repo's main checkout never joins a task; MIAC never pushes, cleans or changes a main checkout.
- Branch scan: registered repos plus git repos that are direct sibling folders of a registered repo (one level).
- Scan times: when the task page is shown, every 2 minutes while the task is `ready` and the window is focused, at the start of Finish, and on "Scan for other repos".
- Discovered repos: `Repo.discovered = true`; Sprint page Start never auto-picks one.
- Every PR links the task's work item, except when the workspace's org differs from the task's connection org: then no link and the work item URL goes in the description.
- With more than one workspace, the PR cost line is the task's total and says so.
- All shell/path logic stays platform-neutral (`path`, `samePath`, `nativePath`; no hard-coded `/`).
- Telemetry: no paths or repo names in events; update `docs/telemetry.md` for new events.
- Checks: `npm test`, `npm run typecheck`, `npm run lint` pass after each task.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A Claude session that only *reads* another repo (Read/Grep, `git log`, `cat`) must not attach it. Test in Task 2.
2. A path Claude wrote in a folder that is not a git repo (e.g. `/tmp/notes.md`, the scratchpad) is ignored, not an error. Test in Task 3.
3. Retry after a partial PR failure must not create duplicate PRs and must not redo pushes of rows that already succeeded. Test in Task 7.
4. A worktree that was removed from disk by hand (detected earlier) must not break Finish or the task page: shown as missing, skipped at cleanup. Test in Task 7.
5. Two open tasks on the same branch name in different repos, or a worktree already owned by another open task, must not cross-attach. Test in Task 4.

---

### Task 1: Data model, workspace helpers, task-level connection

**Files:**
- Modify: `src/shared/types.ts` (TaskSchema, RepoSchema, TerminalDefSchema, new WorkspaceSchema)
- Create: `src/shared/workspaces.ts`, `src/shared/workspaces.test.ts`
- Modify: `src/main/ipc/handlers.ts` (`tasks:create`, `usageSync` target, `updateWorkItem` hook, `tasks:prStatus`)
- Modify: `src/renderer/screens/SprintScreen.tsx:271` (skip discovered repos)
- Modify: `src/renderer/store.ts` (`useTaskConnectionId` uses the task's connection first)
- Test: `src/main/services/TaskStore.test.ts`, `src/main/ipc/handlers.test.ts` (or the existing handlers test file), `src/renderer/screens/SprintScreen.test.tsx`

**Interfaces:**
- Produces (types.ts):
  ```ts
  WorkspaceSchema = z.object({
    id: z.string().min(1), repoId: z.string().min(1), branch: z.string().min(1),
    worktreePath: z.string().min(1), baseRef: z.string().min(1),
    baseSha: z.string().nullable().default(null),
    source: z.enum(['detected', 'manual']),
    summary: TaskSummarySchema.nullable().default(null),
    pullRequest: PullRequestRefSchema.nullable().default(null),
    reopen: z.object({ from: z.string().nullable() }).nullable().default(null),
    dropped: z.boolean().default(false),
  }); type Workspace
  TaskSchema += {
    extraWorkspaces: z.array(WorkspaceSchema).default([]),
    detachedPaths: z.array(z.string()).default([]),
    homeDropped: z.boolean().default(false),
    connectionId: z.string().nullable().default(null),
    /** Repos whose main checkout Claude edited directly; shown as a warning, never touched. */
    mainCheckoutEdits: z.array(z.object({ repoPath: z.string(), branch: z.string().nullable() })).default([]),
  }
  RepoSchema += { discovered: z.boolean().default(false) }
  TerminalDefSchema += { workspaceId: z.string().optional() }  // absent = active home
  ```
- Produces (`src/shared/workspaces.ts`):
  ```ts
  export const HOME_ID = 'home';
  export type WorkspaceView = Omit<Workspace, 'source'> & { source: 'home' | 'detected' | 'manual' };
  export function taskWorkspaces(task: Task): WorkspaceView[]   // [home (id 'home', dropped = homeDropped), ...extraWorkspaces]
  export function activeWorkspaces(task: Task): WorkspaceView[] // not dropped
  export function activeHome(task: Task): WorkspaceView        // home unless dropped, else first non-dropped extra, else home
  export function workspaceById(task: Task, id: string | undefined): WorkspaceView // undefined -> activeHome; unknown id throws
  export function taskConnectionId(task: Pick<Task,'connectionId'|'repoId'>, repos: Pick<Repo,'id'|'connectionId'>[]): string | null
  ```

- [ ] **Step 1: Write failing tests** in `src/shared/workspaces.test.ts`:
  - `taskWorkspaces` of a task with no extras returns one view with `id: 'home'`, `source: 'home'`, and the flat fields.
  - with one extra, returns `[home, extra]` in that order.
  - `activeHome` returns the first extra when `homeDropped` is true; `activeWorkspaces` excludes dropped.
  - `workspaceById(task, undefined)` is the active home; `workspaceById(task, 'nope')` throws `Unknown workspace nope`.
  - `taskConnectionId` returns `task.connectionId` when set, else the home repo's `connectionId`, else null.
  - In `TaskStore.test.ts`: a state file written with the current (pre-change) task shape loads, and the task has `extraWorkspaces: []`, `detachedPaths: []`, `homeDropped: false`, `connectionId: null`, `mainCheckoutEdits: []`; a repo loads with `discovered: false`.
- [ ] **Step 2: Run** `npx vitest run src/shared/workspaces.test.ts src/main/services/TaskStore.test.ts`. Expected: FAIL (module/fields missing).
- [ ] **Step 3: Implement** the schema fields and `src/shared/workspaces.ts`.
- [ ] **Step 4: Write failing handler tests:** `tasks:create` stores `connectionId` equal to the repo's connection; the usage sync target, the start `updateWorkItem` hook and `tasks:prStatus` use `taskConnectionId(task, repos)` (test: task with `connectionId: 'c2'` whose home repo links `c1` syncs to `c2`). SprintScreen test: with repos `[discovered linked to c1, normal linked to c1]`, Start uses the normal one; with only a discovered repo linked, Start behaves as with no linked repo.
- [ ] **Step 5: Implement** in handlers.ts (replace each `s.repos.get(task.repoId).connectionId` / `repos.list().find(...)?.connectionId` used for the *work item* with `taskConnectionId`), `store.ts`, and SprintScreen (`repos.find((r) => r.connectionId === connectionId && !r.discovered)`).
- [ ] **Step 6: Run** `npm test && npm run typecheck && npm run lint`. Expected: all pass.
- [ ] **Step 7: Commit** `feat: workspace model and task-level connection (#48)`.

---

### Task 2: Session log parser

**Files:**
- Create: `src/main/workspaces/sessionLog.ts`, `src/main/workspaces/sessionLog.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type WriteHit = { path: string; via: 'edit' | 'worktree-add' | 'git' };
  /** Parses Claude Code JSONL lines; only `type: 'assistant'` lines' `message.content[]` `tool_use` blocks count. Relative paths resolve against the line's `cwd`. Malformed lines are skipped. */
  export function writeHitsFromLines(lines: string[]): WriteHit[];
  /** Tokenises one Bash command (quotes, `&&`, `;`, `||`, `|`, `cd <dir>` tracked per segment chain) and returns write hits. */
  export function writeHitsFromBash(command: string, cwd: string): WriteHit[];
  /** Reads only what was appended since the last call per file (byte offsets in memory; a shrunk file restarts at 0; a trailing partial line is kept for the next call). */
  export class SessionLogReader {
    constructor(readChunk?: (file: string, from: number) => Promise<{ text: string; size: number } | null>);
    readNew(file: string): Promise<string[]>;
  }
  ```

- [ ] **Step 1: Write failing tests** (use inline JSONL fixtures shaped like `{"type":"assistant","cwd":"/w/home","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/b/x.ts"}}]}}`):
  - `Edit`, `Write`, `MultiEdit` `file_path` and `NotebookEdit` `notebook_path` → `via: 'edit'` hits; relative `file_path` resolves against `cwd`.
  - `Read`, `Grep`, `Glob` blocks → no hits; `type: 'user'` lines → no hits; a malformed line is skipped.
  - Bash `git -C /src/b worktree add /src/b.worktrees/42-x -b feature/42-x origin/main` → `{path: '/src/b.worktrees/42-x', via: 'worktree-add'}`.
  - Bash `cd /src/b.worktrees/42-x && git commit -m "a && b"` → `{path: '/src/b.worktrees/42-x', via: 'git'}` (quoted `&&` does not split).
  - Bash `git -C ../b checkout -b x` with cwd `/src/a` → path `/src/b`.
  - Bash `git -C /src/b log`, `cd /src/b && git status`, `cat /src/b/x` → no hits.
  - `SessionLogReader.readNew` returns all complete lines first, then only lines appended later, holds back a line without a trailing newline until it is complete, and restarts when the file shrinks.
  - Windows-style path: `file_path: 'C:\\src\\b\\x.ts'` with cwd `C:\\src\\a` — use `path.win32` only when the test runs on win32 (`it.runIf(process.platform === 'win32')`).
- [ ] **Step 2: Run** `npx vitest run src/main/workspaces/sessionLog.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** A small shell tokenizer (single/double quotes, backslash escapes outside single quotes, operators `&&`, `||`, `;`, `|`) is enough; `cd <dir>` changes the directory for later segments of the same command. `git -C <dir>` may repeat; the last wins. For `worktree add`, the first non-option argument after `add` is the path (options `-b/-B <name>` take a value).
- [ ] **Step 4: Run** the test file. Expected: PASS.
- [ ] **Step 5: Commit** `feat: find where Claude wrote from its session logs (#48)`.

---

### Task 3: Git resolution and branch scan

**Files:**
- Modify: `src/main/services/GitClient.ts` (+ tests in `GitClient.test.ts`, which use real temp repos)
- Create: `src/main/workspaces/resolve.ts`, `src/main/workspaces/resolve.test.ts`

**Interfaces:**
- Produces (GitClient):
  ```ts
  worktreeList(cwd: string): Promise<{ path: string; branch: string | null }[]>  // `git worktree list --porcelain`, branch without refs/heads/, null when detached; paths via nativePath
  mergeBase(cwd: string, a: string, b: string): Promise<string | null>
  defaultBaseRef(cwd: string): Promise<string>  // 'origin/<HEAD branch>' when origin/HEAD resolves; else 'origin/main' | 'origin/master' if present; else local 'main' | 'master'; else 'HEAD'
  currentBranch(cwd: string): Promise<string | null>
  ```
- Produces (`resolve.ts`):
  ```ts
  export type Candidate = { repoPath: string; worktreePath: string; branch: string | null; mainCheckout: boolean };
  /** The worktree containing `p` (walks up to the nearest existing folder first); null when not in a git repo. repoPath is the main checkout (parent of the common .git dir). */
  export function resolveCandidate(git: GitClient, p: string): Promise<Candidate | null>;
  /** Worktrees on `branch` in each repo; repos that fail are skipped. */
  export function scanBranch(git: GitClient, repoPaths: string[], branch: string): Promise<Candidate[]>;
  /** Direct sibling folders of the given repos that contain `.git` (file or folder), excluding the given repos and `*.worktrees` folders. */
  export function siblingRepos(repoPaths: string[], readdir?: (dir: string) => Promise<string[]>, isRepo?: (dir: string) => Promise<boolean>): Promise<string[]>;
  ```

- [ ] **Step 1: Write failing tests** with real temp git repos (follow the helpers already in `GitClient.test.ts`): `worktreeList` lists main + added worktree with branches; `mergeBase` returns the fork commit; `defaultBaseRef` returns `main` for a repo without origin; `resolveCandidate` on a file inside an added worktree returns `{mainCheckout: false, repoPath: <main>, branch}`; on a file inside the main checkout returns `mainCheckout: true`; on a deleted file path whose folder exists still resolves; on `os.tmpdir()`-based non-repo path returns null; `scanBranch` finds the worktree on the branch and skips a missing repo path; `siblingRepos` returns a sibling repo and not `<repo>.worktrees`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/GitClient.test.ts src/main/workspaces/resolve.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `mainCheckout` = `samePath(toplevel, repoPath)`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: resolve worktrees and scan repos for a task branch (#48)`.

---

### Task 4: Workspace detector, join rules, IPC

**Files:**
- Create: `src/main/workspaces/join.ts`, `src/main/workspaces/join.test.ts`, `src/main/workspaces/WorkspaceDetector.ts`, `src/main/workspaces/WorkspaceDetector.test.ts`
- Modify: `src/main/services/RepoRegistry.ts` (`addDiscovered`, `setDiscovered`), `src/main/services/azureRepos.ts` (`matchConnection`), `src/shared/ipc.ts`, `src/main/ipc/handlers.ts`, `src/main/main.ts` (or wherever `Services` is built)

**Interfaces:**
- Consumes: Task 1 types/helpers, Task 2 `SessionLogReader`/`writeHitsFromLines`, Task 3 `resolveCandidate`/`scanBranch`/`siblingRepos`, `claudeProjectsDir()`.
- Produces:
  ```ts
  // join.ts (pure)
  export type JoinVerdict = 'join' | 'home' | 'already' | 'other-task' | 'detached' | 'main-checkout';
  export function joinVerdict(task: Task, openTasks: Task[], c: Candidate): JoinVerdict;
  // azureRepos.ts
  export function matchConnection(remoteUrl: string | null, connections: Connection[]): Connection | null; // same org as parseAzureReposRemote; prefer same project
  // RepoRegistry
  addDiscovered(folder: string, connectionId: string | null): Promise<Repo>; // like add(); discovered: true; returns existing repo when already registered
  setDiscovered(repoId: string, discovered: boolean): Promise<Repo>;
  // WorkspaceDetector
  export class WorkspaceDetector {
    constructor(deps: { store: TaskStore; git: GitClient; repos: RepoRegistry; connections: () => Connection[]; projectsDir: () => string; reader?: SessionLogReader; patchTask; notice: (message: string) => void; event: (name: string, props?) => void });
    scan(taskId: string): Promise<{ added: Workspace[] }>;       // logs + branch scan, joins, persists, one notice per added repo: "Added <repo name> to this task"
    add(taskId: string, folder: string): Promise<Workspace>;     // manual; main checkout -> Error('<repo> is the main checkout; pick a worktree'); not a repo -> Error
    remove(taskId: string, workspaceId: string): Promise<void>;  // home -> Error; records worktreePath in detachedPaths
  }
  // ipc.ts Channels
  'tasks:scanWorkspaces': { args: [taskId: string]; result: Workspace[] }   // returns added
  'tasks:addWorkspace': { args: [taskId: string, folder: string]; result: Workspace }
  'tasks:removeWorkspace': { args: [taskId: string, workspaceId: string]; result: void }
  'repos:setDiscovered': { args: [repoId: string, discovered: boolean]; result: Repo }
  ```
- Join rule order in `joinVerdict`: same path as home → `home`; same path as an extra of this task → `already`; path in `detachedPaths` → `detached`; `mainCheckout` → `main-checkout`; same path as home/extra of another non-done task → `other-task`; else `join`. Paths compare with `samePath`.
- On join: register repo if unknown (`addDiscovered` with `matchConnection(origin url)`), `branch` = candidate branch (or `currentBranch`), `baseRef` = `defaultBaseRef(repo)`, `baseSha` = `mergeBase(worktree, 'HEAD', baseRef)`, `source: 'detected'`. A `main-checkout` verdict adds `{repoPath, branch}` to `mainCheckoutEdits` once. Session files: `<projectsDir>/*/<sessionId>.jsonl` for the task's Claude terminals (`terminals` and `closedTerminals`) with a `sessionId`. Concurrent `scan` calls for the same task share one in-flight promise.

- [ ] **Step 1: Write failing tests:** `join.test.ts` covers each verdict incl. Review Focus 5 (worktree owned by another open task → `other-task`; a *done* task's old path does not block). `azureRepos.test.ts`: `matchConnection` matches `dev.azure.com/org/p/_git/r` to the connection with that org, prefers same project, returns null for GitHub URLs and for no match. `WorkspaceDetector.test.ts` (real temp repos, a temp projects dir with a fake session file): an Edit in repo B's worktree joins B with `source: 'detected'` and registers B as `discovered` with matched connection; a second scan adds nothing; a Read-only session adds nothing; a worktree of a registered repo on the task branch joins via branch scan without any log; an Edit in B's main checkout adds to `mainCheckoutEdits` and joins nothing; `remove` then `scan` does not re-add; `add` on a main checkout throws; a write to a non-repo path is ignored (Review Focus 2).
- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement**, wire the detector into `Services` (`workspaces: WorkspaceDetector`, optional; handlers construct one from `s` when absent), add the IPC handlers and `repos:setDiscovered`, broadcast `tasks:changed` and `repos:changed` after changes. Telemetry: `workspace.joined` `{source: 'log' | 'branch' | 'manual'}`, `workspace.removed`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: detect and join other repos' worktrees to a task (#48)`.

---

### Task 5: Steering Claude, terminals per workspace

**Files:**
- Modify: `src/shared/naming.ts` (+ its test), `src/main/ipc/handlers.ts` (`terminalCommand`, `spawnTerminal`, `terminals:open`, `tasks:gitSummary`), `src/shared/ipc.ts`
- Test: `src/shared/naming.test.ts`, handlers tests

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces:
  ```ts
  claudeContext(task: Pick<Task,'workItem'|'name'|'branch'|'slug'>): string  // adds the instruction below
  renderTaskMd(task: Task): string                                         // adds the same instruction and lists every workspace (repo path, branch, worktree)
  'tasks:gitSummary': { args: [taskId: string, workspaceId?: string]; result: GitSummary }
  ```
- Instruction text (exact, `<branch>` and `<slug>` filled in):
  `If this task needs changes in another repository, do not edit that repository's main checkout. Create a worktree there on this task's branch: git -C <repo> worktree add <repo>.worktrees/<slug> -b <branch> <base> (use the repo's default branch as base, from origin when it exists). MIAC picks it up automatically.`

- [ ] **Step 1: Write failing tests:** `claudeContext` contains `worktree add <repo>.worktrees/42-x -b feature/42-x`; `renderTaskMd` lists an extra workspace; a Claude terminal of a task with one extra workspace starts with `--add-dir <extra worktree>` (both on start with `--session-id` and on `--resume`), dropped workspaces excluded; a shell opened with `workspaceId` of the extra spawns with that worktree as cwd; a def without `workspaceId` spawns in `activeHome(task).worktreePath`; `tasks:gitSummary(taskId, extraId)` summarises the extra worktree against its `baseRef`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** `spawnTerminal` cwd = `workspaceById(task, def.workspaceId).worktreePath`; Claude flags append `['--add-dir', p]` per active workspace other than the cwd one.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: tell Claude how to add repos, and open terminals in any of the task's repos (#48)`.

---

### Task 6: Task page shows workspaces and scans

**Files:**
- Modify: `src/renderer/components/TerminalTabs.tsx` (chips), `src/renderer/components/NewTerminalMenu.tsx`, `src/renderer/components/HeaderBar.tsx`, `src/renderer/components/TaskNav.tsx`, `src/renderer/screens/TaskScreen.tsx` (scan triggers, main-checkout warning), the git summary hook (`useGitSummary`) to take a workspace id
- Test: the matching `*.test.tsx` files

**Interfaces:**
- Consumes: Task 1 `taskWorkspaces`/`activeWorkspaces`, Task 4 IPC, Task 5 `tasks:gitSummary(taskId, workspaceId)`.
- Produces: `NewTerminalMenu` prop `workspaces: { id: string; name: string }[]` (when length > 1, each terminal type opens a submenu or second list to choose the repo; the chosen id goes in `NewTerminal.workspaceId`).

- [ ] **Step 1: Write failing tests:**
  - Task strip shows one chip per active workspace with its repo name; home first; a chip's menu has "New shell here", "Open folder" (calls `tasks:openInEditor`-like reveal; use `shell` reveal of the worktree), and "Remove from task" (not on home) which calls `tasks:removeWorkspace`.
  - With one workspace the strip looks as today (no chip row change beyond the existing branch display).
  - `NewTerminalMenu` with two workspaces: choosing Shell then the second repo calls `onOpen({kind:'shell', label:'shell', workspaceId: '<id>'})`.
  - HeaderBar hover lists each workspace's repo and branch.
  - TaskNav shows `+1 repo` / `+2 repos` on a task with extras.
  - TaskScreen calls `tasks:scanWorkspaces` on mount and every 120000 ms while `document.hasFocus()` and the task is `ready` (fake timers), not when unfocused; the task menu has "Scan for other repos" and "Add a worktree…" (uses `repos:pickFolder`, then `tasks:addWorkspace`; errors show as a notice).
  - A task with `mainCheckoutEdits` shows the warning "Changes made in <repo folder name>'s main checkout (branch <x>)".
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** in the existing ADO look (Fluent icons, existing CSS tokens).
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: show a task's repos and scan for new ones (#48)`.

---

### Task 7: Finish per workspace

**Files:**
- Modify: `src/shared/types.ts` (`FinishOptions`, `FinishChecks`), `src/shared/ipc.ts`, `src/main/ipc/handlers.ts` (`tasks:finishChecks`, `tasks:prAvailability`, `tasks:finish`, `prContext`), `src/main/services/azureRepos.ts` (`prDescription` input), `src/shared/workItemUsage.ts` (`renderUsageComment(u, branches: string[])`), `src/main/usage/UsageSync.ts`, `src/renderer/screens/FinishScreen.tsx`, `src/renderer/uiPrefs.ts`
- Test: handlers tests, `azureRepos.test.ts`, `workItemUsage` test, `UsageSync.test.ts`, `FinishScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1, Task 4 (`scan` before checks).
- Produces:
  ```ts
  type WorkspaceAction = 'pr' | 'push' | 'keep' | 'drop';  // keep = no push/PR, still cleaned up per the global options
  FinishOptions += { workspaces?: { workspaceId: string; action: WorkspaceAction }[] }  // absent = legacy: home gets 'pr' if createPullRequest else 'keep'
  type WorkspaceCheck = { workspaceId: string; repoName: string; branch: string; missing: boolean; uncommitted: GitFile[]; unpushed: number; commits: number;
                          pr: { available: boolean; reason: string | null; target: string | null; linksWorkItem: boolean } };
  FinishChecks += { workspaces: WorkspaceCheck[] }   // existing fields stay (home)
  'tasks:finishChecks' scans workspaces first (detector.scan), then checks each active workspace
  'tasks:prAvailability': { args: [taskId: string, workspaceId?: string]; ... }
  PrDescriptionInput += { costScope?: { repos: number } ; workItemUrl?: string | null }
  ```
- Row default actions (FinishScreen):
  - `missing` → `keep`, shown as "Folder missing, skipped".
  - `commits === 0 && uncommitted.length === 0` → `drop`, shown as a ticked "Remove, no changes (no push)".
  - otherwise, when `pr.available`: checkbox "Create a draft pull request into <target>", ticked per the remembered choice (`miac.ui.pr.<repoId>`, unticked on first use as today); ticked → `pr`, unticked → `keep`.
  - otherwise: checkbox "Push the branch" (remembered the same way); ticked → `push`, unticked → `keep`.
- Finish algorithm, per active workspace in order (home first), skipping `missing`:
  1. `summary` = `finishSummary` (never blocks).
  2. `drop`: mark `dropped: true` (home: `homeDropped: true`); cleanup later without push.
  3. `push`: push; set `summary.pushed`.
  4. `pr`: push (skip when `origin/<branch>` already contains HEAD), find active PR else create (`workItemId` only when `linksWorkItem`; else `workItemUrl` in the description); description cost line = `costLineFor(taskId)` with `costScope` when more than one active workspace with changes; persist `pullRequest` on that workspace immediately.
  5. Failures are collected per row; after the loop, if any failed: status back to `ready`, nothing cleaned up, throw `Error('Pull request not created for <repo>: <message>; ...')`.
  6. Cleanup for every active or dropped workspace that exists on disk: kill terminals once, remove worktree, prune, delete branch per global options (dropped rows always remove worktree and delete branch).
  7. Persist summaries per workspace; status `done`. Usage comment names all pushed branches.
  Telemetry `task.finished` gains `{ workspaces, prs, dropped }` measurements.

- [ ] **Step 1: Write failing tests (handlers, with the existing fakes):**
  - Two workspaces, home without changes and extra with commits: options `[home: drop, extra: pr]` → no push in home, home worktree removed and branch deleted, `homeDropped: true`; extra pushed, PR created with `workItemId`, `pullRequest` stored on the extra; task `done`.
  - Partial failure: extra-1 `pr` succeeds, extra-2 `pr` fails on push → task `ready`, extra-1 has `pullRequest`, no worktree removed, error names extra-2's repo. Retry with the same options: extra-1 links the existing PR via `findActivePullRequest` (no second `createPullRequest`) and is not pushed again; extra-2 created (Review Focus 3).
  - "Finish without PR" for the failed row = action `keep`: finishes and cleans up.
  - Extra workspace whose folder was deleted by hand: `finishChecks` reports `missing: true`; Finish skips it without error (Review Focus 4).
  - Workspace in another org: PR created without `workItemId`, description contains the work item URL; `linksWorkItem: false` in checks.
  - Legacy call without `workspaces` behaves exactly as today (existing tests untouched).
  - `prDescription` with `costScope: {repos: 2}` renders `AI cost (whole task, 2 repos): ...` (keep existing line format otherwise); `renderUsageComment(u, ['a','b'])` names both branches.
  - FinishScreen: rows per workspace with the defaults above; submitting sends `workspaces`; on error the failed rows offer "Retry" and "Finish without PR" (sends `keep` for the failed rows only).
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: finish every repo of a task, one draft PR per repo (#48)`.

---

### Task 8: Done page per workspace

**Files:**
- Modify: `src/renderer/screens/DoneTaskPage.tsx`, `src/main/ipc/handlers.ts` (`tasks:prStatus(taskId, workspaceId?)`), `src/shared/ipc.ts`
- Test: `DoneTaskPage.test.tsx`, handlers tests

- [ ] **Step 1: Write failing tests:** a done task with two workspaces renders one section per non-dropped workspace (repo, branch, pushed, commits, diff stat, PR with live status fetched via `tasks:prStatus(taskId, workspaceId)`), and a dropped one as the single line `<repo>: no changes, removed`; duration and cost appear once. A single-repo done task renders as today. `tasks:prStatus(taskId, extraId)` refreshes and stores the extra's PR.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Done page shows every repo of a task (#48)`.

---

### Task 9: Reopen restores every workspace

**Files:**
- Modify: `src/main/services/SetupRunner.ts` (+ test), `src/main/ipc/handlers.ts` (`tasks:reopen`, `buildPlan`, `tasks:cancelSetup`, `restoredTerminals`)
- Test: `SetupRunner.test.ts`, handlers tests

**Interfaces:**
- Produces:
  ```ts
  SetupPlan += {
    /** Reopen: skip the home's worktree, copy, task-file and command steps (home was dropped). */
    skipHome?: boolean;
    extraRestores?: { workspaceId: string; repoName: string; repoPath: string; worktreePath: string; branch: string; from: string | null; copy: string[]; commands: string[] }[];
  }
  // planSteps: per extra, after the home's command steps and before 'terminals':
  //   { kind: 'worktree', label: `Restore ${repoName} worktree`, detail }, copy step if any (`Copy local files (${repoName})`), one 'command' step per command with detail `in ${repoName}`
  // handlers: restoreSource(repoPath, ws: {branch, summary, baseSha, baseRef}): Promise<{ from: string | null; via: 'branch'|'origin'|'commit'|'base' }>  // the existing logic of tasks:reopen, extracted
  ```
- Extras' copy and commands come from each repo's `.miac.yml` (`loadConfig(repo.path)`), `copy` honoured per `task.setup.copy`, commands = that config's `setup`.
- "Kept worktree" path of `tasks:reopen` (folder still exists) also requires every non-dropped extra folder to exist; otherwise it goes through setup.
- `tasks:cancelSetup` of a reopen removes the extras' re-made worktrees too.
- Home dropped: `skipHome: true`; Claude tabs resume in `activeHome(task)` (cwd of `--resume <id>` does not matter for finding the session).

- [ ] **Step 1: Write failing tests:** `planSteps` with two `extraRestores` yields the named steps in order before `terminals`; the runner restores an extra worktree from `origin/<branch>` and runs its command in that worktree (real temp repos as in the existing runner tests); `tasks:reopen` of a task with home + one extra sets `reopen.from` on each and the setup restores both; dropped workspaces are not restored; `homeDropped` task restores only extras and Claude tabs spawn in the extra; failing restore of an extra fails setup at that step and `retrySetup` resumes there; cancel removes both worktrees and the task goes back to `done`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: reopen restores every repo of a task (#48)`.

---

### Task 10: Docs tab per workspace

**Files:**
- Modify: `src/main/docs/docsHandlers.ts`, `src/main/docs/DocsWatcher.ts`, `src/shared/ipc.ts`, the Docs components under `src/renderer/components/docs/`, `src/renderer/terminalLinks.ts`
- Test: matching tests

**Interfaces:**
- Produces: every `docs:*` channel's `taskId` argument may be `"<taskId>"` or `"<taskId>#<workspaceId>"` (a docs *target*). Helper in `src/shared/workspaces.ts`: `docsTarget(taskId: string, workspaceId?: string): string` and `parseDocsTarget(target: string): { taskId: string; workspaceId?: string }`. `docs:changed`/`docs:watchStopped` carry the same target string in `taskId`. The watcher keys by target. This keeps every channel signature unchanged.
- `docs:resolve` for terminal links: with a plain task id, tries the active home first, then the other active workspaces; returns `path` prefixed so the Docs tab opens the right workspace (`{ path, kind, workspaceId }` — add optional `workspaceId` to the result type).

- [ ] **Step 1: Write failing tests:** `docs:list` with `<taskId>#<extraId>` lists the extra worktree's Markdown marked against the extra's `baseSha`; `docs:resolve` finds a file that exists only in the extra and returns its `workspaceId`; the Docs tab shows a repo switcher only when there is more than one active workspace and switching lists that repo's files; the watcher stops all of a task's targets on `stopTask(taskId)`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Docs tab reads any repo of a task (#48)`.

---

### Task 11: Settings, telemetry docs, project docs

**Files:**
- Modify: `src/renderer/screens/SettingsScreen.tsx` (+ test), `docs/telemetry.md`, `CLAUDE.md` (Status: one paragraph on #48)

- [ ] **Step 1: Write failing test:** Settings lists a discovered repo with the note "Found in a task" and a "Make it a normal repo" button calling `repos:setDiscovered(id, false)`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**; add `workspace.joined`, `workspace.removed` and the new `task.finished` measurements to `docs/telemetry.md`; add the #48 status paragraph to `CLAUDE.md` (what detection does, where it lives, known gaps: Copilot/OpenCode tabs have no readable log, detection of Bash writes is heuristic, Windows verified by CI only).
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `docs: multi-repo tasks in telemetry and status (#48)`.

---

### Task 12: Functional check in the packaged-like app

Not code; a check with asserted results (the user wants click-through checks, not screenshots alone).

- [ ] Launch the app (`npm start`) with a throwaway profile and two local repos A and B (B with an Azure Repos-style `origin` is not needed; use local only), and a fake `claude` on PATH that writes a session JSONL with an `Edit` into B's worktree and creates that worktree with `git worktree add`.
- [ ] Assert: B joins with the notice "Added B to this task"; the strip shows chips A and B; a shell opened "in B" has cwd B's worktree; Finish shows A as "Remove, no changes" and B with Push; finishing removes A's worktree and branch and pushes nothing for A; Done shows B's section and the line "A: no changes, removed"; Reopen restores B and not A.
- [ ] Record the assertions and results in the PR description.
