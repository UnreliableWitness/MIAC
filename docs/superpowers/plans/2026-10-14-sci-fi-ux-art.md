# Sci-fi UX, splash, icon and art (sub-project 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give MIAC the "Instrument" sci-fi identity: new tokens and bundled fonts, a compact terminal-first workspace with Focus mode, a per-task Usage tab, an animated splash window with real boot steps, an SVG app icon built to `.icns` and `.ico`, and Gemini illustrations.

**Architecture:** Renderer changes are CSS tokens plus a small set of shared "instrument" React components (`src/renderer/components/instrument/`). `TaskStrip` replaces `TopBar` and `TaskHeader`, and `UsagePanel` replaces the `usage` route. UI prefs (Focus, nav rail) live in `localStorage` via `uiPrefs`, and per-task tab selection lives in the zustand store. The splash is a second Forge Vite renderer (`splash.html`, plain TS) with its own preload, driven from `boot()` through a testable `SplashReporter`. Icons are rendered from SVG by a Node script and committed. Art is loaded through `import.meta.glob`, so a missing image falls back to a CSS placeholder.

**Tech Stack:** Electron 44, Electron Forge 8 + Vite 8, React 19, zustand 5, xterm 6, Vitest 5 + Testing Library, `@fontsource/ibm-plex-sans` and `@fontsource/jetbrains-mono` 5.3, `@resvg/resvg-js` 2.6 (dev), macOS `iconutil` and `sips`, Gemini image model via `tools/art/generate.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-14-sci-fi-ux-art-design.md`

## Global Constraints

- Amber `#f0a443` is the only accent. Cream `#f6e7c8` is used for the Mind core and highlights. There is no light theme.
- Fonts: IBM Plex Sans (400, 500, 600) and JetBrains Mono (400, 600) come from `@fontsource`. No network font requests (remove the Google Fonts links and CSP entries).
- Every animation and transition is disabled under `@media (prefers-reduced-motion: reduce)`.
- Chrome heights: task strip 32 px, tab row 26 px, nav 168 px wide, rail 40 px wide.
- Shortcuts: `Mod+0` selects Usage, `Mod+1..9` select terminals, `Mod+Shift+F` toggles Focus. `Mod` is `Cmd` on macOS and `Ctrl` elsewhere.
- `localStorage` keys: `miac.ui.navCollapsed`, `miac.ui.focus`.
- `AppSettingsSchema` gains `showSplash: z.boolean().default(true)`; `version` stays `1`.
- The splash is 640×400, frameless, background `#050609`, and shows for at least 2200 ms unless skipped. Its fade-out is 200 ms.
- Boot step labels, exactly:
  - `Loading tasks`
  - `Starting usage receiver 127.0.0.1:<port>`
  - `Checking Azure DevOps · <n> connection(s)`
  - `Ready`
- `MIAC_SMOKE=1` never creates a splash.
- Art is decorative (`alt=""`, `aria-hidden="true"`), never behind a terminal, shown at 35-60% opacity under a fade to `--ground`. Each file is under 400 KB and at most 1600 px on the long side.
- Source files stay pure ASCII where the existing code does (glyphs via `String.fromCharCode`, as in `StepList.tsx` and `TaskNav.tsx`). CSS `content:` strings may use escapes (`"\25E6"`).
- Never print or commit `tools/art/gemini.local.key`.
- Checks: `npm test`, `npm run typecheck` and `npm run lint` pass after every task.
- Commit messages follow the repo's style (`feat:`, `fix:`, `docs:`, `build:`, `test:`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Terminal keystrokes vs. shortcuts.** Typing `Ctrl+1` or `Ctrl+Shift+F` inside a focused xterm on Windows must switch tabs or toggle Focus, not send the key to the shell. Every other key must still reach the shell. Pinned by a test in Task 8 that fires the keydown on an element inside the terminal host.
2. **Switching tabs or Focus must never remount a terminal** (that would restart or blank a shell). Pinned by a test in Task 8 asserting the same `TerminalView` DOM node survives Usage ↔ terminal ↔ Focus.
3. **A task with zero terminals, or whose selected terminal closes.** The tab selection must fall back to the first terminal, or to Usage when there are none, and never point at a dead id. Pinned in Task 3 (store) and Task 8.
4. **Boot failure after the splash is shown.** The user must see the error and a Quit button, not a frozen breathing splash, and the app must not linger without windows. Pinned in Task 10 (`fail` after `done` pending, `fail` resolves nothing and keeps the window).
5. **Usage across the 6-hour window edge and the billable toggle.** A record at exactly `now - 6h`, records in the future (clock skew), and a session toggled to non-billable must all be handled. Pinned in Task 4 (`timeline` edge tests, `recent` excluding non-billable).

---

## File structure

Create:
- `src/renderer/styles/instrument.css`: styles for the instrument components, the strip, the rail, the tab row and the usage panel.
- `src/renderer/components/instrument/{MindMark,RingGauge,Bracketed,TickRule,Label,IconButton}.tsx`, `index.ts`, `instrument.test.tsx`.
- `src/renderer/uiPrefs.ts` and `uiPrefs.test.ts`.
- `src/shared/usageViews.ts` and `usageViews.test.ts`.
- `src/renderer/components/TaskStrip.tsx` and `TaskStrip.test.tsx`.
- `src/renderer/components/UsagePanel.tsx` and `UsagePanel.test.tsx` (ported from `UsageScreen`).
- `src/renderer/hooks/useShortcuts.ts`.
- `src/renderer/art.ts` and `src/renderer/components/ArtSlot.tsx` + test.
- `src/main/splash.ts` and `splash.test.ts` (`SplashReporter`, `createSplashWindow`).
- `splash.html`, `src/splash/splash.ts`, `src/splash/splash.css`, `src/splashPreload.ts`, `vite.splash.config.mts`.
- `assets/icon/miac.svg`, `assets/icon/miac-small.svg`, the generated `assets/icon/png/*.png`, `assets/icon/miac.ico` and `assets/icon/miac.icns`.
- `tools/art/ico.mjs`, `tools/art/ico.test.ts`, `tools/art/build-icons.mjs`.
- `assets/art/*` (owner picks) and `assets/ART.md`.

Modify:
- `src/renderer/styles/{tokens,app,screens}.css`
- `index.html`, `src/renderer.tsx`, `vite.renderer.config.mts`
- `src/renderer/components/{TerminalView,TaskNav,TerminalTabs,StepList}.tsx`
- `src/renderer/screens/{WorkspaceScreen,SettingsScreen,SetupScreen,NewTaskScreen,FinishScreen}.tsx` and their tests
- `src/renderer/App.tsx`, `src/renderer/store.ts`
- `src/shared/usage.ts`, `src/shared/ipc.ts`
- `src/main/usage/UsageStore.ts`, `src/main/ipc/handlers.ts`
- `src/main.ts`, `src/declarations.d.ts`
- `forge.config.mts`, `package.json`
- `tools/art/prompts.md`, `tools/art/README.md`
- `docs/windows-checklist.md`, `README.md`, `CLAUDE.md`

Delete:
- `src/renderer/components/TopBar.tsx`
- `src/renderer/components/TaskHeader.tsx` and its test
- `src/renderer/screens/UsageScreen.tsx` and its test (ported into `UsagePanel`)

---

### Task 1: Tokens, bundled fonts, base CSS and xterm theme

**Files:**
- Modify: `package.json` (deps), `src/renderer.tsx`, `index.html`, `vite.renderer.config.mts`, `src/renderer/styles/tokens.css`, `src/renderer/styles/app.css`, `src/renderer/styles/screens.css`, `src/renderer/components/TerminalView.tsx`
- Create: `src/renderer/terminalTheme.ts`, `src/renderer/terminalTheme.test.ts` (renderer project: name it `terminalTheme.test.tsx` so the renderer Vitest project picks it up)

**Interfaces:**
- Produces: CSS custom properties from the spec table (`--void --ground --panel --panel-raised --panel-2 --line --line-strong --tick --text --text-bright --muted --faint --accent --accent-ink --cream`, status `--green(-bg|-border) --blue(-bg) --red(-bg|-border) --warn(-text|-bg|-border) --idle`, `--font-ui --font-mono --radius --radius-sm --ease`). Also `export const TERMINAL_THEME` from `src/renderer/terminalTheme.ts`.

- [ ] **Step 1: Install fonts**

Run: `npm install @fontsource/ibm-plex-sans@^5.3.0 @fontsource/jetbrains-mono@^5.3.0`
Expected: both appear under `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing theme test**

`src/renderer/terminalTheme.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { TERMINAL_THEME } from './terminalTheme';

describe('TERMINAL_THEME', () => {
  it('uses the void ground, amber cursor and amber selection', () => {
    expect(TERMINAL_THEME.background).toBe('#07080c');
    expect(TERMINAL_THEME.cursor).toBe('#f0a443');
    expect(TERMINAL_THEME.selectionBackground).toBe('rgba(240,164,67,0.25)');
    expect(TERMINAL_THEME.brightBlack).toBe('#7d8598');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/renderer/terminalTheme.test.tsx`
Expected: FAIL, cannot resolve `./terminalTheme`.

- [ ] **Step 4: Implement the theme and use it**

`src/renderer/terminalTheme.ts`:
```ts
import type { ITheme } from '@xterm/xterm';

/** xterm colours matched to tokens.css (xterm needs literal values, not CSS variables). */
export const TERMINAL_THEME: ITheme = {
  background: '#07080c',
  foreground: '#e7e6e2',
  cursor: '#f0a443',
  cursorAccent: '#07080c',
  selectionBackground: 'rgba(240,164,67,0.25)',
  black: '#0c0e14',
  red: '#f0a0a0',
  green: '#8fd6a4',
  yellow: '#f0c27a',
  blue: '#7fb2ff',
  magenta: '#c9a4f0',
  cyan: '#86d1d6',
  white: '#e7e6e2',
  brightBlack: '#7d8598',
  brightRed: '#ffbcbc',
  brightGreen: '#b2ecc3',
  brightYellow: '#f6dcae',
  brightBlue: '#a9cbff',
  brightMagenta: '#dcc3f7',
  brightCyan: '#b0e6ea',
  brightWhite: '#f3ead8',
};
```
In `TerminalView.tsx`: delete the local `THEME` const, `import { TERMINAL_THEME } from '../terminalTheme';`, and pass `theme: TERMINAL_THEME`.

- [ ] **Step 5: Rewrite `tokens.css`**

```css
:root {
  --void: #07080c;
  --ground: #090b10;
  --panel: #0c0e14;
  --panel-raised: #0d1016;
  --panel-2: #0b0d13;
  --line: #1d2230;
  --line-strong: #232a3a;
  --tick: #39405a;
  --text: #e7e6e2;
  --text-bright: #f3ead8;
  --muted: #7d8598;
  --faint: #6c7488;
  --accent: #f0a443;
  --accent-ink: #1a1408;
  --accent-bg: #1a160e;
  --cream: #f6e7c8;
  --green: #8fd6a4;
  --green-bg: #0f1a14;
  --green-border: #24382b;
  --blue: #7fb2ff;
  --blue-bg: #111a2a;
  --warn: #f0c27a;
  --warn-text: #f6dcae;
  --warn-bg: #1a160e;
  --warn-border: #3d3220;
  --red: #f0a0a0;
  --red-bg: #2a1618;
  --red-border: #5a2a2e;
  --idle: #555b64;
  --font-ui: 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --radius: 4px;
  --radius-sm: 3px;
  --ease: cubic-bezier(0.2, 0.7, 0.2, 1);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}
```
Then rename the old token uses across `app.css` and `screens.css` (no aliases):
- `var(--border)` → `var(--line)`
- `var(--border-strong)` → `var(--line-strong)`
- `var(--text-soft)` → `var(--text)`
- `var(--term)` → `var(--void)`
- `var(--panel-2)` stays
- `var(--radius-lg)` → `var(--radius)`

Run `grep -rn "var(--\(border\|border-strong\|text-soft\|term\|radius-lg\))" src/renderer` and expect no output. Also replace the hard-coded `#8fb4ff` / `#b8cfff` link colours in `app.css` with `var(--blue)` / `var(--text-bright)`, and `style={{ color: '#e9b75c' }}` in components with `var(--warn)` (`grep -rn "#e9b75c" src/renderer`).

- [ ] **Step 6: Bundle fonts and drop Google Fonts**

At the top of `src/renderer.tsx`, before `app.css`:
```ts
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
```
In `index.html`, remove the two `<link>` tags for `fonts.googleapis.com`. In `vite.renderer.config.mts`, change the CSP to:
```ts
const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; script-src 'self'";
```

- [ ] **Step 7: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS. If `oxfmt --check` fails, run `npm run lint:fix` and re-run.

- [ ] **Step 8: Visual check and commit**

Run `npm start` and confirm the app renders in Plex Sans and JetBrains Mono with DevTools network offline (no font requests), and the terminal shows the new background and amber cursor. Then:
```bash
git add -A
git commit -m "feat: instrument design tokens, bundled fonts and terminal theme"
```

---

### Task 2: Instrument components

**Files:**
- Create: `src/renderer/components/instrument/MindMark.tsx`, `RingGauge.tsx`, `Bracketed.tsx`, `TickRule.tsx`, `Label.tsx`, `IconButton.tsx`, `index.ts`, `instrument.test.tsx`, `src/renderer/styles/instrument.css`
- Modify: `src/renderer/styles/app.css` (add `@import './instrument.css';` after `screens.css`)

**Interfaces:**
- Produces (all named exports from `src/renderer/components/instrument/index.ts`):
  - `MindMark({ size = 16 }: { size?: number })`
  - `RingGauge({ value, max, size = 18, segments, label }: { value: number; max?: number; size?: number; segments?: { value: number; color: string }[]; label?: string })`. Without `max` it uses `REFERENCE_EUR = 50`. Renders `<svg role="img" aria-label={label}>`, or `aria-hidden` when there's no label. Arc length is `clamp(value / (max ?? 50), 0, 1)`.
  - `export const REFERENCE_EUR = 50`
  - `Bracketed({ active, as = 'div', className, children, ...rest })`: adds class `bracketed` and `is-active`.
  - `TickRule()`: `<div className="tickrule" aria-hidden="true" />`
  - `Label({ children })`: `<span className="ilabel">{children}</span>`
  - `IconButton({ label, shortcut, tone = 'default', onClick, disabled, children }: { label: string; shortcut?: string; tone?: 'default' | 'accent' | 'green'; onClick?: () => void; disabled?: boolean; children: ReactNode })`: `<button type="button" className={`ibtn ibtn-${tone}`} aria-label={label} title={shortcut ? `${label} (${shortcut})` : label}>`
  - `export const modKey: 'Cmd' | 'Ctrl'` (from `navigator.platform` / `userAgent` containing `Mac`), for shortcut labels

- [ ] **Step 1: Write the failing tests**

`src/renderer/components/instrument/instrument.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Bracketed, IconButton, Label, MindMark, RingGauge } from '.';

const arcLength = (el: Element) =>
  Number(el.querySelector('[data-part="arc"]')!.getAttribute('data-fraction'));

describe('RingGauge', () => {
  it('fills against the 50 EUR reference scale without max', () => {
    render(<RingGauge value={12.5} label="AI cost 12.50" />);
    expect(arcLength(screen.getByRole('img', { name: 'AI cost 12.50' }))).toBe(0.25);
  });
  it('clamps to the full ring and to empty', () => {
    const { container, rerender } = render(<RingGauge value={500} />);
    expect(arcLength(container)).toBe(1);
    rerender(<RingGauge value={-3} />);
    expect(arcLength(container)).toBe(0);
  });
  it('draws one arc per segment, in order', () => {
    const { container } = render(
      <RingGauge value={10} max={10} segments={[{ value: 8, color: 'var(--accent)' }, { value: 2, color: 'var(--blue)' }]} />,
    );
    const segs = container.querySelectorAll('[data-part="segment"]');
    expect([...segs].map((s) => s.getAttribute('data-fraction'))).toEqual(['0.8', '0.2']);
  });
  it('is hidden from assistive tech without a label', () => {
    const { container } = render(<RingGauge value={1} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('IconButton', () => {
  it('uses the label as accessible name and the shortcut in the tooltip', async () => {
    const onClick = vi.fn();
    render(<IconButton label="New task" shortcut="Ctrl+N" onClick={onClick}>+</IconButton>);
    const b = screen.getByRole('button', { name: 'New task' });
    expect(b).toHaveAttribute('title', 'New task (Ctrl+N)');
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('Bracketed, Label, MindMark', () => {
  it('marks the active frame', () => {
    const { container } = render(<Bracketed active>x</Bracketed>);
    expect(container.firstChild).toHaveClass('bracketed', 'is-active');
  });
  it('renders a label and a decorative mark', () => {
    const { container } = render(<><Label>webshop</Label><MindMark /></>);
    expect(screen.getByText('webshop')).toHaveClass('ilabel');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/components/instrument`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the components**

`MindMark.tsx`. The geometry matches icon C: a dim ring, an amber quadrant arc and a cream core with a bloom. The gradient ids use `useId` so several marks can coexist.
```tsx
import { useId } from 'react';

export function MindMark({ size = 16 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="mindmark">
      <defs>
        <radialGradient id={`${id}g`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffd08a" />
          <stop offset="0.4" stopColor="#f0a443" stopOpacity="0.7" />
          <stop offset="1" stopColor="#f0a443" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="26" fill="none" stroke="#2c3142" strokeWidth="3" />
      <path d="M32 6 A26 26 0 0 1 58 32" fill="none" stroke="#f0a443" strokeWidth="4" strokeLinecap="round" />
      <circle cx="32" cy="32" r="16" fill={`url(#${id}g)`} />
      <circle cx="32" cy="32" r="8" fill="#f6e7c8" />
    </svg>
  );
}
```
`RingGauge.tsx`:
```tsx
export const REFERENCE_EUR = 50;
const R = 24;
const C = 2 * Math.PI * R;
const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const round = (n: number) => Math.round(n * 1000) / 1000;

export function RingGauge({
  value,
  max,
  size = 18,
  segments,
  label,
}: {
  value: number;
  max?: number;
  size?: number;
  segments?: { value: number; color: string }[];
  label?: string;
}) {
  const scale = max ?? REFERENCE_EUR;
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="ring" {...a11y}>
      <circle cx="32" cy="32" r={R} fill="none" stroke="var(--line-strong)" strokeWidth="7" />
      {segments ? (
        segments.map((s, i) => {
          const f = round(clamp(s.value / scale));
          const el = (
            <circle
              key={i}
              data-part="segment"
              data-fraction={f}
              cx="32" cy="32" r={R} fill="none" stroke={s.color} strokeWidth="7"
              strokeDasharray={`${f * C} ${C}`}
              strokeDashoffset={-offset * C}
              transform="rotate(-90 32 32)"
            />
          );
          offset += f;
          return el;
        })
      ) : (
        <circle
          data-part="arc"
          data-fraction={round(clamp(value / scale))}
          cx="32" cy="32" r={R} fill="none" stroke="var(--accent)" strokeWidth="7"
          strokeDasharray={`${round(clamp(value / scale)) * C} ${C}`}
          transform="rotate(-90 32 32)"
        />
      )}
    </svg>
  );
}
```
`Bracketed.tsx`:
```tsx
import type { HTMLAttributes, ReactNode } from 'react';

export function Bracketed({
  active = false,
  className = '',
  children,
  ...rest
}: { active?: boolean; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`bracketed${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}
```
`TickRule.tsx`: `export const TickRule = () => <div className="tickrule" aria-hidden="true" />;`
`Label.tsx`: `export const Label = ({ children }: { children: ReactNode }) => <span className="ilabel">{children}</span>;`
`IconButton.tsx`:
```tsx
import type { ReactNode } from 'react';

export const modKey: 'Cmd' | 'Ctrl' =
  typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent) ? 'Cmd' : 'Ctrl';

export function IconButton({
  label, shortcut, tone = 'default', onClick, disabled, children,
}: {
  label: string; shortcut?: string; tone?: 'default' | 'accent' | 'green';
  onClick?: () => void; disabled?: boolean; children: ReactNode;
}) {
  return (
    <button type="button" className={`ibtn ibtn-${tone}`} aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
```
`index.ts` re-exports all six, plus `REFERENCE_EUR` and `modKey`.

`instrument.css`:
```css
.tickrule { height: 1px; background: repeating-linear-gradient(90deg, var(--tick) 0 1px, transparent 1px 10px); }
.ilabel { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--faint); }
.ilabel::before { content: '\25E6  '; color: var(--accent); }
.bracketed { position: relative; border: 1px solid var(--line); background: var(--panel-2); }
.bracketed::before, .bracketed::after { content: ''; position: absolute; width: 6px; height: 6px; border: solid var(--tick); pointer-events: none; }
.bracketed::before { left: -1px; top: -1px; border-width: 1px 0 0 1px; }
.bracketed::after { right: -1px; bottom: -1px; border-width: 0 1px 1px 0; }
.bracketed.is-active { border-color: #3a3322; background: #14120d; }
.bracketed.is-active::before, .bracketed.is-active::after { border-color: var(--accent); }
.ibtn { width: 24px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--line-strong); border-radius: var(--radius); background: transparent; color: var(--text); font-size: 12px; padding: 0; transition: border-color 140ms var(--ease), color 140ms var(--ease); }
.ibtn:hover:not(:disabled) { border-color: var(--tick); color: var(--text-bright); }
.ibtn:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
.ibtn:disabled { opacity: 0.4; cursor: default; }
.ibtn-accent { border-color: var(--accent); color: var(--accent); }
.ibtn-green { border-color: var(--green-border); color: var(--green); }
.ring { flex: none; display: block; }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/components/instrument`
Expected: PASS (7 tests).

- [ ] **Step 5: Checks and commit**

Run: `npm run typecheck && npm run lint`
```bash
git add -A && git commit -m "feat: instrument components (mind mark, ring gauge, brackets, labels, icon buttons)"
```

---

### Task 3: UI prefs and store (tabs, Focus, rail, openUsage)

**Files:**
- Create: `src/renderer/uiPrefs.ts`, `src/renderer/uiPrefs.test.tsx`, `src/renderer/store.test.tsx`
- Modify: `src/renderer/store.ts`

**Interfaces:**
- Produces from `uiPrefs.ts`:
  - `type UiPrefs = { navCollapsed: boolean; focus: boolean }`
  - `readPrefs(storage?: Storage): UiPrefs`
  - `writePref<K extends keyof UiPrefs>(key: K, value: UiPrefs[K], storage?: Storage): void`

  The keys are `miac.ui.navCollapsed` and `miac.ui.focus`, stored as `'true'` / `'false'`; any other value reads as the default `false`. Storage exceptions are swallowed.
- Produces from `store.ts`:
  - `export const USAGE_TAB = 'usage'`
  - state: `tabByTask: Record<string, string>`, `focus: boolean`, `navCollapsed: boolean`
  - actions:
    - `setTab(taskId: string, tab: string): void`
    - `activeTab(taskId: string): string`: returns the stored tab if it is `USAGE_TAB` or the id of a terminal that still exists on that task; otherwise the first terminal id; otherwise `USAGE_TAB`.
    - `openUsage(taskId: string): void`: selects the task, goes to the workspace and sets the tab to `USAGE_TAB`.
    - `toggleFocus(): void`
    - `setNavCollapsed(v: boolean): void`
  - The `Screen` union is unchanged in this task; `usage` is removed in Task 7.

- [ ] **Step 1: Write failing tests**

`src/renderer/uiPrefs.test.tsx`:
```tsx
import { beforeEach, describe, expect, it } from 'vitest';
import { readPrefs, writePref } from './uiPrefs';

beforeEach(() => localStorage.clear());

describe('uiPrefs', () => {
  it('defaults to expanded nav and no focus', () => {
    expect(readPrefs()).toEqual({ navCollapsed: false, focus: false });
  });
  it('round-trips', () => {
    writePref('focus', true);
    writePref('navCollapsed', true);
    expect(localStorage.getItem('miac.ui.focus')).toBe('true');
    expect(readPrefs()).toEqual({ navCollapsed: true, focus: true });
  });
  it('treats bad values as defaults', () => {
    localStorage.setItem('miac.ui.focus', '{"x":1}');
    localStorage.setItem('miac.ui.navCollapsed', 'yes');
    expect(readPrefs()).toEqual({ navCollapsed: false, focus: false });
  });
  it('survives a storage that throws', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } as unknown as Storage;
    expect(readPrefs(broken)).toEqual({ navCollapsed: false, focus: false });
    expect(() => writePref('focus', true, broken)).not.toThrow();
  });
});
```
`src/renderer/store.test.tsx`:
```tsx
import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskView } from '../shared/types';
import { USAGE_TAB, useStore } from './store';

const base = useStore.getState();
const task = (id: string, terms: string[]): TaskView =>
  ({ id, repoId: 'r', name: id, workItem: null, slug: id, branch: 'b', worktreePath: '/w', baseRef: 'main', status: 'ready',
     setup: { copy: false, commands: [], startClaude: false, openShell: false, openCopilot: false },
     terminals: terms.map((t) => ({ id: t, kind: 'shell' as const, label: t })),
     createdAt: 'now', finishedAt: null, worktreeMissing: false, usageSyncedAt: null, usageSyncError: null, usageCommentId: null });

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ ...base, tasks: [], tabByTask: {}, focus: false, navCollapsed: false, screen: { kind: 'workspace' } });
});

describe('tabs', () => {
  it('defaults to the first terminal, or Usage without terminals', () => {
    useStore.setState({ tasks: [task('a', ['t1', 't2']), task('b', [])] });
    expect(useStore.getState().activeTab('a')).toBe('t1');
    expect(useStore.getState().activeTab('b')).toBe(USAGE_TAB);
  });
  it('falls back when the selected terminal is gone', () => {
    useStore.setState({ tasks: [task('a', ['t1', 't2'])] });
    useStore.getState().setTab('a', 't2');
    useStore.setState({ tasks: [task('a', ['t1'])] });
    expect(useStore.getState().activeTab('a')).toBe('t1');
    useStore.setState({ tasks: [task('a', [])] });
    expect(useStore.getState().activeTab('a')).toBe(USAGE_TAB);
  });
  it('openUsage selects the task, the workspace and the Usage tab', () => {
    useStore.setState({ tasks: [task('a', ['t1'])], screen: { kind: 'settings' } });
    useStore.getState().openUsage('a');
    const s = useStore.getState();
    expect(s.selectedTaskId).toBe('a');
    expect(s.screen).toEqual({ kind: 'workspace' });
    expect(s.activeTab('a')).toBe(USAGE_TAB);
  });
});

describe('focus and rail', () => {
  it('persist through uiPrefs', () => {
    useStore.getState().toggleFocus();
    useStore.getState().setNavCollapsed(true);
    expect(useStore.getState().focus).toBe(true);
    expect(localStorage.getItem('miac.ui.focus')).toBe('true');
    expect(localStorage.getItem('miac.ui.navCollapsed')).toBe('true');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/uiPrefs.test.tsx src/renderer/store.test.tsx`
Expected: FAIL (missing module / missing store members).

- [ ] **Step 3: Implement**

`src/renderer/uiPrefs.ts`:
```ts
export type UiPrefs = { navCollapsed: boolean; focus: boolean };
const KEY: Record<keyof UiPrefs, string> = { navCollapsed: 'miac.ui.navCollapsed', focus: 'miac.ui.focus' };
const DEFAULTS: UiPrefs = { navCollapsed: false, focus: false };
const local = (): Storage | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);

export function readPrefs(storage: Storage | undefined = local()): UiPrefs {
  const read = (k: keyof UiPrefs): boolean => {
    try {
      return storage?.getItem(KEY[k]) === 'true';
    } catch {
      return DEFAULTS[k];
    }
  };
  return { navCollapsed: read('navCollapsed'), focus: read('focus') };
}

export function writePref<K extends keyof UiPrefs>(key: K, value: UiPrefs[K], storage: Storage | undefined = local()): void {
  try {
    storage?.setItem(KEY[key], String(value));
  } catch {
    /* preferences are best effort */
  }
}
```
In `store.ts`, add to the `Store` type and the initial state (`...readPrefs()` for `focus` and `navCollapsed`, and `tabByTask: {}`):
```ts
export const USAGE_TAB = 'usage';
// in create():
tabByTask: {},
...readPrefs(),
setTab: (taskId, tab) => set({ tabByTask: { ...get().tabByTask, [taskId]: tab } }),
activeTab: (taskId) => {
  const task = get().tasks.find((t) => t.id === taskId);
  const want = get().tabByTask[taskId];
  if (want === USAGE_TAB) return USAGE_TAB;
  if (task && want && task.terminals.some((t) => t.id === want)) return want;
  return task?.terminals[0]?.id ?? USAGE_TAB;
},
openUsage: (taskId) =>
  set({ selectedTaskId: taskId, screen: { kind: 'workspace' }, tabByTask: { ...get().tabByTask, [taskId]: USAGE_TAB } }),
toggleFocus: () => {
  const focus = !get().focus;
  writePref('focus', focus);
  set({ focus });
},
setNavCollapsed: (navCollapsed) => {
  writePref('navCollapsed', navCollapsed);
  set({ navCollapsed });
},
```
Components must subscribe to `tabByTask` and `tasks` (not only call `activeTab`) so they re-render. The usage pattern is `useStore((s) => s.activeTab(task.id))`; zustand re-runs the selector on every state change, and it returns a string, so equality holds.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer`
Expected: PASS, including the existing tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: per-task tab selection, focus and nav rail prefs in the store"
```

---

### Task 4: Usage view data (`lastAt`, `recent`, `tokenMix`, `timeline`)

**Files:**
- Modify: `src/shared/usage.ts` (`SessionSummary`, `TaskUsage`), `src/main/usage/UsageStore.ts` (`summarize`), `src/main/usage/UsageStore.test.ts`, the fixtures in `src/renderer/test-helpers/fakeApi.ts`, `src/renderer/screens/UsageScreen.test.tsx`, `src/shared/workItemUsage.test.ts` and `src/main/usage/UsageSync.test.ts` (wherever a `SessionSummary` or `TaskUsage` literal is built; `npm run typecheck` lists them)
- Create: `src/shared/usageViews.ts`, `src/shared/usageViews.test.ts`

**Interfaces:**
- Produces:
  - `SessionSummary.lastAt: string`: the latest record `at` of the session.
  - `type RecentPoint = { at: string; tool: UsageTool; costEur: number }`
  - `TaskUsage.recent: RecentPoint[]`: billable, priced records with `at >= now - 6h`, sorted by `at`.
  - `UsageStore.summarize(taskId: string, now = Date.now()): TaskUsage`
  - From `usageViews.ts`:
    - `tokenMix(u: TaskUsage): { cacheRead: number; input: number; cacheWrite: number; output: number }`: summed over billable sessions.
    - `type Bin = { start: number; costEur: number; byTool: Record<UsageTool, number>; dominant: UsageTool | null }`
    - `timeline(recent: RecentPoint[], now: number, o = { hours: 6, binMinutes: 15 }): Bin[]`: always `hours * 60 / binMinutes` bins, oldest first; the last bin ends at `now`. A point is in the window when `now - hours*3600e3 <= at <= now`; future points are dropped.
    - `isLive(s: SessionSummary, now: number, windowMs = 5 * 60_000): boolean`

- [ ] **Step 1: Write failing `usageViews` tests**

`src/shared/usageViews.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { RecentPoint, SessionSummary, TaskUsage } from './usage';
import { isLive, timeline, tokenMix } from './usageViews';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const p = (minAgo: number, costEur: number, tool: RecentPoint['tool'] = 'claude-code'): RecentPoint => ({ at: at(minAgo), tool, costEur });

describe('timeline', () => {
  it('always returns 24 bins of 15 minutes, oldest first, ending at now', () => {
    const bins = timeline([], NOW);
    expect(bins).toHaveLength(24);
    expect(bins[23].start).toBe(NOW - 15 * 60_000);
    expect(bins[0].start).toBe(NOW - 6 * 3600_000);
    expect(bins.every((b) => b.costEur === 0 && b.dominant === null)).toBe(true);
  });
  it('bins points and picks the dominant tool', () => {
    const bins = timeline([p(1, 2), p(2, 1, 'copilot-cli'), p(3, 0.5, 'copilot-cli')], NOW);
    expect(bins[23].costEur).toBeCloseTo(3.5);
    expect(bins[23].byTool).toEqual({ 'claude-code': 2, 'copilot-cli': 1.5 });
    expect(bins[23].dominant).toBe('claude-code');
  });
  it('includes a point at exactly now - 6h in the first bin and drops older and future points', () => {
    const bins = timeline([p(360, 1), p(361, 9), p(-5, 9)], NOW);
    expect(bins[0].costEur).toBe(1);
    expect(bins.reduce((n, b) => n + b.costEur, 0)).toBe(1);
  });
  it('puts a point at exactly now in the last bin', () => {
    expect(timeline([p(0, 4)], NOW)[23].costEur).toBe(4);
  });
});

const session = (over: Partial<SessionSummary>): SessionSummary => ({
  sessionId: 's', tool: 'claude-code', startedAt: at(30), lastAt: at(10), models: ['m'], requests: 1,
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, unpricedRequests: 0, billable: true, ...over,
});

describe('tokenMix', () => {
  it('sums billable sessions only', () => {
    const u = { sessions: [
      session({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 100, cacheWriteTokens: 5 }),
      session({ sessionId: 'x', inputTokens: 1000, billable: false }),
    ] } as TaskUsage;
    expect(tokenMix(u)).toEqual({ cacheRead: 100, input: 10, cacheWrite: 5, output: 2 });
  });
});

describe('isLive', () => {
  it('is live within 5 minutes of the last event', () => {
    expect(isLive(session({ lastAt: at(4) }), NOW)).toBe(true);
    expect(isLive(session({ lastAt: at(6) }), NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Write failing `UsageStore` tests**

Add to `src/main/usage/UsageStore.test.ts`. Follow the file's existing helpers for building a store and adding events, and reuse its event factory. If it has none, write one inline that returns a full `UsageEvent` with the overrides applied.
```ts
it('reports lastAt per session and recent billable priced points in the last 6 hours', async () => {
  // Build the store as the other tests in this file do, with a rate that prices model 'claude-opus-5-5'.
  const now = Date.parse('2026-10-14T12:00:00.000Z');
  const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  await store.add(event({ id: 'e1', sessionId: 's1', at: iso(400) }));  // older than 6h
  await store.add(event({ id: 'e2', sessionId: 's1', at: iso(30) }));
  await store.add(event({ id: 'e3', sessionId: 's2', at: iso(10) }));
  await store.setBillable('t1', 's2', false);
  const u = store.summarize('t1', now);
  expect(u.sessions.find((s) => s.sessionId === 's1')!.lastAt).toBe(iso(30));
  expect(u.recent.map((r) => r.at)).toEqual([iso(30)]);
  expect(u.recent[0].costEur).toBeGreaterThan(0);
});
```
Adjust the names `store`, `event` and `setBillable` to what the file uses: read the top of `UsageStore.test.ts` and the public methods of `UsageStore` first.

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/shared/usageViews.test.ts src/main/usage/UsageStore.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

In `src/shared/usage.ts`: add `lastAt: string;` after `startedAt` in `SessionSummary`. Add:
```ts
/** One billable, priced request from the last 6 hours, for the usage timeline. */
export type RecentPoint = { at: string; tool: UsageTool; costEur: number };
```
and `recent: RecentPoint[];` to `TaskUsage`.

In `UsageStore.summarize(taskId: string, now = Date.now())`:
- Initialise `lastAt: r.at` with the session.
- In the loop, `if (r.at > s.lastAt) s.lastAt = r.at; if (r.at < s.startedAt) s.startedAt = r.at;`
- Before `return`:
```ts
const since = now - 6 * 3600_000;
const recent = this.records(taskId)
  .filter((r) => r.costUsd !== null && sessions.get(r.sessionId)!.billable)
  .filter((r) => { const t = Date.parse(r.at); return t >= since && t <= now; })
  .map((r) => ({ at: r.at, tool: r.tool, costEur: round6(r.costUsd! * factor) }))
  .sort((a, b) => a.at.localeCompare(b.at));
```
and include `recent` in the returned object.

`src/shared/usageViews.ts`:
```ts
import type { RecentPoint, SessionSummary, TaskUsage, UsageTool } from './usage';

export type Bin = { start: number; costEur: number; byTool: Record<UsageTool, number>; dominant: UsageTool | null };

export function tokenMix(u: TaskUsage) {
  const mix = { cacheRead: 0, input: 0, cacheWrite: 0, output: 0 };
  for (const s of u.sessions.filter((x) => x.billable)) {
    mix.cacheRead += s.cacheReadTokens;
    mix.input += s.inputTokens;
    mix.cacheWrite += s.cacheWriteTokens;
    mix.output += s.outputTokens;
  }
  return mix;
}

export function timeline(recent: RecentPoint[], now: number, o = { hours: 6, binMinutes: 15 }): Bin[] {
  const binMs = o.binMinutes * 60_000;
  const count = (o.hours * 60) / o.binMinutes;
  const from = now - o.hours * 3600_000;
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({
    start: from + i * binMs, costEur: 0, byTool: { 'claude-code': 0, 'copilot-cli': 0 }, dominant: null,
  }));
  for (const p of recent) {
    const t = Date.parse(p.at);
    if (!(t >= from && t <= now)) continue;
    const i = Math.min(count - 1, Math.floor((t - from) / binMs));
    bins[i].costEur += p.costEur;
    bins[i].byTool[p.tool] += p.costEur;
  }
  for (const b of bins) {
    if (b.costEur > 0) b.dominant = b.byTool['claude-code'] >= b.byTool['copilot-cli'] ? 'claude-code' : 'copilot-cli';
  }
  return bins;
}

export const isLive = (s: SessionSummary, now: number, windowMs = 5 * 60_000): boolean =>
  now - Date.parse(s.lastAt) <= windowMs;
```
Note that `bins[0].start === now - 6h` and `bins[23].start === now - 15min`. The `from + i*binMs` arithmetic gives exactly that.

- [ ] **Step 5: Fix fixtures**

In `fakeApi.ts`, add `recent: []` to `emptyUsage`. Add `lastAt` (equal to `startedAt`) to every `SessionSummary` literal that `npm run typecheck` flags.

- [ ] **Step 6: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: session lastAt, recent usage points, token mix and timeline views"
```

---

### Task 5: Task strip (replaces TopBar and TaskHeader)

**Files:**
- Create: `src/renderer/components/TaskStrip.tsx`, `src/renderer/components/TaskStrip.test.tsx`
- Modify: `src/renderer/screens/WorkspaceScreen.tsx`, `SettingsScreen.tsx`, `SetupScreen.tsx`, `UsageScreen.tsx` (temporary: swap `TopBar` for the breadcrumb strip; the screen is deleted in Task 7), their tests, `src/renderer/styles/instrument.css`, and `app.css` (delete the `.topbar`, `.brand`, `.taskhead*` and `.costtile` rules)
- Delete: `src/renderer/components/TopBar.tsx`, `TaskHeader.tsx`, `TaskHeader.test.tsx` (move each of its assertions into `TaskStrip.test.tsx`)

**Interfaces:**
- Consumes: `MindMark`, `RingGauge`, `IconButton`, `TickRule`, `modKey` (Task 2); `useStore().openUsage` (Task 3); `useTaskUsage`, `eur`, `ago`, `api`, `tryInvoke`.
- Produces:
  - `TaskStrip({ task }: { task: TaskView })`
  - `CrumbStrip({ crumb, back }: { crumb: string; back?: { label: string; onClick: () => void } })`

  Both render `<header className="strip">`. `CrumbStrip` is for screens without a task: it shows the mark, `MIAC`, `/`, the crumb, and the back link on the right. Clicking the `MIAC` mark/wordmark goes to the workspace in both.
- Also produces: `useGitSummary(taskId: string, worktreeMissing: boolean): GitSummary | null`. The polling hook is extracted from `TaskHeader` into `src/renderer/hooks/useGitSummary.ts`, unchanged (5 s poll).

- [ ] **Step 1: Write failing tests**

`src/renderer/components/TaskStrip.test.tsx`. Build the task fixture as `WorkspaceScreen.test.tsx` does (copy its `task` object), and use `installFakeApi` with `'tasks:gitSummary': () => ({ ahead: 2, behind: 0, files: [{ path: 'a', status: 'M' }] })`. Match the `GitSummary` type in `src/shared/types.ts`, and adapt the file entries to its exact shape.
```tsx
describe('TaskStrip', () => {
  it('shows id, title, branch, git state and cost', async () => {
    installFakeApi({ 'tasks:gitSummary': () => git, 'usage:task': (id) => ({ ...emptyUsage(id), billable: { costUsd: 25, costEur: 23, tokens: 1 } }) });
    render(<TaskStrip task={task} />);
    expect(screen.getByText('48213')).toBeInTheDocument();
    expect(screen.getByText('Checkout: allow saving a delivery address')).toBeInTheDocument();
    expect(await screen.findByText(/feature\/48213-save-delivery-address/)).toBeInTheDocument();
    expect(await screen.findByText(/↑2/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /AI cost .*23\.00/ })).toBeInTheDocument();
  });
  it('opens the Usage tab from the cost gauge', async () => {
    installFakeApi({ 'tasks:gitSummary': () => git });
    useStore.setState({ tasks: [task] });
    render(<TaskStrip task={task} />);
    await userEvent.click(await screen.findByRole('button', { name: /AI cost/ }));
    expect(useStore.getState().activeTab(task.id)).toBe('usage');
  });
  it('opens the detail card on title focus and closes it with Escape', async () => {
    installFakeApi({ 'tasks:gitSummary': () => git });
    render(<TaskStrip task={task} />);
    await userEvent.tab(); // MIAC home button
    await userEvent.tab(); // title
    const card = await screen.findByRole('dialog', { name: 'Task details' });
    expect(card).toHaveTextContent('User Story 48213');
    expect(card).toHaveTextContent('/src/webshop.worktrees/48213-save-delivery-address');
    expect(card).toHaveTextContent('Not logged on the work item yet');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull();
  });
  it('has Open in VS Code, Finish task, New task and Settings actions', async () => {
    installFakeApi({ 'tasks:gitSummary': () => git });
    render(<TaskStrip task={task} />);
    for (const name of ['Open in VS Code', 'Finish task', 'New task', 'Settings'])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Finish task' }));
    expect(useStore.getState().screen).toEqual({ kind: 'finish', taskId: task.id });
  });
});
describe('CrumbStrip', () => {
  it('shows the crumb and a back link', async () => {
    const back = vi.fn();
    render(<CrumbStrip crumb="Settings" back={{ label: 'Back to tasks', onClick: back }} />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to tasks' }));
    expect(back).toHaveBeenCalled();
  });
});
```
Port each assertion of the deleted `TaskHeader.test.tsx` into this file: the sync line variants, the ADO link button that opens `shell:openExternal`, the disabled VS Code button when `worktreeMissing`, and so on. Keep the assertions; change only the queries: the details now sit inside the `Task details` card.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/components/TaskStrip.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `TaskStrip` and `CrumbStrip`**

Key structure. Glyphs come from code points: `BRANCH = String.fromCharCode(0x2387)`, `UP = 0x2191`, `DOWN = 0x2193`, `DELTA = 0x394`, `PLUS = 0xff0b`, `GEAR = 0x2699`, `CHECK = 0x2713`.
```tsx
export function TaskStrip({ task }: { task: TaskView }) {
  const go = useStore((s) => s.go);
  const openUsage = useStore((s) => s.openUsage);
  const notify = useStore((s) => s.notify);
  const usage = useTaskUsage(task.id);
  const git = useGitSummary(task.id, task.worktreeMissing);
  const [card, setCard] = useState(false);
  const cost = usage?.billable.costEur ?? 0;
  return (
    <header className="strip">
      <Home />
      <span className="strip-sep" aria-hidden="true">/</span>
      <div className="strip-task" onMouseEnter={() => setCard(true)} onMouseLeave={() => setCard(false)}>
        <button type="button" className="strip-title" aria-expanded={card} aria-controls="task-details"
          onFocus={() => setCard(true)} onBlur={(e) => { if (!e.currentTarget.parentElement!.contains(e.relatedTarget as Node)) setCard(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setCard(false); }}>
          {task.workItem && <span className="mono strip-id">{task.workItem.id}</span>}
          <span className="strip-name">{task.workItem?.title ?? task.name}</span>
        </button>
        {card && <TaskDetails task={task} git={git} onClose={() => setCard(false)} />}
      </div>
      <span className="mono strip-git">
        {`${BRANCH} ${task.branch}`}
        {git && ` ${UP}${git.ahead}${git.behind ? ` ${DOWN}${git.behind}` : ''} · ${git.files.length ? `${git.files.length}${DELTA}` : 'clean'}`}
      </span>
      <span className="spacer" />
      <button type="button" className="strip-cost" aria-label={`AI cost ${eur(cost)}, open usage`} onClick={() => openUsage(task.id)}>
        <RingGauge value={cost} /> <span className="mono">{usage ? eur(cost) : '—'}</span>
      </button>
      <IconButton label="Open in VS Code" disabled={task.worktreeMissing} onClick={() => tryInvoke(() => api().invoke('tasks:openInEditor', task.id), notify)}>{'{ }'}</IconButton>
      <IconButton label="Finish task" tone="green" onClick={() => go({ kind: 'finish', taskId: task.id })}>{CHECK}</IconButton>
      <IconButton label="New task" tone="accent" onClick={() => go({ kind: 'new-task' })}>{PLUS}</IconButton>
      <IconButton label="Settings" onClick={() => go({ kind: 'settings' })}>{GEAR}</IconButton>
      <TickRule />
    </header>
  );
}
```
- Replace the literal `·` and `—` in the snippet with `String.fromCharCode` constants, to keep the source ASCII and match the file's style.
- `Home` is a button with `aria-label="MIAC, back to tasks"` containing `<MindMark />` and `<span className="strip-word">MIAC</span>`; it calls `go({ kind: 'workspace' })`.
- `TaskDetails` is `<div role="dialog" id="task-details" aria-label="Task details" className="strip-card bracketed">`. It holds the old header content: the type and id with the ADO link button (`shell:openExternal`, as in the old `TaskHeader`), the status, the branch, the git summary, the worktree path, the Claude/Copilot split and the sync line (copy the `syncLine` logic from `TaskHeader.tsx` verbatim). It has `onKeyDown` Escape → `onClose`.

`CrumbStrip` renders `<header className="strip"><Home /><span className="strip-sep">/</span><span className="strip-crumb">{crumb}</span><span className="spacer" />{back && <button type="button" className="linkbtn" onClick={back.onClick}>{back.label}</button>}<TickRule /></header>`.

CSS in `instrument.css`:
```css
.strip { position: relative; height: 32px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 8px 0 10px; background: var(--panel-raised); }
.strip > .tickrule { position: absolute; left: 0; right: 0; bottom: 0; }
.strip-home { display: inline-flex; align-items: center; gap: 8px; background: none; border: 0; padding: 0; color: var(--text-bright); }
.strip-word { font-family: var(--font-mono); font-weight: 600; font-size: 11px; letter-spacing: 0.22em; }
.strip-sep { color: var(--muted); }
.strip-task { position: relative; min-width: 0; flex: 0 1 auto; }
.strip-title { display: flex; gap: 8px; align-items: baseline; min-width: 0; background: none; border: 0; padding: 0; }
.strip-id { color: var(--accent); font-size: 11px; }
.strip-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.strip-git { font-size: 10.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.strip-cost { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px 0 3px; border: 1px solid var(--line-strong); border-radius: 999px; background: transparent; font-weight: 600; }
.strip-cost:hover { border-color: var(--accent); }
.strip-card { position: absolute; top: 28px; left: 0; z-index: 20; width: 420px; padding: 10px 12px; display: grid; gap: 6px; font-size: 12px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6); }
.spacer { flex: 1; }
.linkbtn { background: none; border: 0; color: var(--blue); padding: 0; }
```
Give `Home` the class `strip-home`.

- [ ] **Step 4: Use the strips in screens**

- `WorkspaceScreen`: replace `<TopBar>…</TopBar>` and `<TaskHeader …/>`. When a task is selected (any status), render `<TaskStrip task={task} />` at the top. Otherwise render `<CrumbStrip crumb="Tasks" />` plus a strip-sized row with the `New task` and `Settings` `IconButton`s; simplest is to give `CrumbStrip` optional `children`, rendered before the tick rule, and pass the two buttons. Remove the `TaskHeader` import.
- `SettingsScreen`: `<CrumbStrip crumb="Settings" back={{ label: 'Back to tasks', onClick: () => go({ kind: 'workspace' }) }} />`.
- `SetupScreen`: `<CrumbStrip crumb={`${repo?.name ?? ''} / ${task.workItem?.id ?? task.name} / setup`} back={{ label: 'Back to tasks', onClick: () => go({ kind: 'workspace' }) }} />`.
- `UsageScreen` (temporary): `<CrumbStrip crumb=… back={{ label: 'Back to task', … }} />`.

Update the tests that looked for the old `MIAC` text button or the `Back to tasks` link: `getByRole('link', …)` becomes `getByRole('button', …)`.

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS. `grep -rn "TopBar\|TaskHeader" src` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: compact task strip with details card replaces the top bar and task header"
```

---

### Task 6: Dense nav with collapsible rail

**Files:**
- Modify: `src/renderer/components/TaskNav.tsx`, `src/renderer/components/TaskNav.test.tsx`, `src/renderer/styles/app.css` (the `.tasknav*` and `.taskrow*` rules move to `instrument.css` and are rewritten)

**Interfaces:**
- Consumes: `Label`, `Bracketed`, `RingGauge` (Task 2); `navCollapsed` and `setNavCollapsed` (Task 3).
- Produces: unchanged `TaskNav()` and `groupTasks` exports. `<nav aria-label="Tasks" className={navCollapsed ? 'tasknav is-rail' : 'tasknav'}>`.

- [ ] **Step 1: Write failing tests** (add to `TaskNav.test.tsx`, reusing its fixtures)

```tsx
it('collapses to a rail of cost rings and back, and remembers it', async () => {
  // set up two open tasks as the other tests in this file do
  render(<TaskNav />);
  await userEvent.click(screen.getByRole('button', { name: 'Collapse task list' }));
  expect(screen.getByRole('navigation', { name: 'Tasks' })).toHaveClass('is-rail');
  expect(localStorage.getItem('miac.ui.navCollapsed')).toBe('true');
  // each task is a button named by its id and title
  expect(screen.getByRole('button', { name: /48213 Checkout/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Expand task list' }));
  expect(screen.getByRole('navigation', { name: 'Tasks' })).not.toHaveClass('is-rail');
});
it('shows one dense row per task with id, title and cost', async () => {
  render(<TaskNav />);
  const row = screen.getByRole('button', { name: /48213/ });
  expect(row).toHaveTextContent('Checkout: allow saving a delivery address');
});
```
Add `localStorage.clear()` and `useStore.setState({ navCollapsed: false })` to the file's `beforeEach`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/components/TaskNav.test.tsx`
Expected: FAIL (no Collapse button).

- [ ] **Step 3: Implement**

Changes in `TaskNav.tsx`:
- The group header uses `<Label>{repo.name} · {list.length}</Label>`; the dot comes from a `String.fromCharCode(0xb7)` constant.
- `Row` renders a single line: `<button className="taskrow" aria-current=…><Bracketed active={selected} className="taskrow-frame">` containing the dot, the mono id (class `taskrow-id`), the title (class `taskrow-title`) and the cost (class `taskrow-cost`). Keep `aria-label` on the dot as today. The branch line goes away; the branch is in the strip.
- `RailRow` renders `<button className="railrow" aria-label={`${task.workItem?.id ?? ''} ${task.workItem?.title ?? task.name}`.trim()} title={…same} aria-current=…><Bracketed active={selected}><RingGauge value={cost} size={20} /></Bracketed></button>` with the same `pick` logic as `Row` (extract `usePick(task)`).
- The footer gets a button: in full mode `«` (`String.fromCharCode(0xab)`) with `aria-label="Collapse task list"`; in rail mode only `»` (`0xbb`) with `aria-label="Expand task list"`, and the status dot without text (its `title` is the footer text).
- In rail mode the Done group is hidden.

CSS (in `instrument.css`):
```css
.tasknav { width: 168px; flex: none; background: var(--panel); border-right: 1px solid var(--line); padding: 6px 4px; display: flex; flex-direction: column; gap: 1px; overflow-y: auto; }
.tasknav.is-rail { width: 40px; align-items: center; padding: 6px 0; gap: 6px; }
.tasknav-group { display: flex; flex-direction: column; gap: 1px; }
.tasknav-group > .ilabel { padding: 6px 6px 3px; }
.taskrow { background: none; border: 0; padding: 0; text-align: left; color: var(--text); }
.taskrow-frame { display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 6px; border-color: transparent; background: transparent; font-size: 12px; }
.taskrow:hover .taskrow-frame { background: var(--panel-2); }
.taskrow-id { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
.taskrow[aria-current='true'] .taskrow-id { color: var(--accent); }
.taskrow-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.taskrow-cost { font-family: var(--font-mono); font-size: 10.5px; color: var(--muted); }
.railrow { background: none; border: 0; padding: 0; }
.railrow .bracketed { border-color: transparent; background: transparent; padding: 3px; }
.tasknav-foot { margin-top: auto; display: flex; align-items: center; gap: 6px; padding: 6px; font-size: 10.5px; color: var(--muted); }
.tasknav-foot .linkbtn { margin-left: auto; font-family: var(--font-mono); color: var(--muted); }
```

- [ ] **Step 4: Run tests, then the other checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: dense task nav that collapses to a rail of cost rings"
```

---

### Task 7: Usage panel (replaces the usage screen and route)

**Files:**
- Create: `src/renderer/components/UsagePanel.tsx`, `src/renderer/components/UsagePanel.test.tsx`
- Delete: `src/renderer/screens/UsageScreen.tsx`, `src/renderer/screens/UsageScreen.test.tsx` (its tests move into `UsagePanel.test.tsx`)
- Modify: `src/renderer/store.ts` (remove `{ kind: 'usage'; taskId: string }` from `Screen`), `src/renderer/App.tsx` (remove the usage branch and import), `src/renderer/screens/WorkspaceScreen.tsx` (done tasks: a banner plus `UsagePanel`), `src/renderer/screens/WorkspaceScreen.test.tsx` (line ~278 asserted the `usage` route; it now asserts `activeTab === 'usage'`), `src/renderer/styles/instrument.css` (the usage panel styles), `screens.css` (delete the `.usage*` rules no longer used)

**Interfaces:**
- Consumes: `tokenMix`, `timeline`, `isLive` (Task 4); `RingGauge`, `Bracketed`, `Label` (Task 2); `useTaskUsage`; the IPC channels `usage:sync`, `usage:exportCsv`, `usage:setBillable`, `usage:fieldsStatus`; `aiFieldValues` and `renderUsageComment` from `shared/workItemUsage`.
- Produces: `UsagePanel({ taskId, now }: { taskId: string; now?: () => number })`. `now` defaults to `Date.now` and exists for tests. The root element is `<section className="usagepanel" aria-label="AI usage">`.

- [ ] **Step 1: Port the tests**

Move `UsageScreen.test.tsx` to `src/renderer/components/UsagePanel.test.tsx`:
- Render `<UsagePanel taskId="t1" />` instead of the screen.
- Remove the `screen: { kind: 'usage' … }` store setup and the "Back to task" assertions.
- Rename button queries: `Sync now` → `Write to work item`, `Export CSV` → `CSV`.

Keep every other assertion: the tiles' amounts, the unpriced warning text, the empty state text, the billable checkbox calling `usage:setBillable`, the CSV download, sync notices, fields "not on <type>", and the comment preview. Then add:
```tsx
it('splits the billable ring by tool and shows the total', async () => {
  installFakeApi({ 'usage:task': () => usage });
  render(<UsagePanel taskId="t1" />);
  const ring = await screen.findByRole('img', { name: /Billable .*9\.20/ });
  expect(ring.querySelectorAll('[data-part="segment"]')).toHaveLength(2);
});
it('marks a session with an event in the last 5 minutes as LIVE', async () => {
  const now = Date.parse('2026-10-14T10:03:00.000Z');
  installFakeApi({ 'usage:task': () => ({ ...usage, sessions: usage.sessions.map((s, i) => ({ ...s, lastAt: i === 1 ? '2026-10-14T10:00:00.000Z' : s.startedAt })) }) });
  render(<UsagePanel taskId="t1" now={() => now} />);
  const rows = await screen.findAllByRole('row');
  expect(rows.filter((r) => r.textContent?.includes('LIVE'))).toHaveLength(1);
});
it('mutes and strikes through a non-billable session', async () => {
  installFakeApi({ 'usage:task': () => ({ ...usage, sessions: [{ ...usage.sessions[0], billable: false }] }) });
  render(<UsagePanel taskId="t1" />);
  const row = (await screen.findAllByRole('row'))[1];
  expect(row).toHaveClass('is-excluded');
});
it('draws 24 timeline bins', async () => {
  installFakeApi({ 'usage:task': () => usage });
  render(<UsagePanel taskId="t1" />);
  expect(await screen.findByRole('img', { name: /Cost per 15 minutes/ })).toBeInTheDocument();
  expect(document.querySelectorAll('[data-part="bin"]')).toHaveLength(24);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/components/UsagePanel.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `UsagePanel`**

Move the logic of `UsageScreen.tsx` (fields status effect, `sync`, `exportCsv`, `setBillable`, `TOOL`, `FIELD_LABEL`, `when`) into `UsagePanel.tsx` as-is, then change the markup to:
```tsx
<section className="usagepanel" aria-label="AI usage">
  <div className="up-col up-instrument">
    <Bracketed className="up-box up-billable">
      <Label>Billable</Label>{/* TaskView has no customer field, so no customer name */}
      <RingGauge size={150} value={total} max={Math.max(total, 0.0001)} label={`Billable ${eur(total)}`}
        segments={[{ value: claude, color: 'var(--accent)' }, { value: copilot, color: 'var(--blue)' }]} />
      <div className="up-total mono">{eur(total)}</div>
      <div className="up-sub mono">{compact(usage.billable.tokens)} tokens</div>
      <div className="up-split"><span><i className="dot" style={{ background: 'var(--accent)' }} /> Claude <b className="mono">{eur(claude)}</b></span>
        <span><i className="dot" style={{ background: 'var(--blue)' }} /> Copilot <b className="mono">{eur(copilot)}</b></span></div>
    </Bracketed>
    <Bracketed className="up-box"><Label>Tokens</Label>{/* four rows: label, compact value, bar with width = value / max of the four */}</Bracketed>
    <div className="up-caption mono">{`Official list prices ${DOT} USD${ARROW}EUR ${usage.usdToEur}`}</div>
  </div>
  <div className="up-col up-main">
    <Bracketed className="up-box"><Label>Last 6 hours</Label><Timeline bins={timeline(usage.recent, now())} live={anyLive} /></Bracketed>
    {/* the unpriced warning: same text as today, class "check check-warn" */}
    <Bracketed className="up-box up-sessions"><Label>{`Sessions ${DOT} ${usage.sessions.length}`}</Label>{/* table or the empty state, same text as today */}</Bracketed>
    <Bracketed className="up-box up-workitem">{/* sync status line, the field dl, the comment status and a <details><summary>Comment preview</summary><pre className="usage-comment">…</pre></details>, then CSV and Write to work item buttons */}</Bracketed>
  </div>
</section>
```
Details:
- `total = usage.billable.costEur` and `claude` / `copilot` = `usage.byTool[…].costEur`. Copilot gets the blue segment, as in the mockup.
- The ring centre text sits in an absolutely positioned overlay `.up-total` / `.up-sub` over the 150 px ring, inside the `.up-billable` grid.
- `Timeline` is a local component: `<svg role="img" aria-label="Cost per 15 minutes, last 6 hours" viewBox="0 0 240 56" preserveAspectRatio="none">`. Each bin is a `<rect data-part="bin">` with width 8 at x = i*10. Height is `max(2, 52 * costEur / maxBin)` when `maxBin > 0`, and 2 otherwise. Fill is `--accent` for `claude-code`, `--blue` for `copilot-cli`, and `--line-strong` when empty. The last rect gets class `is-live` when `live`.
- Session rows: `className={s.billable ? undefined : 'is-excluded'}`. When `isLive(s, now())`, append a `<span className="live mono">LIVE</span>` to the Started cell.
- Table columns: Started, Tool, Model, Tokens (sum of the four counts, `compact`), EUR (the same unpriced logic as today), Bill (the existing checkbox, `aria-label="Billable"`, visually styled as a switch through CSS on `.switch input`).
- Glyphs: `DOT = String.fromCharCode(0xb7)`, `ARROW = String.fromCharCode(0x2192)`.

CSS (in `instrument.css`):
```css
.usagepanel { flex: 1; min-height: 0; overflow: auto; background: var(--void); padding: 14px 16px; display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 16px; align-content: start; }
@media (max-width: 900px) { .usagepanel { grid-template-columns: 1fr; } }
.up-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.up-box { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.up-billable { align-items: center; position: relative; }
.up-billable .ilabel { align-self: flex-start; }
.up-total { position: absolute; top: 88px; font-size: 20px; font-weight: 600; color: var(--text-bright); }
.up-sub { position: absolute; top: 116px; font-size: 9px; color: var(--muted); letter-spacing: 0.08em; }
.up-split { display: flex; justify-content: space-between; width: 100%; font-size: 11px; }
.up-bar { height: 6px; background: #151925; } .up-bar > span { display: block; height: 100%; background: var(--accent); }
.up-caption { font-size: 10px; color: var(--muted); }
.usagepanel table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.usagepanel th { text-align: left; font: 10px var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); font-weight: 400; padding: 4px 6px; border-bottom: 1px solid var(--line); }
.usagepanel td { padding: 4px 6px; border-bottom: 1px solid #12151e; white-space: nowrap; }
.usagepanel tr.is-excluded { color: var(--faint); } .usagepanel tr.is-excluded td.eur { text-decoration: line-through; }
.live { color: var(--accent); font-size: 9.5px; margin-left: 6px; animation: pulse 1.6s var(--ease) infinite; }
rect.is-live { animation: pulse 1.6s var(--ease) infinite; }
@keyframes pulse { 50% { opacity: 0.35; } }
```
Give the EUR `<td>` the class `eur`.

- [ ] **Step 4: Remove the route and wire done tasks**

- In `store.ts`, remove the `usage` member of `Screen`; in `App.tsx`, remove its branch and import.
- In `WorkspaceScreen.tsx`, the done-task branch becomes:
```tsx
<>
  <div className="done-banner">
    <ArtSlot name="empty-done" />  {/* added in Task 12; until then omit this line */}
    <p>This task is done. Its worktree and branch were cleaned up on {task.finishedAt}.</p>
  </div>
  <UsagePanel taskId={task.id} />
</>
```
Leave the `ArtSlot` line out in this task and add it in Task 12.
- Every former `go({ kind: 'usage', … })` (the WorkspaceScreen "View AI usage" button and the old cost tile) is gone or becomes `openUsage`. Check with `grep -rn "kind: 'usage'" src`.

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: usage panel with ring, token mix and timeline replaces the usage screen"
```

---

### Task 8: Tab row with the pinned Usage tab, shortcuts, the new-usage dot and Focus mode

**Files:**
- Create: `src/renderer/hooks/useShortcuts.ts`
- Modify: `src/renderer/components/TerminalTabs.tsx`, `src/renderer/screens/WorkspaceScreen.tsx`, `src/renderer/screens/WorkspaceScreen.test.tsx`, `src/renderer/styles/app.css` (delete the old `.tabs` and `.tab` rules), `instrument.css`

**Interfaces:**
- Consumes: `USAGE_TAB`, `activeTab`, `setTab`, `focus`, `toggleFocus`, `navCollapsed` (Task 3); `UsagePanel` (Task 7); `MindMark`, `RingGauge`, `IconButton`, `modKey` (Task 2).
- Produces:
  - `useShortcuts(task: TaskView | null): void`: one `window` `keydown` listener in the **capture** phase. With `mod = isMac ? e.metaKey : e.ctrlKey`, and `!e.altKey`:
    - `mod && !shift && /^[0-9]$/.test(e.key)`: `0` selects `USAGE_TAB`, `n` selects `task.terminals[n-1]` if it exists. It calls `preventDefault()` and `stopPropagation()` only when it acts.
    - `mod && shift && e.code === 'KeyF'`: `toggleFocus()`, `preventDefault()`, `stopPropagation()`.
    - Anything else is untouched. The hook does nothing when `task` is null or its status is not `ready`.
  - `TerminalTabs({ task }: { task: TaskView })` renders the tab row and the pane host (terminals plus `UsagePanel`).

- [ ] **Step 1: Write failing tests** (in `WorkspaceScreen.test.tsx`, reusing its fixtures; the mocked `TerminalView` renders `data-testid="term-<id>"` with `data-active`)

```tsx
describe('tabs and focus', () => {
  beforeEach(() => { localStorage.clear(); useStore.setState({ focus: false, navCollapsed: false, tabByTask: {} }); });

  it('pins Usage first, before the terminals', async () => {
    setup(); // the file's existing helper that installs the fake API and selects task 'a'; write one if missing
    render(<WorkspaceScreen />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([expect.stringContaining('Usage'), 'Claude Code', 'zsh']);
  });

  it('switches with Mod+0 and Mod+2 even when the key comes from inside the terminal', async () => {
    setup();
    render(<WorkspaceScreen />);
    const term = await screen.findByTestId('term-c1');
    fireEvent.keyDown(term, { key: '0', code: 'Digit0', ctrlKey: true, metaKey: true });
    expect(screen.getByRole('region', { name: 'AI usage' })).toBeVisible();
    fireEvent.keyDown(term, { key: '2', code: 'Digit2', ctrlKey: true, metaKey: true });
    expect(screen.getByTestId('term-s1')).toHaveAttribute('data-active', 'true');
  });

  it('leaves other keys alone', async () => {
    setup();
    render(<WorkspaceScreen />);
    const term = await screen.findByTestId('term-c1');
    const ev = createEvent.keyDown(term, { key: 'c', ctrlKey: true });
    fireEvent(term, ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('keeps the same terminal node across Usage, terminals and Focus', async () => {
    setup();
    render(<WorkspaceScreen />);
    const before = await screen.findByTestId('term-c1');
    await userEvent.click(screen.getByRole('tab', { name: /Usage/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'Claude Code' }));
    fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true, ctrlKey: true, metaKey: true });
    expect(screen.getByTestId('term-c1')).toBe(before);
  });

  it('Focus hides the strip and the nav, persists, and double-click toggles it back', async () => {
    setup();
    render(<WorkspaceScreen />);
    fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true, ctrlKey: true, metaKey: true });
    expect(screen.queryByRole('navigation', { name: 'Tasks' })).toBeNull();
    expect(document.querySelector('header.strip')).toBeNull();
    expect(localStorage.getItem('miac.ui.focus')).toBe('true');
    await userEvent.dblClick(screen.getByRole('tablist', { name: 'Terminals' }));
    expect(screen.getByRole('navigation', { name: 'Tasks' })).toBeInTheDocument();
  });

  it('keeps the rail in Focus when the nav was collapsed', async () => {
    setup();
    useStore.setState({ navCollapsed: true });
    render(<WorkspaceScreen />);
    fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true, ctrlKey: true, metaKey: true });
    expect(screen.getByRole('navigation', { name: 'Tasks' })).toHaveClass('is-rail');
  });

  it('shows a new-usage dot on the Usage tab until it is selected', async () => {
    const { emit } = setup();
    render(<WorkspaceScreen />);
    await screen.findByTestId('term-c1');
    act(() => emit('usage:changed', { taskId: 'a' }));
    expect(screen.getByRole('tab', { name: /Usage, new usage/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Usage/ }));
    expect(screen.getByRole('tab', { name: 'Usage' })).toBeInTheDocument();
  });

  it('falls back to Usage when a task has no terminals', async () => {
    setup({ terminals: [] });
    render(<WorkspaceScreen />);
    expect(await screen.findByRole('region', { name: 'AI usage' })).toBeVisible();
  });
});
```
The tests set both `ctrlKey` and `metaKey`, so they pass on macOS and Windows runners whatever `isMac` detects. Import `createEvent` and `fireEvent` from `@testing-library/react`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/screens/WorkspaceScreen.test.tsx`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement `useShortcuts`**

```ts
import { useEffect } from 'react';
import type { TaskView } from '../../shared/types';
import { USAGE_TAB, useStore } from '../store';

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent);

export function useShortcuts(task: TaskView | null): void {
  useEffect(() => {
    if (!task || task.status !== 'ready') return;
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey) return;
      const { setTab, toggleFocus } = useStore.getState();
      if (e.shiftKey && e.code === 'KeyF') {
        toggleFocus();
      } else if (!e.shiftKey && /^[0-9]$/.test(e.key)) {
        const n = Number(e.key);
        const target = n === 0 ? USAGE_TAB : task.terminals[n - 1]?.id;
        if (!target) return;
        setTab(task.id, target);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [task]);
}
```
xterm handles keys on its own textarea's `keydown`, which bubbles; a capture listener on `window` runs first and `stopPropagation()` keeps the key from reaching xterm. Confirm by hand in Step 7.

- [ ] **Step 4: Implement `TerminalTabs`**

- Replace the local `active` state with `const active = useStore((s) => s.activeTab(task.id)); const setTab = useStore((s) => s.setTab);`. Remove the `useEffect` fallback, since the store now handles it. `open()` calls `setTab(task.id, created.id)`.
- The new-usage dot: `const [unseen, setUnseen] = useState(false);` plus an effect subscribing to `api().on('usage:changed', p => { if ((p.taskId === task.id || p.taskId === '*') && useStore.getState().activeTab(task.id) !== USAGE_TAB) setUnseen(true); })`, and `useEffect(() => { if (active === USAGE_TAB) setUnseen(false); }, [active]);`.
- Tab row markup:
```tsx
<div role="tablist" aria-label="Terminals" className="tabrow" onDoubleClick={(e) => { if (e.target === e.currentTarget) toggleFocus(); }}>
  {focus && <span className="tabrow-brand"><MindMark size={14} /><span className="mono">{task.workItem?.id ?? task.name}</span></span>}
  <button type="button" role="tab" aria-selected={active === USAGE_TAB} aria-label={unseen ? 'Usage, new usage' : 'Usage'}
    className="tab tab-pin" onClick={() => setTab(task.id, USAGE_TAB)}>
    <span className="mono tab-glyph" aria-hidden="true">{QUARTER}</span>Usage{unseen && <span className="tab-new" aria-hidden="true" />}
  </button>
  {task.terminals.map((t) => (/* the existing tab button, className "tab", aria-selected={active === t.id}, onClick={() => setTab(task.id, t.id)} */))}
  {/* the existing + and Copilot CLI buttons, now className "tab tab-add" */}
  <div className="tabrow-right">
    {runCommands.length > 0 && <><span className="ilabel">Run</span>{runCommands.map(([name, command]) => <button key={name} type="button" className="chip" onClick={() => open({ kind: 'run', label: name, command })} disabled={task.worktreeMissing}>{name}</button>)}</>}
    {focus && <CostPill taskId={task.id} />}
    <IconButton label={focus ? 'Exit focus' : 'Focus'} shortcut={`${modKey}+Shift+F`} onClick={toggleFocus}>{focus ? COLLAPSE : EXPAND}</IconButton>
  </div>
</div>
<div className="termhost">
  {active === USAGE_TAB && <UsagePanel taskId={task.id} />}
  {task.terminals.map((t) => <TerminalView key={t.id} terminalId={t.id} active={active === t.id} />)}
</div>
```
- Glyphs: `QUARTER = String.fromCharCode(0x25d4)`, `EXPAND = String.fromCharCode(0x2922)`, `COLLAPSE = String.fromCharCode(0x2921)`.
- `CostPill` is the cost button from `TaskStrip`. Extract it there as `export function CostPill({ taskId })` (it uses `useTaskUsage`, `RingGauge` and `openUsage`) and import it in both places.
- Drop the old "No terminals" empty state. With no terminals the store selects Usage, so the panel shows.
- In `WorkspaceScreen`, call `useShortcuts(task)`. Render `TaskStrip` only when `!focus`, and render `<TaskNav />` when `!focus || navCollapsed`.

CSS:
```css
.tabrow { height: 26px; flex: none; display: flex; align-items: stretch; gap: 2px; padding: 0 6px; background: var(--panel-2); border-bottom: 1px solid var(--line); }
.tab { display: flex; align-items: center; gap: 6px; padding: 0 10px; background: none; color: var(--muted); font-size: 11.5px; border: 1px solid transparent; border-bottom: 0; transition: color 120ms var(--ease); }
.tab:hover { color: var(--text); }
.tab[aria-selected='true'] { color: var(--text-bright); background: var(--void); border-color: var(--line); margin-bottom: -1px; box-shadow: inset 0 1px 0 var(--accent); }
.tab-pin { border-right-color: var(--line); margin-right: 4px; }
.tab-glyph { color: var(--accent); }
.tab-new { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: pulse 1.6s var(--ease) infinite; }
.tabrow-brand { display: flex; align-items: center; gap: 6px; padding-right: 8px; margin-right: 4px; border-right: 1px solid var(--line); color: var(--accent); font-size: 10.5px; }
.tabrow-right { margin-left: auto; display: flex; align-items: center; gap: 4px; }
.chip { font: 10.5px var(--font-mono); padding: 1px 7px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: none; color: var(--text); }
.chip:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.tabrow .ibtn { height: 18px; width: 20px; font-size: 10px; }
.termhost { flex: 1; min-height: 0; display: flex; background: var(--void); }
```
Keep the existing `.termhost` and `.termview` sizing rules from `app.css`; merge them with these, without duplicates.

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: pinned usage tab, tab shortcuts, new-usage dot and focus mode"
```

- [ ] **Step 7: Manual check**

Run `npm start` and open a task with a running shell:
- `Cmd+0`, `Cmd+1` and `Cmd+2` switch tabs while the terminal has focus.
- `Cmd+Shift+F` toggles Focus.
- `Ctrl+C` still interrupts the shell, and typing normally works.
- Switching tabs does not clear the terminal.

Report any failure as a bug against this task.

---

### Task 9: Other screens, the setup tick rule, the splash setting and About

**Files:**
- Modify: `src/shared/usage.ts` (`showSplash`), `src/main/usage/SettingsStore.test.ts`, `src/shared/ipc.ts` (`'app:info'`), `src/main/ipc/handlers.ts` (handler + dependency `appVersion: string`), `src/main/ipc/handlers.test.ts`, `src/main.ts` (pass `appVersion: app.getVersion()`), `src/renderer/test-helpers/fakeApi.ts` (defaults for `settings:get` with `showSplash: true`, and `'app:info': () => ({ version: '1.0.0' })`), `src/renderer/components/StepList.tsx`, `src/renderer/screens/{SettingsScreen,SetupScreen,NewTaskScreen,FinishScreen}.tsx` and tests, `src/renderer/styles/screens.css`

**Interfaces:**
- Produces:
  - `AppSettings.showSplash: boolean` (zod `.default(true)`)
  - `defaultSettings()` includes `showSplash: true`
  - IPC `'app:info': { args: []; result: { version: string } }`
  - Settings sections `#appearance` (a "Show splash on start" checkbox that saves through the existing `settings:save`) and `#about`

- [ ] **Step 1: Failing tests**

In `SettingsStore.test.ts`:
```ts
it('defaults showSplash to true for files written before sub-project 6', async () => {
  const f = file();
  writeFileSync(f, JSON.stringify({ version: 1, receiverPort: 4319, hourlySync: true }));
  const s = new SettingsStore(f);
  await s.load();
  expect(s.get().showSplash).toBe(true);
});
```
In `SettingsScreen.test.tsx`:
```tsx
it('toggles the splash setting', async () => {
  const { calls } = installFakeApi({ 'settings:save': (next) => next });
  render(<SettingsScreen />);
  const box = await screen.findByRole('checkbox', { name: 'Show splash on start' });
  expect(box).toBeChecked();
  await userEvent.click(box);
  expect(calls.find((c) => c.channel === 'settings:save')?.args[0]).toMatchObject({ showSplash: false });
});
it('shows the About panel with the version', async () => {
  installFakeApi();
  render(<SettingsScreen />);
  const about = await screen.findByRole('region', { name: 'About' });
  expect(about).toHaveTextContent("Me, I'm Counting");
  expect(about).toHaveTextContent('General Systems Vehicle (accounting division)');
  expect(about).toHaveTextContent('1.0.0');
});
```
In `handlers.test.ts`, following the file's pattern: `'app:info'` returns `{ version: <the appVersion dependency> }`.

In the `StepList` test (create `src/renderer/components/StepList.test.tsx` if none exists):
```tsx
it('renders a ticked rule with status per step', () => {
  render(<StepList steps={[
    { def: { label: 'Create worktree', detail: '' }, status: 'done', ms: 1200 },
    { def: { label: 'npm ci', detail: '' }, status: 'running' },
    { def: { label: 'Build', detail: '' }, status: 'failed' },
  ] as never} />);
  const items = screen.getAllByRole('listitem');
  expect(items.map((i) => i.getAttribute('data-status'))).toEqual(['done', 'running', 'failed']);
  expect(screen.getByRole('list')).toHaveClass('steps', 'steps-rule');
});
```
Check the `SetupState['steps']` element type in `src/shared/types.ts`, and build the fixture to match it instead of `as never` if that's straightforward.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/usage/SettingsStore.test.ts src/renderer/screens/SettingsScreen.test.tsx src/renderer/components/StepList.test.tsx src/main/ipc/handlers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `usage.ts`: add `showSplash: z.boolean().default(true),` to `AppSettingsSchema` and `showSplash: true` to `defaultSettings()`. If zod 4's inferred type makes `showSplash` optional on input, keep `AppSettings = z.infer<…>` (the output type), which is `boolean`.
- `ipc.ts`: `'app:info': { args: []; result: { version: string } };`. In `handlers.ts`, add `appVersion: string` to the deps type and `'app:info': async () => ({ version: s.appVersion })`. In `main.ts`, pass `appVersion: app.getVersion()` in `createHandlers({...})`.
- `StepList`: add class `steps-rule` to the `<ol>`. CSS:
```css
.steps-rule { position: relative; list-style: none; margin: 0; padding: 0 0 0 18px; }
.steps-rule::before { content: ''; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 1px; background: repeating-linear-gradient(180deg, var(--tick) 0 1px, transparent 1px 6px); }
.steps-rule .step-icon { position: absolute; left: -18px; width: 11px; text-align: center; font-family: var(--font-mono); }
.steps-rule .step[data-status='done'] .step-icon { color: var(--accent); }
.steps-rule .step[data-status='running'] .step-icon { color: var(--accent); animation: pulse 1.6s var(--ease) infinite; }
.steps-rule .step[data-status='failed'] .step-icon { color: var(--red); }
.steps-rule .step[data-status='todo'] .step-icon { color: var(--faint); }
.steps-rule .step { position: relative; }
```
- `SettingsScreen`: add nav links `Appearance` and `About`.
  - The `<section id="appearance">` has a heading and a `<label className="checkbox"><input type="checkbox" checked={settings.showSplash} onChange={…save({ ...settings, showSplash: e.target.checked })} /> Show splash on start</label>`. Reuse how the screen already loads and saves `settings:get` / `settings:save` for `hourlySync`, the same pattern.
  - The `<section id="about" aria-label="About" className="about bracketed">` holds `<ArtSlot name="about-registry" />` (added in Task 12; leave it out for now), `<MindMark size={40} />`, `<h2 className="mono">MIAC</h2>`, `<p>Me, I'm Counting</p>`, `<p className="muted">General Systems Vehicle (accounting division)</p>`, and `<p className="mono muted">v{version}</p>` from `app:info`.
  - Section headings use `<Label>`.
- `SetupScreen`, `NewTaskScreen`, `FinishScreen`: no structural change.
  - Replace the `pill-*` work item tags with `<span className="mono strip-id">{type} {id}</span>`.
  - Replace section headings with `<Label>`.
  - Wrap the dialog boxes (`.dialog`) in the new surface: in `screens.css` set `.dialog { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: 0 24px 64px rgba(0,0,0,.7); }`, with `.dialog-head` underlined by a `.tickrule`.
  - Primary buttons: `.btn-primary { background: transparent; color: var(--accent); border: 1px solid var(--accent); }`, and hover `background: var(--accent-bg)`.
  - The setup log pane uses `background: var(--void)`.

  Keep all copy and roles unchanged, so the existing tests pass untouched apart from queries for removed pills. Adjust those queries to the new text.

- [ ] **Step 4: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Visual check and commit**

Run `npm start` and click through New task, Setup, Finish and Settings: they should look consistent, nothing should be unreadable, and Settings should show Appearance and About. Then:
```bash
git add -A && git commit -m "feat: instrument styling for setup, dialogs and settings, splash setting and about panel"
```

---

### Task 10: Splash window and boot reporting

**Files:**
- Create: `src/main/splash.ts`, `src/main/splash.test.ts`, `splash.html` (project root, next to `index.html`), `src/splash/splash.ts`, `src/splash/splash.css`, `src/splashPreload.ts`, `vite.splash.config.mts`
- Modify: `forge.config.mts`, `src/declarations.d.ts`, `src/main.ts`, `src/main/smoke.test.ts` (only if it asserts on boot internals)

**Interfaces:**
- Produces from `src/main/splash.ts`:
```ts
export type SplashWindowLike = {
  isDestroyed(): boolean;
  webContents: { send(channel: string, ...args: unknown[]): void };
  close(): void;
  once(event: 'ready-to-show', fn: () => void): void;
};
export const SPLASH_MIN_MS = 2200;
export const SPLASH_FADE_MS = 200;
export class SplashReporter {
  constructor(win: SplashWindowLike | null, opts?: { minMs?: number; fadeMs?: number });
  step(label: string): void;          // sends 'splash:step'
  fail(message: string): void;        // sends 'splash:fail'; afterwards done() never resolves
  skip(): void;                       // called from ipcMain 'splash:skip'
  done(): Promise<void>;              // resolves at shownAt + minMs, or on skip; immediately when win is null or destroyed
  fadeOut(): Promise<void>;           // sends 'splash:done', resolves after fadeMs (immediately if no window)
  close(): void;                      // closes if not destroyed
  get active(): boolean;              // window exists and not destroyed
}
export function createSplashWindow(): BrowserWindow;
```
- The splash preload exposes `window.splash = { onStep(fn), onFail(fn), onDone(fn), skip(), quit() }`, using the channels `splash:step`, `splash:fail`, `splash:done` (main → splash) and `splash:skip`, `splash:quit` (splash → main, `ipcRenderer.send`).
- The version reaches the splash in the URL hash: `#v=<version>`.

- [ ] **Step 1: Write failing `SplashReporter` tests**

`src/main/splash.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SplashReporter, type SplashWindowLike } from './splash';

function stub() {
  let ready: () => void = () => {};
  let destroyed = false;
  const sent: [string, unknown[]][] = [];
  const win: SplashWindowLike = {
    isDestroyed: () => destroyed,
    webContents: { send: (c, ...a) => { sent.push([c, a]); } },
    close: vi.fn(() => { destroyed = true; }),
    once: (_e, fn) => { ready = fn; },
  };
  return { win, sent, show: () => ready(), destroy: () => { destroyed = true; } };
}
const settled = async (p: Promise<unknown>) => {
  let done = false;
  void p.then(() => { done = true; });
  await Promise.resolve(); await Promise.resolve();
  return done;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SplashReporter', () => {
  it('done waits for the 2.2 s minimum after the window shows', async () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    const d = r.done();
    s.show();
    await vi.advanceTimersByTimeAsync(2199);
    expect(await settled(d)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(d)).toBe(true);
  });
  it('does not start the clock before the window shows', async () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    const d = r.done();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await settled(d)).toBe(false);
    s.show();
    await vi.advanceTimersByTimeAsync(2200);
    expect(await settled(d)).toBe(true);
  });
  it('skip resolves early', async () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    s.show();
    const d = r.done();
    r.skip();
    expect(await settled(d)).toBe(true);
  });
  it('sends steps and failures', () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    r.step('Loading tasks');
    r.fail('state.json: EACCES');
    expect(s.sent).toEqual([['splash:step', ['Loading tasks']], ['splash:fail', ['state.json: EACCES']]]);
  });
  it('never resolves done after a failure, and keeps the window', async () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    s.show();
    const d = r.done();
    r.fail('boom');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await settled(d)).toBe(false);
    expect(s.win.close).not.toHaveBeenCalled();
  });
  it('is a no-op without a window (splash off)', async () => {
    const r = new SplashReporter(null);
    expect(() => { r.step('x'); r.fail('y'); r.close(); }).not.toThrow();
    expect(await settled(r.done())).toBe(true);
    expect(await settled(r.fadeOut())).toBe(true);
    expect(r.active).toBe(false);
  });
  it('ignores calls after the window is destroyed, and done resolves', async () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    s.destroy();
    r.step('x');
    expect(s.sent).toEqual([]);
    expect(await settled(r.done())).toBe(true);
  });
  it('fadeOut tells the page and waits 200 ms', async () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    const f = r.fadeOut();
    expect(s.sent.at(-1)).toEqual(['splash:done', []]);
    await vi.advanceTimersByTimeAsync(199);
    expect(await settled(f)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(f)).toBe(true);
  });
});
```
Because `src/main/splash.ts` imports `electron` (for `createSplashWindow`), add at the top of the test: `vi.mock('electron', () => ({ BrowserWindow: class {}, app: { getVersion: () => '1.0.0' } }));`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/splash.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `SplashReporter` and `createSplashWindow`**

```ts
import path from 'node:path';
import { app, BrowserWindow } from 'electron';

export const SPLASH_MIN_MS = 2200;
export const SPLASH_FADE_MS = 200;

export type SplashWindowLike = { /* as in Interfaces */ };

export class SplashReporter {
  private shownAt: number | null = null;
  private failed = false;
  private release: (() => void) | null = null;
  private readonly minMs: number;
  private readonly fadeMs: number;
  private readonly gate: Promise<void>;

  constructor(private readonly win: SplashWindowLike | null, opts: { minMs?: number; fadeMs?: number } = {}) {
    this.minMs = opts.minMs ?? SPLASH_MIN_MS;
    this.fadeMs = opts.fadeMs ?? SPLASH_FADE_MS;
    this.gate = new Promise((resolve) => { this.release = resolve; });
    if (!this.active) { this.open(); return; }
    win!.once('ready-to-show', () => {
      this.shownAt = Date.now();
      setTimeout(() => this.open(), this.minMs);
    });
  }
  get active(): boolean { return this.win !== null && !this.win.isDestroyed(); }
  private open(): void { if (!this.failed) this.release?.(); }
  private send(channel: string, ...args: unknown[]): void { if (this.active) this.win!.webContents.send(channel, ...args); }
  step(label: string): void { this.send('splash:step', label); }
  fail(message: string): void { this.failed = true; this.send('splash:fail', message); }
  skip(): void { this.open(); }
  done(): Promise<void> { return this.active ? this.gate : Promise.resolve(); }
  fadeOut(): Promise<void> {
    if (!this.active) return Promise.resolve();
    this.send('splash:done');
    return new Promise((resolve) => setTimeout(resolve, this.fadeMs));
  }
  close(): void { if (this.active) this.win!.close(); }
}

export function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 640, height: 400, frame: false, resizable: false, center: true, show: false,
    backgroundColor: '#050609', title: 'MIAC', skipTaskbar: false,
    webPreferences: { preload: path.join(__dirname, 'splashPreload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => win.show());
  const hash = `v=${encodeURIComponent(app.getVersion())}`;
  if (SPLASH_WINDOW_VITE_DEV_SERVER_URL) void win.loadURL(`${SPLASH_WINDOW_VITE_DEV_SERVER_URL}/splash.html#${hash}`);
  else void win.loadFile(path.join(__dirname, `../renderer/${SPLASH_WINDOW_VITE_NAME}/splash.html`), { hash });
  return win;
}
```
Check one subtlety against the "destroyed" test: when the window is already destroyed at construction, the constructor calls `open()` straight away and `done()` returns `Promise.resolve()`. When it is destroyed later, `done()` returns `Promise.resolve()` because `active` is false. Both pass.

`src/declarations.d.ts`: add `declare const SPLASH_WINDOW_VITE_DEV_SERVER_URL: string | undefined; declare const SPLASH_WINDOW_VITE_NAME: string;`. Forge's env types only declare `MAIN_WINDOW_*`, so check `node_modules/@electron-forge/plugin-vite/forge-vite-env.d.ts` first and add these only if they're missing. In the test environment the constants are undefined, but `createSplashWindow` isn't called there.

- [ ] **Step 4: Run reporter tests**

Run: `npx vitest run src/main/splash.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Splash page, preload and Forge entries**

`src/splashPreload.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('splash', {
  onStep: (fn: (label: string) => void) => ipcRenderer.on('splash:step', (_e, l: string) => fn(l)),
  onFail: (fn: (message: string) => void) => ipcRenderer.on('splash:fail', (_e, m: string) => fn(m)),
  onDone: (fn: () => void) => ipcRenderer.on('splash:done', () => fn()),
  skip: () => ipcRenderer.send('splash:skip'),
  quit: () => ipcRenderer.send('splash:quit'),
});
```
`vite.splash.config.mts`:
```ts
import { defineConfig, type Plugin } from 'vite';

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; script-src 'self'";
function cspForBuild(): Plugin {
  return { name: 'miac-splash-csp', apply: 'build', transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }] };
}
export default defineConfig({ plugins: [cspForBuild()], build: { rollupOptions: { input: 'splash.html' } } });
```
In `forge.config.mts`:
- add `{ entry: 'src/splashPreload.ts', config: 'vite.preload.config.mts', target: 'preload' }` to `build`;
- add `{ name: 'splash_window', config: 'vite.splash.config.mts' }` to `renderer`.

`splash.html` (project root):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>MIAC</title>
    <link rel="icon" href="/assets/icon/png/32.png" />
  </head>
  <body>
    <main class="sp" id="sp">
      <div class="neb" id="neb"></div>
      <div class="stars"></div>
      <div class="scan"></div>
      <div class="center">
        <svg width="170" height="170" viewBox="0 0 200 200" aria-hidden="true">
          <defs>
            <radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffd08a" /><stop offset=".35" stop-color="#f0a443" stop-opacity=".75" /><stop offset="1" stop-color="#f0a443" stop-opacity="0" /></radialGradient>
          </defs>
          <circle cx="100" cy="100" r="80" fill="none" stroke="#1d2230" stroke-width="1" />
          <circle class="ring ticks" cx="100" cy="100" r="80" fill="none" stroke="#f0a443" stroke-width="2.5" transform="rotate(-90 100 100)" />
          <circle class="ring arc" cx="100" cy="100" r="80" fill="none" stroke="#f0a443" stroke-width="5" stroke-linecap="round" transform="rotate(-90 100 100)" />
          <text class="counter" id="cnt" x="100" y="108" text-anchor="middle">0000</text>
          <circle class="bloom" cx="100" cy="100" r="52" fill="url(#g)" />
          <g class="core"><circle cx="100" cy="100" r="22" fill="#f6e7c8" /><circle cx="94" cy="94" r="8" fill="#fff" opacity=".7" /></g>
        </svg>
        <div class="word" aria-label="MIAC"><span>M</span><span>I</span><span>A</span><span>C</span></div>
        <div class="tag">ME, I'M COUNTING</div>
      </div>
      <div class="rule"></div>
      <div class="status"><span><b>&rsaquo;</b> <span id="step" role="status">Starting</span></span><span id="ver"></span></div>
      <div class="fail" id="fail" hidden><span id="failmsg"></span><button type="button" id="quit">Quit</button></div>
    </main>
    <script type="module" src="/src/splash/splash.ts"></script>
  </body>
</html>
```
The favicon `href` is fixed in Task 11, which creates the PNGs. Until then the browser tolerates the missing file.

`src/splash/splash.css` is the animation from the approved mockup (option B), scaled to 640×400:
```css
@import '@fontsource/jetbrains-mono/400.css';
@import '@fontsource/jetbrains-mono/600.css';
html, body { margin: 0; height: 100%; background: #050609; overflow: hidden; user-select: none; cursor: default; }
.sp { position: relative; width: 100%; height: 100%; font-family: 'JetBrains Mono', ui-monospace, monospace; color: #e7e6e2; transition: opacity 200ms ease-out; }
.sp.out { opacity: 0; }
.neb { position: absolute; inset: 0; background-size: cover; background-position: center; opacity: 0; mask-image: radial-gradient(closest-side, transparent 30%, #000 100%); -webkit-mask-image: radial-gradient(closest-side, transparent 30%, #000 100%); }
.stars { position: absolute; inset: -10%; opacity: 0; background-image:
  radial-gradient(1px 1px at 10% 20%, #fff9, transparent), radial-gradient(1px 1px at 30% 70%, #fff6, transparent),
  radial-gradient(1.5px 1.5px at 55% 15%, #fff8, transparent), radial-gradient(1px 1px at 75% 55%, #fff5, transparent),
  radial-gradient(1px 1px at 90% 30%, #fff7, transparent), radial-gradient(1.2px 1.2px at 20% 90%, #fff6, transparent),
  radial-gradient(1px 1px at 65% 85%, #fff5, transparent), radial-gradient(1px 1px at 45% 45%, #fff4, transparent),
  radial-gradient(1px 1px at 5% 60%, #fff6, transparent), radial-gradient(1.3px 1.3px at 85% 90%, #fff7, transparent); }
.scan { position: absolute; left: 0; right: 0; top: 0; height: 40%; transform: translateY(-100%); opacity: 0; pointer-events: none;
  background: linear-gradient(180deg, transparent, rgba(240,164,67,.07) 80%, rgba(240,164,67,.25)); }
.center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
.ring { stroke-dashoffset: 503; }
.ticks { stroke-dasharray: 2 10; }
.arc { stroke-dasharray: 126 503; }
.counter { font: 600 26px 'JetBrains Mono', monospace; fill: #f0a443; opacity: 0; }
.bloom { opacity: 0; transform-origin: 100px 100px; }
.core { opacity: 0; }
.word { font-weight: 600; letter-spacing: .5em; padding-left: .5em; font-size: 24px; color: #f3ead8; }
.word span { opacity: 0; display: inline-block; }
.tag { font-size: 10px; letter-spacing: .32em; color: #7d8598; opacity: 0; }
.rule { position: absolute; left: 20px; right: 20px; bottom: 36px; height: 1px; transform-origin: left; transform: scaleX(0);
  background: repeating-linear-gradient(90deg, #39405a 0 1px, transparent 1px 10px); }
.status { position: absolute; left: 20px; right: 20px; bottom: 14px; font-size: 10.5px; color: #6c7488; display: flex; justify-content: space-between; opacity: 0; }
.status b { color: #f0a443; font-weight: 400; }
.fail { position: absolute; left: 20px; right: 20px; bottom: 44px; display: flex; gap: 12px; align-items: center; color: #f0a0a0; font-size: 11px; }
.fail button { font: inherit; color: #f0a0a0; background: transparent; border: 1px solid #5a2a2e; border-radius: 3px; padding: 3px 10px; cursor: pointer; }

.run .stars { animation: fade 1s ease-out forwards; }
.run .neb { animation: nebIn 1.6s .1s ease-out forwards; }
.run .scan { animation: scan 1.1s .1s cubic-bezier(.6,0,.2,1) forwards; }
.run .counter { animation: fade .1s .3s forwards, fadeOut .2s 1.5s forwards; }
.run .ring { animation: sweep 1.2s .3s cubic-bezier(.6,0,.2,1) forwards; }
.run .core { animation: fade .3s 1.5s forwards; }
.run .bloom { animation: bloom 1.2s 1.5s ease-out forwards, breathe 2.4s 2.7s ease-in-out infinite; }
.run .word span { animation: glyph .25s forwards; }
.run .word span:nth-child(1) { animation-delay: 1.6s; } .run .word span:nth-child(2) { animation-delay: 1.7s; }
.run .word span:nth-child(3) { animation-delay: 1.8s; } .run .word span:nth-child(4) { animation-delay: 1.9s; }
.run .tag { animation: fade .6s 2.1s forwards; }
.run .status { animation: fade .4s .3s forwards; }
.run .rule { animation: grow 2.2s .1s cubic-bezier(.4,0,.2,1) forwards; }
.final .stars, .final .core, .final .tag, .final .status, .final .word span { opacity: 1; animation: none; }
.final .neb { opacity: .5; animation: none; } .final .bloom { opacity: .85; animation: none; }
.final .ring { stroke-dashoffset: 0; animation: none; } .final .rule { transform: none; animation: none; }
.final .counter, .final .scan { opacity: 0; animation: none; }
.final.breathe .bloom { animation: breathe 2.4s ease-in-out infinite; }

@keyframes fade { to { opacity: 1 } }
@keyframes fadeOut { to { opacity: 0 } }
@keyframes nebIn { to { opacity: .5 } }
@keyframes sweep { to { stroke-dashoffset: 0 } }
@keyframes scan { 0% { transform: translateY(-100%); opacity: 1 } 100% { transform: translateY(250%); opacity: 0 } }
@keyframes bloom { 0% { opacity: 0; transform: scale(.3) } 40% { opacity: 1; transform: scale(1.25) } 100% { opacity: .85; transform: scale(1) } }
@keyframes breathe { 50% { opacity: .55; transform: scale(.94) } }
@keyframes glyph { 0% { opacity: 0; transform: translateY(4px); filter: blur(3px) } 100% { opacity: 1; transform: none; filter: none } }
@keyframes grow { to { transform: scaleX(1) } }
@media (prefers-reduced-motion: reduce) { .sp * { animation: none !important; transition: none !important; } }
```
`src/splash/splash.ts`:
```ts
import './splash.css';

type SplashApi = { onStep(fn: (l: string) => void): void; onFail(fn: (m: string) => void): void; onDone(fn: () => void): void; skip(): void; quit(): void };
const api = (window as unknown as { splash: SplashApi }).splash;
const $ = (id: string) => document.getElementById(id)!;
const sp = $('sp');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

$('ver').textContent = `v${new URLSearchParams(location.hash.slice(1)).get('v') ?? ''}`;

function toFinal() {
  sp.classList.remove('run');
  sp.classList.add('final');
  if (!reduced) sp.classList.add('breathe');
}

if (reduced) toFinal();
else {
  sp.classList.add('run');
  const cnt = $('cnt');
  const t0 = performance.now();
  const tick = (t: number) => {
    const p = Math.min(1, Math.max(0, (t - t0 - 300) / 1150));
    cnt.textContent = String(Math.round(1440 * (1 - (1 - p) ** 3))).padStart(4, '0');
    if (p < 1 && sp.classList.contains('run')) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setTimeout(toFinal, 2400);
}

const skip = () => { toFinal(); api.skip(); };
window.addEventListener('keydown', skip, { once: true });
window.addEventListener('mousedown', skip, { once: true });

api.onStep((l) => { $('step').textContent = l; });
api.onFail((m) => {
  toFinal();
  sp.classList.remove('breathe');
  $('failmsg').textContent = m;
  $('fail').hidden = false;
  $('quit').addEventListener('click', () => api.quit());
});
api.onDone(() => sp.classList.add('out'));
```
The nebula backdrop is set in Task 12 (`$('neb').style.backgroundImage`). Until then `.neb` stays empty.

- [ ] **Step 6: Wire into `main.ts`**

- Import: `import { createSplashWindow, SplashReporter } from './main/splash';`.
- `createWindow()` gets `show: false`, and `backgroundColor: '#090b10'` to match the new ground.
- Change `boot()` to `boot(): Promise<void>`, with this structure:
```ts
async function boot(): Promise<void> {
  const userData = app.getPath('userData');
  const settings = new SettingsStore(path.join(userData, 'settings.json'));
  const settingsLoaded = await settings.load();
  splashWin = settings.get().showSplash ? createSplashWindow() : null;
  const reporter = new SplashReporter(splashWin);
  ipcMain.on('splash:skip', () => reporter.skip());
  ipcMain.on('splash:quit', () => app.quit());
  try {
    reporter.step('Loading tasks');
    // ...existing store, recover, git, platform, connections, repos, prune, usage dir, usage store, handlers...
    // (remove the old `const settings`/`settingsLoaded`/`userData` lines further down; they moved up)
    reporter.step(`Starting usage receiver 127.0.0.1:${settings.get().receiverPort}`);
    const receiverStarted = await receiver.start(settings.get().receiverPort);
    // ...copilot.start(), stopUsage, terminal listeners...
    reporter.step(`Checking Azure DevOps ${DOT} ${connections.list().length} connection(s)`);
    mainWindow = createWindow();
    const win = mainWindow;
    // ...the existing did-finish-load notices block, unchanged...
    await Promise.all([new Promise<void>((r) => win.once('ready-to-show', () => r())), reporter.done()]);
    reporter.step('Ready');
    await reporter.fadeOut();
    revealMain(win);
    reporter.close();
    splashWin = null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(e);
    if (reporter.active) reporter.fail(message);
    else {
      dialog.showErrorBox('MIAC could not start', message);
      app.quit();
    }
  }
}
```
- `DOT = String.fromCharCode(0xb7)`.
- Use the method `ConnectionStore` actually has for listing connections: look for `list()` or `all()` in `src/main/services/ConnectionStore.ts`.
- Add module-level `let splashWin: BrowserWindow | null = null;`.
- `revealMain`:
```ts
function revealMain(win: BrowserWindow): void {
  if (process.platform === 'linux') { win.show(); return; }
  win.setOpacity(0);
  win.show();
  const t0 = Date.now();
  const timer = setInterval(() => {
    const p = Math.min(1, (Date.now() - t0) / 200);
    if (win.isDestroyed()) { clearInterval(timer); return; }
    win.setOpacity(p);
    if (p === 1) clearInterval(timer);
  }, 16);
}
```
- Replace `.then(boot).catch((e) => { console.error(e); app.quit(); })` with `.then(boot)`. `boot` handles its own errors now. Keep a final `.catch((e) => { console.error(e); app.quit(); })` for errors thrown before the splash exists (settings load).
- The `second-instance` handler: `const target = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : splashWin && !splashWin.isDestroyed() ? splashWin : null; if (!target) return; …restore/focus target`.
- The `activate` handler (macOS dock click with no windows): it calls `createWindow()`, which now has `show: false`. Add `win.once('ready-to-show', () => win.show())` in that handler: `const w = createWindow(); w.once('ready-to-show', () => w.show()); mainWindow = w;`.
- The smoke path is unchanged (`MIAC_SMOKE` never calls `boot`).
- `window-all-closed`: with the splash closed after the main window shows, nothing changes. On a boot failure the splash stays open until Quit.

- [ ] **Step 7: Run checks, then try it**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

Run `npm start` and check:
- The splash appears centred and frameless and plays B: scan, counter to 1440, ring, core, then MIAC and the tagline.
- The steps update, and the version shows.
- After at least 2.2 s it fades, and the main window fades in.
- A click on the splash skips to the final frame; the handoff still waits until the main window is ready.

Then:
- Set `"showSplash": false` in `~/Library/Application Support/miac/settings.json` (also via the Settings toggle) and restart: no splash, the main window shows.
- Simulate a failure by temporarily adding `throw new Error('test failure')` after `reporter.step('Loading tasks')`. The splash must show the red message and a working Quit. **Remove the throw.**
- With System Settings > Accessibility > Display > Reduce motion on, the splash shows the static final frame.

- [ ] **Step 8: Packaged check**

Run: `npm run package` and open `out/miac-darwin-arm64/miac.app` (the path printed by Forge). The splash must load from `.vite/renderer/splash_window/splash.html`. If it shows blank, check the output folder name and fix the `loadFile` path.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: animated splash window with real boot steps, failure state and fade handoff"
```

---

### Task 11: App icon

**Files:**
- Create: `assets/icon/miac.svg`, `assets/icon/miac-small.svg`, `tools/art/ico.mjs`, `tools/art/ico.test.ts`, `tools/art/build-icons.mjs`, and the generated `assets/icon/png/{16,24,32,48,64,128,256,512,1024}.png`, `assets/icon/miac.ico` and `assets/icon/miac.icns`
- Modify: `package.json` (dev dep `@resvg/resvg-js`, script `"icons": "node tools/art/build-icons.mjs"`), `forge.config.mts`, `src/main.ts`, `src/declarations.d.ts`, `index.html`, `splash.html`

**Interfaces:**
- Produces from `tools/art/ico.mjs`: `buildIco(entries: { size: number; png: Buffer }[]): Buffer`
- `src/main.ts` uses `import iconUrl from '../assets/icon/png/256.png?inline'` (a data URL), passed through `nativeImage.createFromDataURL`

- [ ] **Step 1: Failing ICO writer test**

`tools/art/ico.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildIco } from './ico.mjs';

describe('buildIco', () => {
  it('writes the ICONDIR header and one 16-byte entry per image, then the PNG data', () => {
    const a = Buffer.from([1, 2, 3]);
    const b = Buffer.from([4, 5, 6, 7]);
    const ico = buildIco([{ size: 16, png: a }, { size: 256, png: b }]);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    // entry 0
    expect(ico[6]).toBe(16); expect(ico[7]).toBe(16);
    expect(ico.readUInt16LE(6 + 4)).toBe(1);   // planes
    expect(ico.readUInt16LE(6 + 6)).toBe(32);  // bpp
    expect(ico.readUInt32LE(6 + 8)).toBe(3);   // size
    expect(ico.readUInt32LE(6 + 12)).toBe(6 + 2 * 16);
    // entry 1: 256 is stored as 0
    expect(ico[22]).toBe(0); expect(ico[23]).toBe(0);
    expect(ico.readUInt32LE(22 + 12)).toBe(6 + 2 * 16 + 3);
    expect([...ico.subarray(38)]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('rejects sizes above 256', () => {
    expect(() => buildIco([{ size: 512, png: Buffer.from([0]) }])).toThrow(/256/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tools/art/ico.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `ico.mjs`**

```js
// Packs PNG images into a Windows .ico (PNG-compressed entries, supported since Windows Vista).
/** @param {{ size: number, png: Buffer }[]} entries */
export function buildIco(entries) {
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, i) => {
    if (size < 1 || size > 256) throw new Error(`ICO sizes must be 1-256, got ${size}`);
    const at = 6 + i * 16;
    header[at] = size === 256 ? 0 : size;
    header[at + 1] = size === 256 ? 0 : size;
    header[at + 2] = 0;
    header[at + 3] = 0;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.png)]);
}
```
Run the test: PASS. If TypeScript complains about importing `.mjs` without types, add `tools/art/ico.d.mts` with `export function buildIco(entries: { size: number; png: Buffer }[]): Buffer;`. Check how `tools/art/prompts.test.ts` imports `prompts.mjs` and follow the same pattern.

- [ ] **Step 4: Draw the SVGs**

`assets/icon/miac.svg` (refined concept C: 24 bold ticks, one lit quadrant, cream core with bloom):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="space" cx="35%" cy="25%" r="90%"><stop offset="0" stop-color="#232838"/><stop offset=".55" stop-color="#11131b"/><stop offset="1" stop-color="#07080c"/></radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffd08a"/><stop offset=".35" stop-color="#f0a443" stop-opacity=".75"/><stop offset="1" stop-color="#f0a443" stop-opacity="0"/></radialGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>
  </defs>
  <rect width="512" height="512" rx="114" fill="url(#space)"/>
  <circle cx="256" cy="256" r="168" fill="none" stroke="#2c3142" stroke-width="4"/>
  <g id="ticks" stroke-linecap="round" stroke-width="12"><!-- generated: see below --></g>
  <path d="M256 88 A168 168 0 0 1 424 256" fill="none" stroke="#f0a443" stroke-width="18" stroke-linecap="round" filter="url(#soft)" opacity=".9"/>
  <path d="M256 88 A168 168 0 0 1 424 256" fill="none" stroke="#f0a443" stroke-width="18" stroke-linecap="round"/>
  <circle cx="256" cy="256" r="112" fill="url(#glow)"/>
  <circle cx="256" cy="256" r="60" fill="#f6e7c8"/>
  <circle cx="238" cy="236" r="20" fill="#fff" opacity=".7"/>
</svg>
```
Fill the `ticks` group with 24 `<line>`s. For `i = 0..23`, at angle `a = i*15° - 90°`, draw from radius 186 to 206 around (256, 256). Stroke is `#f0a443` for `i` in `0..6` (the lit quadrant, inclusive of both ends) and `#3a3f52` otherwise. Generate the 24 lines once with a throwaway `node -e` and paste the output, so the SVG stays static and readable. Example line: `<line x1="256" y1="70" x2="256" y2="50" stroke="#f0a443"/>`.

`assets/icon/miac-small.svg`: the same ground, no ticks, `<circle r="168" stroke="#3a3f52" stroke-width="28">`, the arc at stroke-width 44 without the blur, the core at r=92 and the glow at r=150. This is what makes 16 and 32 px readable.

- [ ] **Step 5: `build-icons.mjs`**

```js
// Renders assets/icon/*.svg to PNGs, a Windows .ico and (on macOS) a .icns. Outputs are committed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { buildIco } from './ico.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'assets/icon');
const big = readFileSync(path.join(dir, 'miac.svg'), 'utf8');
const small = readFileSync(path.join(dir, 'miac-small.svg'), 'utf8');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

const render = (size) =>
  Buffer.from(new Resvg(size <= 32 ? small : big, { fitTo: { mode: 'width', value: size } }).render().asPng());

mkdirSync(path.join(dir, 'png'), { recursive: true });
const pngs = new Map(SIZES.map((s) => [s, render(s)]));
for (const [s, png] of pngs) writeFileSync(path.join(dir, 'png', `${s}.png`), png);
writeFileSync(path.join(dir, 'miac.ico'), buildIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: pngs.get(size) }))));
console.log('wrote png/*.png and miac.ico');

if (process.platform !== 'darwin') {
  console.error('miac.icns needs macOS iconutil; skipped. Commit the .icns from a Mac.');
  process.exit(0);
}
const tmp = mkdtempSync(path.join(os.tmpdir(), 'miac-icns-'));
const set = path.join(tmp, 'miac.iconset');
mkdirSync(set);
for (const [name, size] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]])
  copyFileSync(path.join(dir, 'png', `${size}.png`), path.join(set, `icon_${name}.png`));
execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(dir, 'miac.icns')]);
rmSync(tmp, { recursive: true, force: true });
console.log('wrote miac.icns');
```
Run: `npm install -D @resvg/resvg-js@^2.6.2`, then `npm run icons`.
Expected: `assets/icon/png/*.png`, `miac.ico` and `miac.icns` exist. Open `png/16.png`, `32.png` and `256.png` (with the Read tool or Preview) and check that the dial reads at 16 px. If the 16 px version is mush, thicken the small variant's strokes and re-run.

- [ ] **Step 6: Wire the icon**

- `forge.config.mts`: `packagerConfig.icon: 'assets/icon/miac'`, and `setupIcon: 'assets/icon/miac.ico'` in `MakerSquirrel`.
- `src/declarations.d.ts`: `declare module '*.png?inline' { const src: string; export default src; }`.
- `src/main.ts`: `import iconUrl from '../assets/icon/png/256.png?inline';` and `nativeImage` from `electron`. Then `const icon = nativeImage.createFromDataURL(iconUrl);`.
  - Pass `icon` in both `BrowserWindow` constructors, `createWindow` and `createSplashWindow`. Pass it as a parameter, `createSplashWindow(icon)`, and update its signature and the test mock accordingly. Only do this when `process.platform !== 'darwin'`.
  - In `app.whenReady().then(...)` on macOS when `!app.isPackaged`: `app.dock?.setIcon(icon)`.
- `index.html` and `splash.html`: `<link rel="icon" href="./assets/icon/png/32.png" />`. Vite resolves and copies relative asset links in HTML; if it doesn't, import the PNG in `renderer.tsx` and `splash.ts` and set `document.querySelector('link[rel=icon]').href` at runtime instead.

- [ ] **Step 7: Checks, package, commit**

Run: `npm test && npm run typecheck && npm run lint`, then `npm run package`.
Check that the `.app` in `out/` shows the Mind dial in Finder and the Dock. Then:
```bash
git add -A && git commit -m "feat: Mind dial app icon with icns, ico and PNG builds"
```

---

### Task 12: Gemini art

**Files:**
- Modify: `tools/art/prompts.md`, `tools/art/README.md` (the processing line), `src/renderer/screens/WorkspaceScreen.tsx`, `src/renderer/components/TaskNav.tsx` (the "no tasks" state), `src/renderer/screens/SettingsScreen.tsx` (About), `src/splash/splash.ts`, `instrument.css`
- Create: `src/renderer/art.ts`, `src/renderer/components/ArtSlot.tsx`, `src/renderer/components/ArtSlot.test.tsx`, `src/splash/art.ts`, `assets/art/*.jpg` (owner picks), `assets/ART.md`

**Interfaces:**
- Produces:
  - `type ArtName = 'splash-nebula' | 'empty-no-tasks' | 'empty-no-selection' | 'empty-done' | 'about-registry'`
  - `artUrl(name: ArtName): string | null`: from `import.meta.glob('../../assets/art/*.{jpg,png,webp}', { eager: true, query: '?url', import: 'default' })`, matched on the file's base name
  - `ArtSlot({ name, className }: { name: ArtName; className?: string })`: renders `<div className="art art-<name>" aria-hidden="true">` with an `<img alt="">` when a URL exists. On `onError`, and when there is no URL, it renders the CSS placeholder (class `art-placeholder`).

- [ ] **Step 1: Rewrite the prompts**

`tools/art/prompts.md`. Keep the explanation paragraph at the top as it is, then:
```markdown
## Style block

> Quiet, cinematic science fiction illustration in the spirit of Iain M. Banks' Culture novels, for the
> background of a developer tool. Deep space black with a faint blue cast, very soft amber and dim indigo light,
> fine luminous lines, vast calm emptiness, painterly but restrained, low contrast, nothing busy in the middle.
> No text, no letters, no numbers, no logos, no watermark, no frame, no people.

## Backgrounds

**splash-nebula.png** - A wide field of deep space with a faint amber and indigo nebula drifting across the upper right, and far away, very small, an elongated smooth Culture General Systems Vehicle silhouette catching a sliver of amber light, off-centre to the lower left. The centre of the image is dark and empty. Landscape.

**empty-no-tasks.png** - The inside of a vast quiet hangar bay seen from deep inside, its great open mouth framing a field of stars, a thin line of amber light along the deck, no ships present, peaceful and waiting. Landscape.

**empty-no-selection.png** - The thin bright arc of a distant Orbital habitat ring curving across the dark, lit amber along one edge, with tiny stars beyond, almost all of the image dark. Landscape.

**empty-done.png** - A small sleek ship drifting away into a soft amber dawn rising over the curve of a planet, a gentle sense of a job finished, mostly dark sky above. Landscape.

## Registry

> A precise, quiet engraving-like science fiction illustration on near-black, fine luminous amber and cream lines,
> like a ship's registry plate, symmetrical and calm. No text, no letters, no numbers, no logos, no watermark.

**about-registry.png** - A glowing ship Mind core, a small cream sphere with an amber halo, held in a cradle of fine concentric rings and tick marks like an instrument dial, floating in the dark. Portrait.
```
Run: `node tools/art/generate.mjs list`
Expected: the five names.

- [ ] **Step 2: Failing `ArtSlot` test**

`src/renderer/components/ArtSlot.test.tsx`:
```tsx
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../art', () => ({ artUrl: (n: string) => (n === 'empty-done' ? '/a/empty-done.jpg' : null) }));
const { ArtSlot } = await import('./ArtSlot');

describe('ArtSlot', () => {
  it('renders a decorative image when the art exists', () => {
    const { container } = render(<ArtSlot name="empty-done" />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('alt', '');
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });
  it('renders the placeholder when the art is missing', () => {
    const { container } = render(<ArtSlot name="about-registry" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.art-placeholder')).not.toBeNull();
  });
  it('falls back to the placeholder when the image fails to load', () => {
    const { container } = render(<ArtSlot name="empty-done" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('.art-placeholder')).not.toBeNull();
  });
});
```
Run it and expect FAIL.

- [ ] **Step 3: Implement**

`src/renderer/art.ts`:
```ts
export type ArtName = 'splash-nebula' | 'empty-no-tasks' | 'empty-no-selection' | 'empty-done' | 'about-registry';
const files = import.meta.glob('../../assets/art/*.{jpg,png,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const byName = new Map(Object.entries(files).map(([p, url]) => [p.split('/').pop()!.replace(/\.[^.]+$/, ''), url]));
export const artUrl = (name: ArtName): string | null => byName.get(name) ?? null;
```
`ArtSlot.tsx`:
```tsx
import { useState } from 'react';
import { artUrl, type ArtName } from '../art';

export function ArtSlot({ name, className = '' }: { name: ArtName; className?: string }) {
  const url = artUrl(name);
  const [broken, setBroken] = useState(false);
  return (
    <div className={`art art-${name}${className ? ` ${className}` : ''}`} aria-hidden="true">
      {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} /> : <div className="art-placeholder" />}
    </div>
  );
}
```
If `import.meta.glob` isn't typed, add `/// <reference types="vite/client" />` at the top of `src/declarations.d.ts`.

`src/splash/art.ts` uses the same glob pattern (`'../../assets/art/splash-nebula.*'`) and exports `nebulaUrl: string | null`. In `splash.ts`, add `import { nebulaUrl } from './art'; if (nebulaUrl) $('neb').style.backgroundImage = `url("${nebulaUrl}")`;`.

CSS:
```css
.art { position: relative; overflow: hidden; pointer-events: none; }
.art img, .art-placeholder { width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0.5;
  mask-image: radial-gradient(ellipse at center, #000 40%, transparent 75%); -webkit-mask-image: radial-gradient(ellipse at center, #000 40%, transparent 75%); }
.art-placeholder { background:
  radial-gradient(1px 1px at 20% 30%, #fff8, transparent), radial-gradient(1px 1px at 70% 60%, #fff6, transparent),
  radial-gradient(1.4px 1.4px at 45% 80%, #fff7, transparent), radial-gradient(60% 50% at 70% 30%, rgba(240,164,67,.10), transparent 70%),
  radial-gradient(50% 60% at 25% 75%, rgba(90,110,180,.10), transparent 70%); }
.empty-art { display: grid; place-items: center; gap: 12px; padding: 24px; text-align: center; }
.empty-art .art { width: min(560px, 80%); aspect-ratio: 16 / 9; }
.done-banner { display: flex; align-items: center; gap: 16px; padding: 10px 16px; background: var(--panel-2); border-bottom: 1px solid var(--line); }
.done-banner .art { width: 160px; aspect-ratio: 16 / 9; flex: none; }
.about .art { width: 180px; aspect-ratio: 9 / 16; }
```
Wiring:
- `WorkspaceScreen`: when there is no task selected but tasks exist, show `<div className="empty empty-art"><ArtSlot name="empty-no-selection" /><p>No task selected…</p></div>`. With no tasks at all, use `empty-no-tasks` and the copy "No tasks yet. Create one with New task." Keep the current copy wording; check the existing tests.
- Put `ArtSlot name="empty-done"` into the done banner from Task 7.
- Put `ArtSlot name="about-registry"` into About.

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.
Commit: `git add -A && git commit -m "feat: art slots with placeholders for splash, empty states and about"`

- [ ] **Step 4: Generate candidates**

Run: `node tools/art/generate.mjs generate`, three times, to get three candidates per name. The script saves timestamped files in `tools/art/incoming/`; check that it doesn't overwrite them.
Expected: candidates in `tools/art/incoming/`. If a run fails with an HTTP error, show the status code without the key and stop.

- [ ] **Step 5: Owner picks (human gate)**

Show the candidates to the owner: read each image with the Read tool, then list them per name with a one-line description. Ask the owner to pick one per name, or to ask for a prompt change and re-run for a single name (`node tools/art/generate.mjs generate <name>`). **Do not choose for the owner.**

- [ ] **Step 6: Post-process and log**

For each pick (`cwebp` is not installed on the owner's Mac, so use JPEG):
```bash
sips -Z 1600 -s format jpeg -s formatOptions 80 tools/art/incoming/<picked>.png --out assets/art/<name>.jpg
ls -l assets/art/<name>.jpg   # must be < 400 KB; if not, re-run with formatOptions 70
```
Write `assets/ART.md` in the same structure as the Adem `ART.md`. For each image record:
- the date (2026-10-14 or the actual date)
- the model (`gemini-2.5-flash-image`, or `GEMINI_IMAGE_MODEL` if set)
- the prompt (the style block plus the subject, as sent)
- the chosen candidate file name and the owner's reason
- the post-processing (`sips -Z 1600`, JPEG q80 or q70)

Update `tools/art/README.md` step 3: replace the hand-copy note with these exact commands.

- [ ] **Step 7: Check and commit**

Run `npm start` and check the splash backdrop, the empty states, the done banner and About. Art must never compete with text; lower its opacity in CSS if it does. Then:
```bash
git add assets/art assets/ART.md tools/art/README.md tools/art/prompts.md src
git commit -m "feat: Culture art for splash, empty states and about (owner picks)"
```

---

### Task 13: Docs and final verification

**Files:**
- Modify: `docs/windows-checklist.md`, `README.md`, `CLAUDE.md` (Status), `design/README.md` (the visual language line)

- [ ] **Step 1: Windows checklist**

Append to `docs/windows-checklist.md`, in the file's existing format:
- The splash appears centred, plays, shows the steps and hands off to the main window. A click skips it.
- The splash setting off: no splash on the next start.
- The taskbar icon is legible at 100% and 150% display scaling.
- The installer (`MIAC-Setup.exe`) and the Start menu entry show the Mind dial icon.
- `Ctrl+0..9` and `Ctrl+Shift+F` work while a PowerShell terminal has focus, and `Ctrl+C` still interrupts.

- [ ] **Step 2: README, CLAUDE.md and design README**

- `CLAUDE.md` Status: add "Sub-project 6 (sci-fi UX, splash, icon and art) implemented 2026-10-14 on `<branch>`." Under known gaps, remove "no app icon yet (Gemini key needed…)", and add "splash and icon on Windows verified by CI only".
- `design/README.md`: update the "Visual language" line to the new tokens: space-black `#090b10` ground, `#1d2230` hairlines, amber `#f0a443` the one accent, cream `#f6e7c8`, the Instrument motifs, and the note that the fonts are bundled.
- `README.md`: if it has a screenshot or status section, add one line about the splash, focus mode and the Usage tab. Follow its tone.

- [ ] **Step 3: Full verification**

Run: `npm test && npm run typecheck && npm run lint && npm run package`
Expected: all PASS; the package builds.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: status, design language and Windows checklist for sub-project 6"
```
