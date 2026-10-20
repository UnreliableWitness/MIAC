# Light Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A light Azure DevOps theme next to the dark one, chosen in Settings → Appearance as System / Light / Dark, applied live to every surface.

**Architecture:** One piece of state: Electron's `nativeTheme.themeSource`, set from the `theme` setting. CSS switches through `@media (prefers-color-scheme: light)` in `tokens.css`; renderer code that needs literal colours (xterm, Monaco, Mermaid) reads the same media query through `src/renderer/colorScheme.ts`; main listens to `nativeTheme.on('updated')` for the window background and the Windows title-bar overlay.

**Tech Stack:** Electron 44, React, TypeScript, xterm.js (WebGL addon), monaco-editor, mermaid 12, Vitest (node + jsdom projects), Playwright `_electron` for the functional check.

**Spec:** `docs/superpowers/specs/2026-10-20-light-theme-design.md`

## Global Constraints

- Setting values exactly `'system' | 'light' | 'dark'`; default `'system'`; existing `settings.json` files load unchanged.
- `nativeTheme.themeSource` is set after `settings.load()` and before the splash and main windows are created.
- Dark values stay exactly as they are today (the dark look must not change).
- Light text tokens (`--text`, `--muted`, `--link`, `--green`, `--red`, `--amber`, `--warn`) ≥ 4.5:1 on `--bg-page` and `--bg-card`; chart and repo colours ≥ 3:1 on `--bg-card`. Same check for dark.
- No hard-coded colour literals in `src/renderer/styles/*.css` outside `tokens.css` (allowlist: `#fff` text/knob on `--accent`, kept as the token `--on-accent`).
- Formatting: run `npx oxfmt src tools` — never `npm run lint:fix` or bare `oxfmt` at the root (`.claude/worktrees/` holds other agents' worktrees).
- Checks before each commit: `npm test`, `npm run typecheck`, `npm run lint`.
- In a fresh worktree run `npm install`, and `node node_modules/electron/install.js` if `node_modules/electron/dist` is missing.

## Review Focus

1. **Live OS switch while in System mode** — terminals already open, an open diff and a rendered Mermaid diagram must all re-colour without a reload. Pinned by Task 4 (terminal listener test), Task 5 (`setTheme` on change test), Task 6 (re-render on change test), and the functional check step 3.
2. **Terminal created before the first scheme read** — a terminal opened while the app is light must start light, not flash dark. Pinned by Task 4 `terminalOptions` test with the light stub.
3. **Saving another setting must not reset the theme** — `saveSettings` merges on a fresh read; a save of `showSplash` keeps `theme: 'light'`. Pinned by Task 1 handler test (`applyTheme` not called when theme unchanged) and Task 8 settings screen test.
4. **Pale colours on white** — ADO state colour `removed: #ffffff` and light chart bars must stay visible. Pinned by Task 7 and the contrast test in Task 3.
5. **Restart in light mode** — the splash and the main window's first frame must be light (no dark flash). Pinned by Task 2 tests (`windowBackground`, `splashBackground`) and functional check step 4.

---

## File Structure

- Create `src/shared/theme.ts` — `THEMES`, `ThemeChoice`, `ColorScheme`, `schemeOf(dark: boolean)`. Shared by main, renderer and the schema.
- Modify `src/shared/usage.ts` — `theme` field in `AppSettingsSchema`.
- Modify `src/main/ipc/handlers.ts` — optional `applyTheme` service, called on save when `theme` changes.
- Modify `src/main.ts` — set `themeSource` at boot, pass `applyTheme`, react to `nativeTheme.on('updated')`, scheme-aware window options.
- Modify `src/main/windowChrome.ts` — per-scheme chrome colours; `titleBarOptions(platform, scheme)`; `windowBackground(scheme)`; `splashBackground(scheme)`.
- Modify `src/main/splash.ts` — `createSplashWindow(icon, scheme)`.
- Modify `src/renderer/styles/tokens.css` — light block, new tokens `--focus-ring`, `--shadow-1`, `--shadow-2`, `--on-accent`, `--highlight-flash`.
- Modify `src/renderer/styles/{app,shell,screens,docs,review,home,usage}.css` — literals → tokens.
- Create `src/renderer/styles/tokens.test.ts` — contrast check + literal guard (renderer project, runs in jsdom but only reads files with `node:fs`).
- Create `src/renderer/colorScheme.ts` — `currentColorScheme()`, `onColorSchemeChange()`, `useColorScheme()`.
- Create `src/renderer/testColorScheme.ts` — a controllable `matchMedia` stub; installed in `src/renderer/test-setup.ts`.
- Modify `src/renderer/terminalTheme.ts` — `TERMINAL_THEMES` (dark + light), `terminalTheme(scheme)`.
- Modify `src/renderer/terminalSetup.ts`, `src/renderer/components/TerminalView.tsx` — start with and follow the scheme.
- Modify `src/renderer/review/monacoSetup.ts`, `src/renderer/components/review/DiffView.tsx` — `shellie-light`, follow the scheme.
- Modify `src/renderer/components/docs/MermaidBlock.tsx` — per-scheme initialize and re-render.
- Modify `src/renderer/components/ui/StateDot.tsx`, `src/renderer/styles/app.css` — removed colour, dot outline.
- Modify `src/splash/splash.css` — light block.
- Modify `src/renderer/screens/SettingsScreen.tsx` — Theme select in Appearance.
- Modify `CLAUDE.md` — status line.

---

### Task 1: Theme setting and applying it in main

**Files:**
- Create: `src/shared/theme.ts`
- Create: `src/shared/theme.test.ts`
- Modify: `src/shared/usage.ts` (schema, near `notifyOnDone` at line ~74)
- Modify: `src/main/usage/SettingsStore.test.ts` (default expectations at lines ~68 and ~87 gain `theme: 'system'`)
- Modify: `src/main/ipc/handlers.ts` (services interface near line 142; `settings:save` near line 2282)
- Modify: `src/main/ipc/handlers.test.ts`
- Modify: `src/main.ts` (after `settings.load()` near line 268; where handlers' services are built near line 568)

**Interfaces:**
- Produces: `THEMES`, `type ThemeChoice = 'system' | 'light' | 'dark'`, `type ColorScheme = 'light' | 'dark'`, `schemeOf(dark: boolean): ColorScheme` from `src/shared/theme.ts`; `AppSettings.theme: ThemeChoice`; services field `applyTheme?: (theme: ThemeChoice) => void`.

- [ ] **Step 1: Write the failing tests**

`src/shared/theme.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { AppSettingsSchema, defaultSettings } from './usage';
import { schemeOf } from './theme';

describe('theme setting', () => {
  it('defaults to following the system', () => {
    expect(defaultSettings().theme).toBe('system');
  });

  it('fills in system for a settings file written before themes existed', () => {
    const old = { version: 1, receiverPort: 4319, hourlySync: true };
    expect(AppSettingsSchema.parse(old).theme).toBe('system');
  });

  it.each(['system', 'light', 'dark'] as const)('keeps %s', (theme) => {
    expect(AppSettingsSchema.parse({ ...defaultSettings(), theme }).theme).toBe(theme);
  });

  it('rejects an unknown theme', () => {
    expect(() => AppSettingsSchema.parse({ ...defaultSettings(), theme: 'sepia' })).toThrow();
  });
});

describe('schemeOf', () => {
  it('maps nativeTheme.shouldUseDarkColors to a scheme', () => {
    expect(schemeOf(true)).toBe('dark');
    expect(schemeOf(false)).toBe('light');
  });
});
```

In `src/main/ipc/handlers.test.ts`, next to "reports which settings changed" (line ~2760). Check how `harness(crypto, overrides)` merges its second argument into the services and pass `applyTheme` the same way `telemetry` is passed:
```ts
  it('applies the theme when it changes, and only then', async () => {
    const applied: string[] = [];
    const hx = await harness(fakeCrypto(), {
      applyTheme: (t: string) => applied.push(t),
    });
    const s = await hx.h['settings:get']();
    await hx.h['settings:save']({ ...s, theme: 'light' });
    await hx.h['settings:save']({ ...s, theme: 'light', showSplash: false });
    await hx.h['settings:save']({ ...s, theme: 'dark', showSplash: false });
    expect(applied).toEqual(['light', 'dark']);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/theme.test.ts src/main/ipc/handlers.test.ts -t "theme"`
Expected: FAIL — `./theme` not found; `applied` is `[]`.

- [ ] **Step 3: Implement**

`src/shared/theme.ts`:
```ts
/** What the developer picks in Settings → Appearance; `system` follows the OS appearance. */
export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEMES)[number];
/** The look actually on screen. */
export type ColorScheme = 'light' | 'dark';

export const schemeOf = (dark: boolean): ColorScheme => (dark ? 'dark' : 'light');
```

`src/shared/usage.ts`, in `AppSettingsSchema` after `notifyOnDone`:
```ts
  /** Light or dark look; `system` follows the OS appearance (sets nativeTheme.themeSource). */
  theme: z.enum(THEMES).default('system'),
```
with `import { THEMES } from './theme';` at the top.

`src/main/ipc/handlers.ts`, in the services interface after `settings: SettingsStore;`:
```ts
  /** Sets nativeTheme.themeSource (main); absent in tests that don't care. */
  applyTheme?: (theme: ThemeChoice) => void;
```
and in `settings:save`, right after `const changed = changedKeys(before, saved);`:
```ts
      if (saved.theme !== before.theme) s.applyTheme?.(saved.theme);
```
Import `type ThemeChoice` from `'../../shared/theme'`.

`src/main.ts`: add `nativeTheme` to the `electron` import. Right after `const settingsLoaded = await settings.load();`:
```ts
  // Before any window: the splash, the first frame and prefers-color-scheme all follow it.
  nativeTheme.themeSource = settings.get().theme;
```
And where the handler services object is built (the one with `budget,` near line 568) add:
```ts
      applyTheme: (theme) => {
        nativeTheme.themeSource = theme;
      },
```

Update the default-settings expectations in `src/main/usage/SettingsStore.test.ts` (and any other `toEqual` on full settings that now fails, e.g. `CostSection.test.tsx` fixtures typed as `AppSettings` — add `theme: 'system'`).

- [ ] **Step 4: Run checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/theme.ts src/shared/theme.test.ts src/shared/usage.ts src/main src/main.ts src/renderer
git commit -m "feat: theme setting (system, light, dark) drives nativeTheme"
```

---

### Task 2: Window chrome, window background and splash follow the scheme

**Files:**
- Modify: `src/main/windowChrome.ts`
- Modify: `src/main/windowChrome.test.ts`
- Modify: `src/main/splash.ts` (`createSplashWindow`, line ~128)
- Modify: `src/main.ts` (`createWindow` line ~179; splash creation line ~269; add `nativeTheme.on('updated')`)
- Modify: `src/splash/splash.css`

**Interfaces:**
- Consumes: `ColorScheme`, `schemeOf` from `src/shared/theme.ts`.
- Produces: `chromeColors(scheme): { color: string; symbolColor: string }`, `windowBackground(scheme): string`, `splashBackground(scheme): string`, `titleBarOptions(platform, scheme)`; `createSplashWindow(icon: NativeImage | undefined, scheme: ColorScheme)`.

- [ ] **Step 1: Write the failing tests**

Replace the `titleBarOptions` block in `src/main/windowChrome.test.ts`:
```ts
import { chromeColors, splashBackground, titleBarOptions, windowBackground } from './windowChrome';

describe('titleBarOptions', () => {
  it('puts the macOS traffic lights inside the 40 px header, vertically centred', () => {
    for (const scheme of ['dark', 'light'] as const)
      expect(titleBarOptions('darwin', scheme)).toEqual({
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 14, y: 13 },
      });
  });

  it('draws the Windows controls over the header in its colours and height', () => {
    expect(titleBarOptions('win32', 'dark')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#1b1a19', symbolColor: '#e8e8e8', height: 40 },
    });
    expect(titleBarOptions('win32', 'light')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#f3f2f1', symbolColor: '#1b1a19', height: 40 },
    });
  });

  it('keeps the system title bar elsewhere', () => {
    expect(titleBarOptions('linux', 'light')).toEqual({});
  });
});

describe('scheme colours', () => {
  it('matches --bg-chrome / --bg-page of tokens.css per scheme', () => {
    expect(chromeColors('dark')).toEqual({ color: '#1b1a19', symbolColor: '#e8e8e8' });
    expect(windowBackground('dark')).toBe('#201f1e');
    expect(windowBackground('light')).toBe('#faf9f8');
    expect(splashBackground('dark')).toBe('#1b1a19');
    expect(splashBackground('light')).toBe('#f3f2f1');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/windowChrome.test.ts`
Expected: FAIL — `chromeColors` is not exported.

- [ ] **Step 3: Implement**

`src/main/windowChrome.ts` — replace the two constants with:
```ts
import type { ColorScheme } from '../shared/theme';

/** `--bg-chrome` and `--text` (on that ground) from tokens.css, so the Windows buttons blend into the header. */
const CHROME: Record<ColorScheme, { color: string; symbolColor: string }> = {
  dark: { color: '#1b1a19', symbolColor: '#e8e8e8' },
  light: { color: '#f3f2f1', symbolColor: '#1b1a19' },
};
/** `--bg-page` from tokens.css: the window's colour before the page paints. */
const PAGE: Record<ColorScheme, string> = { dark: '#201f1e', light: '#faf9f8' };

export const chromeColors = (scheme: ColorScheme) => CHROME[scheme];
export const windowBackground = (scheme: ColorScheme) => PAGE[scheme];
/** The splash is drawn on the chrome colour. */
export const splashBackground = (scheme: ColorScheme) => CHROME[scheme].color;
```
`titleBarOptions(platform, scheme: ColorScheme)`; the overlay case becomes:
```ts
        titleBarOverlay: { ...chromeColors(scheme), height: TITLE_BAR_HEIGHT },
```

`src/main/splash.ts`: `createSplashWindow(icon: NativeImage | undefined, scheme: ColorScheme)` and `backgroundColor: splashBackground(scheme),`.

`src/main.ts`:
- `const scheme = () => schemeOf(nativeTheme.shouldUseDarkColors);`
- in `createWindow`: `backgroundColor: windowBackground(scheme()),` and `...titleBarOptions(process.platform, scheme()),`
- splash: `createSplashWindow(windowIcon, scheme())` (the call has `windowIcon` possibly undefined — keep it as the first argument).
- after the main window is first created (near line 700, `mainWindow = createWindow();`), register once:
```ts
  // System mode follows the OS live; a Settings change lands here too.
  nativeTheme.on('updated', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setBackgroundColor(windowBackground(scheme()));
    if (titleBarKind(process.platform) === 'overlay')
      mainWindow.setTitleBarOverlay({ ...chromeColors(scheme()), height: TITLE_BAR_HEIGHT });
  });
```
Import `titleBarKind`, `TITLE_BAR_HEIGHT` from `./shared/titleBar` if not already imported. Make sure this listener is registered only once (not inside `createWindow`, which also runs on macOS re-activate at line ~841).

`src/splash/splash.css` — introduce variables at the top and use them for every colour in the file:
```css
:root {
  color-scheme: light dark;
  --sp-bg: #1b1a19;
  --sp-text: rgba(255, 255, 255, 0.9);
  --sp-muted: rgba(255, 255, 255, 0.55);
  --sp-disabled: rgba(255, 255, 255, 0.38);
  --sp-track: rgba(255, 255, 255, 0.08);
  --sp-accent: #0078d4;
  --sp-red: #f1707b;
  --sp-red-bg: rgba(241, 112, 123, 0.12);
  --sp-line-strong: rgba(255, 255, 255, 0.16);
  --sp-card: #252423;
}
@media (prefers-color-scheme: light) {
  :root {
    --sp-bg: #f3f2f1;
    --sp-text: rgba(0, 0, 0, 0.9);
    --sp-muted: rgba(0, 0, 0, 0.55);
    --sp-disabled: rgba(0, 0, 0, 0.38);
    --sp-track: rgba(0, 0, 0, 0.08);
    --sp-red: #a4262c;
    --sp-red-bg: rgba(164, 38, 44, 0.08);
    --sp-line-strong: rgba(0, 0, 0, 0.16);
    --sp-card: #ffffff;
  }
}
```
Then replace: line 6 `#1b1a19` → `var(--sp-bg)`; 22 → `var(--sp-text)`; 52 → `var(--sp-track)`; 59 → `var(--sp-accent)`; 75 → `var(--sp-muted)`; 82 → `var(--sp-disabled)`; 94/95 → `var(--sp-red)` / `var(--sp-red-bg)`; 107 → `var(--sp-line-strong)`; 109 → `var(--sp-card)`; 110 → `var(--sp-text)`; 119 → `var(--sp-red)`. (Line numbers are from `origin/main`; match by value.) If 119 is a button background with white text on it, keep the text white.

- [ ] **Step 4: Run checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main src/main.ts src/splash/splash.css
git commit -m "feat: window background, title-bar overlay and splash follow the colour scheme"
```

---

### Task 3: Light tokens, literal sweep, contrast and literal guard tests

**Files:**
- Modify: `src/renderer/styles/tokens.css`
- Modify: `src/renderer/styles/app.css` (lines ~194, ~397-398, ~469-470, ~524), `shell.css` (~622), `screens.css` (~67-68), `docs.css` (~104, ~272-273), `review.css` (~40), `home.css` (~169), `usage.css` (~169)
- Create: `src/renderer/styles/tokens.test.ts`

**Interfaces:**
- Produces: CSS tokens `--focus-ring`, `--shadow-1`, `--shadow-2`, `--on-accent`, `--highlight-flash` (both schemes); the full light override block.

- [ ] **Step 1: Write the failing tests**

`src/renderer/styles/tokens.test.ts`:
```ts
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(__dirname);
const tokensCss = readFileSync(path.join(dir, 'tokens.css'), 'utf8');

type RGBA = [number, number, number, number];

function parseColor(v: string): RGBA {
  const s = v.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as RGBA;
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(s);
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map((x) => x.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  throw new Error(`not a colour: ${v}`);
}

/** Custom properties declared in a CSS block body. */
function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}

const darkBlock = /:root\s*\{([^}]*)\}/.exec(tokensCss)![1];
const lightBlock = /@media \(prefers-color-scheme: light\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(tokensCss)![1];
const DARK = decls(darkBlock);
const LIGHT = { ...DARK, ...decls(lightBlock) };

function over(fg: RGBA, bg: RGBA): RGBA {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1) as RGBA;
}
function lum([r, g, b]: RGBA): number {
  const f = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(fgVar: string, bgVar: string, t: Record<string, string>): number {
  const bg = parseColor(t[bgVar]);
  const fg = over(parseColor(t[fgVar]), bg);
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const TEXT = ['--text', '--muted', '--link', '--green', '--red', '--amber', '--warn'];
const CHART = [
  '--chart-claude', '--chart-copilot', '--chart-opus', '--chart-sonnet', '--chart-haiku', '--chart-fable',
  '--repo-1', '--repo-2', '--repo-3', '--repo-4', '--repo-5', '--repo-6',
];

describe.each([
  ['dark', DARK],
  ['light', LIGHT],
] as const)('%s tokens', (name, t) => {
  it.each(TEXT.flatMap((fg) => ['--bg-page', '--bg-card'].map((bg) => [fg, bg])))(
    `${name}: %s on %s is at least 4.5:1`,
    (fg, bg) => expect(contrast(fg, bg, t)).toBeGreaterThanOrEqual(4.5),
  );
  if (name === 'light')
    it.each(CHART)(`${name}: %s on --bg-card is at least 3:1`, (fg) =>
      expect(contrast(fg, '--bg-card', t)).toBeGreaterThanOrEqual(3),
    );
});

describe('light block', () => {
  it('overrides every colour token of the dark block', () => {
    const colourKeys = Object.keys(DARK).filter((k) => /^(#|rgba?\()/.test(DARK[k]));
    const missing = colourKeys.filter((k) => !(k in decls(lightBlock)) && k !== '--accent');
    expect(missing).toEqual([]);
  });
});

describe('stylesheets', () => {
  it('use tokens instead of colour literals', () => {
    const hits: string[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.css') && f !== 'tokens.css'))
      readFileSync(path.join(dir, f), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
        });
    expect(hits).toEqual([]);
  });
});
```
Note on the dark contrast run: only text tokens are checked for dark (they already pass today — if one doesn't, report it rather than change a dark value, since the dark look must not change; mark that case with `it.skip` and a comment naming the measured ratio).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/styles/tokens.test.ts`
Expected: FAIL — the light block regex finds nothing (`Cannot read properties of null`), and the literal guard lists the lines in app/shell/screens/docs/review/home/usage.css.

- [ ] **Step 3: Implement tokens**

In `tokens.css`, change `color-scheme: dark;` to `color-scheme: light dark;` and add to the dark `:root`:
```css
  --on-accent: #ffffff;
  --focus-ring: rgba(255, 255, 255, 0.3);
  --highlight-flash: rgba(0, 120, 212, 0.25);
  --shadow-1:
    0 1.6px 3.6px rgba(0, 0, 0, 0.26), 0 0.3px 0.9px rgba(0, 0, 0, 0.22);
  --shadow-2:
    0 6.4px 14.4px rgba(0, 0, 0, 0.4), 0 1.2px 3.6px rgba(0, 0, 0, 0.3);
```
Then, before the `prefers-reduced-motion` block:
```css
/* Azure DevOps light theme: chosen by Settings → Appearance through nativeTheme (spec 2026-10-20). */
@media (prefers-color-scheme: light) {
  :root {
    --bg-page: #faf9f8;
    --bg-chrome: #f3f2f1;
    --bg-card: #ffffff;
    --bg-hover: rgba(0, 0, 0, 0.04);
    --bg-selected: rgba(0, 0, 0, 0.06);
    --line: rgba(0, 0, 0, 0.08);
    --line-strong: rgba(0, 0, 0, 0.16);
    --text: rgba(0, 0, 0, 0.9);
    --muted: rgba(0, 0, 0, 0.6);
    --disabled: rgba(0, 0, 0, 0.38);
    --accent-hover: #106ebe;
    --accent-bg: rgba(0, 120, 212, 0.08);
    --link: #0063b1;
    --green: #107c10;
    --green-bg: rgba(16, 124, 16, 0.08);
    --red: #a4262c;
    --amber: #8a6100;
    --red-bg: rgba(164, 38, 44, 0.08);
    --warn: #8a5300;
    --warn-bg: rgba(138, 83, 0, 0.1);
    --chart-claude: #0078d4;
    --chart-copilot: #8764b8;
    --chart-opus: #0063b1;
    --chart-sonnet: #2b88d8;
    --chart-haiku: #4f8fcf;
    --chart-fable: #8764b8;
    --repo-1: #2b7bb9;
    --repo-2: #8764b8;
    --repo-3: #00827a;
    --repo-4: #ca5010;
    --repo-5: #c239b3;
    --repo-6: #5c63d6;
    --on-accent: #ffffff;
    --focus-ring: rgba(0, 0, 0, 0.3);
    --highlight-flash: rgba(0, 120, 212, 0.18);
    --shadow-1:
      0 1.6px 3.6px rgba(0, 0, 0, 0.13), 0 0.3px 0.9px rgba(0, 0, 0, 0.11);
    --shadow-2:
      0 6.4px 14.4px rgba(0, 0, 0, 0.13), 0 1.2px 3.6px rgba(0, 0, 0, 0.11);
  }
}
```
`--muted` is 0.6 (not the spec's 0.55) so it clears 4.5:1 on `--bg-page`; `--link` is `#0063b1` because `#0078d4` measures ~4.35:1 on `#faf9f8`. If a chart/repo value still measures under 3:1, darken that one value in steps of the same hue until it passes, and note the change in the commit message.

- [ ] **Step 4: Replace literals**

- `app.css` ~194 `.field:hover { border-color: rgba(255,255,255,0.3) }` → `var(--focus-ring)`.
- `app.css` ~397-398 and `screens.css` ~67-68 (two-layer card shadow) → `box-shadow: var(--shadow-1);`
- `app.css` ~469-470 (two-layer popup) → `box-shadow: var(--shadow-2);`
- `app.css` ~524 and `shell.css` ~622 (`0 6.4px 14.4px rgba(0,0,0,0.4)` alone) → `box-shadow: var(--shadow-2);`
- `docs.css` ~104 `rgba(0, 120, 212, 0.25)` → `var(--highlight-flash)`.
- `docs.css` ~272-273 `var(--surface, #1f1f1f)` / `var(--border, #444)` → `var(--bg-card)` / `var(--line-strong)` (`--surface`/`--border` don't exist; the fallbacks were always used).
- `review.css` ~40, `home.css` ~169 `color: #fff` → `color: var(--on-accent);`
- `usage.css` ~169 `.switch input:checked::after { background: #fff }` → `background: var(--on-accent);`

Match by value — line numbers may have shifted.

- [ ] **Step 5: Run checks**

Run: `npx vitest run src/renderer/styles/tokens.test.ts && npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/styles
git commit -m "feat: light Azure DevOps tokens, no colour literals outside tokens.css"
```

---

### Task 4: Colour scheme in the renderer, and terminals that follow it

**Files:**
- Create: `src/renderer/colorScheme.ts`
- Create: `src/renderer/colorScheme.test.ts`
- Create: `src/renderer/testColorScheme.ts`
- Modify: `src/renderer/test-setup.ts`
- Modify: `src/renderer/terminalTheme.ts`, `src/renderer/terminalTheme.test.tsx`
- Modify: `src/renderer/terminalSetup.ts`
- Modify: `src/renderer/components/TerminalView.tsx` (terminal effect, line ~39)
- Test: `src/renderer/terminalSetup.test.ts` (create if absent)

**Interfaces:**
- Consumes: `ColorScheme` from `src/shared/theme.ts`.
- Produces: `currentColorScheme(): ColorScheme`, `onColorSchemeChange(cb: (s: ColorScheme) => void): () => void`, `useColorScheme(): ColorScheme` from `src/renderer/colorScheme.ts`; test helper `setTestColorScheme(s: ColorScheme)` from `src/renderer/testColorScheme.ts`; `TERMINAL_THEMES: Record<ColorScheme, ITheme>`, `terminalTheme(s): ITheme`.

- [ ] **Step 1: Write the test stub and failing tests**

`src/renderer/testColorScheme.ts` (jsdom has no `matchMedia`):
```ts
import type { ColorScheme } from '../shared/theme';

const QUERY = '(prefers-color-scheme: light)';
let scheme: ColorScheme = 'dark';
const listeners = new Set<() => void>();

/** A matchMedia that answers the light-scheme query from `scheme`; every other query is false. */
export function installMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === QUERY && scheme === 'light';
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    addListener: (l: () => void) => listeners.add(l),
    removeListener: (l: () => void) => listeners.delete(l),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

/** Switches the emulated OS appearance and fires the change listeners. */
export function setTestColorScheme(next: ColorScheme): void {
  scheme = next;
  for (const l of [...listeners]) l();
}

export function resetTestColorScheme(): void {
  scheme = 'dark';
  listeners.clear();
}
```
In `src/renderer/test-setup.ts` add `installMatchMedia();` at top level and `resetTestColorScheme();` in the `afterEach`. If a test file already defines its own `window.matchMedia`, leave it.

`src/renderer/colorScheme.test.ts`:
```ts
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { currentColorScheme, onColorSchemeChange, useColorScheme } from './colorScheme';
import { setTestColorScheme } from './testColorScheme';

describe('colour scheme', () => {
  it('reads the light-scheme media query', () => {
    expect(currentColorScheme()).toBe('dark');
    setTestColorScheme('light');
    expect(currentColorScheme()).toBe('light');
  });

  it('tells subscribers about a change until they unsubscribe', () => {
    const cb = vi.fn();
    const off = onColorSchemeChange(cb);
    setTestColorScheme('light');
    off();
    setTestColorScheme('dark');
    expect(cb.mock.calls).toEqual([['light']]);
  });

  it('re-renders a component when the OS switches', () => {
    const { result } = renderHook(() => useColorScheme());
    expect(result.current).toBe('dark');
    act(() => setTestColorScheme('light'));
    expect(result.current).toBe('light');
  });
});
```

Replace `src/renderer/terminalTheme.test.tsx`:
```ts
import { describe, expect, it } from 'vitest';
import { TERMINAL_THEMES, terminalTheme } from './terminalTheme';

describe('terminal themes', () => {
  it('keeps the dark ADO page ground, blue cursor and selection', () => {
    const t = TERMINAL_THEMES.dark;
    expect(t.background).toBe('#201f1e');
    expect(t.cursor).toBe('#5ca9f2');
    expect(t.selectionBackground).toBe('rgba(0,120,212,0.4)');
    expect(t.brightBlack).toBe('#8a8886');
  });

  it('draws light terminals on the light page ground', () => {
    expect(terminalTheme('light').background).toBe('#faf9f8');
    expect(terminalTheme('light').cursorAccent).toBe('#faf9f8');
  });

  it('defines the same colours in both themes', () => {
    expect(Object.keys(TERMINAL_THEMES.light).sort()).toEqual(Object.keys(TERMINAL_THEMES.dark).sort());
  });
});
```

`src/renderer/terminalSetup.test.ts` (add to it if it exists):
```ts
import { describe, expect, it } from 'vitest';
import { terminalOptions } from './terminalSetup';
import { TERMINAL_THEMES } from './terminalTheme';
import { setTestColorScheme } from './testColorScheme';

describe('terminalOptions', () => {
  it('starts a terminal in the scheme on screen', () => {
    expect(terminalOptions(null).theme).toBe(TERMINAL_THEMES.dark);
    setTestColorScheme('light');
    expect(terminalOptions(null).theme).toBe(TERMINAL_THEMES.light);
  });
});
```

For the live switch, add to `TerminalView`'s existing test file (find it with `ls src/renderer/components/TerminalView*.test.tsx`; it mocks `@xterm/xterm`'s `Terminal`). After rendering a `TerminalView`, get the mocked terminal instance the way the existing tests do and assert:
```ts
  it('re-colours an open terminal when the colour scheme changes', async () => {
    // render as the neighbouring tests do, then:
    act(() => setTestColorScheme('light'));
    expect(lastTerminal().options.theme).toBe(TERMINAL_THEMES.light);
  });
```
(`lastTerminal()` stands for whatever accessor the existing test file uses for the mocked instance; if the file has none, keep the created instances in an array inside the `vi.mock` factory and read the last one.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project renderer src/renderer/colorScheme.test.ts src/renderer/terminalTheme.test.tsx src/renderer/terminalSetup.test.ts`
Expected: FAIL — `./colorScheme` not found, `TERMINAL_THEMES` not exported.

- [ ] **Step 3: Implement**

`src/renderer/colorScheme.ts`:
```ts
import { useSyncExternalStore } from 'react';
import type { ColorScheme } from '../shared/theme';

/** Main sets nativeTheme.themeSource from Settings, so this query is the one answer to "light or dark?". */
const QUERY = '(prefers-color-scheme: light)';

export function currentColorScheme(): ColorScheme {
  return window.matchMedia(QUERY).matches ? 'light' : 'dark';
}

/** For code outside React (terminals, Monaco); returns the unsubscribe. */
export function onColorSchemeChange(cb: (s: ColorScheme) => void): () => void {
  const q = window.matchMedia(QUERY);
  const h = () => cb(currentColorScheme());
  q.addEventListener('change', h);
  return () => q.removeEventListener('change', h);
}

export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(onColorSchemeChange, currentColorScheme);
}
```

`src/renderer/terminalTheme.ts`:
```ts
import type { ITheme } from '@xterm/xterm';
import type { ColorScheme } from '../shared/theme';

/** xterm colours matched to tokens.css (xterm needs literal values, not CSS variables); ANSI from VS Code Dark Modern / Light Modern. */
export const TERMINAL_THEMES: Record<ColorScheme, ITheme> = {
  dark: {
    // the current TERMINAL_THEME object, unchanged
  },
  light: {
    background: '#faf9f8',
    foreground: '#1f1f1f',
    cursor: '#005fb8',
    cursorAccent: '#faf9f8',
    selectionBackground: 'rgba(0,120,212,0.25)',
    black: '#000000',
    red: '#cd3131',
    green: '#107c10',
    yellow: '#949800',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#555555',
    brightBlack: '#666666',
    brightRed: '#cd3131',
    brightGreen: '#14ce14',
    brightYellow: '#b5ba00',
    brightBlue: '#0451a5',
    brightMagenta: '#bc05bc',
    brightCyan: '#0598bc',
    brightWhite: '#a5a5a5',
  },
};

export const terminalTheme = (s: ColorScheme): ITheme => TERMINAL_THEMES[s];
```
(Move the existing dark object's 21 keys into `dark` verbatim.)

`src/renderer/terminalSetup.ts`: import `currentColorScheme` and `terminalTheme`; `theme: terminalTheme(currentColorScheme()),`. Remove the `TERMINAL_THEME` import. `git grep TERMINAL_THEME` must find no other users afterwards.

`src/renderer/components/TerminalView.tsx`, inside the effect after `term.current = t;`:
```ts
    const offScheme = onColorSchemeChange((s) => {
      t.options.theme = terminalTheme(s);
    });
```
and call `offScheme();` in that effect's cleanup function (next to `unregister()`).

- [ ] **Step 4: Run checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat: terminals start in and follow the colour scheme"
```

---

### Task 5: Monaco diff view in light

**Files:**
- Modify: `src/renderer/review/monacoSetup.ts`
- Modify: `src/renderer/components/review/DiffView.tsx` (options at line ~110)
- Test: `src/renderer/components/review/DiffView.test.tsx` (existing; it mocks the Monaco loader)

**Interfaces:**
- Consumes: `useColorScheme()`, `currentColorScheme()` (Task 4).
- Produces: Monaco themes `shellie-dark`, `shellie-light`; `monacoTheme(s: ColorScheme): string` exported from `DiffView.tsx`.

- [ ] **Step 1: Write the failing test**

In `DiffView.test.tsx`, using the file's existing Monaco mock (it provides `editor.createDiffEditor`; add `setTheme: vi.fn()` to the mocked `editor` if missing):
```ts
  it('creates the diff in the scheme on screen and follows a switch', async () => {
    setTestColorScheme('light');
    // render <DiffView …/> as the neighbouring tests do and wait for createDiffEditor
    expect(monacoMock.editor.createDiffEditor.mock.calls[0][1].theme).toBe('shellie-light');
    act(() => setTestColorScheme('dark'));
    expect(monacoMock.editor.setTheme).toHaveBeenLastCalledWith('shellie-dark');
  });
```
(`monacoMock` = the file's existing mock object; use its real name.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project renderer src/renderer/components/review/DiffView.test.tsx`
Expected: FAIL — theme is `shellie-dark`; `setTheme` not called.

- [ ] **Step 3: Implement**

`monacoSetup.ts`, after `shellie-dark`:
```ts
// The ADO light palette (the prefers-color-scheme: light block of tokens.css).
monaco.editor.defineTheme('shellie-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#faf9f8',
    'editorGutter.background': '#faf9f8',
    'editor.lineHighlightBackground': '#0000000a',
    'editorLineNumber.foreground': '#00000073',
    'editorLineNumber.activeForeground': '#000000e6',
    'diffEditor.insertedTextBackground': '#107c1026',
    'diffEditor.removedTextBackground': '#a4262c26',
    'diffEditor.insertedLineBackground': '#107c1012',
    'diffEditor.removedLineBackground': '#a4262c12',
    'diffEditor.unchangedRegionBackground': '#f3f2f1',
    'scrollbarSlider.background': '#0000001f',
  },
});
```

`DiffView.tsx`:
```ts
export const monacoTheme = (s: ColorScheme) => `shellie-${s}`;
```
In the component: `const scheme = useColorScheme();`. In `createDiffEditor` options: `theme: monacoTheme(currentColorScheme()),` (read at creation, not a dependency, so the editor isn't recreated on a switch). Add:
```ts
  // Monaco themes are global: one call re-colours every editor.
  useEffect(() => {
    m?.editor.setTheme(monacoTheme(scheme));
  }, [m, scheme]);
```

- [ ] **Step 4: Run checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat: light Monaco theme for the Changes diff"
```

---

### Task 6: Mermaid diagrams follow the scheme

**Files:**
- Modify: `src/renderer/components/docs/MermaidBlock.tsx`
- Test: `src/renderer/components/docs/MermaidBlock.test.tsx` (existing or create; mock `mermaid`)

**Interfaces:**
- Consumes: `useColorScheme()` (Task 4).

- [ ] **Step 1: Write the failing test**

```ts
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setTestColorScheme } from '../../testColorScheme';

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg></svg>' })),
}));
vi.mock('mermaid', () => ({ default: mermaid }));

import { MermaidBlock } from './MermaidBlock';

describe('MermaidBlock colour scheme', () => {
  it('renders with the light theme in light, and re-renders dark on a switch', async () => {
    setTestColorScheme('light');
    render(<MermaidBlock code="graph TD; A-->B" />);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'default', securityLevel: 'strict' }));
    act(() => setTestColorScheme('dark'));
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }));
  });
});
```
If an existing `MermaidBlock.test.tsx` already mocks `mermaid`, add the `it` there using its mock instead. Because the module caches the loaded Mermaid across tests, assert with `toHaveBeenLastCalledWith` (as above) rather than call counts on `initialize`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project renderer src/renderer/components/docs/MermaidBlock.test.tsx`
Expected: FAIL — `initialize` called with `theme: 'dark'`; no second render.

- [ ] **Step 3: Implement**

Replace `ready`/`load` in `MermaidBlock.tsx`:
```ts
let ready: Promise<typeof import('mermaid').default> | null = null;
let initializedFor: ColorScheme | null = null;
/** Mermaid's theme is global to initialize(): set it again whenever the scheme on screen changes. */
const load = (scheme: ColorScheme) =>
  (ready ??= import('mermaid').then((m) => m.default)).then((m) => {
    if (initializedFor !== scheme) {
      m.initialize({
        startOnLoad: false,
        theme: scheme === 'light' ? 'default' : 'dark',
        securityLevel: 'strict',
      });
      initializedFor = scheme;
    }
    return m;
  });
```
In the component: `const scheme = useColorScheme();`, call `load(scheme)` in the render effect and add `scheme` to its dependency array (`[id, code, scheme]`).

- [ ] **Step 4: Run checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat: Mermaid diagrams render in the colour scheme on screen"
```

---

### Task 7: State dots stay visible on white

**Files:**
- Modify: `src/renderer/components/ui/StateDot.tsx` (line ~12)
- Modify: `src/renderer/styles/app.css` (`.state-dot`, line ~271)
- Test: `src/renderer/components/ui/ui.test.tsx`

- [ ] **Step 1: Write the failing test**

In `ui.test.tsx`:
```ts
  it('draws a Removed item in the muted colour, not white', () => {
    const { container } = render(<StateDot state="Removed" />);
    expect((container.querySelector('.state-dot') as HTMLElement).style.background).toBe('var(--muted)');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project renderer src/renderer/components/ui/ui.test.tsx -t Removed`
Expected: FAIL — background is `rgb(255, 255, 255)`.

- [ ] **Step 3: Implement**

`StateDot.tsx`: `removed: 'var(--muted)',` with the comment line above `STATE_COLOR` extended: `Removed is ADO's white, drawn muted so it shows on a light page.`
`app.css` `.state-dot`: add `box-shadow: inset 0 0 0 1px var(--line-strong);` (an outline that keeps pale project colours visible in both schemes).

- [ ] **Step 4: Run checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS (the Task 3 literal guard still passes: no new literals).

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "fix: state dots stay visible on a light page"
```

---

### Task 8: Theme choice in Settings → Appearance

**Files:**
- Modify: `src/renderer/screens/SettingsScreen.tsx` (Appearance section, line ~247)
- Test: `src/renderer/screens/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `AppSettings.theme`, `THEMES` (Task 1); existing `saveSettings` / `tryInvoke`.

The spec says "segmented control"; Settings uses `<select className="field">` for every multi-choice setting, so this uses a select to match (same three options, applied immediately).

- [ ] **Step 1: Write the failing tests**

In `SettingsScreen.test.tsx`, next to "toggles the notify-on-done setting":
```ts
  it('picks the theme, starting at System', async () => {
    const { calls } = installFakeApi({ 'settings:save': (next) => next });
    render(<SettingsScreen />);
    const select = await screen.findByRole('combobox', { name: 'Theme' });
    await waitFor(() => expect(select).toHaveValue('system'));
    await userEvent.selectOptions(select, 'light');
    expect(
      calls.find((c) => c.channel === 'settings:save')?.args[0],
    ).toMatchObject({ theme: 'light' });
    await waitFor(() => expect(select).toHaveValue('light'));
  });

  it('keeps the chosen theme when another appearance setting is saved', async () => {
    const { calls } = installFakeApi({
      'settings:get': () => ({ ...defaultSettings(), theme: 'light' }),
      'settings:save': (next) => next,
    });
    render(<SettingsScreen />);
    const box = await screen.findByRole('checkbox', { name: 'Show splash on start' });
    await waitFor(() => expect(box).toBeChecked());
    await userEvent.click(box);
    expect(
      calls.find((c) => c.channel === 'settings:save')?.args[0],
    ).toMatchObject({ theme: 'light', showSplash: false });
  });
```
(Use however the file's other tests provide a custom `settings:get`; import `defaultSettings` from `../../shared/usage` if that's how they build settings.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project renderer src/renderer/screens/SettingsScreen.test.tsx -t theme`
Expected: FAIL — no combobox named Theme.

- [ ] **Step 3: Implement**

In the Appearance section, widen the `toggle` patch type to include `'theme'` (rename it `save` if that reads better; keep both call sites), and add as the first `list-row`:
```tsx
        <div className="list-row">
          <label>
            Theme{' '}
            <select
              className="field"
              aria-label="Theme"
              value={settings?.theme ?? 'system'}
              disabled={!settings}
              onChange={(e) =>
                void toggle({ theme: e.target.value as ThemeChoice })
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
```

- [ ] **Step 4: Run checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat: Theme choice in Settings → Appearance"
```

---

### Task 9: Functional check of the packaged app, screenshots, docs

**Files:**
- Create (scratchpad, not committed): `func/light-theme.mjs` in the session scratchpad
- Modify: `CLAUDE.md` (Status list)

- [ ] **Step 1: Package**

Run: `npm run package` (after `node node_modules/electron/install.js` if `node_modules/electron/dist` is missing).
Expected: `out/Shellie-darwin-arm64/Shellie.app` exists.

- [ ] **Step 2: Write the check**

Playwright `_electron.launch` on the packaged executable with a fresh `--user-data-dir` (pre-seed `migrated-from-miac.json` so the MIAC migration's Keychain prompt doesn't appear; register a throwaway repo through the `repos:add` IPC as in earlier checks). Assertions, each logged PASS/FAIL:
1. Save `theme: 'light'` via `settings:save`. Then `getComputedStyle(document.body).backgroundColor === 'rgb(250, 249, 248)'`; a `.card` (or Home tile) background `rgb(255, 255, 255)`; the header background `rgb(243, 242, 241)`.
2. Open a task terminal: the xterm `.xterm-viewport` / canvas parent background is `rgb(250, 249, 248)`.
3. Changes page with a diff: `.monaco-editor` background is `rgb(250, 249, 248)`.
4. Docs page with a ```mermaid block: diagram re-renders (the `<svg>` element is replaced) and its background/text colours differ from the dark render.
5. Save `theme: 'dark'`: checks 1-3 return the dark values (`rgb(32, 31, 30)`, `rgb(37, 36, 35)`, `rgb(27, 26, 25)`).
6. Save `theme: 'system'`, then `app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; })`: body background becomes light without reload (assert `performance.navigation`/a window marker survives), then back to `'dark'`.
7. Quit with `theme: 'light'` saved, relaunch: `BrowserWindow.getAllWindows()[0].getBackgroundColor()` is `#FAF9F8` (case-insensitive) and the splash window's is `#F3F2F1` while it's open.
8. Save `showSplash: false` from the Settings screen UI: `settings:get` still has `theme: 'light'`.

- [ ] **Step 3: Run it**

Run: `node <scratchpad>/func/light-theme.mjs`
Expected: 8/8 PASS. On a failure: fix in the owning task's files, rerun `npm test`, commit, repackage, rerun.

- [ ] **Step 4: Screenshots**

Take Home, a task with a terminal, Changes and Docs in light and dark (`page.screenshot`) into the scratchpad, for the PR.

- [ ] **Step 5: Docs and commit**

Add to `CLAUDE.md` Status:
```
- Light theme (spec `docs/superpowers/specs/2026-10-20-light-theme-design.md`) implemented 2026-10-20 on `feature/light-theme`: Settings → Appearance → Theme (System / Light / Dark, default System) sets `nativeTheme.themeSource`; CSS follows `prefers-color-scheme` (light block in `tokens.css`), terminals, Monaco and Mermaid follow `src/renderer/colorScheme.ts`, main re-colours the window background and Windows title-bar overlay on `nativeTheme` updates. `tokens.test.ts` checks contrast and that no stylesheet outside `tokens.css` has colour literals.
```
```bash
git add CLAUDE.md
git commit -m "docs: light theme status"
```
