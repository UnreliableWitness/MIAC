# Light theme

Date: 2026-10-20
Status: design approved in chat, spec under review

## Goal

Shellie gets a light Azure DevOps look next to the existing dark one (spec 2026-10-15). The developer picks **System / Light / Dark** in Settings → Appearance. System follows the macOS / Windows appearance and switches live when the OS switches. Every surface follows the theme: app chrome and screens, terminal panes, the Monaco diff view, Docs (including Mermaid), the splash, and the Windows title-bar buttons.

Owner decisions (2026-10-20):
- Switching: System + override, default `system`.
- Terminal follows the theme (no separate terminal setting).
- Approach A: the OS appearance (`nativeTheme.themeSource`) is the single source of truth.

Out of scope: per-theme app icon, user-defined colours, high-contrast themes, a separate terminal theme setting.

## Architecture

One piece of state: Electron's `nativeTheme.themeSource`.

```
Settings.theme ('system'|'light'|'dark')
   └─ main: nativeTheme.themeSource = theme   (at boot, before any window, and on save)
        ├─ renderer CSS: @media (prefers-color-scheme: light)  → token overrides
        ├─ renderer JS: useColorScheme() via matchMedia         → xterm / Monaco / Mermaid
        └─ main: nativeTheme.on('updated')                      → title-bar overlay, window background
```

Because Chromium derives `prefers-color-scheme` from `themeSource`, CSS and native controls (scrollbars, form controls, context menus) switch with no extra wiring, including live OS switches in System mode.

## Components

### 1. Setting (`src/shared/usage.ts`, `SettingsStore`)
- `AppSettingsSchema` gains `theme: z.enum(['system', 'light', 'dark']).default('system')`. Existing `settings.json` files parse unchanged (default fills it in).
- Main applies `nativeTheme.themeSource = settings.get().theme` after `settings.load()` and before the splash and main windows are created, and again whenever settings are saved with a changed `theme`.

### 2. Settings UI (`SettingsScreen.tsx`, Appearance section)
- A "Theme" row with a three-option segmented control (System / Light / Dark), saved through the existing `saveSettings` patch path. The change applies immediately; no restart.

### 3. CSS tokens (`src/renderer/styles/tokens.css`)
- `:root` keeps the dark values and drops the hard-coded `color-scheme: dark` in favour of `color-scheme: light dark`.
- A `@media (prefers-color-scheme: light) { :root { … } }` block overrides every colour token. Light Azure DevOps palette:
  - `--bg-page #faf9f8`, `--bg-chrome #f3f2f1`, `--bg-card #ffffff`
  - `--bg-hover rgba(0,0,0,0.04)`, `--bg-selected rgba(0,0,0,0.06)`
  - `--line rgba(0,0,0,0.08)`, `--line-strong rgba(0,0,0,0.16)`
  - `--text rgba(0,0,0,0.9)`, `--muted rgba(0,0,0,0.55)`, `--disabled rgba(0,0,0,0.38)`
  - `--accent #0078d4` (unchanged), `--accent-hover #106ebe`, `--accent-bg rgba(0,120,212,0.08)`, `--link #0078d4`
  - status colours darkened for contrast on white: `--green #107c10`, `--red #a4262c`, `--amber #8a6100`, `--warn #8a5300`, with matching `*-bg` tints
  - chart and repo colours: darker variants of the same hues so bars and labels stay distinguishable on white (exact values chosen during implementation, checked by the contrast test, see Testing).
- New tokens replace the literal colours left in stylesheets: `--focus-ring` (was `rgba(255,255,255,0.3)` in `app.css`), `--shadow-1` (card shadow in `app.css`, `screens.css`), `--shadow-2` (popup shadow in `app.css`, `shell.css`). Light values use lighter shadows (ADO light depth).
- Remaining literal colours in `docs.css`, `home.css`, `usage.css`, `review.css`, `TaskNav.tsx` move to existing or new tokens. After the change, `git grep` for hex / `rgba(` in `src/renderer/styles` outside `tokens.css` finds only colour-neutral values (e.g. `transparent`) or documented exceptions.

### 4. Palettes in code (`src/renderer/themes.ts`, new)
- `type ColorScheme = 'light' | 'dark'`.
- Exports per scheme: the xterm `ITheme` (dark = current `TERMINAL_THEME`; light = VS Code Light Modern ANSI with `--bg-page` background), the Monaco theme names, and the Mermaid theme name (`dark` / `default`).
- `terminalTheme.ts` becomes the home of both xterm palettes (or folds into `themes.ts`), keeping its comment that xterm needs literal values matched to `tokens.css`.

### 5. `useColorScheme()` hook (`src/renderer/useColorScheme.ts`, new)
- Returns the current `ColorScheme` from `matchMedia('(prefers-color-scheme: light)')` and re-renders on its `change` event. A plain `currentColorScheme()` getter and a `onColorSchemeChange(cb)` subscription are exported for non-React code (terminal setup, Monaco).

### 6. Terminal (`terminalSetup.ts`)
- New terminals start with the current scheme's theme; existing terminals update `term.options.theme` on a scheme change. The WebGL renderer picks up the new theme without recreating the terminal.

### 7. Monaco (`monacoSetup.ts`, `DiffView.tsx`)
- Define `shellie-light` (base `vs`) next to `shellie-dark`, with light background, gutter, line numbers and diff tints (green/red at the light token values with low alpha).
- `DiffView` passes the theme for the current scheme; a scheme change calls `monaco.editor.setTheme` (global in Monaco, so one call covers all editors).

### 8. Mermaid (`MermaidBlock.tsx`)
- Mermaid's theme is global to `initialize`; the block reads `useColorScheme()`, re-initializes Mermaid with `dark` / `default` when the scheme changes, and re-renders (the scheme joins the render effect's dependencies).

### 9. Work item state colours (`StateDot.tsx`)
- ADO's own state colours stay as they are (they're ADO's, and the project's fetched colours are used anyway). The `removed: '#ffffff'` fallback would vanish on white: it becomes the `--muted` colour. The dot gets a thin `--line-strong` outline so pale colours stay visible in both themes.

### 10. Main window and title bar (`windowChrome.ts`, `main.ts`)
- `windowChrome.ts` exports `chromeColors(scheme)` returning `{ background, symbol }` for both schemes (dark = current values; light = `#f3f2f1` / `rgba(0,0,0,0.9)` as an opaque hex), and `titleBarOptions(platform, scheme)` uses them.
- The `BrowserWindow` `backgroundColor` uses the scheme's `--bg-page` so no dark flash appears in light mode.
- On `nativeTheme.on('updated')`, main calls `win.setTitleBarOverlay(...)` (Windows overlay only) and `win.setBackgroundColor(...)`.
- Scheme in main = `nativeTheme.shouldUseDarkColors ? 'dark' : 'light'`.

### 11. Splash (`splash.css`, `splash.ts`)
- `splash.css` gets the same light/dark split via `prefers-color-scheme` (its own small set of variables, since it doesn't load `tokens.css`). `splash.ts` picks `backgroundColor` from `chromeColors(scheme)`. Works because `themeSource` is set before the splash opens.

## Error handling

- An unknown `theme` value in `settings.json` fails schema validation the same way other bad settings do today; the zod default covers a missing field.
- If `setTitleBarOverlay` throws (window not using an overlay), it's skipped: only called when `titleBarKind(platform) === 'overlay'`.

## Testing

Unit (Vitest):
- Settings schema: missing `theme` → `system`; each valid value round-trips; an invalid value is rejected.
- `windowChrome`: `titleBarOptions` / `chromeColors` for both schemes and all three platform kinds.
- `themes.ts`: both xterm palettes define every `ITheme` key the dark one does.
- `useColorScheme`: reacts to a mocked `matchMedia` change.
- Contrast check (new test): parses `tokens.css`, resolves the light and dark token sets, and asserts WCAG ≥ 4.5:1 for `--text`, `--muted`, `--link`, `--green`, `--red`, `--amber`, `--warn` on `--bg-page` and `--bg-card`, and ≥ 3:1 for chart/repo colours on `--bg-card`. Translucent colours are composited onto the background before measuring.
- Literal-colour guard: a test that fails when a stylesheet outside `tokens.css` / `splash.css` contains a hex or `rgb(a)` literal not on an allowlist.

Functional check of the packaged app (Playwright `_electron`, user's data set aside):
1. Settings → Theme = Light: computed `background-color` of `body`, a card and the header match the light tokens; the xterm viewport background is the light terminal background; Monaco's `.monaco-editor` background on the Changes page is light; a Mermaid diagram in Docs re-renders with the light theme.
2. Theme = Dark: the same checks give the dark values.
3. Theme = System: emulate the OS switch by setting `nativeTheme.themeSource` via `app.evaluate` and confirm the renderer follows live without reload.
4. Restart with Light saved: the splash and the first frame of the main window are light (window `getBackgroundColor()`).
5. Windows-only checks (overlay colours) run in CI's Windows job as unit tests; a manual look on Windows before release.

Screenshots of Home, a task with terminal, Changes and Docs in both themes go with the PR.
