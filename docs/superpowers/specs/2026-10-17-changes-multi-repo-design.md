# Changes tab: multi-repo tasks

Follows the Changes review page (`2026-10-17-changes-review-design.md`). Goal: when a task spans 2-3 repos, the reviewer always knows which repo they are in and how far each repo is, and can work one repo at a time.

Scope: repo colors, a summary header per repo, a repo breadcrumb and repo filter chips. Out of scope (later): commit menu grouping, a VS Code multi-root workspace, a review order, per-repo PR target on the header, per-repo comment sending.

Everything below applies to tasks with 2 or more repos. A single-repo task looks exactly as before: no colors, no headers, no chips.

## Repo colors (task-wide)

- `repoColor(task, workspaceId)` in `src/shared/workspaces.ts`: the repo's index in `taskWorkspaces(task)` (home first, dropped repos keep their slot, so a color never shifts), modulo 6, as 1-6. `null` for single-repo tasks.
- Palette `--repo-1` … `--repo-6` in `tokens.css`: sky, purple, teal, orange, pink, lime, clear of the A/M/D status colors and the primary blue, each at least 3:1 against `--bg-card`.
- Shown as a 3px bar or a dot; text keeps normal text colors.
- Used on the task page's repo chips (dot before the name), the repo groups of the terminal + menu, and in Changes (headers, breadcrumb, chips).

## Repo header row

```
▾ ┃ web   8 files  +120 −40   3/8 viewed   💬 2   ● 1 uncommitted
```

- Chevron, color bar, name, then muted counts for the current scope: files, added/removed lines, viewed. The comment count (open or sent) shows only when above 0; "● N uncommitted" (always against HEAD) in `--warn` only when above 0.
- A repo with no files in the scope is one muted row without chevron: `api · No changes`, plus ` · not in Finish` when Finish would drop it (see below).
- A git error shows git's message instead of the counts.
- Collapse: manual (chevron) or automatic. A repo folds by itself when every file is viewed and opens when a file becomes "changed since viewed". A manual open or close sticks until a file in that repo changes, then the repo goes back to automatic.
- `j` / `k` and next / previous file still walk into a folded repo and open it.

## Breadcrumb

The diff toolbar's path gets the repo in front with its color bar: `┃ web › src/components/Foo.tsx` (a rename stays `old → new`). A click on the repo name filters to that repo.

## Repo filter chips

In the header after the scope switcher: `All · ┃web 5 · ┃api 2 · ┃shared ✓` (unviewed count, or ✓ when all viewed).

- A repo chip narrows the file tree, `j` / `k` and next / previous file, and the viewed counter ("3 / 8 viewed in web").
- Task-wide still: the Comments list, the open comments count, Send comments, the Finish reminder. Open in editor still opens the selected file's repo.
- When the selected file is outside the filter, the selection moves to the repo's first unviewed file, else its first file.
- Keys `1`-`9` pick a repo by chip order, `0` picks All, under the same focus rule as `j` / `k`.
- Commits scope: picking a commit sets the filter to its repo; the other chips are disabled ("Commits are per repo"). All changes or Uncommitted enables them again and keeps the filter.
- A jump from the Comments list to another repo's comment sets the filter to that repo.
- The filter falls back to All when its repo leaves the task.

## Data

- `ReviewRepo.uncommitted: number`: paths in `git status --porcelain` (staged, unstaged, untracked), read by `ReviewService.files` in parallel with the commit list, in every scope.
- "Not in Finish" is Finish's own rule, moved to one shared helper used by both screens: base known, no commits, nothing uncommitted. An empty All changes diff is not enough (commits that add and revert still go to Finish).
- View state per task in `useViewField`: `repoFilter` (workspaceId or null) and `collapsed` (`workspaceId → 'auto' | 'open' | 'closed'`). In memory only, like `selected`.

## Telemetry

New events: `review.repoFiltered` (`via`: `chip` | `key` | `breadcrumb` | `commit` | `comment`) and `review.repoCollapsed` (`how`: `manual` | `auto`). No names.

## Testing

- `repoColor`: order, dropped repo keeps its slot, wrap past 6, null for one repo.
- The shared Finish rule against Finish's existing cases.
- `ReviewService.files`: `uncommitted` counts staged, unstaged and untracked, same in every scope; a failing repo still returns `error`.
- `FileTree`: header counts, the No changes row with and without "not in Finish", manual and automatic collapse, reopen on change.
- `ChangesTab`: chips filter tree, keys and counter; `1`-`9` and `0`, ignored in a comment box; selection moves into the filtered repo; a commit pick sets and locks the filter; a comment jump sets the filter; fallback to All; breadcrumb shows the repo and filters on click; `j` into a folded repo opens it.
- Single-repo tasks unchanged (existing tests stay green).
- Live check with a 3-repo task (one repo without changes): chips, keys, collapse, auto-collapse, a commit pick, the counts, the No changes row and matching colors on the task page.
