# Docs tab, terminal links and Send to

Date: 2026-10-16. Owner decisions:
- Build the Markdown viewer and clickable terminal links as one feature.
- One **Docs** tab per task with a file list; links in a terminal open there.
- Render GitHub-flavored Markdown, **Mermaid** diagrams, and a **Source** view with line numbers.
- **Send to:** a selected passage is pasted as a quote into any of the task's terminals (Claude, Copilot, opencode in a shell, …), never with Enter.
- Approach: render in the renderer with `react-markdown`; main reads files and checks that they stay inside the worktree.

## Goal

Claude writes specs, plans and notes as Markdown in the worktree. The developer should be able to:
- read them rendered without leaving MIAC;
- jump to a file from a path printed in the terminal;
- answer the agent about a passage without copying and pasting by hand.

## 1. Docs tab

**Place.** A new pivot in the task row, right after Usage (the first pivot) and before the terminal pivots: icon `Document16Regular`, label "Docs". Its tab id is the constant `DOCS_TAB = 'docs'`, next to `USAGE_TAB`.
- A dot on the pivot when a listed file changed since the tab was last active.
- Shortcut **Mod+Shift+D** (Cmd on macOS, Ctrl on Windows), in `useShortcuts`, only for a ready task on the task page.
- Done tasks have no Docs tab, because the worktree is gone.

**File list.** Left, 240px, collapsible (the choice is kept in `uiPrefs`).
- Grouped by folder, folders sorted, files sorted by name.
- `.miac/task.md` pinned on top as "Task".
- A badge **new** or **modified** on files changed in this task against the task's `baseSha`. Without a `baseSha`, no badges.
- A filter field on top that matches the path, case-insensitive.
- Empty state: "No Markdown files in this worktree".

**Document.** Right, filling the rest.
- A command bar:
  - the path as a breadcrumb;
  - a **Rendered | Source** pivot;
  - "Open in VS Code" (at the current line in Source view);
  - "Reveal in Finder" on macOS, "Show in Explorer" on Windows.
- **Rendered view.** Content at most 860px wide, centered, ADO dark styling, body 14px.
  - GitHub-flavored Markdown: tables, task lists (read-only checkboxes), strikethrough, autolinks.
  - Fenced code blocks with syntax highlighting and a copy button.
  - ` ```mermaid ` blocks render as diagrams with the dark theme. When a diagram fails to parse, show its source in a code block and the parse error under it in `--red`.
  - Relative links:
    - to a `.md` file open it in the viewer (with `#anchor` if given);
    - to another file inside the worktree open it in VS Code.
  - `#anchor` links scroll to the heading. Heading ids follow GitHub's slug rule.
  - `http`/`https` links open in the browser through `links:open`. Other schemes do nothing.
  - Relative images load through `docs:asset`. Remote images are not loaded; they show as their alt text with the link.
- **Source view.** The raw text in the code font with a line-number gutter, no wrapping, horizontal scroll. Opening `file.md:42` selects Source view, scrolls line 42 into the middle and highlights it for 2 s.
- **States.**
  - Loading: nothing for the first 150 ms, then a spinner.
  - Read error: the message and Retry.
  - Too large: "This file is larger than 2 MB." with "Open in VS Code".
  - Deleted while open: a warning bar "This file was deleted." over the last content shown.

**Live reload.** When the open file changes on disk, re-read and re-render it, keeping the scroll position. If the view is not at the top, an "Updated" chip shows for 2 s.

**Remembered per task**, in renderer localStorage (as the PR choice is): the open file, the view mode, and the scroll position of the open file. Default file: `.miac/task.md` if it exists, else the root `README.md`, else the first file in the list.

## 2. Send to

- Selecting text inside the document (either view) shows a floating button at the end of the selection: **"Send to <terminal label>"**, plus a chevron that opens a menu of the task's terminals.
- **The default target** is the last terminal sent to for this task. The first time, it is the first `claude` or `copilot` terminal, else the first terminal. Terminals that have exited show disabled in the menu.
- **The quote:**
  ```
  docs/plan.md:40-52
  > first selected line
  > second selected line

  ```
  - The first line is the path, plus `:N` for one line or `:N-M` for a range. The text after it is the selection as plain text, each line prefixed with `> `. Then one empty line.
  - **Line numbers:** in Source view, the exact lines selected. In Rendered view, the source lines of the blocks the selection touches (paragraph, list item, table row, code block, heading), from the Markdown AST positions.
  - Longer than 4,000 characters: cut at 4,000 and end with `> …(truncated)`.
- **Sending** calls xterm's `Terminal.paste()` on the target. A program that has turned on bracketed paste (Claude Code, opencode, PSReadLine, zsh) receives it as one paste. No Enter is ever sent. Then the target tab becomes active and focused.
- Escape or a click elsewhere hides the button.

## 3. Terminal links

An xterm link provider (`registerLinkProvider`) on every task terminal.

**Recognized:**
- URLs: `http://` and `https://`, including `localhost` and ports. Trailing `.,;:)]` is not part of the link unless brackets balance.
- File paths with an extension, relative or absolute, optionally followed by `:line` or `:line:col`, or `(line,col)` as tsc prints it. Examples: `src/main/x.ts:12:5`, `./docs/plan.md`, `docs/plan.md:40`, `C:\work\repo\src\a.ts:3`, `src/a.ts(3,7)`.

**Validation.** A path becomes a link only when `docs:resolve` in main confirms it is an existing file inside the task's worktree. Relative paths resolve against the worktree root. Results are cached per terminal line text, so hovering does not call main repeatedly.

**Interaction.** Hover underlines the link and shows a tooltip ("Open in Docs", "Open in VS Code", "Open in browser"). A click opens it:
- `.md` file: switches to the Docs tab and opens the file. With a line, it opens in Source view at that line.
- other file: VS Code at the file and line (`code -g <file>:<line>[:<col>]`);
- URL: the browser.

## 4. Main process

New module `src/main/docs/`.

**Path rule** (`resolveInWorktree(worktree, rel)`), shared by every call below:
- reject empty, absolute (outside the worktree) and NUL-containing paths;
- `realpath` both the worktree and the target;
- the target must equal the worktree or start with it plus the separator, case-insensitive on Windows;
- the target must be a regular file.

Failure throws `Error('Outside the worktree')` or `Error('Not found')`.

**IPC**, all taking `taskId` and requiring a ready task with an existing worktree:

| Channel | Returns |
|---|---|
| `docs:list(taskId)` | `{ files: { path, changed: 'new' \| 'modified' \| null }[] }` from `git ls-files -co --exclude-standard -- '*.md' '*.markdown'`, plus `.miac/task.md` when it exists; at most 2,000 files. `changed` comes from `git diff --name-status <baseSha>` plus untracked. |
| `docs:read(taskId, path)` | `{ text, mtimeMs }`; refuses files over 2 MB with `Error('Too large')`. |
| `docs:asset(taskId, path)` | a data URL for png, jpg, jpeg, gif, webp, svg (as `image/svg+xml`, rendered only in `<img>`); refuses files over 10 MB. |
| `docs:resolve(taskId, path)` | `{ path, kind: 'md' \| 'file' } \| null`, with `path` relative to the worktree, `/` separators. |
| `docs:openInEditor(taskId, path, line?, col?)` | void; runs `Platform.editorGotoCommand(worktree, file, line, col)`, a new `Platform` method (`code -g`). |
| `docs:reveal(taskId, path)` | void; `shell.showItemInFolder`. |
| `docs:watch(taskId, on: boolean)` | `{ live: boolean }`; starts or stops the watcher for the task. `live: false` means no watcher could start, and the renderer polls the open file with `docs:read` every 2 s. |
| `links:open(url)` | void; only `http:` and `https:` URLs without username or password. `shell:openExternal` stays limited to Azure DevOps hosts. |

**Watcher.** One recursive `fs.watch` per task worktree, reference-counted by `docs:watch`, ignoring `node_modules/` and `.git/`. It sends `docs:changed { taskId, paths }` with relative `/` paths, debounced to 150 ms. It stops when the window closes, and Cancel setup and Finish stop it before they remove the worktree, because Windows will not delete a watched folder.

## 5. Renderer pieces

- `components/docs/DocsTab.tsx`: layout, list, command bar, states.
- `components/docs/MarkdownView.tsx`: `react-markdown` + `remark-gfm` + `rehype-sanitize` (GitHub schema, plus `data-line-start` and `data-line-end` on block elements and `class` on code) + `rehype-highlight` (the highlight.js common languages). A small rehype plugin copies `position.start.line` and `position.end.line` onto block elements.
- `components/docs/MermaidBlock.tsx`: `mermaid` imported with dynamic `import()` on first use, `securityLevel: 'strict'`, dark theme.
- `components/docs/SourceView.tsx`: line-numbered source.
- `components/docs/SendTo.tsx`: floating button and menu.
- `docs/quote.ts`: pure `buildQuote(path, startLine, endLine, text)`.
- `terminalLinks.ts`: pure `findLinks(lineText)` plus the xterm provider.
- Raw HTML in Markdown is not rendered (react-markdown default; no `rehype-raw`).

## 6. Telemetry

- `docs.opened` with `{ view: 'rendered' | 'source', from: 'list' | 'link' | 'terminal' }`.
- `docs.sentTo` with `{ kind }` (the terminal kind).
- `terminal.linkOpened` with `{ type: 'md' | 'file' | 'url' }`.
- No paths, file names or URLs. Update `docs/telemetry.md`.

## 7. Testing

**Unit (Vitest):**
- `resolveInWorktree`:
  - `..` escape, absolute paths outside the worktree, a symlink pointing outside, a symlink inside;
  - NUL, a missing file, a directory;
  - Windows case-insensitivity through the platform path module.
- `docs:list` against a real temp git repo: tracked, untracked, ignored, the `.miac/task.md` pin, the new and modified flags, the 2,000 cap.
- `findLinks`:
  - Claude Code output, `tsc` (`file(3,7)`), vitest stack lines, Windows drive paths, URLs with trailing punctuation and parentheses;
  - no false links on plain words with dots (`e.g.`, `v1.0.1`).
- `buildQuote`: one line, ranges, CRLF input, truncation.
- The line-position rehype plugin.
- `links:open` scheme rules.

**Component:**
- the Docs tab: empty, list and filter, badges, default file, Rendered and Source, a Mermaid error, too large, deleted, live reload keeping the scroll position, remembered state;
- Send to: button on selection, default target, remembered target, exited terminal disabled, `paste` called without Enter, tab switch;
- terminal link click routing: md to Docs at the line, file to the editor, URL to `links:open`;
- the Mod+Shift+D shortcut.

**Live:** launch the packaged app with Playwright `_electron`. Open a task, then screenshot:
- a fixture document rendered, with a table, a code block and a Mermaid diagram;
- Source view at a line;
- a Send to into a Claude terminal;
- a clicked `path:line` in a terminal.

## 8. Out of scope

Editing files, a general file browser for non-Markdown files, search across files, split view of document and terminal side by side, and remote images.
