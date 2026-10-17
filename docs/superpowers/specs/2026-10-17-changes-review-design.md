# Changes: reviewing a task's work before it leaves the worktree

Date: 2026-10-17. Owner decisions:
- Purpose: **self-review of agent-written code** before Finish or a draft PR, with review comments that go back to the agent. Not a replacement for reviewing a colleague's PR in Azure DevOps.
- Comments are **tracked threads**: kept per task across relaunches, marked sent, outdated when their lines change, resolved by hand.
- Diffs are rendered with the **Monaco diff editor**.
- The page can **open the task in the developer's IDE**, chosen per repo and per user. v1 supports **VS Code and Visual Studio**.

Calls marked *(our call)* were made during design and not explicitly decided by the owner.

## Why

Claude Code and Copilot commit as they go, so by the time a developer looks, much of the work is already in commits. `git diff` in a terminal shows only uncommitted work, and the Azure DevOps PR view only exists after a push. There is no comfortable place in MIAC to read everything a task changed, mark what has been checked, and tell the agent what to fix.

## Goals

- One page that shows everything the task changed since its base, committed or not, across every repo of the task.
- Track which files have been read, and notice when the agent changes a file again.
- Comment on lines and send the open comments to a Claude tab in one action.
- Jump from any file and line into the developer's IDE.

## Non-goals

- Staging, reverting or committing hunks from the page *(our call: powerful but risky, later)*.
- Changes view for Done tasks (the worktree is gone; Reopen first).
- Reply threads on comments, or syncing comments to Azure DevOps PR threads.
- Hunk attribution (which lines came from Claude versus the developer).
- Editors other than VS Code and Visual Studio, and custom editor command templates. The registry is built so one more editor is one entry.

## Page

A **Changes** pivot on the task page, next to Docs and Usage, as a full page (#15), with a count badge ("Changes 12"). Shown while the task is ready and its worktree exists.

**Header:** scope switcher, "7 / 12 viewed", "3 open comments", **Send N comments to ⟨tab⟩ ▾**, **Open in ⟨editor⟩ ▾**.

**Scope switcher:**
- **All changes** (default): base → working tree. Committed, staged, unstaged and untracked together.
- **Uncommitted:** HEAD → working tree.
- **Commit…:** a dropdown of the branch's commits (subject, author, relative time), showing one commit; shift-click picks a range.

**Left: file tree.** Grouped by repo when the task has more than one (same names as the repo chips). Per file: status (A, M, D, R), +/- counts, a viewed checkbox, a comment count. A **Comments** filter lists all comments; a click jumps to one. Generated files are collapsed under **Generated**: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `*.min.js`, `*.map`, `dist/**`, plus the repo's `review.collapse` globs in `.miac.yml` *(our call)*.

**Right: Monaco diff editor** for the selected file. Toolbar: side-by-side / inline, ignore whitespace, hide unchanged regions (on by default), previous / next change, previous / next file, Open file in editor. Binary files and files over 2 MB show "binary, 12 KB → 14 KB" (or "too large") with Open in editor instead of a diff.

**Keys** (when focus is on the page, not in a comment box): `j` / `k` next / previous file, `n` / `p` next / previous change, `v` toggle viewed, `c` comment on the cursor line or selection.

**Viewed:** stored per file as the hash of the file's after-side content. When the hash changes the checkmark clears and the file shows "changed since viewed".

**Live:** while the agent writes or commits, the list and the open diff refresh; the open file, scroll position and comment drafts stay.

UI follows the ADO redesign: Segoe UI, ADO dark palette, Fluent icons. Monaco's theme is mapped to the same palette.

## Review comments

**Making one:** hover a line and a **+** appears in the glyph margin; click it, or select lines and press `c`. A comment box opens as a view zone under the line(s). Comments sit on the after side by default; a deleted line takes one on the before side. Text is Markdown, one comment per thread, no replies.

**Fields:** `id`, `workspaceId`, `path`, `side` (`before` | `after`), `startLine`, `endLine`, `snippet` (the commented lines), `context` (3 lines before and after), `text`, `status` (`open` | `sent` | `resolved` | `outdated`), `createdAt`, `sentAt?`, `resolvedAt?`.

**Anchoring:** on each refresh a comment is located again by finding its `snippet` in the new content, closest to the old line, with `context` breaking ties. Found: the line moves. Not found: `outdated`. A sent comment that turns outdated shows "code changed, probably addressed", with **Resolve** and **Show change** (the diff between the snippet and what is there now). An open comment that turns outdated keeps its text and can be resolved or re-placed by clicking a line.

**Send to Claude:** the header button uses Send to's target picker and remembered target (`docsPrefs`) and `pasteInto`, without Enter, so the developer can add a sentence:

```
Review comments on the changes in this task:

1. src/main/foo.ts:42-45
   > const x = compute(a);
   > ...
   Use the cached value here, compute() is expensive.

2. src/renderer/Bar.tsx:10
   > ...
   ...
```

In multi-repo tasks each path is prefixed with the repo name (`repo/path`). Only `open` comments are sent; they become `sent` with `sentAt`. The button lists every Claude Code tab of the task; with none, it is disabled with "Open a Claude Code tab first". Copilot and OpenCode tabs are also listed (the paste is plain text).

**Finish:** the Finish page shows a soft line, "2 files not viewed · 1 comment unresolved", linking to Changes. It never blocks. Hidden when every file is viewed and no comment is open or sent.

## Opening the IDE

An **editor registry** in main (`src/main/editors/`) replaces the hardcoded `code` in `Platform.editorCommand` / `editorGotoCommand`. Docs links and terminal `path:line` links use it too.

Each entry: `id`, `label`, `detect(): Promise<string | null>` (the executable path), `openFolder(exe, worktree, hints)`, `openFile(exe, worktree, file, line?)`.

**VS Code** (both platforms): found on `PATH` (`code`, as now). Folder: `code <worktree>`. File: `code -g <file>:<line>` in the worktree's window, as `editorGotoCommand` does now.

**Visual Studio** (Windows only): found with `%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe -latest -property productPath`, any edition. Folder:
- one `.sln` in the worktree root or one level down: `devenv <worktree>\<x>.sln`;
- several: the split button lists them, and the pick is remembered per repo;
- none: `devenv <worktree>` (Open Folder).

Always the worktree's own solution, never the main checkout's. File: `devenv /edit <file> /command "Edit.GoTo <line>"`, which reuses the running instance. To check on Windows hardware: if `/command` does not move to the line, the file opens at the top and this is listed as a known gap.

**Which editor opens** (first match wins):
1. The repo's editor in Settings (per repo, personal, in `settings.json`).
2. The global default editor in Settings.
3. Project hint: a `*.sln` or `*.csproj` in the worktree root or one level down → Visual Studio when installed.
4. VS Code.

Only installed editors count at every step. The choice is personal, so it is not in `.miac.yml`. Detection is cached per launch, and again when Settings opens. When no editor is installed, the button reads "No editor found" and links to Settings.

The **Open in ⟨editor⟩ ▾** split button opens the worktree (the selected file's repo in multi-repo tasks); its menu lists the other installed editors and, for Visual Studio, the solutions. **Open file in editor** goes to the cursor's line on the after side.

## Main process

**ReviewService** (`src/main/review/`) on top of `GitClient.run`, per workspace of the task, in parallel.

**Base:** the task's `baseSha`, else the merge base with `baseRef`, the same rule as `finishSummary`. With neither: All and Commit are unavailable ("No base for this task"), Uncommitted still works.

**File list:**
- All: `git diff -z -M --name-status <base>` and `git diff -z -M --numstat <base>`, plus `git ls-files -z --others --exclude-standard` (untracked → added; +lines counted from the file, binary when it has a NUL in the first 8 KB).
- Uncommitted: the same with `HEAD`.
- Commit / range `a..b`: `git diff -z -M <a>^ <b>`; for a root commit, against the empty tree.
- Commits for the picker: `git log --format=... <base>..HEAD`, newest first, up to 200.
- Each file gets `hash`: the after side's git blob hash (`git hash-object` for working-tree files, the tree entry's blob id for commits).

**File contents:** only for the file being opened. Before: `git show <ref>:<oldPath>` (empty for added). After: the file from disk (All, Uncommitted) or `git show <b>:<path>`. Language from the extension. Binary or over 2 MB: no content, only sizes.

**State:** `review/<taskId>.json` in MIAC's data folder: `{ viewed: { "<workspaceId>:<path>": hash }, comments: [...] }`. Written atomically with `fsRetry`. Removed when a task is deleted; kept through Finish so a reopened task keeps its comments.

**IPC:**
- `review:files(taskId, scope)` → `{ base: string | null, commits, repos: [{ workspaceId, name, error?, files: [{ path, oldPath?, status, added, removed, binary, hash }] }] }`
- `review:file(taskId, workspaceId, path, scope)` → `{ before, after, language, binary, sizes }`
- `review:state(taskId)`, `review:saveState(taskId, state)`
- `editor:list()` → installed editors; `editor:open({ taskId, workspaceId, file?, line?, editorId?, solution? })`
- event `review:changed(taskId)`

**Watching:** DocsWatcher becomes a shared `WorktreeWatcher` with holder counts, so Docs and Changes share one recursive watch per worktree. It keeps ignoring `node_modules` and `.git`, and also watches the worktree's git dir (`HEAD`, `index`, `logs/HEAD` under `git rev-parse --git-dir`) so commits, amends, resets and staging from a terminal are seen. Changes are debounced (300 ms) into `review:changed`. Where watching fails, the page polls every 5 s while it is on screen, like Docs.

**Monaco:** `monaco-editor` loaded lazily as its own Vite chunk the first time Changes opens, with its editor worker through Vite `?worker` imports. No CDN. Only the diff editor and basic language tokenizers are bundled.

## Errors

- Worktree missing: "The worktree is gone", with a link to Reopen.
- Git fails for one repo: an inline banner on that repo's group with git's stderr and Retry; other repos keep working.
- A comment whose repo left the task: kept and shown as outdated.
- State file unreadable: start empty, keep the bad file as `.bak`, tell the user once.
- Editor launch fails: notice with the error; the menu still offers the other editors.

## Telemetry

New events in `docs/telemetry.md`: `review.opened` (scope, file count, repo count), `review.fileViewed` (no properties), `review.commentsSent` (count), `review.commentResolved` (was it outdated). `editor.opened` gains an `editor` property (`vscode` | `visualstudio`) and `at` (`file` | `folder`). No paths, names or comment text.

## Testing

- ReviewService against temporary git repos (as in `GitClient.test.ts`): committed, staged, unstaged, untracked, rename, delete, binary, large file, no base, merge-base fallback, commit, range, root commit, multi-repo with one failing repo.
- Comment anchoring: unchanged, moved lines, edited snippet, deleted snippet, duplicate snippets.
- Editor registry: detection with stubbed `vswhere` and `PATH`, the preference order, solution discovery, command lines per editor.
- Renderer: file tree, viewed / changed since viewed, comment create and status flow, the Send to Claude text, the Finish line; Monaco mocked.
- Live click-through in the packaged app on macOS: commit and edit in a task, review across scopes, comment, send to Claude, let Claude fix it and see the comment go outdated, resolve, open in VS Code. Visual Studio on Windows hardware via `docs/windows-checklist.md`.

## Known gaps

- Visual Studio go-to-line depends on `/command "Edit.GoTo"`, unverified until the Windows check.
- Comment anchoring is text matching; heavily rewritten code makes comments outdated even when they were not addressed.
- No Changes view for Done tasks.

## Implementation notes (2026-10-17, from the implementation plan)

- Comments are made and shown in the All changes scope only; their lines refer to the working-tree file (after) or the base file (before). Other scopes show "Comments are shown in All changes".
- An outdated comment shows its original lines with Resolve; "Show change" and re-placing a comment by clicking a line are left out. A comment whose lines come back is open (or sent) again.
- The renderer and main talk through granular calls (`review:setViewed`, `review:addComment`, `review:updateComment`, `review:deleteComment`, `review:markSent`, `review:summary`) instead of one `review:saveState`, so main owns the state and the re-anchoring.
- DocsWatcher is shared, not renamed: `review:watch` holds the same DocsWatcher target as the Docs tab plus a GitDirWatcher on the worktree's git dir (`HEAD`, `index`, `ORIG_HEAD`, `logs/HEAD`). File edits arrive as `docs:changed`, git changes as `review:changed`.
- Monaco picks the language from the file name (the model URI); main sends no language.
- An unreadable review file is kept as `<taskId>.json.corrupt-<time>` (JsonFileStore) and a notice says so. Tasks are never deleted, so review files are not removed.
- Monaco is the full `monaco-editor` package with its JSON, CSS, HTML and TypeScript workers (diagnostics off), loaded as a separate chunk on first use.
- A repo whose git call fails shows git's message in its group; it refreshes with the next change or scope switch (no separate Retry button).
- Telemetry events sent: `review.opened` (scope, files, repos), `review.fileViewed` (no properties), `review.commentsSent` (count, only after the comments were marked sent) and `review.commentResolved` (outdated). `editor.opened` carries `editor` and `at`.
- Inline diff view: Side by side is honoured at any width. In inline view, before-side comments are shown in the after editor at the mapped line, and new comments can only be added on the after side.
- Comment links: http(s) links open in the browser; other links render as plain text.
- A non-empty comment draft is kept when + is clicked elsewhere ("Finish or cancel the open comment first"), and drafts survive refreshes.
- The pivot badge pauses while the Changes tab itself is open. Refreshes are debounced (200 ms after the last change) with one git call in flight.
- Paste to an agent: the whole prompt, including paths, is stripped of control characters; terminals without bracketed paste get a single-line prompt; only agent tabs (Claude Code, Copilot, OpenCode) are send targets.
- Settings > Editor looks for editors again each time Settings opens.
- Final review fixes: each row of the Comments list has Resolve (or Reopen) and Delete, so a comment on a file that left the change list can still be closed. The scope, the selected file and the draft are kept per task in the renderer store, so leaving the Changes tab (Send does, it switches to the agent's tab) and coming back loses nothing; a stored file that is no longer listed falls back to the first file. Scroll and cursor are kept per file for the app's lifetime (DiffView saves the view when it leaves a file and restores it when the file is shown again). DiffView keeps each zone's portal node across view-zone rebuilds, so a comment being edited keeps its text. A before-side comment on a renamed file stores `oldPath` and is read, re-anchored and sent at the old path; a before-side location is sent as `old.ts:30 (removed line, base version; now new.ts)`, or `src/x.ts:30 (removed line, base version)` without a rename. The Changes panel is shown for ready tasks only, and a failed file list shows "The changes could not be loaded: <reason>". An unknown editor id in settings.json reads as no choice instead of resetting all settings.
- Not yet checked: Visual Studio's go-to-line on Windows (see the checklist).
