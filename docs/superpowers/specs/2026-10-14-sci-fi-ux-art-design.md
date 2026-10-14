# MIAC sub-project 6: sci-fi UX, splash, icon and art

Date: 2026-10-14
Status: design approved in conversation, awaiting written review
Builds on: sub-projects 1-5 (merged, PR #1-#5)

## Context

MIAC works, but it looks like the first mockups: a plain dark UI with an amber accent, no icon, no splash, and fonts that are named in CSS but not shipped. This slice gives it a polished sci-fi identity that fits its name (a Culture ship): the "Instrument" style. It also reclaims screen height for the terminals, moves AI usage into a per-task tab, and adds an animated splash, an app icon and Gemini illustrations.

Decisions made in the brainstorm (visual companion mockups in `.superpowers/brainstorm/`, not committed):
- Direction: Culture / ship-Mind, amber stays the only accent.
- Icon: concept C, "the Mind, keeping count": a glowing core inside a dial of ticks with one lit quadrant. Hand-built SVG.
- App chrome: style C, "Instrument" (tick rulers, corner brackets, mono uppercase labels, ring gauges), in a compact, terminal-first layout with a Focus mode.
- Usage: a pinned Usage tab per task, replacing the separate usage screen.
- Splash: option B, "Counted in from the dark".
- Art: Gemini images for the splash backdrop, three empty states and an About / ship's registry panel.

## Scope

In:
- New design tokens and bundled fonts.
- Shared Instrument components.
- Compact workspace: a merged task strip, dense collapsible nav, a 26 px tab row, Focus mode.
- A Usage tab with a usage panel (adds a token mix and a 6-hour timeline), replacing `UsageScreen`.
- Restyle of New task, Setup, Finish and Settings in the new system (layouts unchanged).
- A matching xterm theme.
- A splash window with real boot steps.
- An app icon: master SVG and generated `.icns`, `.ico` and PNGs, wired into packaging and the window.
- Gemini art: prompts, candidates, owner picks, `assets/ART.md`, wired into splash, empty states and About.
- A "Show splash on start" setting.

Out:
- New features beyond the Usage tab's two new views.
- Light theme.
- Animated icons.
- Sound.
- A redesign of the invoicing view (none exists in the app yet).
- macOS signing.
- Renaming or restructuring screens other than removing the `usage` route.

## 1. Design system

### Tokens (`src/renderer/styles/tokens.css`, rewritten)

| Token | Value | Use |
|---|---|---|
| `--void` | `#07080c` | terminal and usage pane ground |
| `--ground` | `#090b10` | app ground |
| `--panel` | `#0c0e14` | nav, rails |
| `--panel-raised` | `#0d1016` | task strip, inputs |
| `--panel-2` | `#0b0d13` | tab row, boxes |
| `--line` | `#1d2230` | hairlines |
| `--line-strong` | `#232a3a` | control borders |
| `--tick` | `#39405a` | tick rulers, inactive brackets |
| `--text` | `#e7e6e2` | body |
| `--text-bright` | `#f3ead8` | titles, selected |
| `--muted` | `#7d8598` | secondary |
| `--faint` | `#6c7488` | labels |
| `--accent` | `#f0a443` | the one accent |
| `--accent-ink` | `#1a1408` | text on accent |
| `--cream` | `#f6e7c8` | Mind core, highlights |
| `--green`, `--blue`, `--red`, `--warn` | current hues, `-bg` / `-border` variants darkened for the new ground | status |

Existing token names that components use (`--border`, `--panel`, ...) are renamed in the same change; there are no aliases. Contrast: body text and `--muted` on `--ground` meet WCAG AA (4.5:1). `--faint` is used only for uppercase labels of 10 px or larger, beside a value that carries the meaning.

Shape: `--radius: 4px`, `--radius-sm: 3px`; pills (`999px`) only for gauges and toggles. Selection is shown with amber corner brackets, not a fill.

Motion: `--ease: cubic-bezier(.2,.7,.2,1)`, 120-180 ms for state changes. Glow pulses only for live things (a live session, new usage). A global `@media (prefers-reduced-motion: reduce)` block turns off animations and transitions.

### Fonts

IBM Plex Sans (400, 500, 600) and JetBrains Mono (400, 600) are bundled via `@fontsource/ibm-plex-sans` and `@fontsource/jetbrains-mono` (OFL), imported in `renderer.tsx` and in the splash entry. xterm uses JetBrains Mono. There are no network font requests.

### Instrument components (`src/renderer/components/instrument/`)

- `MindMark({ size })`: the brand mark as inline SVG, using the same geometry as the icon.
- `RingGauge({ value, max?, size, segments? })`: a ring with an optional tick ring, used in the strip, the nav rail and the usage panel. Without `max`, the ring shows the share of the task's cost over a fixed reference scale (€50 = full), so it reads as an ambient "how expensive is this task" cue. The exact amount is always printed next to it.
- `Bracketed({ active, children })`: a frame with amber corner brackets when `active`, `--tick` brackets otherwise.
- `TickRule()`: a 1 px repeating tick hairline.
- `Label({ children })`: mono, uppercase, 9.5-10 px, `.14em` tracking, with an amber `◦` marker.
- `IconButton({ label, shortcut?, tone?, onClick })`: a 24×22 px button. `label` is used as `aria-label` and in the tooltip; the tooltip also shows `shortcut`.

### xterm theme

`TerminalView` uses `background: --void`, `foreground: --text`, an amber cursor and `selectionBackground: rgba(240,164,67,.25)`. The ANSI palette is tuned so green, yellow, blue and red match the status tokens; bright black is `--muted`.

## 2. Workspace

### Task strip (32 px), replacing `TopBar` and `TaskHeader`

`TaskStrip` shows, left to right:
- `MindMark` and the `MIAC` wordmark
- `/`
- the work item id (amber mono) and title (ellipsis), or the task name for blank tasks
- the branch and git state in mono (`⎇ branch ↑2 · 3Δ`)
- the cost `RingGauge` pill (click: opens the Usage tab)
- `IconButton`s: Open in VS Code, Finish task, New task, Settings (there is no task search today, so no search button)

A `TickRule` runs along the bottom edge.

Hovering or focusing the title opens a hover card with everything the old header showed: type, state, sprint, "Open in Azure DevOps", worktree path, PR status where present, and "Logged on work item N min ago". The card is reachable by keyboard (focus the title, Esc closes it).

Screens without a task (Settings, New task, Setup, Finish) use the same strip with a breadcrumb instead of the task fields and a back action. `TopBar` is removed.

### Nav (`TaskNav`)

Repo groups use `Label`. Each task is one 26 px row: a status dot, the id (amber when selected), the title (ellipsis), the cost (mono). The selected row is `Bracketed`. The width is 168 px. A `«` control in the footer, next to the ADO connection status, collapses the nav to a 40 px rail. The rail shows one `RingGauge` per task (tooltip: id and title), with brackets on the selected one; `»` expands it.

### Tab row (`TerminalTabs`, 26 px)

- **The pinned `◔ Usage` tab comes first**, then the terminal tabs, then `＋`.
- **On the right:** the run chips (`RUN dev test lint`) and the Focus toggle.
- **Keyboard:** `Ctrl+0` selects Usage and `Ctrl+1..9` select the terminals (on macOS `Cmd`, through the existing key handling pattern).
- **New-usage dot:** when a usage update arrives for the visible task while another tab is selected, the Usage tab shows a pulsing amber dot until it is selected.

### Focus mode

`Ctrl+Shift+F` (`Cmd+Shift+F` on macOS), the toggle, or a double-click on the empty part of the tab row switches Focus on and off. In Focus, the strip and the nav are hidden. The tab row then starts with `MindMark` and the task id, and carries the cost pill and an exit toggle on the right. If the nav was collapsed to the rail before Focus, the rail stays; otherwise nothing shows on the left.

### Persistence

The nav collapsed state and Focus are UI preferences, stored in renderer `localStorage` (`miac.ui.navCollapsed`, `miac.ui.focus`) through a small `uiPrefs` module with a tested read/write and a fallback to defaults on bad values.

## 3. Usage tab

`UsagePanel({ taskId })` replaces `UsageScreen` and is rendered in the terminal area when the Usage tab is selected. Terminals stay mounted (hidden), as they are today.

It is a two-column layout (220 px instrument column, flexible right column), stacking below 900 px wide. Each section is a `Bracketed` box with a `Label`.

Left column:
- **Billable:** a large `RingGauge` split by tool (Claude amber, Copilot blue) with the total in the centre, total tokens below, and the per-tool amounts underneath. The label shows the customer when one is known, otherwise just "Billable".
- **Tokens:** four bars (cache read, input, cache write, output), each scaled to the largest of the four, with compact values.
- A caption: "Official list prices · USD→EUR 0.92".

Right column:
- **Last 6 hours:** cost per 15-minute bin, coloured by the dominant tool. The current bin pulses while a session is live. Empty when no usage falls in the window.
- **Sessions:** the existing table (started, tool, model, tokens, EUR, billable toggle), dense. A live session (last event within 5 minutes) is marked `LIVE`. Rows excluded from billing are muted, with the amount struck through.
- **Work item:** write-back status and the field values, plus `CSV` and `Write to work item` buttons (the existing `usage:exportCsv` and `usage:sync`).
- The existing unpriced-requests warning and the "no usage yet" empty state, restyled.

Data: everything comes from what `useTaskUsage` already returns, plus the stored events. Two pure functions are added in `src/shared/usageViews.ts`:
- `tokenMix(summary) -> { cacheRead, input, cacheWrite, output }`
- `timeline(recent, now, { hours: 6, binMinutes: 15 }) -> Bin[]`

`TaskUsage` today carries per-session totals only, not per-event timestamps. So `TaskUsage` gains `recent: RecentPoint[]`: one `{ at, tool, costEur }` per billable, priced record from the last 6 hours, built in the main process by the code that answers `usage:task`. It contains billable records only, so toggling a session off removes its points. No capture or storage change.

Routing: the `usage` screen kind is removed. Anything that navigated to it (the cost card, "View AI usage" on done tasks) now selects the task and its Usage tab. Done tasks render `UsagePanel` in place of terminals, under a done banner.

## 4. Other screens

New task, Setup, Finish and Settings keep their layouts and copy, and adopt the tokens, `Label`, `Bracketed`, `IconButton` and the task strip breadcrumb.
- **Setup:** `StepList` becomes a vertical ticked progress rule: done steps are amber ticks, the running step pulses, a failed step is red. The log pane uses the `--void` ground.
- **Settings** gains:
  - an "Appearance" row with **Show splash on start** (on by default);
  - an **About** section: the ship's registry illustration, `MIAC`, "Me, I'm Counting", the version, and the line "General Systems Vehicle (accounting division)".

## 5. Splash

### Window

A second renderer entry, `splash.html` plus `src/splash/splash.ts` (plain TS and CSS, no React), is added to the Vite plugin's `renderer` list in `forge.config.mts`, with its own preload `src/splash/preload.ts` that exposes only `onStep`, `onFail`, `onDone`, `skip` and `quit`.
- `BrowserWindow` options: 640×400, `frame: false`, `resizable: false`, `center: true`, `backgroundColor: '#050609'`, `show: false` until `ready-to-show`, `alwaysOnTop: false`, `skipTaskbar: false` on Windows so a slow start is visible.

### Animation B: "Counted in from the dark", 2.2 s

1. 0-0.1 s: the starfield and the Gemini nebula backdrop fade in. The backdrop is shown at reduced opacity under a radial vignette, so the dial stays the brightest thing.
2. 0.1-1.2 s: an amber scan line passes top to bottom.
3. 0.3-1.45 s: a mono counter in the centre of the dial counts 0000 → 1440 (ease-out cubic). The tick ring and the lit quadrant arc draw on.
4. 1.5 s: the counter fades out, and the core ignites with a bloom.
5. 1.6-1.9 s: `M I A C` resolves letter by letter (blur to sharp).
6. 2.1 s: "ME, I'M COUNTING" fades in.
7. Hold: the core breathes (2.4 s cycle) until done.

A tick rule grows along the bottom over 2.2 s. Below it, the status line shows the current step on the left and the version on the right.

`prefers-reduced-motion`: the final frame is shown at once, with no scan, counter or breathing.

### Boot reporting

A `SplashReporter` in `src/main/splash.ts` wraps the window:
- `step(label)`
- `fail(message)`
- `done(): Promise<void>`: resolves when the minimum animation time (2.2 s from show) has passed, or immediately after a skip.
- `close()`

`boot()` is reordered so that the settings load first; then the splash shows (when `showSplash` is true), and these steps are reported:
1. "Loading tasks"
2. "Starting usage receiver 127.0.0.1:<port>"
3. "Checking Azure DevOps · N connection(s)"
4. "Ready"

"Checking Azure DevOps" only reports the count of loaded connections; it does not make network calls, so startup never waits on the network.

### Handoff

The main window is created with `show: false`. When both its `ready-to-show` has fired and `reporter.done()` has resolved, the splash fades its content out over 200 ms. Then the main window shows (with `win.setOpacity` from 0 to 1 over 200 ms on platforms that support it, otherwise a plain `show()`), and the splash closes. Any key or click on the splash skips the rest of the animation to the hold frame. The handoff still waits for the main window to be ready.

### Failure

If `boot()` throws, `reporter.fail(message)` shows the message in red in the status line with a `Quit` button, and the app does not quit silently. This replaces the current `console.error` + `app.quit()` for boot failures.

### Off switches

- `showSplash: false` creates no splash window, and the main window shows on `ready-to-show`.
- `MIAC_SMOKE=1` never creates a splash.
- The second-instance handler focuses the main window, or the splash while booting.

`AppSettingsSchema` gains `showSplash: z.boolean().default(true)`. `version` stays `1`; existing files parse with the default.

## 6. Icon

- **Master:** `assets/icon/miac.svg` (512 px viewBox). A space-black rounded-square ground with a soft radial gradient, a tick dial (24 bolder ticks), one amber lit quadrant arc, and the cream core with an amber bloom.
- **Small variant:** `assets/icon/miac-small.svg` for 16 px and 32 px. No tick dial, a thicker arc, a bigger core, so it reads on the Windows taskbar and in tabs.
- **Build:** `tools/art/build-icons.mjs` renders both SVGs with `@resvg/resvg-js` (dev dependency) to `assets/icon/png/{16,24,32,48,64,128,256,512,1024}.png`, using the small variant up to 32 px. Then it:
  - writes `assets/icon/miac.ico` (16, 24, 32, 48, 64, 128, 256) with a small pure-Node ICO writer (PNG-encoded entries);
  - writes `assets/icon/miac.icns` with `iconutil` on macOS (it fails with a clear message elsewhere).

  The outputs are committed, so CI and Windows builds need no `iconutil`. `npm run icons` runs it.
- **Wiring:**
  - `packagerConfig.icon: 'assets/icon/miac'`. Packager picks `.icns` or `.ico` per platform.
  - `MakerSquirrel` `setupIcon: 'assets/icon/miac.ico'`.
  - `BrowserWindow` `icon` on Windows and Linux, from `png/256.png`.
  - In dev on macOS, `app.dock.setIcon(png/512.png)`.
  - `packageFilter` keeps `assets/icon/png/256.png` and the art images in the package.
- **Also used for:** the favicon of `index.html` and `splash.html`.

## 7. Art (Gemini)

`tools/art/prompts.md` is rewritten for the Instrument / Culture style. The style block names colours in words, not hex (the Adem lesson). The old four icon prompts are removed, since the icon is SVG now. Images:

| Name | Ratio | Use |
|---|---|---|
| `splash-nebula.png` | Landscape | Splash backdrop: deep space, faint amber and indigo nebula, a tiny distant elongated Culture GSV silhouette off-centre, the centre kept dark and empty for the dial |
| `empty-no-tasks.png` | Landscape | Nav and main empty state when there are no tasks: a quiet hangar bay opening onto stars |
| `empty-no-selection.png` | Landscape | Main empty state with tasks but none selected: a distant Orbital ring arc against the dark |
| `empty-done.png` | Landscape | A done task's banner: a small ship drifting away into a soft amber dawn |
| `about-registry.png` | Portrait | About panel: a ship-Mind core in a cradle of fine rings, like a registry plate |

Flow (as in `tools/art/README.md`): `node tools/art/generate.mjs generate` makes candidates in `tools/art/incoming/`. The owner picks one per name, possibly after prompt edits and re-runs. Picks are post-processed with `sips`:
- resize to at most 1600 px on the long side;
- convert to WebP via `cwebp` if present, else keep PNG;
- keep each file under 400 KB.

They are copied to `assets/art/` and logged in `assets/ART.md` (date, model, prompt, chosen candidate and why, post-processing).

Display rules:
- Art is always under text, never behind a terminal.
- Art is shown at 35-60% opacity under a vignette or mask fading into `--ground`.
- Images are decorative: `alt=""`, `aria-hidden`.

Until the picks exist, each slot renders a CSS starfield and gradient placeholder, so the code can merge before the art.

## Error handling

- **Missing art file:** the placeholder is used (`onError` swaps to it). There is no broken-image icon.
- **Corrupt `localStorage` prefs:** defaults are used.
- **Splash window fails to load:** the reporter calls go to a destroyed window and are ignored, and the main window still shows on its own `ready-to-show`. This is guarded: every reporter call checks `isDestroyed()`.
- **Boot failure:** described in §5, "Failure".

## Testing

Vitest:
- `usageViews`: `timeline` (bins, the 6 h window edge, empty input, billable-only), `tokenMix`.
- `uiPrefs`: defaults, round-trip, bad values.
- `SplashReporter`, with fake timers and a stub window:
  - `done()` waits for the 2.2 s minimum;
  - a skip resolves early;
  - `fail` shows the message;
  - calls after destroy are no-ops;
  - `showSplash: false` creates nothing.
- The settings schema: an old file without `showSplash` parses to `true`.
- `TaskStrip`: fields, the hover card (keyboard open and Esc), the gauge click selecting Usage.
- `TaskNav`: collapse to the rail and back, persisted.
- `TerminalTabs`: Usage pinned first, `Ctrl+0` / `Ctrl+N`, the new-usage dot appears and clears.
- Focus mode: toggle by shortcut and by double-click, persisted.
- `UsagePanel`: the existing `UsageScreen` tests ported (sync, CSV, billable toggle, unpriced warning, empty state), plus the ring split and the `LIVE` marker.
- Existing screen tests updated for `TopBar` → `TaskStrip` and the removed `usage` route.
- `build-icons`: the ICO writer produces a valid header and directory for given PNG buffers (unit test on the pure writer).

Manual, on macOS with `npm start`:
- the splash plays B, with real steps, a skip and the handoff;
- reduced motion;
- Focus and the rail;
- the Usage tab live while Claude Code runs;
- the icon in the Dock, and in the packaged `.app` from `npm run make`.

On Windows: CI builds `MIAC-Setup.exe` with the icon. `docs/windows-checklist.md` gains lines for the splash, the taskbar icon at 100% and 150% scaling, and the installer icon.

Checks: `npm test`, `npm run typecheck`, `npm run lint` pass on macOS and in CI.
