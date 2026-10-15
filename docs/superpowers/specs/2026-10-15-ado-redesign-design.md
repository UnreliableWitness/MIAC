# Azure DevOps look, sprint home, full-page views (issues #9, #10, #11, #12, #15)

Date: 2026-10-15. Replaces the Culture/Instrument look from sub-project 6 (PR #8).

## Goal

A developer should feel they are still working in Azure DevOps (dark theme). The owner chose the full ADO look:
- ADO dark palette and blue accent
- Segoe UI
- Fluent icons
- ADO-style header, left nav, page headers, pivots and grids

The Mind dial app icon and a short splash stay. The Gemini art is removed from the screens.

| Issue | What it asks | Where it lands |
|---|---|---|
| #12 | Look like an extension of ADO, dark theme, reuse its icons | Visual language, shell |
| #11 | "Done" in the nav is oddly aligned | Left nav |
| #15 | Use the whole screen instead of popups | Full-page views |
| #9 | First screen is the current sprint in exact ADO order | Sprint home |
| #10 | The done page header is useless; show what was done and how | Done task page |

## 1. Visual language

**Tokens** (`src/renderer/styles/tokens.css`). Keep the variable names where they still fit, and rename the sci-fi ones.

| Token | Value | Use |
|---|---|---|
| `--bg-page` | `#201f1e` | content area |
| `--bg-chrome` | `#1b1a19` | header bar, left nav |
| `--bg-card` | `#252423` | panels, cards, grid header, dropdowns |
| `--bg-hover` | `rgba(255,255,255,0.04)` | row and item hover |
| `--bg-selected` | `rgba(255,255,255,0.08)` | selected row or nav item |
| `--line` | `rgba(255,255,255,0.08)` | separators |
| `--line-strong` | `rgba(255,255,255,0.16)` | field borders |
| `--text` | `rgba(255,255,255,0.9)` | primary text |
| `--muted` | `rgba(255,255,255,0.55)` | secondary text |
| `--disabled` | `rgba(255,255,255,0.38)` | disabled text |
| `--accent` | `#0078d4` | primary buttons, selected pivot underline, focus ring |
| `--accent-hover` | `#106ebe` | primary button hover |
| `--link` | `#5ca9f2` | links |
| `--green` | `#6ccb5f` | success |
| `--red` | `#f1707b` | error |
| `--warn` | `#f7b955` | warning |

Status backgrounds use the same hue at about 12% alpha.

**Type**
- UI font: `"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", sans-serif`. Body 14px, small 12px, page title 20px semibold, section title 16px semibold.
- Code font: `"Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, monospace`.
- The terminal keeps the bundled JetBrains Mono.
- Remove the bundled IBM Plex Sans.

**Shape:** radius 2px for buttons and fields, 4px for cards. No glows, no tick rules, no brackets.

**Icons**
- **Work item type icons:** fetched from ADO itself, the real icons. The `workitemtypes` API returns `color` and `icon.url` per type. The main process downloads each icon SVG with the PAT, caches it per connection, and sends it to the renderer as a data URL.
- **Fallback when icons can't be fetched:** a colored 3px left bar or square in the type color. Fallback colors: Bug `#CC293D`, Task `#F2CB1D`, User Story or Product Backlog Item `#009CCC`, Feature `#773B93`, Epic `#FF7B00`, Issue `#B4009E`, other `#888`.
- **State colors:** fetched from the `workitemtypes/{type}/states` API and drawn as a dot before the state name, as in ADO. Fallback: New `#b2b2b2`; Active, In Progress, Committed `#007acc`; Resolved `#ff9d00`; Done, Closed `#339933`; Removed `#ffffff`.
- **UI icons:** `@fluentui/react-icons` (MIT), 16 or 20 px regular style. This is the icon family ADO's new UI uses. Import per icon so the bundle tree-shakes.

**Components**
- **Buttons:** primary is blue with white text. Default is `--bg-card` with a `--line-strong` border. Subtle buttons have no border and only a hover background.
- **Pivot tabs:** text with a 2px blue underline on the selected tab.
- **Grids:** 36px rows with hover and selected backgrounds, and a header row with muted column titles.
- **Fields:** 32px high with a `--line-strong` border and a blue border on focus.
- **Focus ring:** 1px `--accent` outline everywhere.

## 2. Shell

**Header bar:** 40px, `--bg-chrome`.
- Left: the Mind dial mark (16px), then the breadcrumb `MIAC › <project> › <page>`, for example `MIAC › DXP › Sprint 8`, `MIAC › DXP › Task 8125 PDP dynamic redirect logic` or `MIAC › Settings`. Each crumb is a link.
- Right: a primary "New task" button (`Add` icon) and a settings icon button.
- Window controls: as today, no custom title bar.

**Left nav:** 240px, `--bg-chrome`. It collapses to a 48px icon rail; the choice persists as today.
- Top: a project tile with a square avatar holding the project's initial, then the project name. With more than one connection, it opens a project switcher.
- Hub item "Sprint" (icon `ArrowSprint`, or `Board` if missing): the home page.
- Section header "Tasks". Under it, one subheader per repo (muted, 12px) and task rows. Each row: type icon, id, title (ellipsis), and cost (muted, right-aligned). A status dot appears only when the task is not ready: setting up, failed or missing.
- "Done (n)" is a collapsible section header, left-aligned like the other section headers, with a chevron (#11).
- Bottom: a "Settings" item (`Settings` icon), the connection status line (dot plus `org: project`, with ellipsis), and the collapse chevron.
- In the rail: hub and settings icons, and the task rows as type icons with a tooltip.

**Focus mode:** keeps its current behavior. It hides the header and nav for a ready task.

## 3. Screens: full pages, no overlays (#15)

The `Screen` union becomes `sprint | task | new-task | setup | finish | settings`. Every screen renders in the content area next to the nav. Nothing renders as an overlay any more; delete `.overlay` and `.dialog`. Each page has a page header: title (20px semibold), optional pivots, and a command bar row.

- **Sprint (home, #9).** See section 4.
- **Task (ready).**
  - The task's identity lives in the breadcrumb.
  - One 36px row under the header. Left: pivots, one per terminal plus "Usage". Right: branch and git state (mono, muted), cost, then "Open in VS Code" (subtle) and "Finish" (default button).
  - Keep the tab actions that exist today, such as add terminal and close.
  - The terminal area fills the rest. Chrome total is 76px.
- **New task.**
  - A full page with the title "New task" and pivots "Work item | Typed | Blank".
  - Left, flexible: for "Work item", an ADO-style grid with columns type icon, ID, Title, State (dot plus name) and Assigned to. Search field and scope pivots ("Current sprint | Assigned to me") sit above it. The grid fills the height and scrolls.
  - Right, a fixed 380px details panel: the repo, branch and setup options of today, with Create and Cancel at the bottom.
  - Cancel and Escape return to the previous page.
  - Opening New task from a sprint row preselects that work item.
- **Setup and Settings:** same content as today, laid out as pages with page headers.
- **Finish:** the content of today's dialog as a page with header "Finish task", for the task in the breadcrumb.

## 4. Sprint home (#9)

**Data**
- `currentIteration` also returns the iteration `id`.
- New `AdoClient.iterationWorkItems(project, iterationId)` calls `GET {project}/_apis/work/teamsettings/iterations/{id}/workitems?api-version=7.1`, for the project's default team. It returns `workItemRelations` in sprint backlog order:
  - an entry with `source: null` is a top-level item;
  - an entry with `rel: System.LinkTypes.Hierarchy-Forward` is a child of its `source`.
- The client batch-fetches the fields already listed in `FIELDS`, plus `Microsoft.VSTS.Scheduling.RemainingWork`, in chunks of 200.
- A pure function `buildSprintTree(relations, items)` keeps the API order exactly. Children follow their parent in API order. A child whose parent is outside the iteration shows at top level, in place.
- IPC: `workItems:sprint(connectionId)` returns `{ iteration: {id, name, path, startDate, finishDate} | null, rows: SprintRow[] }`.
- IPC: `workItems:types(connectionId)` returns type colors and icon data URLs plus state colors. It is cached in main for the session.

**UI**
- Page header: title is the sprint name, with the dates muted next to it ("15 Oct – 28 Oct"). Command bar: Refresh, and "Collapse all" / "Expand all".
- Grid columns: expand chevron, Title (type icon, id, title), State, Assigned to, Remaining work, MIAC. Indentation: 24px per level.
- **Rows done in ADO** (state category Completed or Removed, or the fallback state names) show as in ADO, with no extra dimming.
- **Rows with a MIAC task** (any task whose work item id matches): the MIAC column shows the task status. Clicking the row opens the task, or the Done page for a done task.
- **Rows without a MIAC task:** the MIAC column shows a "Start" subtle button on hover and focus. It opens New task with the item preselected, using the first repo linked to that connection.
- **Empty states:**
  - no connection: "Connect Azure DevOps in Settings", with a button;
  - no current sprint: "This project has no current sprint", plus an "Assigned to me" list using the existing search;
  - the request failed: an error message and Retry.
- Refresh runs on page open, on window focus (at most once per 60 s), and on the Refresh button.

**Startup:** the app opens on Sprint, and no task is auto-selected (the current `setTasks` auto-select goes). After a task is created, the app still goes to its setup page.

## 5. Done task page (#10)

**Capture at finish time.** In main, before the worktree is removed, `GitClient` records `summary` on the task:
- `commits`: `{ sha, subject }[]`, at most 50 in order, plus `commitCount`, from `git log --format=%h%x09%s <merge-base(baseRef, HEAD)>..HEAD`;
- `filesChanged`, `insertions`, `deletions`, from `git diff --shortstat <merge-base>..HEAD`;
- `pushed: boolean` and `upstream: string | null`.

`TaskSchema` gains `summary` (nullable, default null), so old state files still load.

**Page**
- Page header: type icon, then "<Type> <id>" as a link that opens ADO, then the title, then the live state from ADO (fetched on open; hidden if it fails).
- A row of facts:
  - Duration: from `createdAt` to `finishedAt`, as "2 d 3 h" or "45 min".
  - Finished: a local date and time, for example "15 Oct 2026, 12:01" (no ISO strings anywhere in the UI).
  - Branch: name, pushed or local.
  - Changes: "12 files, +340 −95".
  - AI cost: EUR, with the Claude and Copilot split.
  - Logged on work item: yes, when; or no.
- A "Commits" list: short sha (mono) and subject.
- The existing Usage panel below.
- Tasks with no `summary` show "Finished before MIAC recorded summaries." instead of the commit and change facts.

## 6. Splash

- An ADO-style splash: `--bg-chrome` background, the Mind dial icon at 64px centered, "MIAC" in Segoe UI semibold 20px, and under it a thin 2px blue indeterminate progress bar plus the current real boot step in muted 12px text.
- Fade out 200 ms. No nebula, no count-in.
- The `showSplash` setting stays.

## 7. Removed

- The Gemini art from screens and the package: `ArtSlot`, `src/renderer/art.ts`, `src/splash/art.ts`, art in empty states, the done banner, the About panel and the splash. `assets/art/*` and `assets/ART.md` stay in git. ART.md gets a note: "Retired from the UI on 2026-10-15 (#12)".
- The instrument components that end up unused (`Bracketed`, `TickRule`, `Label`, `RingGauge`, `IconButton` if replaced).
- `MindMark` stays as the header logo.
- The IBM Plex font files.

## 8. Testing

**Unit tests (Vitest):**
- `buildSprintTree` covers order kept, nesting, orphan children, empty sprint and duplicate relations.
- `AdoClient.iterationWorkItems`, the type and state metadata calls, and icon fetching, with fakes.
- Summary capture with a real temp git repo, as the GitClient tests do.
- Schema default for `summary`.
- Duration and date formatting.

**Component tests:**
- the sprint page states;
- Start from a row preselects the item in New task;
- startup lands on Sprint;
- New task and Finish render without an overlay;
- the done page with and without a summary;
- the nav Done header.

**Checks:** `npm test`, `npm run typecheck` and `npm run lint` pass.

**Visual check:** launch the app (`npm start`) and screenshot the sprint page, the task page, New task, the done page and settings at 1920×1080 and 1280×800. If `screencapture` is denied, use Playwright's `_electron`.
