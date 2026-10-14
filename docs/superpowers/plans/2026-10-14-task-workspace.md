# MIAC Task Workspace (sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Electron desktop app that creates a git worktree plus branch per task, runs the repo's `.miac.yml` setup with a live log, opens terminals (Claude Code, shell, run commands) in that worktree, and finishes a task with safety checks and cleanup.

**Architecture:** Main process owns all filesystem, git and pty work through seven Electron-free services (`RepoRegistry`, `MiacConfig`, `GitClient`, `SetupRunner`, `TerminalManager`, `TaskStore`, `Platform`) orchestrated by a handler bundle that is exposed to the renderer over a typed `ipcRenderer.invoke` bridge. The React renderer only renders what main pushes, and keeps one xterm instance per pty.

**Tech Stack:** Electron 44 via Electron Forge 8 (`template-vite`, TypeScript), Vite 8, React 19, zustand 5, zod 4, yaml 2, node-pty 1.1, @xterm/xterm 6 with addon-fit, Vitest 5 with jsdom 30 and Testing Library. Node 26 and git 2.54 on the dev Mac.

**Spec:** `docs/superpowers/specs/2026-10-14-task-workspace-design.md`

## Global Constraints

- Develop and test on macOS first; Windows stays the release target. All shell, path and spawn logic goes through the `Platform` interface (`src/main/platform/`). Nothing outside that folder may reference `/bin/zsh`, `pwsh`, `-lc`, or `process.platform`.
- Core services (`src/main/services/*`, `src/main/platform/*`, `src/shared/*`) must not import `electron`. Only `src/main.ts`, `src/preload.ts` and the renderer may.
- Worktrees live in a sibling folder `<repo>.worktrees/<slug>`.
- App state is one JSON file `state.json` in Electron's user data folder, validated with zod, written atomically (temp file then rename).
- MIAC writes `.miac/task.md` into the worktree and adds `.miac/` to the repository's `.git/info/exclude`.
- `.miac.yml` defaults when missing: base `main`, branch `{type}/{id}-{slug}`, setup `npm ci` if `package-lock.json` exists otherwise none, no copy list, no run commands.
- Branch template: `{type}` is `feature` for User Story and blank tasks, `bugfix` for Bug; `{slug}` is a kebab-case slug of the title or name, max 40 characters; blank tasks with no id drop the `{id}-` segment.
- Styling is plain CSS with variables for the mockup palette: ground `#15171a`, panel `#1b1e23`, border `#2a2e35`, text `#e7e6e2`, muted `#a3a9b2`, accent `#f0a443`, terminal ground `#0f1113`, green `#8fd6a4`, blue `#7fb2ff`, warning `#f0c27a`. Fonts: IBM Plex Sans for UI, JetBrains Mono for code, ids, paths and money. No component library.
- Runs from source with `npm start`. No packaging, no `miac` CLI, no Windows `Platform`, no Azure DevOps, no cost tracking in this slice.
- Commit after every task with a conventional-commit style message. Never commit `state.json`, keys or generated art candidates.

## Review Focus

1. **Branch names git rejects** (spaces, `..`, trailing `/`, leading `-`): the New task dialog lets the user edit the branch, so create must refuse with a readable message instead of a raw git failure. Pinned in Task 10 (`rejects an invalid branch name`).
2. **Titles with accents, emoji or 200 characters**: the slug must stay ASCII kebab-case, at most 40 characters, never ending in a dash. Pinned in Task 2 (`slugify` tests).
3. **Adding the same repo twice or a subfolder of it**: the registry must normalise to the git toplevel and reject duplicates, including the macOS `/var` vs `/private/var` symlink case. Pinned in Task 7.
4. **A `.miac.yml` with the wrong shape** (`setup: npm ci` as a string, `run` as a list): a single string becomes a one-item list, anything else fails with the field name in the message, and the app never crashes. Pinned in Task 5.
5. **A corrupt `state.json` at launch**: the app must start with empty state, keep the broken file as a backup, and tell the user. Pinned in Task 4.

---

### Task 1: Scaffold the Forge app with React, Vitest and the native modules

**Files:**
- Create (via scaffold): `package.json`, `forge.config.mts`, `vite.main.config.mts`, `vite.preload.config.mts`, `vite.renderer.config.mts`, `tsconfig.json`, `index.html`, `.oxlintrc.json`, `.oxfmtrc.json`, `.gitignore`, `src/main.ts`, `src/preload.ts`, `src/declarations.d.ts`
- Create: `vitest.config.mts`, `src/renderer.tsx`, `src/renderer/App.tsx`, `src/renderer/App.test.tsx`, `src/renderer/test-setup.ts`, `src/renderer/styles/tokens.css`, `src/renderer/styles/app.css`
- Delete: `src/renderer.ts` (scaffold), `src/index.css` (scaffold)

**Interfaces:**
- Produces: `npm start` (Electron window), `npm test` (Vitest, two projects `main` and `renderer`), `npm run typecheck`, `npm run lint`.

- [ ] **Step 1: Scaffold into a temp folder and copy into the repo**

The scaffold refuses non-empty folders, so scaffold next to the repo and copy. The folder name becomes the package name, so call it `miac`.

```bash
TMP=$(mktemp -d)
npx --yes create-electron-app@8.0.1 "$TMP/miac" --template=vite --typescript --skip-git
rsync -a --exclude node_modules --exclude .git "$TMP/miac/" /Users/drieshoebeke/Projects/MIAC/
cd /Users/drieshoebeke/Projects/MIAC && git status --short
```

Expected: new files `package.json`, `forge.config.mts`, three `vite.*.config.mts`, `tsconfig.json`, `index.html`, `src/main.ts`, `src/preload.ts`, `src/renderer.ts`, `src/index.css`, `src/declarations.d.ts`, `.oxlintrc.json`, `.oxfmtrc.json`; `.gitignore` modified (the scaffold's is longer and already ignores `.vite/`, `out/`, `node_modules/`, `.env*`).

- [ ] **Step 2: Install dependencies**

```bash
cd /Users/drieshoebeke/Projects/MIAC
npm install
npm install node-pty@1.1.0 @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0 react@19 react-dom@19 zod@4 yaml@2 zustand@5
npm install -D vitest@5 jsdom@30 @testing-library/react@16 @testing-library/jest-dom@7 @testing-library/user-event@14 @vitejs/plugin-react@6 @types/react@19 @types/react-dom@19
```

Expected: no errors. node-pty uses its `prebuilds/darwin-arm64` binary, so no compiler is needed for the test run under Node.

- [ ] **Step 3: Point Vite and TypeScript at React and keep node-pty external**

Forge's Vite plugin only externalises `electron` and Node builtins, so node-pty (a native addon) must be listed by hand or Vite will try to bundle its `.node` file.

`vite.main.config.mts`:
```ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['node-pty'],
    },
  },
});
```

`vite.renderer.config.mts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "preserve",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "allowJs": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "noImplicitAny": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*", "*.ts", "*.mts"]
}
```

`index.html` (replace the scaffold's body and title):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
    <title>MIAC</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer.tsx"></script>
  </body>
</html>
```

In dev, Vite injects its client script; if the console shows a CSP violation for `ws:` or inline scripts, append ` 'unsafe-inline'` to `script-src` and `connect-src 'self' ws://localhost:*` only for `MAIN_WINDOW_VITE_DEV_SERVER_URL`. Keep the strict one otherwise.

Delete the scaffold renderer and css:
```bash
git rm -q --cached src/renderer.ts src/index.css 2>/dev/null; rm -f src/renderer.ts src/index.css
```

- [ ] **Step 4: Add the design tokens, base styles and a minimal App**

`src/renderer/styles/tokens.css`:
```css
:root {
  --ground: #15171a;
  --ground-deep: #0c0d0f;
  --panel: #1b1e23;
  --panel-2: #181a1f;
  --panel-raised: #262a31;
  --border: #2a2e35;
  --border-strong: #3a3f48;
  --text: #e7e6e2;
  --text-soft: #c9ccd1;
  --muted: #a3a9b2;
  --accent: #f0a443;
  --accent-ink: #1a1408;
  --accent-bg: #2a2416;
  --term: #0f1113;
  --green: #8fd6a4;
  --green-bg: #1b2620;
  --green-border: #2e4234;
  --blue: #7fb2ff;
  --blue-bg: #1f2a3d;
  --warn: #f0c27a;
  --warn-text: #f6dcae;
  --warn-bg: #2a2416;
  --warn-border: #4a3d22;
  --red: #f0a0a0;
  --red-bg: #3a2224;
  --red-border: #6a3236;
  --idle: #555b64;
  --font-ui: 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --radius: 8px;
  --radius-lg: 10px;
}
```

`src/renderer/styles/app.css`:
```css
@import './tokens.css';

* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--ground); color: var(--text); font: 14px var(--font-ui); }
a { color: #8fb4ff; }
a:hover { color: #b8cfff; }
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; }
.mono { font-family: var(--font-mono); }
.muted { color: var(--muted); }
.small { font-size: 12px; }

.app { height: 100%; display: flex; flex-direction: column; }
.topbar { height: 48px; display: flex; align-items: center; gap: 16px; padding: 0 16px; border-bottom: 1px solid var(--border); background: var(--panel); flex: none; }
.brand { font-family: var(--font-mono); font-weight: 600; font-size: 16px; color: var(--accent); }
.topbar .spacer { margin-left: auto; }

.btn { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--panel); color: var(--text); text-decoration: none; }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
.btn-ghost { background: transparent; }
.btn-green { background: var(--green-bg); border-color: var(--green-border); color: var(--green); }
.btn-danger { background: var(--red-bg); border-color: var(--red-border); color: #f6c4c4; font-weight: 600; }
.btn-warn { background: transparent; border-color: var(--warn-border); color: var(--warn-text); }
.btn-sm { height: 28px; padding: 0 10px; font-size: 12px; }

.field { height: 34px; background: var(--ground); color: var(--text); border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 0 10px; min-width: 0; }
.field:focus { outline: 1px solid var(--accent); }
.checkbox { display: flex; gap: 10px; align-items: center; }
.checkbox input { accent-color: var(--accent); }
fieldset.group { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 12px 14px; margin: 0; display: flex; flex-direction: column; gap: 8px; }
fieldset.group legend { padding: 0 6px; color: var(--muted); font-size: 12px; }

.pill { padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.pill-accent { background: var(--accent-bg); color: var(--accent); }
.pill-blue { background: var(--blue-bg); color: #8fb4ff; }
.pill-red { background: var(--red-bg); color: var(--red); }
.tag { font-size: 12px; padding: 3px 8px; border-radius: 6px; }
.tag-green { background: var(--green-bg); color: var(--green); }
.tag-warn { background: var(--warn-bg); color: var(--warn); }

.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; }

.overlay { position: fixed; inset: 0; background: var(--ground-deep); overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 56px 16px; }
.dialog { width: 100%; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; display: flex; flex-direction: column; overflow: hidden; }
.dialog-head { display: flex; align-items: center; gap: 16px; padding: 18px 24px; border-bottom: 1px solid var(--border); }
.dialog-head h2 { margin: 0; font-size: 18px; font-weight: 600; }
.segmented { display: flex; background: var(--ground); border: 1px solid var(--border); border-radius: var(--radius); padding: 3px; }
.segmented button { height: 30px; padding: 0 12px; border: none; border-radius: 6px; background: transparent; color: var(--muted); }
.segmented button[aria-pressed='true'] { background: #2c3038; color: var(--text); }

.notices { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 10; }
.notice { padding: 10px 14px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--panel); max-width: 420px; display: flex; gap: 12px; align-items: flex-start; }
.notice-error { border-color: var(--red-border); background: var(--red-bg); }
.notice-warn { border-color: var(--warn-border); background: var(--warn-bg); }
.notice button { margin-left: auto; background: none; border: none; color: var(--muted); }
```

`src/renderer/App.tsx` (placeholder until Task 11 replaces it):
```tsx
export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">MIAC</div>
      </header>
    </div>
  );
}
```

`src/renderer.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import { App } from './renderer/App';
import './renderer/styles/app.css';

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 5: Configure Vitest with a `main` (node) and a `renderer` (jsdom) project**

`vitest.config.mts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
          testTimeout: 20000,
          passWithNoTests: true,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.tsx'],
          setupFiles: ['src/renderer/test-setup.ts'],
        },
      },
    ],
  },
});
```

`src/renderer/test-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

Add to `package.json` scripts: `"test": "vitest run"` and `"test:watch": "vitest"`.

- [ ] **Step 6: Write the first renderer test**

`src/renderer/App.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('shows the MIAC brand', () => {
    render(<App />);
    expect(screen.getByText('MIAC')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the checks**

```bash
npm test
npm run typecheck
npm run lint
```

Expected: 1 test passes in project `renderer`, project `main` reports no test files and passes, typecheck clean, lint clean. If oxfmt complains about formatting, run `npm run lint:fix` and re-run.

- [ ] **Step 8: Start the app once**

```bash
npm start
```

Expected: Forge rebuilds node-pty for Electron (first run only, needs Xcode command line tools; `xcode-select --install` if it fails), then a window opens with "MIAC" top-left on a dark background and DevTools open. Quit with Cmd+Q.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold Electron Forge app with React, Vitest and design tokens"
```

---

### Task 2: Shared types, state schema and naming helpers

**Files:**
- Create: `src/shared/types.ts`, `src/shared/naming.ts`
- Test: `src/shared/types.test.ts`, `src/shared/naming.test.ts`

**Interfaces:**
- Produces: zod schemas `WorkItemRefSchema`, `TerminalDefSchema`, `TaskSchema`, `RepoSchema`, `StateSchema` and inferred types `WorkItemRef`, `TerminalDef`, `Task`, `TaskStatus`, `Repo`, `State`; plain types `MiacConfig`, `TaskView`, `CreateTaskInput`, `NewTerminal`, `FinishOptions`, `FinishChecks`, `GitSummary`, `SetupStepDef`, `SetupStepStatus`, `SetupEvent`, `SetupState`, `Notice`. Functions `slugify(text, max?)`, `branchType(workItem)`, `renderBranch(template, {workItem, name})`, `taskSlug(workItem, name)`, `renderTaskMd(task)`, `claudePrompt(task)`.

- [ ] **Step 1: Write the failing naming tests**

`src/shared/naming.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { branchType, claudePrompt, renderBranch, renderTaskMd, slugify, taskSlug } from './naming';
import type { Task } from './types';

const story = { id: '48231', type: 'User Story' as const, title: 'Show estimated delivery date on product page' };
const bug = { id: '48227', type: 'Bug' as const, title: 'Coupon code field ignores trailing spaces' };

describe('slugify', () => {
  it('lowercases and joins words with dashes', () => {
    expect(slugify('Show estimated delivery date')).toBe('show-estimated-delivery-date');
  });
  it('strips accents, emoji and punctuation', () => {
    expect(slugify('Café résumé 🚀 (v2)!')).toBe('cafe-resume-v2');
  });
  it('caps at 40 characters without a trailing dash', () => {
    const s = slugify('This is a very long work item title that keeps going and going forever');
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith('-')).toBe(false);
    expect(s).toBe('this-is-a-very-long-work-item-title-that');
  });
  it('returns "task" for an empty result', () => {
    expect(slugify('!!!')).toBe('task');
  });
});

describe('branchType', () => {
  it('is bugfix for bugs and feature otherwise', () => {
    expect(branchType(bug)).toBe('bugfix');
    expect(branchType(story)).toBe('feature');
    expect(branchType({ ...story, type: 'Task' })).toBe('feature');
    expect(branchType(null)).toBe('feature');
  });
});

describe('renderBranch', () => {
  const tpl = '{type}/{id}-{slug}';
  it('renders a work item', () => {
    expect(renderBranch(tpl, { workItem: story, name: '' })).toBe('feature/48231-show-estimated-delivery-date-on-product');
    expect(renderBranch(tpl, { workItem: bug, name: '' })).toBe('bugfix/48227-coupon-code-field-ignores-trailing-space');
  });
  it('drops the id segment for a blank task', () => {
    expect(renderBranch(tpl, { workItem: null, name: 'spike new search' })).toBe('feature/spike-new-search');
  });
  it('supports templates without a type', () => {
    expect(renderBranch('users/dries/{id}-{slug}', { workItem: story, name: '' })).toBe('users/dries/48231-show-estimated-delivery-date-on-product');
  });
});

describe('taskSlug', () => {
  it('prefixes the id when there is a work item', () => {
    expect(taskSlug(story, '')).toBe('48231-show-estimated-delivery-date-on-product');
    expect(taskSlug(null, 'Spike: new search')).toBe('spike-new-search');
  });
});

const task: Task = {
  id: 't1', repoId: 'r1', name: '', workItem: story, slug: '48231-show-estimated-delivery-date-on',
  branch: 'feature/48231-show-estimated-delivery-date-on', worktreePath: '/src/webshop.worktrees/48231-show-estimated-delivery-date-on',
  baseRef: 'origin/main', status: 'ready', setup: { copy: true, commands: ['npm ci'], startClaude: true, openShell: true },
  terminals: [], createdAt: '2026-10-14T09:00:00.000Z', finishedAt: null,
};

describe('renderTaskMd', () => {
  it('lists the work item, branch and worktree', () => {
    const md = renderTaskMd(task);
    expect(md).toContain('# User Story 48231: Show estimated delivery date on product page');
    expect(md).toContain('- Branch: `feature/48231-show-estimated-delivery-date-on`');
    expect(md).toContain('- Worktree: `/src/webshop.worktrees/48231-show-estimated-delivery-date-on`');
  });
  it('uses the task name for blank tasks', () => {
    expect(renderTaskMd({ ...task, workItem: null, name: 'Spike new search' })).toContain('# Task: Spike new search');
  });
});

describe('claudePrompt', () => {
  it('names the work item and points at the task file', () => {
    expect(claudePrompt(task)).toBe('Work item 48231: Show estimated delivery date on product page. Details are in .miac/task.md.');
    expect(claudePrompt({ ...task, workItem: null, name: 'Spike' })).toBe('Task: Spike. Details are in .miac/task.md.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project main src/shared/naming.test.ts`
Expected: FAIL, cannot find module `./naming`.

- [ ] **Step 3: Write the types**

`src/shared/types.ts`:
```ts
import { z } from 'zod';

export const WorkItemTypeSchema = z.enum(['User Story', 'Bug', 'Task']);
export type WorkItemType = z.infer<typeof WorkItemTypeSchema>;

export const WorkItemRefSchema = z.object({
  id: z.string().min(1),
  type: WorkItemTypeSchema,
  title: z.string().min(1),
});
export type WorkItemRef = z.infer<typeof WorkItemRefSchema>;

export const TerminalDefSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['claude', 'shell', 'run']),
  label: z.string(),
  command: z.string().optional(),
});
export type TerminalDef = z.infer<typeof TerminalDefSchema>;
export type NewTerminal = Omit<TerminalDef, 'id'>;

export const TaskStatusSchema = z.enum(['setting-up', 'ready', 'setup-failed', 'finishing', 'done']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSetupSchema = z.object({
  copy: z.boolean(),
  commands: z.array(z.string()),
  startClaude: z.boolean(),
  openShell: z.boolean(),
});

export const TaskSchema = z.object({
  id: z.string().min(1),
  repoId: z.string().min(1),
  name: z.string(),
  workItem: WorkItemRefSchema.nullable(),
  slug: z.string().min(1),
  branch: z.string().min(1),
  worktreePath: z.string().min(1),
  baseRef: z.string().min(1),
  status: TaskStatusSchema,
  setup: TaskSetupSchema,
  terminals: z.array(TerminalDefSchema),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

export const RepoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  baseBranch: z.string().min(1),
  connectionId: z.string().nullable(),
  miacYmlFound: z.boolean(),
});
export type Repo = z.infer<typeof RepoSchema>;

export const StateSchema = z.object({
  version: z.literal(1),
  repos: z.array(RepoSchema),
  tasks: z.array(TaskSchema),
});
export type State = z.infer<typeof StateSchema>;

export type MiacConfig = {
  base: string;
  branch: string;
  copy: string[];
  setup: string[];
  run: Record<string, string>;
  found: boolean;
};

export type TaskView = Task & { worktreeMissing: boolean };

export type CreateTaskInput = {
  repoId: string;
  baseRef: string;
  name: string;
  workItem: WorkItemRef | null;
  branch: string;
  copy: boolean;
  commands: string[];
  startClaude: boolean;
  openShell: boolean;
};

export type FinishOptions = { closeTerminals: boolean; removeWorktree: boolean; deleteBranch: boolean };

export type GitFile = { status: string; path: string };
export type GitSummary = { branch: string; ahead: number; behind: number; hasUpstream: boolean; files: GitFile[] };
export type FinishChecks = { uncommitted: GitFile[]; unpushed: number; runningTerminals: number };

export type SetupStepKind = 'fetch' | 'worktree' | 'copy' | 'task-file' | 'command' | 'terminals';
export type SetupStepDef = { kind: SetupStepKind; label: string; detail: string; command?: string };
export type SetupStepStatus = 'todo' | 'running' | 'done' | 'failed';
export type SetupEvent =
  | { taskId: string; type: 'step'; index: number; status: SetupStepStatus; detail?: string; ms?: number }
  | { taskId: string; type: 'log'; line: string }
  | { taskId: string; type: 'finished'; ok: boolean; failedStep?: number };
export type SetupState = {
  steps: { def: SetupStepDef; status: SetupStepStatus; detail?: string; ms?: number }[];
  log: string[];
  finished: boolean;
  ok: boolean | null;
  failedStep: number | null;
};

export type Notice = { id: string; level: 'info' | 'warn' | 'error'; message: string };
```

- [ ] **Step 4: Write the naming helpers**

`src/shared/naming.ts`:
```ts
import type { Task, WorkItemRef } from './types';

export function slugify(text: string, max = 40): string {
  const base = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = base.slice(0, max).replace(/-+$/g, '');
  return cut || 'task';
}

export function branchType(workItem: WorkItemRef | null): 'feature' | 'bugfix' {
  return workItem?.type === 'Bug' ? 'bugfix' : 'feature';
}

export function renderBranch(template: string, input: { workItem: WorkItemRef | null; name: string }): string {
  const slug = slugify(input.workItem?.title ?? input.name);
  let out = template.replaceAll('{type}', branchType(input.workItem)).replaceAll('{slug}', slug);
  const id = input.workItem?.id ?? '';
  out = id ? out.replaceAll('{id}', id) : out.replaceAll('{id}-', '').replaceAll('{id}', '');
  return out;
}

export function taskSlug(workItem: WorkItemRef | null, name: string): string {
  return workItem ? `${workItem.id}-${slugify(workItem.title)}` : slugify(name);
}

export function taskTitle(task: Pick<Task, 'workItem' | 'name'>): string {
  return task.workItem ? `${task.workItem.type} ${task.workItem.id}: ${task.workItem.title}` : `Task: ${task.name}`;
}

export function renderTaskMd(task: Task): string {
  const lines = [
    `# ${taskTitle(task)}`,
    '',
    `- Branch: \`${task.branch}\``,
    `- Base: \`${task.baseRef}\``,
    `- Worktree: \`${task.worktreePath}\``,
    `- Created: ${task.createdAt}`,
    '',
    'This file is written by MIAC and excluded from git. Put notes for the task here.',
    '',
  ];
  return lines.join('\n');
}

export function claudePrompt(task: Pick<Task, 'workItem' | 'name'>): string {
  const head = task.workItem ? `Work item ${task.workItem.id}: ${task.workItem.title}` : `Task: ${task.name}`;
  return `${head}. Details are in .miac/task.md.`;
}
```

- [ ] **Step 5: Write the schema tests**

`src/shared/types.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { StateSchema } from './types';

describe('StateSchema', () => {
  it('accepts an empty state', () => {
    expect(StateSchema.parse({ version: 1, repos: [], tasks: [] })).toEqual({ version: 1, repos: [], tasks: [] });
  });
  it('rejects an unknown task status', () => {
    const bad = {
      version: 1, repos: [],
      tasks: [{ id: 't', repoId: 'r', name: 'x', workItem: null, slug: 'x', branch: 'b', worktreePath: '/w', baseRef: 'main', status: 'weird',
        setup: { copy: false, commands: [], startClaude: false, openShell: false }, terminals: [], createdAt: 'now', finishedAt: null }],
    };
    expect(() => StateSchema.parse(bad)).toThrow();
  });
  it('rejects a future version', () => {
    expect(() => StateSchema.parse({ version: 2, repos: [], tasks: [] })).toThrow();
  });
});
```

- [ ] **Step 6: Run both test files**

Run: `npx vitest run --project main src/shared`
Expected: all naming and types tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared
git commit -m "feat: shared state schema and branch naming helpers"
```

---

### Task 3: Platform interface with the macOS implementation

**Files:**
- Create: `src/main/platform/Platform.ts`, `src/main/platform/shellQuote.ts`, `src/main/platform/darwin.ts`, `src/main/platform/index.ts`
- Test: `src/main/platform/darwin.test.ts`, `src/main/platform/shellQuote.test.ts`

**Interfaces:**
- Produces: `type Command = { command: string; args: string[] }`; `interface Platform { shellLabel: string; interactiveShell(): Command; shellCommand(cmd: string): Command; claudeCommand(prompt: string): Command; editorCommand(path: string): Command }`; `createPlatform(): Platform`; `shellQuote(s: string): string`.

- [ ] **Step 1: Write the failing tests**

`src/main/platform/shellQuote.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { shellQuote } from './shellQuote';

describe('shellQuote', () => {
  it('wraps in single quotes', () => {
    expect(shellQuote('hello world')).toBe("'hello world'");
  });
  it('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});
```

`src/main/platform/darwin.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { darwinPlatform } from './darwin';

describe('darwinPlatform', () => {
  const p = darwinPlatform({ SHELL: '/bin/zsh' });
  it('opens a login shell for interactive tabs', () => {
    expect(p.interactiveShell()).toEqual({ command: '/bin/zsh', args: ['-l'] });
    expect(p.shellLabel).toBe('zsh');
  });
  it('runs a command through a login shell so PATH is loaded', () => {
    expect(p.shellCommand('npm run dev')).toEqual({ command: '/bin/zsh', args: ['-l', '-c', 'npm run dev'] });
  });
  it('starts claude with a quoted prompt', () => {
    expect(p.claudeCommand("Work item 1: it's done")).toEqual({
      command: '/bin/zsh',
      args: ['-l', '-c', "exec claude 'Work item 1: it'\\''s done'"],
    });
  });
  it('opens VS Code', () => {
    expect(p.editorCommand('/src/x')).toEqual({ command: 'code', args: ['/src/x'] });
  });
  it('falls back to /bin/zsh when SHELL is unset', () => {
    expect(darwinPlatform({}).interactiveShell().command).toBe('/bin/zsh');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/platform`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/main/platform/Platform.ts`:
```ts
export type Command = { command: string; args: string[] };

export interface Platform {
  /** Short name shown on the shell tab, e.g. "zsh" or "PowerShell". */
  shellLabel: string;
  /** An interactive shell for a terminal tab. */
  interactiveShell(): Command;
  /** Run one command line non-interactively, with the user's PATH loaded. */
  shellCommand(cmd: string): Command;
  /** Start Claude Code with a first prompt. */
  claudeCommand(prompt: string): Command;
  /** Open a folder in the editor. */
  editorCommand(path: string): Command;
}
```

`src/main/platform/shellQuote.ts`:
```ts
/** POSIX single-quote quoting: safe for zsh, bash and sh. */
export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}
```

`src/main/platform/darwin.ts`:
```ts
import path from 'node:path';
import type { Command, Platform } from './Platform';
import { shellQuote } from './shellQuote';

export function darwinPlatform(env: NodeJS.ProcessEnv): Platform {
  const shell = env.SHELL && env.SHELL.length > 0 ? env.SHELL : '/bin/zsh';
  const login = (args: string[]): Command => ({ command: shell, args: ['-l', ...args] });
  return {
    shellLabel: path.basename(shell),
    interactiveShell: () => login([]),
    shellCommand: (cmd) => login(['-c', cmd]),
    claudeCommand: (prompt) => login(['-c', `exec claude ${shellQuote(prompt)}`]),
    editorCommand: (p) => ({ command: 'code', args: [p] }),
  };
}
```

`src/main/platform/index.ts`:
```ts
import { darwinPlatform } from './darwin';
import type { Platform } from './Platform';

export type { Command, Platform } from './Platform';

export function createPlatform(env: NodeJS.ProcessEnv = process.env): Platform {
  if (process.platform === 'win32') {
    throw new Error('MIAC: the Windows platform module is not implemented yet (sub-project 1 is macOS-first).');
  }
  return darwinPlatform(env);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project main src/main/platform`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/platform
git commit -m "feat: platform interface with macOS shell, claude and editor commands"
```

---

### Task 4: TaskStore with atomic writes and corrupt-file recovery

**Files:**
- Create: `src/main/services/TaskStore.ts`
- Test: `src/main/services/TaskStore.test.ts`

**Interfaces:**
- Consumes: `StateSchema`, `State` from `src/shared/types.ts`.
- Produces: `class TaskStore { constructor(filePath: string); readonly state: State; load(): Promise<LoadResult>; update(mutate: (s: State) => void): Promise<State> }`, `type LoadResult = { recovered: boolean; backup?: string }`, `emptyState(): State`.

- [ ] **Step 1: Write the failing tests**

`src/main/services/TaskStore.test.ts`:
```ts
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TaskStore } from './TaskStore';

const tmp = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'miac-store-')), 'nested', 'state.json');

describe('TaskStore', () => {
  it('starts empty when the file does not exist', async () => {
    const store = new TaskStore(tmp());
    const result = await store.load();
    expect(result).toEqual({ recovered: false });
    expect(store.state).toEqual({ version: 1, repos: [], tasks: [] });
  });

  it('persists updates and reads them back', async () => {
    const file = tmp();
    const store = new TaskStore(file);
    await store.load();
    await store.update((s) => {
      s.repos.push({ id: 'r1', name: 'webshop', path: '/src/webshop', baseBranch: 'main', connectionId: null, miacYmlFound: true });
    });
    const again = new TaskStore(file);
    await again.load();
    expect(again.state.repos).toHaveLength(1);
    expect(again.state.repos[0].name).toBe('webshop');
    expect(readdirSync(path.dirname(file))).toEqual(['state.json']);
  });

  it('does not change state when the mutation produces an invalid state', async () => {
    const store = new TaskStore(tmp());
    await store.load();
    await expect(store.update((s) => { (s as { version: number }).version = 9; })).rejects.toThrow();
    expect(store.state.version).toBe(1);
  });

  it('keeps a backup and starts empty when the file is corrupt', async () => {
    const file = tmp();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{ not json');
    const store = new TaskStore(file);
    const result = await store.load();
    expect(result.recovered).toBe(true);
    expect(result.backup).toMatch(/state\.json\.corrupt-\d+$/);
    expect(readFileSync(result.backup!, 'utf8')).toBe('{ not json');
    expect(store.state).toEqual({ version: 1, repos: [], tasks: [] });
  });

  it('serialises concurrent updates', async () => {
    const store = new TaskStore(tmp());
    await store.load();
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        store.update((s) => { s.repos.push({ id: `r${i}`, name: `n${i}`, path: `/p${i}`, baseBranch: 'main', connectionId: null, miacYmlFound: false }); }),
      ),
    );
    expect(store.state.repos.map((r) => r.id).sort()).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/services/TaskStore.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/main/services/TaskStore.ts`:
```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StateSchema, type State } from '../../shared/types';

export type LoadResult = { recovered: boolean; backup?: string };

export const emptyState = (): State => ({ version: 1, repos: [], tasks: [] });

/** Persists repos and tasks to one JSON file. Writes are atomic (temp file, then rename) and serialised. */
export class TaskStore {
  private current: State = emptyState();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  get state(): State {
    return this.current;
  }

  async load(): Promise<LoadResult> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.current = emptyState();
        return { recovered: false };
      }
      throw e;
    }
    try {
      this.current = StateSchema.parse(JSON.parse(raw));
      return { recovered: false };
    } catch {
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      await fs.rename(this.filePath, backup);
      this.current = emptyState();
      return { recovered: true, backup };
    }
  }

  update(mutate: (s: State) => void): Promise<State> {
    const run = async () => {
      const next = structuredClone(this.current);
      mutate(next);
      const valid = StateSchema.parse(next);
      await this.write(valid);
      this.current = valid;
      return valid;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async write(s: State): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(s, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project main src/main/services/TaskStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/TaskStore.ts src/main/services/TaskStore.test.ts
git commit -m "feat: TaskStore with atomic JSON persistence and corrupt-file recovery"
```

---

### Task 5: MiacConfig loader with defaults and clear validation errors

**Files:**
- Create: `src/main/services/MiacConfig.ts`
- Test: `src/main/services/MiacConfig.test.ts`

**Interfaces:**
- Consumes: `MiacConfig` type from `src/shared/types.ts`.
- Produces: `loadMiacConfig(repoPath: string): Promise<MiacConfig>`, `class MiacConfigError extends Error { file: string }`, `DEFAULT_BRANCH_TEMPLATE = '{type}/{id}-{slug}'`.

- [ ] **Step 1: Write the failing tests**

`src/main/services/MiacConfig.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMiacConfig, MiacConfigError } from './MiacConfig';

const repo = () => mkdtempSync(path.join(os.tmpdir(), 'miac-cfg-'));

describe('loadMiacConfig', () => {
  it('returns defaults without a file and no lockfile', async () => {
    const c = await loadMiacConfig(repo());
    expect(c).toEqual({ base: 'main', branch: '{type}/{id}-{slug}', copy: [], setup: [], run: {}, found: false });
  });

  it('defaults setup to npm ci when package-lock.json exists', async () => {
    const r = repo();
    writeFileSync(path.join(r, 'package-lock.json'), '{}');
    expect((await loadMiacConfig(r)).setup).toEqual(['npm ci']);
  });

  it('reads the full file from the mockup', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.miac.yml'), [
      'base: develop', 'branch: "{type}/{id}-{slug}"', 'copy: [.env, .env.local]',
      'setup:', '  - npm ci', '  - npm run build',
      'run:', '  dev: npm run dev', '  test: npm test', '  lint: npm run lint', '',
    ].join('\n'));
    expect(await loadMiacConfig(r)).toEqual({
      base: 'develop', branch: '{type}/{id}-{slug}', copy: ['.env', '.env.local'],
      setup: ['npm ci', 'npm run build'], run: { dev: 'npm run dev', test: 'npm test', lint: 'npm run lint' }, found: true,
    });
  });

  it('accepts a single string for setup and copy', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.miac.yml'), 'setup: npm ci\ncopy: .env\n');
    const c = await loadMiacConfig(r);
    expect(c.setup).toEqual(['npm ci']);
    expect(c.copy).toEqual(['.env']);
  });

  it('keeps the lockfile default for setup when the file omits it', async () => {
    const r = repo();
    writeFileSync(path.join(r, 'package-lock.json'), '{}');
    writeFileSync(path.join(r, '.miac.yml'), 'base: main\n');
    expect((await loadMiacConfig(r)).setup).toEqual(['npm ci']);
  });

  it('names the bad field when run is a list', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.miac.yml'), 'run:\n  - npm run dev\n');
    await expect(loadMiacConfig(r)).rejects.toThrow(MiacConfigError);
    await expect(loadMiacConfig(r)).rejects.toThrow(/run/);
  });

  it('rejects unknown keys so typos are caught', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.miac.yml'), 'setupp:\n  - npm ci\n');
    await expect(loadMiacConfig(r)).rejects.toThrow(/setupp/);
  });

  it('treats an empty file as defaults but found', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.miac.yml'), '');
    const c = await loadMiacConfig(r);
    expect(c.found).toBe(true);
    expect(c.base).toBe('main');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/services/MiacConfig.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/main/services/MiacConfig.ts`:
```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { MiacConfig } from '../../shared/types';

export const DEFAULT_BRANCH_TEMPLATE = '{type}/{id}-{slug}';

export class MiacConfigError extends Error {
  constructor(public readonly file: string, detail: string) {
    super(`${file}: ${detail}`);
    this.name = 'MiacConfigError';
  }
}

const listOrString = z.union([z.string().transform((s) => [s]), z.array(z.string())]);

const MiacYmlSchema = z.strictObject({
  base: z.string().default('main'),
  branch: z.string().default(DEFAULT_BRANCH_TEMPLATE),
  copy: listOrString.default([]),
  setup: listOrString.optional(),
  run: z.record(z.string(), z.string()).default({}),
});

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function loadMiacConfig(repoPath: string): Promise<MiacConfig> {
  const file = path.join(repoPath, '.miac.yml');
  const defaultSetup = (await exists(path.join(repoPath, 'package-lock.json'))) ? ['npm ci'] : [];

  let text: string | null = null;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (text === null) {
    return { base: 'main', branch: DEFAULT_BRANCH_TEMPLATE, copy: [], setup: defaultSetup, run: {}, found: false };
  }

  let doc: unknown;
  try {
    doc = parseYaml(text) ?? {};
  } catch (e) {
    throw new MiacConfigError(file, `not valid YAML: ${(e as Error).message}`);
  }
  const parsed = MiacYmlSchema.safeParse(doc);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
      .join('; ');
    throw new MiacConfigError(file, detail);
  }
  const c = parsed.data;
  return { base: c.base, branch: c.branch, copy: c.copy, setup: c.setup ?? defaultSetup, run: c.run, found: true };
}
```

If zod's unknown-key message does not include the key name (check the failing assertion text), map `i.code === 'unrecognized_keys'` to `` `unknown keys: ${(i as { keys: string[] }).keys.join(', ')}` `` in the `detail` builder.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project main src/main/services/MiacConfig.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/MiacConfig.ts src/main/services/MiacConfig.test.ts
git commit -m "feat: load .miac.yml with defaults and field-level validation errors"
```

---

### Task 6: GitClient against real temporary repositories

**Files:**
- Create: `src/main/services/GitClient.ts`, `src/main/test-helpers/gitRepo.ts`
- Test: `src/main/services/GitClient.test.ts`

**Interfaces:**
- Consumes: `GitSummary` from `src/shared/types.ts`.
- Produces: `class GitClient { run(cwd, args): Promise<string>; toplevel(dir): Promise<string | null>; commonDir(cwd): Promise<string>; branchExists(cwd, branch): Promise<boolean>; validBranchName(cwd, branch): Promise<boolean>; remotes(cwd): Promise<string[]>; fetch(cwd, baseRef): Promise<boolean>; worktreeAdd(cwd, {branch, path, baseRef}): Promise<void>; worktreeRemove(cwd, worktreePath, force): Promise<void>; deleteBranch(cwd, branch): Promise<void>; summary(worktree, baseRef): Promise<GitSummary> }`, `class GitError extends Error { args: string[]; stderr: string; code: number | null }`. Test helpers `makeRepo(name?)`, `addOrigin(repo)`, `git(cwd, ...args)`, `commitFile(repo, name, content)`.

- [ ] **Step 1: Write the test helper**

`src/main/test-helpers/gitRepo.ts`:
```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0' };

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A fresh repo with one commit on `main`, inside its own temp folder. Returns the real path (no /var symlink). */
export function makeRepo(name = 'repo'): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'miac-git-')));
  const repo = path.join(root, name);
  git(root, 'init', '-q', '-b', 'main', name);
  git(repo, 'config', 'user.email', 'tests@miac.local');
  git(repo, 'config', 'user.name', 'MIAC tests');
  commitFile(repo, 'README.md', '# test\n');
  return repo;
}

export function commitFile(repo: string, name: string, content: string, message = `add ${name}`): void {
  writeFileSync(path.join(repo, name), content);
  git(repo, 'add', name);
  git(repo, 'commit', '-q', '-m', message);
}

/** Adds a bare `origin` next to the repo and pushes main to it. Returns the bare path. */
export function addOrigin(repo: string): string {
  const root = path.dirname(repo);
  git(root, 'init', '-q', '--bare', 'origin.git');
  const bare = path.join(root, 'origin.git');
  git(repo, 'remote', 'add', 'origin', bare);
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  return bare;
}
```

- [ ] **Step 2: Write the failing tests**

`src/main/services/GitClient.test.ts`:
```ts
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addOrigin, commitFile, git, makeRepo } from '../test-helpers/gitRepo';
import { GitClient, GitError } from './GitClient';

const client = new GitClient();

describe('GitClient', () => {
  it('finds the toplevel and returns null outside a repo', async () => {
    const repo = makeRepo();
    expect(await client.toplevel(repo)).toBe(repo);
    expect(await client.toplevel(path.join(repo, '..'))).toBeNull();
  });

  it('reports branch existence and validity', async () => {
    const repo = makeRepo();
    expect(await client.branchExists(repo, 'main')).toBe(true);
    expect(await client.branchExists(repo, 'feature/x')).toBe(false);
    expect(await client.validBranchName(repo, 'feature/48213-save-address')).toBe(true);
    expect(await client.validBranchName(repo, 'bad name')).toBe(false);
    expect(await client.validBranchName(repo, 'bad..name')).toBe(false);
    expect(await client.validBranchName(repo, '-bad')).toBe(false);
  });

  it('adds a worktree on a new branch from a base ref, then removes it', async () => {
    const repo = makeRepo();
    const wt = path.join(path.dirname(repo), 'repo.worktrees', 'x');
    await client.worktreeAdd(repo, { branch: 'feature/x', path: wt, baseRef: 'main' });
    expect(existsSync(path.join(wt, 'README.md'))).toBe(true);
    expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/x');
    await client.worktreeRemove(repo, wt, true);
    expect(existsSync(wt)).toBe(false);
    await client.deleteBranch(repo, 'feature/x');
    expect(await client.branchExists(repo, 'feature/x')).toBe(false);
  });

  it('wraps failures in GitError with stderr', async () => {
    const repo = makeRepo();
    await expect(client.worktreeAdd(repo, { branch: 'y', path: path.join(repo, '..', 'y'), baseRef: 'nope' })).rejects.toBeInstanceOf(GitError);
    await expect(client.worktreeAdd(repo, { branch: 'y', path: path.join(repo, '..', 'y'), baseRef: 'nope' })).rejects.toThrow(/nope/);
  });

  it('fetches when the base ref names a known remote, and skips otherwise', async () => {
    const repo = makeRepo();
    expect(await client.fetch(repo, 'main')).toBe(false);
    expect(await client.fetch(repo, 'origin/main')).toBe(false);
    addOrigin(repo);
    expect(await client.fetch(repo, 'origin/main')).toBe(true);
    expect(await client.remotes(repo)).toEqual(['origin']);
  });

  it('summarises ahead, behind and changed files with an upstream', async () => {
    const repo = makeRepo();
    addOrigin(repo);
    commitFile(repo, 'a.txt', 'a');
    commitFile(repo, 'b.txt', 'b');
    writeFileSync(path.join(repo, 'README.md'), 'changed');
    writeFileSync(path.join(repo, 'new.txt'), 'new');
    const s = await client.summary(repo, 'origin/main');
    expect(s.branch).toBe('main');
    expect(s.hasUpstream).toBe(true);
    expect(s.ahead).toBe(2);
    expect(s.behind).toBe(0);
    expect(s.files).toEqual([{ status: 'M', path: 'README.md' }, { status: '?', path: 'new.txt' }]);
  });

  it('counts commits since the base ref when there is no upstream', async () => {
    const repo = makeRepo();
    const wt = path.join(path.dirname(repo), 'wt');
    await client.worktreeAdd(repo, { branch: 'feature/z', path: wt, baseRef: 'main' });
    git(wt, 'config', 'user.email', 'tests@miac.local');
    git(wt, 'config', 'user.name', 'MIAC tests');
    commitFile(wt, 'z.txt', 'z');
    const s = await client.summary(wt, 'main');
    expect(s.branch).toBe('feature/z');
    expect(s.hasUpstream).toBe(false);
    expect(s.ahead).toBe(1);
    expect(s.files).toEqual([]);
  });

  it('returns the common git dir for a worktree', async () => {
    const repo = makeRepo();
    const wt = path.join(path.dirname(repo), 'wt2');
    await client.worktreeAdd(repo, { branch: 'feature/c', path: wt, baseRef: 'main' });
    expect(await client.commonDir(wt)).toBe(path.join(repo, '.git'));
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/services/GitClient.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`src/main/services/GitClient.ts`:
```ts
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitSummary } from '../../shared/types';

const execFileAsync = promisify(execFile);

export class GitError extends Error {
  constructor(
    public readonly args: string[],
    public readonly stderr: string,
    public readonly code: number | null,
  ) {
    super(`git ${args.join(' ')} failed${code === null ? '' : ` (${code})`}: ${stderr.trim()}`);
    this.name = 'GitError';
  }
}

/** Thin wrapper over the git CLI. Every method takes the directory to run in. */
export class GitClient {
  async run(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 16 * 1024 * 1024,
      });
      return stdout;
    } catch (e) {
      const err = e as { stderr?: string; code?: number | string; message: string };
      const code = typeof err.code === 'number' ? err.code : null;
      throw new GitError(args, err.stderr ?? err.message, code);
    }
  }

  async toplevel(dir: string): Promise<string | null> {
    try {
      return (await this.run(dir, ['rev-parse', '--show-toplevel'])).trim();
    } catch {
      return null;
    }
  }

  /** The shared .git directory, also from inside a linked worktree. */
  async commonDir(cwd: string): Promise<string> {
    const out = (await this.run(cwd, ['rev-parse', '--git-common-dir'])).trim();
    return path.resolve(cwd, out);
  }

  async branchExists(cwd: string, branch: string): Promise<boolean> {
    try {
      await this.run(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  async validBranchName(cwd: string, branch: string): Promise<boolean> {
    if (branch.length === 0 || branch.startsWith('-')) return false;
    try {
      await this.run(cwd, ['check-ref-format', '--branch', branch]);
      return true;
    } catch {
      return false;
    }
  }

  async remotes(cwd: string): Promise<string[]> {
    return (await this.run(cwd, ['remote'])).split('\n').map((s) => s.trim()).filter(Boolean);
  }

  /** `origin/main` fetches `main` from `origin`. A ref without a known remote prefix is left alone. Returns whether it fetched. */
  async fetch(cwd: string, baseRef: string): Promise<boolean> {
    const slash = baseRef.indexOf('/');
    if (slash <= 0) return false;
    const remote = baseRef.slice(0, slash);
    const branch = baseRef.slice(slash + 1);
    if (!(await this.remotes(cwd)).includes(remote)) return false;
    await this.run(cwd, ['fetch', '--quiet', remote, branch]);
    return true;
  }

  async worktreeAdd(cwd: string, o: { branch: string; path: string; baseRef: string }): Promise<void> {
    await this.run(cwd, ['worktree', 'add', '-b', o.branch, o.path, o.baseRef]);
  }

  async worktreeRemove(cwd: string, worktreePath: string, force: boolean): Promise<void> {
    await this.run(cwd, ['worktree', 'remove', ...(force ? ['--force'] : []), worktreePath]);
  }

  async deleteBranch(cwd: string, branch: string): Promise<void> {
    await this.run(cwd, ['branch', '-D', branch]);
  }

  async summary(worktree: string, baseRef: string): Promise<GitSummary> {
    const out = await this.run(worktree, ['status', '--porcelain=v1', '--branch']);
    const lines = out.split('\n');
    const head = lines.shift() ?? '';
    const m = /^## (\S+?)(?:\.\.\.(\S+))?(?: \[([^\]]+)\])?$/.exec(head);
    const branch = m?.[1] ?? '';
    const upstream = m?.[2];
    const track = m?.[3] ?? '';
    const num = (re: RegExp) => Number(re.exec(track)?.[1] ?? 0);
    let ahead = 0;
    let behind = 0;
    if (upstream) {
      ahead = num(/ahead (\d+)/);
      behind = num(/behind (\d+)/);
    } else {
      try {
        ahead = Number((await this.run(worktree, ['rev-list', '--count', `${baseRef}..HEAD`])).trim()) || 0;
      } catch {
        ahead = 0;
      }
    }
    const files = lines
      .filter((l) => l.length > 3)
      .map((l) => ({ status: (l.slice(0, 2).trim()[0] ?? '?') as string, path: l.slice(3) }));
    return { branch, ahead, behind, hasUpstream: Boolean(upstream), files };
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project main src/main/services/GitClient.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/services/GitClient.ts src/main/services/GitClient.test.ts src/main/test-helpers/gitRepo.ts
git commit -m "feat: GitClient for worktrees, branches, fetch and status summaries"
```

---

### Task 7: RepoRegistry and worktree root path

**Files:**
- Create: `src/main/services/RepoRegistry.ts`, `src/main/paths.ts`
- Test: `src/main/services/RepoRegistry.test.ts`, `src/main/paths.test.ts`

**Interfaces:**
- Consumes: `TaskStore` (Task 4), `GitClient` (Task 6), `loadMiacConfig` (Task 5), `Repo` type.
- Produces: `class RepoRegistry { constructor(store: TaskStore, git: GitClient, loadConfig?: typeof loadMiacConfig); list(): Repo[]; get(id): Repo; add(folder: string): Promise<Repo>; remove(id): Promise<void>; refresh(id): Promise<Repo> }`, `worktreeRoot(repoPath: string): string`.

- [ ] **Step 1: Write the failing tests**

`src/main/paths.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { worktreeRoot } from './paths';

describe('worktreeRoot', () => {
  it('is a sibling folder named <repo>.worktrees', () => {
    expect(worktreeRoot('/src/webshop')).toBe('/src/webshop.worktrees');
    expect(worktreeRoot('/src/webshop/')).toBe('/src/webshop.worktrees');
  });
});
```

`src/main/services/RepoRegistry.test.ts`:
```ts
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeRepo } from '../test-helpers/gitRepo';
import { GitClient } from './GitClient';
import { RepoRegistry } from './RepoRegistry';
import { TaskStore } from './TaskStore';

async function registry() {
  const store = new TaskStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'miac-reg-')), 'state.json'));
  await store.load();
  return new RepoRegistry(store, new GitClient());
}

describe('RepoRegistry', () => {
  it('adds a repo with its name, default base and .miac.yml flag', async () => {
    const reg = await registry();
    const repo = makeRepo('webshop');
    const added = await reg.add(repo);
    expect(added).toMatchObject({ name: 'webshop', path: repo, baseBranch: 'main', connectionId: null, miacYmlFound: false });
    expect(reg.list()).toHaveLength(1);
    expect(reg.get(added.id)).toEqual(added);
  });

  it('takes the base branch from .miac.yml', async () => {
    const reg = await registry();
    const repo = makeRepo('api');
    writeFileSync(path.join(repo, '.miac.yml'), 'base: develop\n');
    expect(await reg.add(repo)).toMatchObject({ baseBranch: 'develop', miacYmlFound: true });
  });

  it('normalises a subfolder and a symlink to the toplevel and rejects duplicates', async () => {
    const reg = await registry();
    const repo = makeRepo('webshop');
    mkdirSync(path.join(repo, 'src'));
    const link = path.join(path.dirname(repo), 'link');
    symlinkSync(repo, link);
    const first = await reg.add(path.join(repo, 'src'));
    expect(first.path).toBe(repo);
    await expect(reg.add(repo)).rejects.toThrow(/already/);
    await expect(reg.add(link)).rejects.toThrow(/already/);
    expect(reg.list()).toHaveLength(1);
  });

  it('rejects a folder that is not a git repository', async () => {
    const reg = await registry();
    await expect(reg.add(mkdtempSync(path.join(os.tmpdir(), 'miac-notgit-')))).rejects.toThrow(/not a git repository/);
  });

  it('removes a repo and refuses when it still has open tasks', async () => {
    const reg = await registry();
    const repo = await reg.add(makeRepo('webshop'));
    await reg.remove(repo.id);
    expect(reg.list()).toHaveLength(0);
    const again = await reg.add(makeRepo('webshop'));
    await reg['store'].update((s) => {
      s.tasks.push({ id: 't1', repoId: again.id, name: 'x', workItem: null, slug: 'x', branch: 'b', worktreePath: '/w', baseRef: 'main', status: 'ready',
        setup: { copy: false, commands: [], startClaude: false, openShell: false }, terminals: [], createdAt: 'now', finishedAt: null });
    });
    await expect(reg.remove(again.id)).rejects.toThrow(/open task/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/paths.test.ts src/main/services/RepoRegistry.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/main/paths.ts`:
```ts
import path from 'node:path';

/** Worktrees for `/src/webshop` live in `/src/webshop.worktrees/<slug>`. */
export function worktreeRoot(repoPath: string): string {
  const clean = path.resolve(repoPath);
  return path.join(path.dirname(clean), `${path.basename(clean)}.worktrees`);
}
```

`src/main/services/RepoRegistry.ts`:
```ts
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Repo } from '../../shared/types';
import type { GitClient } from './GitClient';
import { loadMiacConfig } from './MiacConfig';
import type { TaskStore } from './TaskStore';

export class RepoRegistry {
  constructor(
    private readonly store: TaskStore,
    private readonly git: GitClient,
    private readonly loadConfig: typeof loadMiacConfig = loadMiacConfig,
  ) {}

  list(): Repo[] {
    return this.store.state.repos;
  }

  get(id: string): Repo {
    const repo = this.store.state.repos.find((r) => r.id === id);
    if (!repo) throw new Error(`Unknown repo ${id}`);
    return repo;
  }

  async add(folder: string): Promise<Repo> {
    const real = await fs.realpath(folder);
    const top = await this.git.toplevel(real);
    if (!top) throw new Error(`${folder} is not a git repository`);
    if (this.store.state.repos.some((r) => r.path === top)) {
      throw new Error(`${path.basename(top)} is already registered`);
    }
    const repo = await this.describe({ id: randomUUID(), path: top, connectionId: null });
    await this.store.update((s) => { s.repos.push(repo); });
    return repo;
  }

  /** Re-reads name, base branch and .miac.yml presence, e.g. after the user edits the file. */
  async refresh(id: string): Promise<Repo> {
    const current = this.get(id);
    const repo = await this.describe(current);
    await this.store.update((s) => {
      const i = s.repos.findIndex((r) => r.id === id);
      if (i >= 0) s.repos[i] = repo;
    });
    return repo;
  }

  async remove(id: string): Promise<void> {
    const open = this.store.state.tasks.filter((t) => t.repoId === id && t.status !== 'done');
    if (open.length > 0) throw new Error(`Repo still has ${open.length} open task(s); finish them first`);
    await this.store.update((s) => { s.repos = s.repos.filter((r) => r.id !== id); });
  }

  private async describe(base: Pick<Repo, 'id' | 'path' | 'connectionId'>): Promise<Repo> {
    const config = await this.loadConfig(base.path);
    return { id: base.id, name: path.basename(base.path), path: base.path, baseBranch: config.base, connectionId: base.connectionId, miacYmlFound: config.found };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project main src/main/paths.test.ts src/main/services/RepoRegistry.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/paths.ts src/main/paths.test.ts src/main/services/RepoRegistry.ts src/main/services/RepoRegistry.test.ts
git commit -m "feat: RepoRegistry with toplevel normalisation and worktree root helper"
```

---

### Task 8: TerminalManager over node-pty with a scrollback buffer

**Files:**
- Create: `src/main/services/TerminalManager.ts`
- Test: `src/main/services/TerminalManager.test.ts`

**Interfaces:**
- Produces: `type SpawnOptions = { id: string; taskId: string; cwd: string; command: string; args: string[]; cols?: number; rows?: number; env?: Record<string, string> }`; `class TerminalManager extends EventEmitter<{ data: [id: string, data: string]; exit: [id: string, exitCode: number] }> { spawn(o: SpawnOptions): void; write(id, data): void; resize(id, cols, rows): void; kill(id): void; restart(id): void; killAllForTask(taskId): void; runningCount(taskId): number; isRunning(id): boolean; buffer(id): string; ids(): string[] }`.

- [ ] **Step 1: Write the failing tests**

`src/main/services/TerminalManager.test.ts`:
```ts
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { TerminalManager } from './TerminalManager';

const waitFor = (m: TerminalManager, id: string) =>
  new Promise<number>((resolve) => m.on('exit', (exitedId, code) => { if (exitedId === id) resolve(code); }));

describe('TerminalManager', () => {
  it('spawns a process, streams its output and reports exit', async () => {
    const m = new TerminalManager();
    const chunks: string[] = [];
    m.on('data', (_id, d) => chunks.push(d));
    const exited = waitFor(m, 't1');
    m.spawn({ id: 't1', taskId: 'task', cwd: os.tmpdir(), command: '/bin/sh', args: ['-c', 'echo hello-miac'] });
    expect(await exited).toBe(0);
    expect(chunks.join('')).toContain('hello-miac');
    expect(m.buffer('t1')).toContain('hello-miac');
    expect(m.isRunning('t1')).toBe(false);
  });

  it('writes to stdin and counts running terminals per task', async () => {
    const m = new TerminalManager();
    const exited = waitFor(m, 't2');
    m.spawn({ id: 't2', taskId: 'task', cwd: os.tmpdir(), command: '/bin/sh', args: ['-c', 'read x; echo got:$x'] });
    expect(m.runningCount('task')).toBe(1);
    m.write('t2', 'abc\n');
    expect(await exited).toBe(0);
    expect(m.buffer('t2')).toContain('got:abc');
    expect(m.runningCount('task')).toBe(0);
  });

  it('kills everything for a task and forgets the ids', async () => {
    const m = new TerminalManager();
    m.spawn({ id: 'a', taskId: 'x', cwd: os.tmpdir(), command: '/bin/sh', args: ['-c', 'sleep 30'] });
    m.spawn({ id: 'b', taskId: 'x', cwd: os.tmpdir(), command: '/bin/sh', args: ['-c', 'sleep 30'] });
    m.spawn({ id: 'c', taskId: 'y', cwd: os.tmpdir(), command: '/bin/sh', args: ['-c', 'sleep 30'] });
    m.killAllForTask('x');
    expect(m.runningCount('x')).toBe(0);
    expect(m.runningCount('y')).toBe(1);
    expect(() => m.write('a', 'x')).toThrow(/Unknown terminal/);
    m.kill('c');
  });

  it('restarts with the same options and clears the buffer', async () => {
    const m = new TerminalManager();
    const first = waitFor(m, 'r');
    m.spawn({ id: 'r', taskId: 'task', cwd: os.tmpdir(), command: '/bin/sh', args: ['-c', 'echo run'] });
    await first;
    const second = waitFor(m, 'r');
    m.restart('r');
    await second;
    expect(m.buffer('r').split('run').length - 1).toBe(1);
  });

  it('refuses a duplicate id', () => {
    const m = new TerminalManager();
    m.spawn({ id: 'd', taskId: 't', cwd: os.tmpdir(), command: '/bin/sh', args: ['-c', 'sleep 30'] });
    expect(() => m.spawn({ id: 'd', taskId: 't', cwd: os.tmpdir(), command: '/bin/sh', args: [] })).toThrow(/already/);
    expect(m.ids()).toEqual(['d']);
    m.kill('d');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/services/TerminalManager.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/main/services/TerminalManager.ts`:
```ts
import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';

export type SpawnOptions = {
  id: string;
  taskId: string;
  cwd: string;
  command: string;
  args: string[];
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
};

type Entry = { options: SpawnOptions; proc: pty.IPty; exited: boolean; buffer: string };

const BUFFER_LIMIT = 200_000;

/** One pty per terminal id. Exited terminals stay known (for restart and buffer) until killed. */
export class TerminalManager extends EventEmitter<{ data: [id: string, data: string]; exit: [id: string, exitCode: number] }> {
  private readonly entries = new Map<string, Entry>();

  spawn(options: SpawnOptions): void {
    if (this.entries.has(options.id)) throw new Error(`Terminal ${options.id} already exists`);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    Object.assign(env, options.env ?? {});
    env.TERM = 'xterm-256color';
    env.MIAC_TASK_ID = options.taskId;
    const proc = pty.spawn(options.command, options.args, {
      name: 'xterm-256color',
      cols: options.cols ?? 120,
      rows: options.rows ?? 30,
      cwd: options.cwd,
      env,
    });
    const entry: Entry = { options, proc, exited: false, buffer: '' };
    this.entries.set(options.id, entry);
    proc.onData((data) => {
      entry.buffer = (entry.buffer + data).slice(-BUFFER_LIMIT);
      this.emit('data', options.id, data);
    });
    proc.onExit(({ exitCode }) => {
      entry.exited = true;
      this.emit('exit', options.id, exitCode);
    });
  }

  write(id: string, data: string): void {
    const e = this.get(id);
    if (!e.exited) e.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const e = this.get(id);
    if (!e.exited) e.proc.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)));
  }

  kill(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (!e.exited) e.proc.kill();
    this.entries.delete(id);
  }

  restart(id: string): void {
    const { options } = this.get(id);
    this.kill(id);
    this.spawn(options);
  }

  killAllForTask(taskId: string): void {
    for (const [id, e] of this.entries) if (e.options.taskId === taskId) this.kill(id);
  }

  runningCount(taskId: string): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.options.taskId === taskId && !e.exited) n++;
    return n;
  }

  isRunning(id: string): boolean {
    const e = this.entries.get(id);
    return Boolean(e && !e.exited);
  }

  buffer(id: string): string {
    return this.get(id).buffer;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  private get(id: string): Entry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Unknown terminal ${id}`);
    return e;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project main src/main/services/TerminalManager.test.ts`
Expected: PASS (5 tests). If node-pty fails to load under Node 26 with an ABI error, run `npm rebuild node-pty` once; the module is N-API so one build serves both Node and Electron.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/TerminalManager.ts src/main/services/TerminalManager.test.ts
git commit -m "feat: TerminalManager over node-pty with per-terminal scrollback"
```

---

### Task 9: SetupRunner with step events, live log and retry-from-step

**Files:**
- Create: `src/main/services/SetupRunner.ts`
- Test: `src/main/services/SetupRunner.test.ts`

**Interfaces:**
- Consumes: `GitClient` (Task 6), `Platform` (Task 3), `SetupEvent`, `SetupStepDef` (Task 2).
- Produces: `type SetupPlan = { taskId: string; repoPath: string; worktreePath: string; branch: string; baseRef: string; copy: string[]; commands: string[]; taskMd: string; startTerminalsLabel: string | null }`; `planSteps(plan): SetupStepDef[]`; `class SetupRunner { constructor(git: GitClient, platform: Platform); run(plan, hooks: { onEvent(e: SetupEvent): void; startTerminals(): Promise<void>; fromStep?: number }): Promise<{ ok: boolean; failedStep?: number }> }`; `ensureExcluded(git, repoPath, pattern): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`src/main/services/SetupRunner.test.ts`:
```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SetupEvent } from '../../shared/types';
import { darwinPlatform } from '../platform/darwin';
import { addOrigin, makeRepo } from '../test-helpers/gitRepo';
import { GitClient } from './GitClient';
import { planSteps, SetupRunner, type SetupPlan } from './SetupRunner';

const git = new GitClient();
const runner = new SetupRunner(git, darwinPlatform({ SHELL: '/bin/sh' }));

function plan(repo: string, over: Partial<SetupPlan> = {}): SetupPlan {
  return {
    taskId: 'task1', repoPath: repo, worktreePath: path.join(path.dirname(repo), 'repo.worktrees', 'x'),
    branch: 'feature/x', baseRef: 'main', copy: [], commands: [], taskMd: '# Task\n', startTerminalsLabel: null, ...over,
  };
}

function collect() {
  const events: SetupEvent[] = [];
  return { events, onEvent: (e: SetupEvent) => events.push(e) };
}

describe('planSteps', () => {
  it('lists fetch, worktree, optional copy, task file, each command and optional terminals', () => {
    const steps = planSteps(plan('/r', { copy: ['.env'], commands: ['npm ci', 'npm run build'], startTerminalsLabel: 'Claude Code, zsh' }));
    expect(steps.map((s) => s.kind)).toEqual(['fetch', 'worktree', 'copy', 'task-file', 'command', 'command', 'terminals']);
    expect(steps[4]).toEqual({ kind: 'command', label: 'npm ci', detail: 'in worktree', command: 'npm ci' });
    expect(planSteps(plan('/r')).map((s) => s.kind)).toEqual(['fetch', 'worktree', 'task-file']);
  });
});

describe('SetupRunner', () => {
  it('creates the worktree, copies files, writes the task file, runs commands and starts terminals', async () => {
    const repo = makeRepo();
    addOrigin(repo);
    writeFileSync(path.join(repo, '.env'), 'SECRET=1');
    const p = plan(repo, { baseRef: 'origin/main', copy: ['.env', '.env.local'], commands: ['echo building > built.txt'], startTerminalsLabel: 'zsh' });
    const { events, onEvent } = collect();
    let started = false;
    const result = await runner.run(p, { onEvent, startTerminals: async () => { started = true; } });

    expect(result).toEqual({ ok: true });
    expect(started).toBe(true);
    expect(readFileSync(path.join(p.worktreePath, '.env'), 'utf8')).toBe('SECRET=1');
    expect(readFileSync(path.join(p.worktreePath, 'built.txt'), 'utf8').trim()).toBe('building');
    expect(readFileSync(path.join(p.worktreePath, '.miac', 'task.md'), 'utf8')).toBe('# Task\n');
    expect(readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain('.miac/');
    expect(await git.summary(p.worktreePath, 'origin/main')).toMatchObject({ files: [{ status: '?', path: '.env' }, { status: '?', path: 'built.txt' }] });

    const stepEvents = events.filter((e) => e.type === 'step');
    expect(stepEvents.filter((e) => e.type === 'step' && e.status === 'done')).toHaveLength(6);
    expect(events.some((e) => e.type === 'log' && e.line.includes('skipped .env.local'))).toBe(true);
    expect(events.at(-1)).toEqual({ taskId: 'task1', type: 'finished', ok: true });
  });

  it('stops at a failing command, keeps the worktree and reports the step', async () => {
    const repo = makeRepo();
    const p = plan(repo, { commands: ['echo before', 'exit 3', 'echo never'] });
    const { events, onEvent } = collect();
    const result = await runner.run(p, { onEvent, startTerminals: async () => {} });
    expect(result).toEqual({ ok: false, failedStep: 4 });
    expect(existsSync(p.worktreePath)).toBe(true);
    const failed = events.find((e) => e.type === 'step' && e.status === 'failed');
    expect(failed).toMatchObject({ index: 4, detail: expect.stringContaining('code 3') });
    expect(events.some((e) => e.type === 'log' && e.line === 'before')).toBe(true);
    expect(events.some((e) => e.type === 'log' && e.line === 'never')).toBe(false);
  });

  it('retries from a step, marking earlier steps done without re-running them', async () => {
    const repo = makeRepo();
    const p = plan(repo, { commands: ['echo one >> log.txt', 'exit 1'] });
    await runner.run(p, { onEvent: () => {}, startTerminals: async () => {} });
    const fixed = { ...p, commands: ['echo one >> log.txt', 'echo two >> log.txt'] };
    const { events, onEvent } = collect();
    const result = await runner.run(fixed, { onEvent, startTerminals: async () => {}, fromStep: 4 });
    expect(result).toEqual({ ok: true });
    expect(readFileSync(path.join(p.worktreePath, 'log.txt'), 'utf8')).toBe('one\ntwo\n');
    expect(events.filter((e) => e.type === 'step' && e.index < 4).every((e) => e.type === 'step' && e.status === 'done')).toBe(true);
  });

  it('reports a git failure on the worktree step', async () => {
    const repo = makeRepo();
    const p = plan(repo, { baseRef: 'does-not-exist' });
    const { events, onEvent } = collect();
    const result = await runner.run(p, { onEvent, startTerminals: async () => {} });
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(1);
    expect(events.some((e) => e.type === 'log' && e.line.includes('does-not-exist'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/services/SetupRunner.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/main/services/SetupRunner.ts`:
```ts
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SetupEvent, SetupStepDef } from '../../shared/types';
import type { Platform } from '../platform/Platform';
import type { GitClient } from './GitClient';

export type SetupPlan = {
  taskId: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  copy: string[];
  commands: string[];
  taskMd: string;
  startTerminalsLabel: string | null;
};

export type SetupHooks = {
  onEvent(e: SetupEvent): void;
  startTerminals(): Promise<void>;
  fromStep?: number;
};

export function planSteps(plan: SetupPlan): SetupStepDef[] {
  const steps: SetupStepDef[] = [
    { kind: 'fetch', label: 'Fetch base', detail: plan.baseRef },
    { kind: 'worktree', label: 'Create branch and worktree', detail: plan.branch },
  ];
  if (plan.copy.length > 0) steps.push({ kind: 'copy', label: 'Copy local files', detail: plan.copy.join(', ') });
  steps.push({ kind: 'task-file', label: 'Write task file', detail: '.miac/task.md' });
  for (const command of plan.commands) steps.push({ kind: 'command', label: command, detail: 'in worktree', command });
  if (plan.startTerminalsLabel) steps.push({ kind: 'terminals', label: 'Start terminals', detail: plan.startTerminalsLabel });
  return steps;
}

/** Adds a pattern to the repository's .git/info/exclude (shared by all worktrees) if it is not there yet. */
export async function ensureExcluded(git: GitClient, repoPath: string, pattern: string): Promise<void> {
  const common = await git.commonDir(repoPath);
  const file = path.join(common, 'info', 'exclude');
  await fs.mkdir(path.dirname(file), { recursive: true });
  let text = '';
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (text.split('\n').some((l) => l.trim() === pattern)) return;
  const sep = text.length === 0 || text.endsWith('\n') ? '' : '\n';
  await fs.writeFile(file, `${text}${sep}${pattern}\n`, 'utf8');
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export class SetupRunner {
  constructor(
    private readonly git: GitClient,
    private readonly platform: Platform,
  ) {}

  async run(plan: SetupPlan, hooks: SetupHooks): Promise<{ ok: boolean; failedStep?: number }> {
    const steps = planSteps(plan);
    const from = hooks.fromStep ?? 0;
    const emit = (e: Omit<SetupEvent, 'taskId'>) => hooks.onEvent({ taskId: plan.taskId, ...e } as SetupEvent);
    const log = (line: string) => emit({ type: 'log', line });

    for (let index = 0; index < steps.length; index++) {
      if (index < from) {
        emit({ type: 'step', index, status: 'done' });
        continue;
      }
      emit({ type: 'step', index, status: 'running' });
      const started = Date.now();
      try {
        await this.execute(steps[index], plan, hooks, log);
        emit({ type: 'step', index, status: 'done', ms: Date.now() - started });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        log(detail);
        emit({ type: 'step', index, status: 'failed', detail, ms: Date.now() - started });
        emit({ type: 'finished', ok: false, failedStep: index });
        return { ok: false, failedStep: index };
      }
    }
    emit({ type: 'finished', ok: true });
    return { ok: true };
  }

  private async execute(step: SetupStepDef, plan: SetupPlan, hooks: SetupHooks, log: (l: string) => void): Promise<void> {
    switch (step.kind) {
      case 'fetch': {
        log(`$ git fetch ${plan.baseRef}`);
        const fetched = await this.git.fetch(plan.repoPath, plan.baseRef);
        if (!fetched) log(`${plan.baseRef} has no remote, nothing to fetch`);
        return;
      }
      case 'worktree':
        log(`$ git worktree add -b ${plan.branch} ${plan.worktreePath} ${plan.baseRef}`);
        await this.git.worktreeAdd(plan.repoPath, { branch: plan.branch, path: plan.worktreePath, baseRef: plan.baseRef });
        return;
      case 'copy':
        for (const rel of plan.copy) {
          const src = path.join(plan.repoPath, rel);
          if (!(await exists(src))) {
            log(`skipped ${rel} (not present in ${path.basename(plan.repoPath)})`);
            continue;
          }
          await fs.cp(src, path.join(plan.worktreePath, rel), { recursive: true });
          log(`copied ${rel}`);
        }
        return;
      case 'task-file':
        await fs.mkdir(path.join(plan.worktreePath, '.miac'), { recursive: true });
        await fs.writeFile(path.join(plan.worktreePath, '.miac', 'task.md'), plan.taskMd, 'utf8');
        await ensureExcluded(this.git, plan.repoPath, '.miac/');
        log('wrote .miac/task.md');
        return;
      case 'command':
        log(`$ ${step.command}`);
        await this.runCommand(step.command ?? '', plan.worktreePath, log);
        return;
      case 'terminals':
        await hooks.startTerminals();
        return;
    }
  }

  private runCommand(cmd: string, cwd: string, log: (l: string) => void): Promise<void> {
    const { command, args } = this.platform.shellCommand(cmd);
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      const pipe = (stream: NodeJS.ReadableStream) => {
        let buf = '';
        stream.on('data', (chunk: Buffer | string) => {
          buf += chunk.toString();
          let nl = buf.indexOf('\n');
          while (nl >= 0) {
            log(buf.slice(0, nl).replace(/\r$/, ''));
            buf = buf.slice(nl + 1);
            nl = buf.indexOf('\n');
          }
        });
        stream.on('end', () => { if (buf.length > 0) log(buf); });
      };
      pipe(child.stdout);
      pipe(child.stderr);
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
    });
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project main src/main/services/SetupRunner.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/SetupRunner.ts src/main/services/SetupRunner.test.ts
git commit -m "feat: SetupRunner with step events, streamed log and retry from a step"
```

---

### Task 10: IPC contract, handler bundle, preload bridge and main-process wiring

**Files:**
- Create: `src/shared/ipc.ts`, `src/main/ipc/handlers.ts`, `src/main/ipc/register.ts`
- Modify: `src/preload.ts` (replace scaffold content), `src/main.ts` (replace scaffold content), `src/declarations.d.ts` (add `window.miac`)
- Test: `src/main/ipc/handlers.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 to 9.
- Produces: `Channels`, `Events`, `Handlers`, `MiacApi` types in `src/shared/ipc.ts`; `type Services`, `createHandlers(s: Services): Handlers`, `recoverInterruptedTasks(store): Promise<number>` in `src/main/ipc/handlers.ts`; `registerIpc(ipcMain, handlers)` in `src/main/ipc/register.ts`; `window.miac: MiacApi` from the preload.

- [ ] **Step 1: Write the IPC contract**

`src/shared/ipc.ts`:
```ts
import type {
  CreateTaskInput, FinishChecks, FinishOptions, GitSummary, MiacConfig, NewTerminal, Repo, SetupEvent, SetupState, Task, TaskView, TerminalDef,
} from './types';

/** Request/response channels. `args` is the tuple the renderer passes; `result` is what main resolves. */
export type Channels = {
  'repos:list': { args: []; result: Repo[] };
  'repos:add': { args: [folder: string]; result: Repo };
  'repos:remove': { args: [id: string]; result: void };
  'repos:refresh': { args: [id: string]; result: Repo };
  'repos:pickFolder': { args: []; result: string | null };
  'repos:config': { args: [repoId: string]; result: { config: MiacConfig; worktreeRoot: string } };
  'tasks:list': { args: []; result: TaskView[] };
  'tasks:create': { args: [input: CreateTaskInput]; result: Task };
  'tasks:setupState': { args: [taskId: string]; result: SetupState | null };
  'tasks:retrySetup': { args: [taskId: string]; result: void };
  'tasks:cancelSetup': { args: [taskId: string]; result: void };
  'tasks:gitSummary': { args: [taskId: string]; result: GitSummary };
  'tasks:finishChecks': { args: [taskId: string]; result: FinishChecks };
  'tasks:finish': { args: [taskId: string, options: FinishOptions]; result: void };
  'tasks:openInEditor': { args: [taskId: string]; result: void };
  'terminals:open': { args: [taskId: string, def: NewTerminal]; result: TerminalDef };
  'terminals:write': { args: [id: string, data: string]; result: void };
  'terminals:resize': { args: [id: string, cols: number, rows: number]; result: void };
  'terminals:kill': { args: [id: string]; result: void };
  'terminals:restart': { args: [id: string]; result: void };
  'terminals:buffer': { args: [id: string]; result: string };
  'terminals:isRunning': { args: [id: string]; result: boolean };
};

/** Push events from main to the renderer. */
export type Events = {
  setup: SetupEvent;
  'terminal:data': { id: string; data: string };
  'terminal:exit': { id: string; exitCode: number };
  'tasks:changed': TaskView[];
  'repos:changed': Repo[];
  notice: { level: 'info' | 'warn' | 'error'; message: string };
};

export type Handlers = { [K in keyof Channels]: (...args: Channels[K]['args']) => Promise<Channels[K]['result']> };

export type MiacApi = {
  invoke<K extends keyof Channels>(channel: K, ...args: Channels[K]['args']): Promise<Channels[K]['result']>;
  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void;
};

export const EVENT_PREFIX = 'miac-event:';
```

Add to `src/declarations.d.ts`:
```ts
/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

interface Window {
  miac: import('./shared/ipc').MiacApi;
}
```

- [ ] **Step 2: Write the failing handler tests**

`src/main/ipc/handlers.test.ts`:
```ts
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Events } from '../../shared/ipc';
import type { CreateTaskInput } from '../../shared/types';
import { darwinPlatform } from '../platform/darwin';
import { GitClient } from '../services/GitClient';
import { loadMiacConfig } from '../services/MiacConfig';
import { RepoRegistry } from '../services/RepoRegistry';
import { SetupRunner } from '../services/SetupRunner';
import { TaskStore } from '../services/TaskStore';
import { TerminalManager } from '../services/TerminalManager';
import { makeRepo } from '../test-helpers/gitRepo';
import { createHandlers, recoverInterruptedTasks, type Services } from './handlers';

type Broadcast = { event: keyof Events; payload: unknown };

async function harness() {
  const store = new TaskStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'miac-ipc-')), 'state.json'));
  await store.load();
  const git = new GitClient();
  const platform = darwinPlatform({ SHELL: '/bin/sh' });
  const terminals = new TerminalManager();
  const broadcasts: Broadcast[] = [];
  const waiters: ((e: Events['setup']) => void)[] = [];
  const services: Services = {
    store, git, platform, terminals,
    repos: new RepoRegistry(store, git),
    runner: new SetupRunner(git, platform),
    loadConfig: loadMiacConfig,
    pickFolder: async () => '/picked',
    launch: async () => {},
    broadcast: (event, payload) => {
      broadcasts.push({ event, payload });
      if (event === 'setup') waiters.splice(0).forEach((w) => w(payload as Events['setup']));
    },
  };
  const h = createHandlers(services);
  const repo = makeRepo('webshop');
  writeFileSync(path.join(repo, '.env'), 'X=1');
  writeFileSync(path.join(repo, '.miac.yml'), 'copy: [.env]\n');
  const added = await h['repos:add'](repo);
  const setupDone = () =>
    new Promise<Events['setup']>((resolve) => {
      const check = (e: Events['setup']) => (e.type === 'finished' ? resolve(e) : waiters.push(check));
      waiters.push(check);
    });
  const input = (over: Partial<CreateTaskInput> = {}): CreateTaskInput => ({
    repoId: added.id, baseRef: 'main', name: '', workItem: { id: '48231', type: 'User Story', title: 'Show estimated delivery date' },
    branch: 'feature/48231-show-estimated-delivery-date', copy: true, commands: ['echo ok > ok.txt'], startClaude: false, openShell: true, ...over,
  });
  return { h, store, terminals, broadcasts, repo, added, setupDone, input };
}

describe('handlers: repos', () => {
  it('lists, picks and removes repos', async () => {
    const { h, added } = await harness();
    expect(await h['repos:list']()).toEqual([added]);
    expect(await h['repos:pickFolder']()).toBe('/picked');
    const cfg = await h['repos:config'](added.id);
    expect(cfg.worktreeRoot).toBe(`${added.path}.worktrees`);
    expect(cfg.config).toMatchObject({ found: true, copy: ['.env'], setup: [] });
    await h['repos:remove'](added.id);
    expect(await h['repos:list']()).toEqual([]);
  });
});

describe('handlers: create task', () => {
  it('creates the task, runs setup, starts a shell and ends ready', async () => {
    const { h, terminals, setupDone, input, added, broadcasts } = await harness();
    const finished = setupDone();
    const task = await h['tasks:create'](input());
    expect(task.status).toBe('setting-up');
    expect(task.slug).toBe('48231-show-estimated-delivery-date');
    expect(task.worktreePath).toBe(path.join(`${added.path}.worktrees`, '48231-show-estimated-delivery-date'));
    expect((await finished).ok).toBe(true);
    const [view] = await h['tasks:list']();
    expect(view.status).toBe('ready');
    expect(view.worktreeMissing).toBe(false);
    expect(view.terminals).toHaveLength(1);
    expect(view.terminals[0].kind).toBe('shell');
    expect(terminals.runningCount(task.id)).toBe(1);
    expect(existsSync(path.join(task.worktreePath, '.env'))).toBe(true);
    expect(existsSync(path.join(task.worktreePath, 'ok.txt'))).toBe(true);
    const state = await h['tasks:setupState'](task.id);
    expect(state?.finished).toBe(true);
    expect(state?.steps.map((s) => s.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
    expect(broadcasts.some((b) => b.event === 'tasks:changed')).toBe(true);
    terminals.killAllForTask(task.id);
  });

  it('rejects an invalid branch name', async () => {
    const { h, input } = await harness();
    await expect(h['tasks:create'](input({ branch: 'feature/bad name' }))).rejects.toThrow(/not a valid branch name/);
  });

  it('rejects an existing branch and an existing worktree folder', async () => {
    const { h, input, setupDone, terminals } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input());
    await done;
    terminals.killAllForTask(t.id);
    await expect(h['tasks:create'](input({ workItem: { id: '1', type: 'Bug', title: 'other' } }))).rejects.toThrow(/already exists/);
    await expect(h['tasks:create'](input({ branch: 'feature/other' }))).rejects.toThrow(/already exists/);
  });

  it('marks the task setup-failed when a command fails, then retries from that step', async () => {
    const { h, input, setupDone, terminals, store } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ commands: ['exit 7'] }));
    expect((await done).ok).toBe(false);
    expect(store.state.tasks[0].status).toBe('setup-failed');
    const state = await h['tasks:setupState'](t.id);
    expect(state?.failedStep).toBe(4);
    writeFileSync(path.join(t.worktreePath, 'fix.txt'), 'fixed');
    await store.update((s) => { s.tasks[0].setup.commands = ['cat fix.txt']; });
    const retry = setupDone();
    await h['tasks:retrySetup'](t.id);
    expect((await retry).ok).toBe(true);
    expect(store.state.tasks[0].status).toBe('ready');
    terminals.killAllForTask(t.id);
  });

  it('cancels a failed setup: removes worktree, branch and task', async () => {
    const { h, input, setupDone, store, repo } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ commands: ['exit 1'], openShell: false }));
    await done;
    await h['tasks:cancelSetup'](t.id);
    expect(store.state.tasks).toHaveLength(0);
    expect(existsSync(t.worktreePath)).toBe(false);
    expect(await new GitClient().branchExists(repo, t.branch)).toBe(false);
  });
});

describe('handlers: finish', () => {
  it('reports checks, then removes worktree and branch and marks done', async () => {
    const { h, input, setupDone, terminals, store, repo } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input());
    await done;
    const checks = await h['tasks:finishChecks'](t.id);
    expect(checks.uncommitted).toEqual([{ status: '?', path: '.env' }, { status: '?', path: 'ok.txt' }]);
    expect(checks.unpushed).toBe(0);
    expect(checks.runningTerminals).toBe(1);
    await h['tasks:finish'](t.id, { closeTerminals: true, removeWorktree: true, deleteBranch: true });
    const [view] = await h['tasks:list']();
    expect(view.status).toBe('done');
    expect(view.finishedAt).not.toBeNull();
    expect(view.terminals).toEqual([]);
    expect(terminals.runningCount(t.id)).toBe(0);
    expect(existsSync(t.worktreePath)).toBe(false);
    expect(await new GitClient().branchExists(repo, t.branch)).toBe(false);
  });

  it('keeps the task ready when cleanup fails', async () => {
    const { h, input, setupDone, store, terminals } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ openShell: false }));
    await done;
    rmSync(t.worktreePath, { recursive: true, force: true });
    await expect(h['tasks:finish'](t.id, { closeTerminals: true, removeWorktree: true, deleteBranch: true })).rejects.toThrow();
    expect(store.state.tasks[0].status).toBe('ready');
    const [view] = await h['tasks:list']();
    expect(view.worktreeMissing).toBe(true);
    terminals.killAllForTask(t.id);
  });
});

describe('handlers: terminals', () => {
  it('opens a run terminal, exposes its buffer, restarts and kills it', async () => {
    const { h, input, setupDone, terminals, store } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ openShell: false }));
    await done;
    const def = await h['terminals:open'](t.id, { kind: 'run', label: 'dev', command: 'echo dev-server-up; sleep 30' });
    expect(store.state.tasks[0].terminals.map((x) => x.id)).toContain(def.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(await h['terminals:buffer'](def.id)).toContain('dev-server-up');
    expect(await h['terminals:isRunning'](def.id)).toBe(true);
    await h['terminals:kill'](def.id);
    expect(store.state.tasks[0].terminals.map((x) => x.id)).not.toContain(def.id);
    expect(terminals.runningCount(t.id)).toBe(0);
  });
});

describe('recoverInterruptedTasks', () => {
  it('turns setting-up into setup-failed and finishing into ready', async () => {
    const store = new TaskStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'miac-rec-')), 'state.json'));
    await store.load();
    const base = { repoId: 'r', name: 'x', workItem: null, slug: 'x', worktreePath: '/w', baseRef: 'main',
      setup: { copy: false, commands: [], startClaude: false, openShell: false }, terminals: [], createdAt: 'now', finishedAt: null } as const;
    await store.update((s) => {
      s.tasks.push({ ...base, id: 'a', branch: 'a', status: 'setting-up' }, { ...base, id: 'b', branch: 'b', status: 'finishing' }, { ...base, id: 'c', branch: 'c', status: 'ready' });
    });
    expect(await recoverInterruptedTasks(store)).toBe(2);
    expect(store.state.tasks.map((t) => t.status)).toEqual(['setup-failed', 'ready', 'ready']);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/ipc`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the handlers**

`src/main/ipc/handlers.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Events, Handlers } from '../../shared/ipc';
import { claudePrompt, renderTaskMd, taskSlug } from '../../shared/naming';
import type { MiacConfig, SetupEvent, SetupState, Task, TaskView, TerminalDef } from '../../shared/types';
import { worktreeRoot } from '../paths';
import type { Command, Platform } from '../platform/Platform';
import type { GitClient } from '../services/GitClient';
import type { RepoRegistry } from '../services/RepoRegistry';
import { planSteps, type SetupPlan, type SetupRunner } from '../services/SetupRunner';
import type { TaskStore } from '../services/TaskStore';
import type { TerminalManager } from '../services/TerminalManager';

export type Services = {
  store: TaskStore;
  git: GitClient;
  platform: Platform;
  repos: RepoRegistry;
  terminals: TerminalManager;
  runner: SetupRunner;
  loadConfig: (repoPath: string) => Promise<MiacConfig>;
  pickFolder: () => Promise<string | null>;
  launch: (cmd: Command) => Promise<void>;
  broadcast: <K extends keyof Events>(event: K, payload: Events[K]) => void;
};

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** After a crash, tasks cannot still be mid-setup or mid-finish. Returns how many were changed. */
export async function recoverInterruptedTasks(store: TaskStore): Promise<number> {
  let changed = 0;
  await store.update((s) => {
    for (const t of s.tasks) {
      if (t.status === 'setting-up') { t.status = 'setup-failed'; changed++; }
      else if (t.status === 'finishing') { t.status = 'ready'; changed++; }
    }
  });
  return changed;
}

export function createHandlers(s: Services): Handlers {
  const setupStates = new Map<string, SetupState>();

  const taskById = (id: string): Task => {
    const t = s.store.state.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`Unknown task ${id}`);
    return t;
  };

  const listTasks = async (): Promise<TaskView[]> =>
    Promise.all(s.store.state.tasks.map(async (t) => ({ ...t, worktreeMissing: t.status !== 'done' && !(await exists(t.worktreePath)) })));

  const tasksChanged = async () => s.broadcast('tasks:changed', await listTasks());

  const patchTask = async (id: string, patch: Partial<Task>) => {
    await s.store.update((st) => {
      const t = st.tasks.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    });
    await tasksChanged();
  };

  const terminalCommand = (task: Task, def: TerminalDef): Command => {
    if (def.kind === 'claude') return s.platform.claudeCommand(claudePrompt(task));
    if (def.kind === 'run' && def.command) return s.platform.shellCommand(def.command);
    return s.platform.interactiveShell();
  };

  const spawnTerminal = (task: Task, def: TerminalDef) => {
    const cmd = terminalCommand(task, def);
    s.terminals.spawn({ id: def.id, taskId: task.id, cwd: task.worktreePath, command: cmd.command, args: cmd.args });
  };

  const initialTerminals = (task: Task): TerminalDef[] => {
    const defs: TerminalDef[] = [];
    if (task.setup.startClaude) defs.push({ id: randomUUID(), kind: 'claude', label: 'Claude Code' });
    if (task.setup.openShell) defs.push({ id: randomUUID(), kind: 'shell', label: s.platform.shellLabel });
    return defs;
  };

  const applySetupEvent = (state: SetupState, e: SetupEvent) => {
    if (e.type === 'log') state.log.push(e.line);
    else if (e.type === 'step') {
      const step = state.steps[e.index];
      if (step) { step.status = e.status; step.detail = e.detail ?? step.detail; step.ms = e.ms ?? step.ms; }
    } else {
      state.finished = true;
      state.ok = e.ok;
      state.failedStep = e.failedStep ?? null;
    }
  };

  const buildPlan = async (task: Task): Promise<SetupPlan> => {
    const repo = s.repos.get(task.repoId);
    const config = await s.loadConfig(repo.path);
    const defs = initialTerminals(task);
    return {
      taskId: task.id, repoPath: repo.path, worktreePath: task.worktreePath, branch: task.branch, baseRef: task.baseRef,
      copy: task.setup.copy ? config.copy : [], commands: task.setup.commands, taskMd: renderTaskMd(task),
      startTerminalsLabel: defs.length > 0 ? defs.map((d) => d.label).join(', ') : null,
    };
  };

  const runSetup = async (taskId: string, fromStep?: number): Promise<void> => {
    const task = taskById(taskId);
    const plan = await buildPlan(task);
    const steps = planSteps(plan);
    const state: SetupState = { steps: steps.map((def) => ({ def, status: 'todo' })), log: [], finished: false, ok: null, failedStep: null };
    setupStates.set(taskId, state);
    const result = await s.runner.run(plan, {
      fromStep,
      onEvent: (e) => { applySetupEvent(state, e); s.broadcast('setup', e); },
      startTerminals: async () => {
        const defs = initialTerminals(task);
        for (const def of defs) spawnTerminal({ ...task, terminals: defs }, def);
        await patchTask(taskId, { terminals: defs });
      },
    });
    await patchTask(taskId, { status: result.ok ? 'ready' : 'setup-failed' });
  };

  const startSetupInBackground = (taskId: string, fromStep?: number) => {
    void runSetup(taskId, fromStep).catch(async (e: Error) => {
      s.broadcast('notice', { level: 'error', message: `Setup failed: ${e.message}` });
      await patchTask(taskId, { status: 'setup-failed' });
    });
  };

  return {
    'repos:list': async () => s.repos.list(),
    'repos:add': async (folder) => {
      const repo = await s.repos.add(folder);
      s.broadcast('repos:changed', s.repos.list());
      return repo;
    },
    'repos:remove': async (id) => {
      await s.repos.remove(id);
      s.broadcast('repos:changed', s.repos.list());
    },
    'repos:refresh': async (id) => {
      const repo = await s.repos.refresh(id);
      s.broadcast('repos:changed', s.repos.list());
      return repo;
    },
    'repos:pickFolder': () => s.pickFolder(),
    'repos:config': async (repoId) => {
      const repo = s.repos.get(repoId);
      return { config: await s.loadConfig(repo.path), worktreeRoot: worktreeRoot(repo.path) };
    },

    'tasks:list': listTasks,
    'tasks:create': async (input) => {
      const repo = s.repos.get(input.repoId);
      const branch = input.branch.trim();
      if (!(await s.git.validBranchName(repo.path, branch))) throw new Error(`"${branch}" is not a valid branch name`);
      if (await s.git.branchExists(repo.path, branch)) throw new Error(`Branch ${branch} already exists in ${repo.name}`);
      if (!input.workItem && input.name.trim().length === 0) throw new Error('Give the task a name or a work item');
      if (input.workItem && input.workItem.title.trim().length === 0) throw new Error('Give the work item a title');
      const slug = taskSlug(input.workItem, input.name);
      const worktreePath = path.join(worktreeRoot(repo.path), slug);
      if (await exists(worktreePath)) throw new Error(`Folder ${worktreePath} already exists`);
      const task: Task = {
        id: randomUUID(), repoId: repo.id, name: input.name.trim(), workItem: input.workItem, slug, branch, worktreePath, baseRef: input.baseRef,
        status: 'setting-up', setup: { copy: input.copy, commands: input.commands, startClaude: input.startClaude, openShell: input.openShell },
        terminals: [], createdAt: new Date().toISOString(), finishedAt: null,
      };
      await s.store.update((st) => { st.tasks.push(task); });
      await tasksChanged();
      startSetupInBackground(task.id);
      return task;
    },
    'tasks:setupState': async (taskId) => setupStates.get(taskId) ?? null,
    'tasks:retrySetup': async (taskId) => {
      const task = taskById(taskId);
      if (task.status !== 'setup-failed') throw new Error('Only a failed setup can be retried');
      const from = setupStates.get(taskId)?.failedStep ?? 0;
      await patchTask(taskId, { status: 'setting-up' });
      startSetupInBackground(taskId, from);
    },
    'tasks:cancelSetup': async (taskId) => {
      const task = taskById(taskId);
      const repo = s.repos.get(task.repoId);
      s.terminals.killAllForTask(taskId);
      if (await exists(task.worktreePath)) await s.git.worktreeRemove(repo.path, task.worktreePath, true);
      if (await s.git.branchExists(repo.path, task.branch)) await s.git.deleteBranch(repo.path, task.branch);
      setupStates.delete(taskId);
      await s.store.update((st) => { st.tasks = st.tasks.filter((t) => t.id !== taskId); });
      await tasksChanged();
    },
    'tasks:gitSummary': async (taskId) => {
      const task = taskById(taskId);
      return s.git.summary(task.worktreePath, task.baseRef);
    },
    'tasks:finishChecks': async (taskId) => {
      const task = taskById(taskId);
      const summary = await s.git.summary(task.worktreePath, task.baseRef);
      return { uncommitted: summary.files, unpushed: summary.ahead, runningTerminals: s.terminals.runningCount(taskId) };
    },
    'tasks:finish': async (taskId, options) => {
      const task = taskById(taskId);
      const repo = s.repos.get(task.repoId);
      await patchTask(taskId, { status: 'finishing' });
      try {
        if (options.closeTerminals) s.terminals.killAllForTask(taskId);
        if (options.removeWorktree) await s.git.worktreeRemove(repo.path, task.worktreePath, true);
        if (options.deleteBranch) await s.git.deleteBranch(repo.path, task.branch);
      } catch (e) {
        await patchTask(taskId, { status: 'ready' });
        throw e;
      }
      await patchTask(taskId, { status: 'done', finishedAt: new Date().toISOString(), terminals: options.closeTerminals ? [] : task.terminals });
    },
    'tasks:openInEditor': async (taskId) => {
      const task = taskById(taskId);
      await s.launch(s.platform.editorCommand(task.worktreePath));
    },

    'terminals:open': async (taskId, def) => {
      const task = taskById(taskId);
      const full: TerminalDef = { id: randomUUID(), ...def };
      spawnTerminal(task, full);
      await patchTask(taskId, { terminals: [...task.terminals, full] });
      return full;
    },
    'terminals:write': async (id, data) => s.terminals.write(id, data),
    'terminals:resize': async (id, cols, rows) => s.terminals.resize(id, cols, rows),
    'terminals:kill': async (id) => {
      s.terminals.kill(id);
      const owner = s.store.state.tasks.find((t) => t.terminals.some((x) => x.id === id));
      if (owner) await patchTask(owner.id, { terminals: owner.terminals.filter((x) => x.id !== id) });
    },
    'terminals:restart': async (id) => s.terminals.restart(id),
    'terminals:buffer': async (id) => s.terminals.buffer(id),
    'terminals:isRunning': async (id) => s.terminals.isRunning(id),
  };
}
```

`src/main/ipc/register.ts`:
```ts
import type { IpcMain } from 'electron';
import type { Handlers } from '../../shared/ipc';

/** Registers every handler under its channel name. Errors propagate to the renderer as rejected promises. */
export function registerIpc(ipcMain: Pick<IpcMain, 'handle'>, handlers: Handlers): void {
  for (const channel of Object.keys(handlers) as (keyof Handlers)[]) {
    const fn = handlers[channel] as (...args: unknown[]) => Promise<unknown>;
    ipcMain.handle(channel, (_event, ...args: unknown[]) => fn(...args));
  }
}
```

- [ ] **Step 5: Run the handler tests**

Run: `npx vitest run --project main src/main/ipc`
Expected: PASS (11 tests). The `register.ts` file is covered by the manual check in Step 8.

- [ ] **Step 6: Write the preload bridge**

`src/preload.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';
import { EVENT_PREFIX, type MiacApi } from './shared/ipc';

const api: MiacApi = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (event, listener) => {
    const channel = `${EVENT_PREFIX}${event}`;
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) => listener(payload as never);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('miac', api);
```

- [ ] **Step 7: Wire the main process**

`src/main.ts` (replace the scaffold file entirely):
```ts
import { spawn } from 'node:child_process';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import started from 'electron-squirrel-startup';
import { EVENT_PREFIX, type Events } from './shared/ipc';
import { createHandlers, recoverInterruptedTasks } from './main/ipc/handlers';
import { registerIpc } from './main/ipc/register';
import { createPlatform } from './main/platform';
import { GitClient } from './main/services/GitClient';
import { loadMiacConfig } from './main/services/MiacConfig';
import { RepoRegistry } from './main/services/RepoRegistry';
import { SetupRunner } from './main/services/SetupRunner';
import { TaskStore } from './main/services/TaskStore';
import { TerminalManager } from './main/services/TerminalManager';

if (started) app.quit();

let mainWindow: BrowserWindow | null = null;
const terminals = new TerminalManager();

function broadcast<K extends keyof Events>(event: K, payload: Events[K]): void {
  mainWindow?.webContents.send(`${EVENT_PREFIX}${event}`, payload);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#15171a',
    title: 'MIAC',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  return win;
}

async function boot(): Promise<void> {
  const store = new TaskStore(path.join(app.getPath('userData'), 'state.json'));
  const loaded = await store.load();
  const recovered = await recoverInterruptedTasks(store);
  const git = new GitClient();
  const platform = createPlatform();
  const handlers = createHandlers({
    store, git, platform, terminals,
    repos: new RepoRegistry(store, git),
    runner: new SetupRunner(git, platform),
    loadConfig: loadMiacConfig,
    pickFolder: async () => {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
    },
    launch: async (cmd) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(cmd.command, cmd.args, { detached: true, stdio: 'ignore' });
        child.on('error', (e) => reject(new Error(`Could not start ${cmd.command}: ${e.message}`)));
        child.on('spawn', () => { child.unref(); resolve(); });
      }),
    broadcast,
  });
  registerIpc(ipcMain, handlers);
  terminals.on('data', (id, data) => broadcast('terminal:data', { id, data }));
  terminals.on('exit', (id, exitCode) => broadcast('terminal:exit', { id, exitCode }));

  mainWindow = createWindow();
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.once('did-finish-load', () => {
    if (loaded.recovered) broadcast('notice', { level: 'warn', message: `state.json was unreadable and was moved to ${path.basename(loaded.backup ?? '')}. Starting empty.` });
    if (recovered > 0) broadcast('notice', { level: 'warn', message: `${recovered} task(s) were interrupted by a previous exit and need attention.` });
  });
}

app.whenReady().then(boot);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  for (const id of terminals.ids()) terminals.kill(id);
});
```

- [ ] **Step 8: Run everything and start the app**

```bash
npm test
npm run typecheck
npm start
```

Expected: all tests pass; typecheck clean; the app starts, the window shows the brand, and in DevTools `await window.miac.invoke('repos:list')` returns `[]`. Quit.

- [ ] **Step 9: Commit**

```bash
git add src/shared/ipc.ts src/main/ipc src/preload.ts src/main.ts src/declarations.d.ts
git commit -m "feat: typed IPC bridge, handler bundle and main-process wiring"
```

---

### Task 11: Renderer foundation: API wrapper, store, app shell, notices and the Settings screen

**Files:**
- Create: `src/renderer/api.ts`, `src/renderer/store.ts`, `src/renderer/test-helpers/fakeApi.ts`, `src/renderer/components/TopBar.tsx`, `src/renderer/components/Notices.tsx`, `src/renderer/screens/SettingsScreen.tsx`, `src/renderer/screens/WorkspaceScreen.tsx` (placeholder, replaced in Task 14), `src/renderer/styles/screens.css`
- Modify: `src/renderer/App.tsx`, `src/renderer/App.test.tsx`, `src/renderer/styles/app.css` (import screens.css)
- Test: `src/renderer/screens/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `MiacApi`, `Channels`, `Events` (Task 10), `Repo`, `TaskView`, `Notice` (Task 2).
- Produces: `api(): MiacApi`; `type Screen`; `useStore` (zustand) with `screen, repos, tasks, selectedTaskId, notices, go(screen), select(id), setRepos, setTasks, notify(level, message), dismiss(id), load()`; `installFakeApi(overrides?)` returning `{ calls, emit }`; components `TopBar`, `Notices`, `SettingsScreen`, `WorkspaceScreen`.

- [ ] **Step 1: Write the API wrapper, store and fake API**

`src/renderer/api.ts`:
```ts
import type { MiacApi } from '../shared/ipc';

export function api(): MiacApi {
  if (!window.miac) throw new Error('window.miac is not available: preload did not run');
  return window.miac;
}

/** Runs an IPC call and turns a rejection into a notice instead of an unhandled error. */
export async function tryInvoke<T>(run: () => Promise<T>, notify: (level: 'error', message: string) => void): Promise<T | undefined> {
  try {
    return await run();
  } catch (e) {
    notify('error', e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    return undefined;
  }
}
```

`src/renderer/store.ts`:
```ts
import { create } from 'zustand';
import type { Notice, Repo, TaskView } from '../shared/types';
import { api } from './api';

export type Screen =
  | { kind: 'workspace' }
  | { kind: 'new-task' }
  | { kind: 'setup'; taskId: string }
  | { kind: 'finish'; taskId: string }
  | { kind: 'settings' };

type Store = {
  screen: Screen;
  repos: Repo[];
  tasks: TaskView[];
  selectedTaskId: string | null;
  notices: Notice[];
  go(screen: Screen): void;
  select(taskId: string | null): void;
  setRepos(repos: Repo[]): void;
  setTasks(tasks: TaskView[]): void;
  notify(level: Notice['level'], message: string): void;
  dismiss(id: string): void;
  load(): Promise<void>;
};

let noticeSeq = 0;

export const useStore = create<Store>((set, get) => ({
  screen: { kind: 'workspace' },
  repos: [],
  tasks: [],
  selectedTaskId: null,
  notices: [],
  go: (screen) => set({ screen }),
  select: (selectedTaskId) => set({ selectedTaskId }),
  setRepos: (repos) => set({ repos }),
  setTasks: (tasks) => {
    const selected = get().selectedTaskId;
    const stillThere = tasks.some((t) => t.id === selected);
    const firstOpen = tasks.find((t) => t.status !== 'done')?.id ?? null;
    set({ tasks, selectedTaskId: stillThere ? selected : firstOpen });
  },
  notify: (level, message) => {
    const id = `n${++noticeSeq}`;
    set({ notices: [...get().notices, { id, level, message }] });
    if (level !== 'error') setTimeout(() => get().dismiss(id), 6000);
  },
  dismiss: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
  load: async () => {
    const [repos, tasks] = await Promise.all([api().invoke('repos:list'), api().invoke('tasks:list')]);
    get().setRepos(repos);
    get().setTasks(tasks);
  },
}));
```

`src/renderer/test-helpers/fakeApi.ts`:
```ts
import type { Channels, Events, MiacApi } from '../../shared/ipc';

type AnyFn = (...args: never[]) => unknown;
export type FakeHandlers = Partial<{ [K in keyof Channels]: (...args: Channels[K]['args']) => Channels[K]['result'] | Promise<Channels[K]['result']> }>;

const defaults: FakeHandlers = {
  'repos:list': () => [],
  'tasks:list': () => [],
  'tasks:setupState': () => null,
  'terminals:buffer': () => '',
  'terminals:isRunning': () => false,
  'terminals:write': () => undefined,
  'terminals:resize': () => undefined,
};

/** Installs `window.miac` backed by plain functions. Returns the call log and an `emit` to push events. */
export function installFakeApi(overrides: FakeHandlers = {}) {
  const calls: { channel: keyof Channels; args: unknown[] }[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const handlers = { ...defaults, ...overrides };
  const fake: MiacApi = {
    invoke: async (channel, ...args) => {
      calls.push({ channel, args });
      const fn = handlers[channel] as AnyFn | undefined;
      if (!fn) throw new Error(`No fake handler for ${channel}`);
      return (await fn(...(args as never[]))) as never;
    },
    on: (event, listener) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener as (p: unknown) => void);
      listeners.set(event, set);
      return () => set.delete(listener as (p: unknown) => void);
    },
  };
  window.miac = fake;
  const emit = <K extends keyof Events>(event: K, payload: Events[K]) => listeners.get(event)?.forEach((l) => l(payload));
  return { calls, emit };
}
```

- [ ] **Step 2: Write the failing Settings test**

`src/renderer/screens/SettingsScreen.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { SettingsScreen } from './SettingsScreen';

const webshop: Repo = { id: 'r1', name: 'webshop', path: '/src/webshop', baseBranch: 'main', connectionId: null, miacYmlFound: true };

beforeEach(() => {
  useStore.setState({ repos: [], tasks: [], notices: [], screen: { kind: 'settings' } });
});

describe('SettingsScreen', () => {
  it('lists repos with their base branch and .miac.yml status', () => {
    installFakeApi();
    useStore.setState({ repos: [webshop, { ...webshop, id: 'r2', name: 'api', path: '/src/api', baseBranch: 'develop', miacYmlFound: false }] });
    render(<SettingsScreen />);
    expect(screen.getByText('webshop')).toBeInTheDocument();
    expect(screen.getByText('/src/webshop · base main')).toBeInTheDocument();
    expect(screen.getByText('.miac.yml found')).toBeInTheDocument();
    expect(screen.getByText('No .miac.yml, using defaults')).toBeInTheDocument();
  });

  it('adds a folder through the native picker', async () => {
    const { calls } = installFakeApi({ 'repos:pickFolder': () => '/src/picked', 'repos:add': () => ({ ...webshop, id: 'r9', name: 'picked', path: '/src/picked' }) });
    render(<SettingsScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Add folder…' }));
    await waitFor(() => expect(calls.map((c) => c.channel)).toEqual(['repos:pickFolder', 'repos:add']));
    expect(calls[1].args).toEqual(['/src/picked']);
    expect(useStore.getState().repos.map((r) => r.name)).toEqual(['picked']);
  });

  it('shows an error notice when adding fails', async () => {
    installFakeApi({ 'repos:pickFolder': () => '/nope', 'repos:add': () => { throw new Error('/nope is not a git repository'); } });
    render(<SettingsScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Add folder…' }));
    await waitFor(() => expect(useStore.getState().notices[0]?.message).toBe('/nope is not a git repository'));
  });

  it('shows the effective config for a repo', async () => {
    installFakeApi({ 'repos:config': () => ({ worktreeRoot: '/src/webshop.worktrees', config: { base: 'main', branch: '{type}/{id}-{slug}', copy: ['.env'], setup: ['npm ci'], run: { dev: 'npm run dev' }, found: true } }) });
    useStore.setState({ repos: [webshop] });
    render(<SettingsScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Show setup' }));
    await waitFor(() => expect(screen.getByText(/dev: npm run dev/)).toBeInTheDocument());
    expect(screen.getByText(/copy: \[\.env\]/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run --project renderer src/renderer/screens/SettingsScreen.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the shared components and the Settings screen**

`src/renderer/styles/screens.css`:
```css
.settings { flex: 1; display: flex; min-height: 0; }
.settings-nav { flex: 0 0 220px; padding: 16px 8px; border-right: 1px solid var(--border); background: var(--panel); display: flex; flex-direction: column; gap: 2px; }
.settings-nav a { padding: 10px 12px; border-radius: var(--radius); color: var(--text-soft); text-decoration: none; }
.settings-nav a.active { background: var(--panel-raised); color: var(--text); }
.settings-nav a.disabled { opacity: 0.45; pointer-events: none; }
.settings-main { flex: 1; min-width: 0; padding: 28px 32px; display: flex; flex-direction: column; gap: 36px; max-width: 900px; overflow: auto; }
.section { display: flex; flex-direction: column; gap: 14px; }
.section-head { display: flex; align-items: center; gap: 12px; }
.section-head h2 { margin: 0; font-size: 18px; font-weight: 600; }
.section-head .btn { margin-left: auto; }
.list { border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.list-row { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.list-row:last-child { border-bottom: none; }
.list-row .grow { flex: 1 1 240px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.codeblock { background: var(--term); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px 16px; font: 13px/1.6 var(--font-mono); color: var(--text-soft); white-space: pre; overflow: auto; }
.empty { padding: 40px; text-align: center; color: var(--muted); }
.placeholder { color: var(--muted); font-size: 13px; }

.workspace { flex: 1; display: flex; min-height: 0; }
```

Add `@import './screens.css';` right after the tokens import in `src/renderer/styles/app.css`.

`src/renderer/components/TopBar.tsx`:
```tsx
import type { ReactNode } from 'react';
import { useStore } from '../store';

export function TopBar({ children, crumb }: { children?: ReactNode; crumb?: string }) {
  const go = useStore((s) => s.go);
  return (
    <header className="topbar">
      <button type="button" className="brand" style={{ background: 'none', border: 'none', padding: 0 }} onClick={() => go({ kind: 'workspace' })}>
        MIAC
      </button>
      {crumb && <div className="muted">{crumb}</div>}
      {children}
    </header>
  );
}
```

`src/renderer/components/Notices.tsx`:
```tsx
import { useStore } from '../store';

export function Notices() {
  const notices = useStore((s) => s.notices);
  const dismiss = useStore((s) => s.dismiss);
  if (notices.length === 0) return null;
  return (
    <div className="notices" role="status">
      {notices.map((n) => (
        <div key={n.id} className={`notice notice-${n.level}`}>
          <span>{n.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(n.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
```

`src/renderer/screens/SettingsScreen.tsx`:
```tsx
import { useState } from 'react';
import type { MiacConfig, Repo } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { TopBar } from '../components/TopBar';
import { useStore } from '../store';

function renderConfig(name: string, c: MiacConfig, worktreeRoot: string): string {
  const lines = [
    `${name}/.miac.yml${c.found ? '' : ' (defaults, file not found)'}`,
    `base: ${c.base}`,
    `branch: "${c.branch}"`,
    `copy: [${c.copy.join(', ')}]`,
    'setup:',
    ...c.setup.map((s) => `  - ${s}`),
    'run:',
    ...Object.entries(c.run).map(([k, v]) => `  ${k}: ${v}`),
    '',
    `# worktrees go in ${worktreeRoot}`,
  ];
  return lines.join('\n');
}

function RepoRow({ repo }: { repo: Repo }) {
  const notify = useStore((s) => s.notify);
  const setRepos = useStore((s) => s.setRepos);
  const [shown, setShown] = useState<string | null>(null);

  const show = async () => {
    if (shown !== null) return setShown(null);
    const result = await tryInvoke(() => api().invoke('repos:config', repo.id), notify);
    if (result) setShown(renderConfig(repo.name, result.config, result.worktreeRoot));
  };
  const remove = async () => {
    const ok = await tryInvoke(async () => { await api().invoke('repos:remove', repo.id); return true; }, notify);
    if (ok) setRepos(await api().invoke('repos:list'));
  };

  return (
    <>
      <div className="list-row">
        <div className="grow">
          <span style={{ fontWeight: 600 }}>{repo.name}</span>
          <span className="mono small muted">{`${repo.path} · base ${repo.baseBranch}`}</span>
        </div>
        {repo.miacYmlFound ? <span className="tag tag-green">.miac.yml found</span> : <span className="tag tag-warn">No .miac.yml, using defaults</span>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={show}>{shown === null ? 'Show setup' : 'Hide setup'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={remove}>Remove</button>
      </div>
      {shown !== null && <div className="codeblock" style={{ borderRadius: 0, borderWidth: '0 0 1px 0' }}>{shown}</div>}
    </>
  );
}

export function SettingsScreen() {
  const repos = useStore((s) => s.repos);
  const setRepos = useStore((s) => s.setRepos);
  const notify = useStore((s) => s.notify);
  const go = useStore((s) => s.go);

  const addFolder = async () => {
    const folder = await tryInvoke(() => api().invoke('repos:pickFolder'), notify);
    if (!folder) return;
    const added = await tryInvoke(() => api().invoke('repos:add', folder), notify);
    if (added) setRepos(await api().invoke('repos:list'));
  };

  return (
    <>
      <TopBar crumb="Settings">
        <a href="#" className="spacer" onClick={(e) => { e.preventDefault(); go({ kind: 'workspace' }); }}>Back to tasks</a>
      </TopBar>
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          <a href="#repos" className="active">Repositories</a>
          <a href="#ado" className="disabled" aria-disabled="true">Azure DevOps</a>
          <a href="#cost" className="disabled" aria-disabled="true">AI cost and invoicing</a>
          <a href="#terminals" className="disabled" aria-disabled="true">Terminals and Claude</a>
        </nav>
        <main className="settings-main">
          <section id="repos" className="section">
            <div className="section-head">
              <h2>Repositories</h2>
              <button type="button" className="btn" onClick={addFolder}>Add folder…</button>
            </div>
            {repos.length === 0 ? (
              <div className="list"><div className="empty">No repositories yet. Add the folder of a git repository to start tasks in it.</div></div>
            ) : (
              <div className="list">{repos.map((r) => <RepoRow key={r.id} repo={r} />)}</div>
            )}
          </section>
          <section id="ado" className="section">
            <div className="section-head"><h2>Azure DevOps</h2></div>
            <p className="placeholder">Connections to one or more Azure DevOps organizations arrive in the next release.</p>
          </section>
          <section id="cost" className="section">
            <div className="section-head"><h2>AI cost and invoicing</h2></div>
            <p className="placeholder">Rate table, currency and customer mapping arrive with usage tracking.</p>
          </section>
          <section id="terminals" className="section">
            <div className="section-head"><h2>Terminals and Claude</h2></div>
            <p className="placeholder">Default shell and Claude flags are fixed to the platform defaults for now.</p>
          </section>
        </main>
      </div>
    </>
  );
}
```

`src/renderer/screens/WorkspaceScreen.tsx` (placeholder for Task 14):
```tsx
import { TopBar } from '../components/TopBar';
import { useStore } from '../store';

export function WorkspaceScreen() {
  const go = useStore((s) => s.go);
  const tasks = useStore((s) => s.tasks);
  return (
    <>
      <TopBar>
        <div className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => go({ kind: 'new-task' })}>New task</button>
        <button type="button" className="btn" aria-label="Settings" onClick={() => go({ kind: 'settings' })}>⚙</button>
      </TopBar>
      <div className="workspace">
        <div className="empty">{tasks.length === 0 ? 'No tasks yet.' : `${tasks.length} task(s).`}</div>
      </div>
    </>
  );
}
```

`src/renderer/App.tsx`:
```tsx
import { useEffect } from 'react';
import { api } from './api';
import { Notices } from './components/Notices';
import { SettingsScreen } from './screens/SettingsScreen';
import { WorkspaceScreen } from './screens/WorkspaceScreen';
import { useStore } from './store';

export function App() {
  const screen = useStore((s) => s.screen);
  const load = useStore((s) => s.load);
  const setTasks = useStore((s) => s.setTasks);
  const setRepos = useStore((s) => s.setRepos);
  const notify = useStore((s) => s.notify);

  useEffect(() => {
    void load().catch((e: Error) => notify('error', e.message));
    const offs = [
      api().on('tasks:changed', setTasks),
      api().on('repos:changed', setRepos),
      api().on('notice', (n) => notify(n.level, n.message)),
    ];
    return () => offs.forEach((off) => off());
  }, [load, setTasks, setRepos, notify]);

  return (
    <div className="app">
      {screen.kind === 'settings' ? <SettingsScreen /> : <WorkspaceScreen />}
      <Notices />
    </div>
  );
}
```

Update `src/renderer/App.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { installFakeApi } from './test-helpers/fakeApi';
import { App } from './App';

beforeEach(() => useStore.setState({ repos: [], tasks: [], notices: [], screen: { kind: 'workspace' } }));

describe('App', () => {
  it('loads repos and tasks on start and shows notices pushed from main', async () => {
    const { calls, emit } = installFakeApi();
    render(<App />);
    expect(screen.getByText('MIAC')).toBeInTheDocument();
    await waitFor(() => expect(calls.map((c) => c.channel).sort()).toEqual(['repos:list', 'tasks:list']));
    emit('notice', { level: 'warn', message: 'state.json was unreadable' });
    expect(await screen.findByText('state.json was unreadable')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run the renderer tests**

Run: `npx vitest run --project renderer`
Expected: PASS (5 tests).

- [ ] **Step 6: Start the app and add a real repo**

```bash
npm start
```

Click the gear, click "Add folder…", pick any local git repo (for example this MIAC checkout). Expected: the row appears with its base branch and `.miac.yml` status; "Show setup" prints the effective config with the worktree root. Pick a non-git folder: a red notice says it is not a git repository. Quit.

- [ ] **Step 7: Commit**

```bash
git add src/renderer
git commit -m "feat: renderer store, API wrapper, notices and Settings with repositories"
```

---

### Task 12: New task screen

**Files:**
- Create: `src/renderer/screens/NewTaskScreen.tsx`
- Modify: `src/renderer/App.tsx` (mount the overlay when `screen.kind === 'new-task'`), `src/renderer/styles/screens.css` (form layout)
- Test: `src/renderer/screens/NewTaskScreen.test.tsx`

**Interfaces:**
- Consumes: `renderBranch`, `taskSlug` (Task 2), `repos:config`, `tasks:create` (Task 10), store.
- Produces: `NewTaskScreen` component.

- [ ] **Step 1: Write the failing tests**

`src/renderer/screens/NewTaskScreen.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { NewTaskScreen } from './NewTaskScreen';

const webshop: Repo = { id: 'r1', name: 'webshop', path: '/src/webshop', baseBranch: 'main', connectionId: null, miacYmlFound: true };
const config = { worktreeRoot: '/src/webshop.worktrees', config: { base: 'main', branch: '{type}/{id}-{slug}', copy: ['.env', '.env.local'], setup: ['npm ci', 'npm run build'], run: {}, found: true } };

beforeEach(() => useStore.setState({ repos: [webshop], tasks: [], notices: [], screen: { kind: 'new-task' } }));

describe('NewTaskScreen', () => {
  it('prefills branch and folder from the work item and the repo template', async () => {
    installFakeApi({ 'repos:config': () => config });
    render(<NewTaskScreen />);
    await userEvent.type(screen.getByLabelText('Work item id'), '48231');
    await userEvent.type(screen.getByLabelText('Title'), 'Show estimated delivery date on product page');
    await waitFor(() => expect(screen.getByLabelText('Branch')).toHaveValue('feature/48231-show-estimated-delivery-date-on-product'));
    expect(screen.getByText('/src/webshop.worktrees/48231-show-estimated-delivery-date-on-product')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Bug');
    expect(screen.getByLabelText('Branch')).toHaveValue('bugfix/48231-show-estimated-delivery-date-on-product');
  });

  it('keeps a branch the user edited by hand', async () => {
    installFakeApi({ 'repos:config': () => config });
    render(<NewTaskScreen />);
    await userEvent.type(screen.getByLabelText('Title'), 'One');
    await userEvent.clear(screen.getByLabelText('Branch'));
    await userEvent.type(screen.getByLabelText('Branch'), 'custom/x');
    await userEvent.type(screen.getByLabelText('Title'), ' two');
    expect(screen.getByLabelText('Branch')).toHaveValue('custom/x');
  });

  it('uses the task name for a blank task', async () => {
    installFakeApi({ 'repos:config': () => config });
    render(<NewTaskScreen />);
    await userEvent.click(screen.getByRole('tab', { name: 'Blank task' }));
    await userEvent.type(screen.getByLabelText('Task name'), 'Spike new search');
    await waitFor(() => expect(screen.getByLabelText('Branch')).toHaveValue('feature/spike-new-search'));
  });

  it('creates the task with the chosen options and opens the setup screen', async () => {
    const { calls } = installFakeApi({
      'repos:config': () => config,
      'tasks:create': () => ({ id: 't1' }) as never,
    });
    render(<NewTaskScreen />);
    await userEvent.type(screen.getByLabelText('Work item id'), '48231');
    await userEvent.type(screen.getByLabelText('Title'), 'Delivery date');
    await waitFor(() => expect(screen.getByLabelText('npm run build')).toBeChecked());
    await userEvent.click(screen.getByLabelText('npm run build'));
    await userEvent.click(screen.getByLabelText('Open a shell tab'));
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(useStore.getState().screen).toEqual({ kind: 'setup', taskId: 't1' }));
    const create = calls.find((c) => c.channel === 'tasks:create');
    expect(create?.args[0]).toEqual({
      repoId: 'r1', baseRef: 'origin/main', name: '', workItem: { id: '48231', type: 'User Story', title: 'Delivery date' },
      branch: 'feature/48231-delivery-date', copy: true, commands: ['npm ci'], startClaude: true, openShell: false,
    });
  });

  it('shows the error and stays open when create fails', async () => {
    installFakeApi({ 'repos:config': () => config, 'tasks:create': () => { throw new Error('Branch feature/x already exists in webshop'); } });
    render(<NewTaskScreen />);
    await userEvent.type(screen.getByLabelText('Title'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(useStore.getState().notices[0]?.message).toMatch(/already exists/));
    expect(useStore.getState().screen).toEqual({ kind: 'new-task' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project renderer src/renderer/screens/NewTaskScreen.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Append to `src/renderer/styles/screens.css`:
```css
.newtask { max-width: 1080px; }
.newtask-body { display: flex; flex-wrap: wrap; }
.newtask-left { flex: 999 1 460px; min-width: 0; padding: 20px 24px; border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 14px; }
.newtask-right { flex: 1 1 340px; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; background: var(--panel-2); }
.form-grid { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 10px 12px; align-items: center; }
.form-grid label, .form-grid .label { color: var(--muted); }
.form-stack { display: flex; flex-direction: column; gap: 10px; }
.form-stack label { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 12px; }
.form-stack .field { font-size: 14px; }
.actions { display: flex; gap: 10px; margin-top: auto; justify-content: flex-end; flex-wrap: wrap; }
```

`src/renderer/screens/NewTaskScreen.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react';
import { renderBranch, taskSlug } from '../../shared/naming';
import type { MiacConfig, WorkItemRef, WorkItemType } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';

type Mode = 'work-item' | 'blank';
const TYPES: WorkItemType[] = ['User Story', 'Bug', 'Task'];

export function NewTaskScreen() {
  const repos = useStore((s) => s.repos);
  const go = useStore((s) => s.go);
  const select = useStore((s) => s.select);
  const notify = useStore((s) => s.notify);

  const [mode, setMode] = useState<Mode>('work-item');
  const [repoId, setRepoId] = useState(repos[0]?.id ?? '');
  const [config, setConfig] = useState<{ config: MiacConfig; worktreeRoot: string } | null>(null);
  const [id, setId] = useState('');
  const [type, setType] = useState<WorkItemType>('User Story');
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [branch, setBranch] = useState('');
  const [branchEdited, setBranchEdited] = useState(false);
  const [copy, setCopy] = useState(true);
  const [commands, setCommands] = useState<Record<string, boolean>>({});
  const [startClaude, setStartClaude] = useState(true);
  const [openShell, setOpenShell] = useState(true);
  const [busy, setBusy] = useState(false);

  const repo = repos.find((r) => r.id === repoId) ?? null;

  useEffect(() => {
    if (!repo) return;
    let live = true;
    void tryInvoke(() => api().invoke('repos:config', repo.id), notify).then((result) => {
      if (!live || !result) return;
      setConfig(result);
      setBaseRef(`origin/${result.config.base}`);
      setCommands(Object.fromEntries(result.config.setup.map((c) => [c, true])));
    });
    return () => { live = false; };
  }, [repo, notify]);

  const workItem: WorkItemRef | null = useMemo(
    () => (mode === 'work-item' && (id.trim() || title.trim()) ? { id: id.trim(), type, title: title.trim() } : null),
    [mode, id, type, title],
  );
  const label = mode === 'work-item' ? title : name;
  const template = config?.config.branch ?? '{type}/{id}-{slug}';

  useEffect(() => {
    if (branchEdited) return;
    setBranch(label.trim() || workItem?.id ? renderBranch(template, { workItem, name }) : '');
  }, [workItem, name, label, template, branchEdited]);

  const slug = label.trim() || workItem?.id ? taskSlug(workItem && workItem.id ? workItem : null, label) : '…';
  const folder = config ? `${config.worktreeRoot}/${slug}` : '';
  const baseOptions = config ? [`origin/${config.config.base}`, config.config.base] : [];

  const create = async () => {
    if (!repo) return notify('error', 'Add a repository in Settings first');
    setBusy(true);
    const task = await tryInvoke(
      () => api().invoke('tasks:create', {
        repoId: repo.id, baseRef, name: mode === 'blank' ? name : '',
        workItem: mode === 'work-item' && workItem && workItem.id ? workItem : null,
        branch, copy, commands: (config?.config.setup ?? []).filter((c) => commands[c]), startClaude, openShell,
      }),
      notify,
    );
    setBusy(false);
    if (task) {
      select(task.id);
      go({ kind: 'setup', taskId: task.id });
    }
  };

  return (
    <div className="overlay">
      <div role="dialog" aria-labelledby="nt-title" className="dialog newtask">
        <div className="dialog-head">
          <h2 id="nt-title">New task</h2>
          <div role="tablist" aria-label="Start from" className="segmented">
            <button type="button" role="tab" aria-selected={mode === 'work-item'} aria-pressed={mode === 'work-item'} onClick={() => setMode('work-item')}>Work item</button>
            <button type="button" role="tab" aria-selected={mode === 'blank'} aria-pressed={mode === 'blank'} onClick={() => setMode('blank')}>Blank task</button>
          </div>
          <button type="button" className="btn btn-ghost spacer" aria-label="Close" onClick={() => go({ kind: 'workspace' })}>✕</button>
        </div>
        <div className="newtask-body">
          <section className="newtask-left" aria-label={mode === 'work-item' ? 'Work item' : 'Task'}>
            {mode === 'work-item' ? (
              <div className="form-stack">
                <p className="muted small" style={{ margin: 0 }}>Type the work item for now. Picking from Azure DevOps arrives in the next release.</p>
                <label>Work item id<input className="field mono" value={id} onChange={(e) => setId(e.target.value)} /></label>
                <label>Type
                  <select className="field" value={type} onChange={(e) => setType(e.target.value as WorkItemType)}>
                    {TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label>Title<input className="field" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              </div>
            ) : (
              <div className="form-stack">
                <label>Task name<input className="field" value={name} onChange={(e) => setName(e.target.value)} /></label>
              </div>
            )}
          </section>
          <section className="newtask-right" aria-label="Task preview">
            <div>
              <div className="muted small">{workItem?.id ? `${type} ${workItem.id}` : 'Blank task'}</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{label || 'New task'}</div>
            </div>
            <div className="form-grid">
              <label htmlFor="nt-repo">Repo</label>
              <select id="nt-repo" className="field" value={repoId} onChange={(e) => setRepoId(e.target.value)}>
                {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <label htmlFor="nt-base">From</label>
              <select id="nt-base" className="field mono" value={baseRef} onChange={(e) => setBaseRef(e.target.value)}>
                {baseOptions.map((b) => <option key={b}>{b}</option>)}
              </select>
              <label htmlFor="nt-branch">Branch</label>
              <input id="nt-branch" className="field mono" value={branch} onChange={(e) => { setBranchEdited(true); setBranch(e.target.value); }} />
              <span className="label">Folder</span>
              <span className="mono small" style={{ overflowWrap: 'anywhere' }}>{folder}</span>
            </div>
            <fieldset className="group">
              <legend>Setup from .miac.yml</legend>
              {config && config.config.copy.length > 0 && (
                <label className="checkbox"><input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />Copy <span className="mono small">{config.config.copy.join(', ')}</span></label>
              )}
              {(config?.config.setup ?? []).map((c) => (
                <label key={c} className="checkbox"><input type="checkbox" checked={commands[c] ?? false} onChange={(e) => setCommands({ ...commands, [c]: e.target.checked })} /><span className="mono">{c}</span></label>
              ))}
              {config && config.config.setup.length === 0 && config.config.copy.length === 0 && <span className="muted small">Nothing to run for this repo.</span>}
            </fieldset>
            <fieldset className="group">
              <legend>When ready</legend>
              <label className="checkbox"><input type="checkbox" checked={startClaude} onChange={(e) => setStartClaude(e.target.checked)} />Start Claude Code with the task</label>
              <label className="checkbox"><input type="checkbox" checked={openShell} onChange={(e) => setOpenShell(e.target.checked)} />Open a shell tab</label>
            </fieldset>
            <div className="actions">
              <button type="button" className="btn" onClick={() => go({ kind: 'workspace' })}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy || !repo || !branch} onClick={create}>Create task</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
```

In `src/renderer/App.tsx`, import `NewTaskScreen` and render it after the base screen: `{screen.kind === 'new-task' && <NewTaskScreen />}` (the workspace stays mounted underneath because the base expression should treat `new-task` like `workspace`: `screen.kind === 'settings' ? <SettingsScreen /> : <WorkspaceScreen />`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project renderer src/renderer/screens/NewTaskScreen.test.tsx`
Expected: PASS (5 tests). The "Copy" checkbox has visible text "Copy .env, .env.local"; if `getByLabelText('npm run build')` is ambiguous, the label text is exactly the command, so it should resolve.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat: New task screen with branch prefill and setup options"
```

---

### Task 13: Setup screen with live steps and log

**Files:**
- Create: `src/renderer/screens/SetupScreen.tsx`, `src/renderer/components/StepList.tsx`
- Modify: `src/renderer/App.tsx` (render `SetupScreen` for `screen.kind === 'setup'`), `src/renderer/styles/screens.css`
- Test: `src/renderer/screens/SetupScreen.test.tsx`

**Interfaces:**
- Consumes: `tasks:setupState`, `tasks:retrySetup`, `tasks:cancelSetup`, `setup` event (Task 10), `SetupState`, `SetupEvent`.
- Produces: `SetupScreen({ taskId })`, `StepList({ steps })`, `applySetupEvent(state, event): SetupState` (pure, in the screen file, exported for tests).

- [ ] **Step 1: Write the failing tests**

`src/renderer/screens/SetupScreen.test.tsx`:
```tsx
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SetupState, TaskView } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { SetupScreen } from './SetupScreen';

const task: TaskView = {
  id: 't1', repoId: 'r1', name: '', workItem: { id: '48231', type: 'User Story', title: 'Show estimated delivery date' }, slug: '48231-show',
  branch: 'feature/48231-show', worktreePath: '/src/webshop.worktrees/48231-show', baseRef: 'origin/main', status: 'setting-up',
  setup: { copy: true, commands: ['npm ci'], startClaude: true, openShell: true }, terminals: [], createdAt: 'now', finishedAt: null, worktreeMissing: false,
};
const state: SetupState = {
  steps: [
    { def: { kind: 'fetch', label: 'Fetch base', detail: 'origin/main' }, status: 'done', ms: 400 },
    { def: { kind: 'worktree', label: 'Create branch and worktree', detail: 'feature/48231-show' }, status: 'running' },
    { def: { kind: 'command', label: 'npm ci', detail: 'in worktree', command: 'npm ci' }, status: 'todo' },
  ],
  log: ['$ git fetch origin/main'], finished: false, ok: null, failedStep: null,
};

beforeEach(() => useStore.setState({ repos: [{ id: 'r1', name: 'webshop', path: '/src/webshop', baseBranch: 'main', connectionId: null, miacYmlFound: true }], tasks: [task], notices: [], screen: { kind: 'setup', taskId: 't1' } }));

describe('SetupScreen', () => {
  it('shows the steps and log from the current state, then applies live events', async () => {
    const { emit } = installFakeApi({ 'tasks:setupState': () => state });
    render(<SetupScreen taskId="t1" />);
    expect(await screen.findByText('Create branch and worktree')).toBeInTheDocument();
    expect(screen.getByText('$ git fetch origin/main')).toBeInTheDocument();
    expect(screen.getByText('0.4s')).toBeInTheDocument();
    act(() => {
      emit('setup', { taskId: 't1', type: 'log', line: 'Preparing worktree' });
      emit('setup', { taskId: 't1', type: 'step', index: 1, status: 'done', ms: 2100 });
      emit('setup', { taskId: 't1', type: 'step', index: 2, status: 'running' });
    });
    expect(screen.getByText('Preparing worktree')).toBeInTheDocument();
    expect(screen.getByText('2.1s')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /npm ci/ })).toHaveAttribute('data-status', 'running');
  });

  it('ignores events for other tasks', async () => {
    const { emit } = installFakeApi({ 'tasks:setupState': () => state });
    render(<SetupScreen taskId="t1" />);
    await screen.findByText('Fetch base');
    act(() => emit('setup', { taskId: 'other', type: 'log', line: 'not mine' }));
    expect(screen.queryByText('not mine')).not.toBeInTheDocument();
  });

  it('offers retry and cancel after a failure', async () => {
    const failed: SetupState = { ...state, steps: state.steps.map((s, i) => ({ ...s, status: i === 2 ? 'failed' : 'done', detail: i === 2 ? 'npm ci exited with code 1' : s.detail })), finished: true, ok: false, failedStep: 2 };
    useStore.setState({ tasks: [{ ...task, status: 'setup-failed' }] });
    const { calls } = installFakeApi({ 'tasks:setupState': () => failed, 'tasks:retrySetup': () => undefined, 'tasks:cancelSetup': () => undefined });
    render(<SetupScreen taskId="t1" />);
    expect(await screen.findByText('npm ci exited with code 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry from npm ci' }));
    await waitFor(() => expect(calls.some((c) => c.channel === 'tasks:retrySetup' && c.args[0] === 't1')).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel and remove' }));
    await waitFor(() => expect(calls.some((c) => c.channel === 'tasks:cancelSetup')).toBe(true));
    expect(useStore.getState().screen).toEqual({ kind: 'workspace' });
  });

  it('jumps to the workspace when setup finishes successfully', async () => {
    const { emit } = installFakeApi({ 'tasks:setupState': () => state });
    render(<SetupScreen taskId="t1" />);
    await screen.findByText('Fetch base');
    act(() => emit('setup', { taskId: 't1', type: 'finished', ok: true }));
    await waitFor(() => expect(useStore.getState().screen).toEqual({ kind: 'workspace' }));
    expect(useStore.getState().selectedTaskId).toBe('t1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project renderer src/renderer/screens/SetupScreen.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Append to `src/renderer/styles/screens.css`:
```css
.setup { flex: 1; display: flex; min-height: 0; }
.setup-left { flex: 1 1 380px; max-width: 520px; padding: 32px; display: flex; flex-direction: column; gap: 20px; border-right: 1px solid var(--border); overflow: auto; }
.setup-left h1 { margin: 0; font-size: 22px; font-weight: 600; }
.setup-log { flex: 999 1 520px; min-width: 0; display: flex; flex-direction: column; }
.setup-log-head { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-bottom: 1px solid var(--border); }
.setup-log-body { flex: 1; background: var(--term); padding: 16px 20px; font: 13px/1.6 var(--font-mono); color: var(--text-soft); overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.step { display: flex; gap: 12px; align-items: center; padding: 10px 12px; border-radius: var(--radius-lg); border: 1px solid transparent; }
.step[data-status='running'] { background: #1f2228; border-color: var(--border-strong); }
.step[data-status='running'] .step-label { font-weight: 600; }
.step[data-status='todo'] .step-label { color: var(--muted); }
.step-icon { flex: none; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; border: 1px solid var(--border-strong); color: var(--muted); }
.step[data-status='done'] .step-icon { background: var(--green-bg); color: var(--green); border-color: transparent; }
.step[data-status='running'] .step-icon { background: var(--accent-bg); color: var(--accent); border-color: transparent; }
.step[data-status='failed'] .step-icon { background: var(--red-bg); color: var(--red); border-color: transparent; }
.step-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
```

`src/renderer/components/StepList.tsx`:
```tsx
import type { SetupState } from '../../shared/types';

const ICON = { todo: '○', running: '●', done: '✓', failed: '✕' } as const;

export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '';
  return ms >= 10_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;
}

export function StepList({ steps }: { steps: SetupState['steps'] }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={i} className="step" data-status={s.status} aria-label={s.def.label}>
          <span className="step-icon" aria-hidden="true">{ICON[s.status]}</span>
          <span className="step-text">
            <span className="step-label">{s.def.label}</span>
            <span className="mono small muted" style={{ overflowWrap: 'anywhere' }}>{s.detail ?? s.def.detail}</span>
          </span>
          <span className="small muted">{formatMs(s.ms)}</span>
        </li>
      ))}
    </ol>
  );
}
```

`src/renderer/screens/SetupScreen.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import type { SetupEvent, SetupState } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { StepList } from '../components/StepList';
import { TopBar } from '../components/TopBar';
import { useStore } from '../store';

export function applySetupEvent(state: SetupState, e: SetupEvent): SetupState {
  if (e.type === 'log') return { ...state, log: [...state.log, e.line] };
  if (e.type === 'step') {
    const steps = state.steps.map((s, i) => (i === e.index ? { ...s, status: e.status, detail: e.detail ?? s.detail, ms: e.ms ?? s.ms } : s));
    return { ...state, steps };
  }
  return { ...state, finished: true, ok: e.ok, failedStep: e.failedStep ?? null };
}

export function SetupScreen({ taskId }: { taskId: string }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const repo = useStore((s) => s.repos.find((r) => r.id === task?.repoId));
  const go = useStore((s) => s.go);
  const select = useStore((s) => s.select);
  const notify = useStore((s) => s.notify);
  const [state, setState] = useState<SetupState | null>(null);
  const [follow, setFollow] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void api().invoke('tasks:setupState', taskId).then((s) => { if (live) setState(s); });
    const off = api().on('setup', (e) => {
      if (e.taskId !== taskId) return;
      setState((prev) => (prev ? applySetupEvent(prev, e) : prev));
      if (e.type === 'finished' && e.ok) {
        select(taskId);
        go({ kind: 'workspace' });
      }
    });
    return () => { live = false; off(); };
  }, [taskId, go, select]);

  useEffect(() => {
    if (follow && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state?.log.length, follow]);

  const failedStep = state?.failedStep ?? null;
  const failedLabel = failedStep !== null ? state?.steps[failedStep]?.def.label : null;
  const running = state?.steps.find((s) => s.status === 'running');

  const retry = async () => {
    await tryInvoke(() => api().invoke('tasks:retrySetup', taskId), notify);
  };
  const cancel = async () => {
    const ok = await tryInvoke(async () => { await api().invoke('tasks:cancelSetup', taskId); return true; }, notify);
    if (ok) go({ kind: 'workspace' });
  };

  if (!task) return <div className="empty">Task not found.</div>;

  return (
    <>
      <TopBar crumb={`${repo?.name ?? ''} / ${task.workItem?.id ?? task.name}`} />
      <div className="setup">
        <section className="setup-left">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {task.workItem ? <span className="pill pill-blue" style={{ alignSelf: 'flex-start' }}>{task.workItem.type} {task.workItem.id}</span> : <span className="pill pill-accent" style={{ alignSelf: 'flex-start' }}>Blank task</span>}
            <h1>{task.workItem?.title ?? task.name}</h1>
            <div className="muted">
              {failedStep !== null ? 'Setup failed. Fix the cause, then retry from the failed step, or remove the task.' : 'Setting up your task. You can go back to the task list; it keeps going in the background.'}
            </div>
          </div>
          {state ? <StepList steps={state.steps} /> : <div className="muted">Loading…</div>}
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn" onClick={() => go({ kind: 'workspace' })}>Back to tasks</button>
            {failedLabel && <button type="button" className="btn btn-primary" onClick={retry}>{`Retry from ${failedLabel}`}</button>}
            <button type="button" className="btn btn-warn" onClick={cancel}>Cancel and remove</button>
          </div>
        </section>
        <section className="setup-log" aria-label="Setup log">
          <div className="setup-log-head">
            <span style={{ fontWeight: 600 }}>{running?.def.label ?? (state?.finished ? (state.ok ? 'Done' : 'Failed') : 'Starting')}</span>
            <span className="small muted">live output</span>
            <label className="checkbox small" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />Follow</label>
          </div>
          <div className="setup-log-body" ref={logRef}>
            {(state?.log ?? []).map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </section>
      </div>
    </>
  );
}
```

In `src/renderer/App.tsx`, render `SetupScreen` for the setup screen:
```tsx
{screen.kind === 'settings' ? <SettingsScreen /> : screen.kind === 'setup' ? <SetupScreen taskId={screen.taskId} /> : <WorkspaceScreen />}
{screen.kind === 'new-task' && <NewTaskScreen />}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project renderer src/renderer/screens/SetupScreen.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Start the app and create a real task**

```bash
npm start
```

With a repo registered, click New task, type an id and title, Create task. Expected: the Setup screen shows steps turning green with timings and the log streams git and npm output; when done the app switches to the workspace placeholder. Check that `<repo>.worktrees/<slug>` exists and `.miac/task.md` is there. Quit.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat: Setup screen with live steps, log, retry and cancel"
```

---

### Task 14: Workspace screen: task nav, task header, terminal tabs with xterm

**Files:**
- Create: `src/renderer/components/TaskNav.tsx`, `src/renderer/components/TaskHeader.tsx`, `src/renderer/components/TerminalTabs.tsx`, `src/renderer/components/TerminalView.tsx`, `src/renderer/hooks/useRepoConfig.ts`
- Modify: `src/renderer/screens/WorkspaceScreen.tsx` (replace placeholder), `src/renderer/styles/screens.css`
- Test: `src/renderer/components/TaskNav.test.tsx`, `src/renderer/screens/WorkspaceScreen.test.tsx`

**Interfaces:**
- Consumes: `tasks:gitSummary`, `tasks:openInEditor`, `terminals:*` channels and `terminal:data`, `terminal:exit` events (Task 10); store (Task 11).
- Produces: `TaskNav`, `TaskHeader({ task })`, `TerminalTabs({ task })`, `TerminalView({ terminalId, active })`, `useRepoConfig(repoId)`, `groupTasks(tasks, repos)` (pure, exported from TaskNav).

- [ ] **Step 1: Write the failing tests**

`src/renderer/components/TaskNav.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo, TaskView } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { groupTasks, TaskNav } from './TaskNav';

const repos: Repo[] = [
  { id: 'r1', name: 'webshop', path: '/src/webshop', baseBranch: 'main', connectionId: null, miacYmlFound: true },
  { id: 'r2', name: 'backoffice-api', path: '/src/api', baseBranch: 'develop', connectionId: null, miacYmlFound: false },
];
const base = { setup: { copy: true, commands: [], startClaude: true, openShell: true }, terminals: [], createdAt: 'now', finishedAt: null, worktreeMissing: false, baseRef: 'origin/main' };
const tasks: TaskView[] = [
  { ...base, id: 'a', repoId: 'r1', name: '', workItem: { id: '48213', type: 'User Story', title: 'Checkout: save address' }, slug: 'a', branch: 'feature/48213-a', worktreePath: '/w/a', status: 'ready' },
  { ...base, id: 'b', repoId: 'r1', name: 'spike-new-search', workItem: null, slug: 'b', branch: 'feature/spike', worktreePath: '/w/b', status: 'setting-up' },
  { ...base, id: 'c', repoId: 'r2', name: '', workItem: { id: '47988', type: 'Task', title: 'Export orders' }, slug: 'c', branch: 'feature/47988-c', worktreePath: '/w/c', status: 'done', finishedAt: 'then' },
  { ...base, id: 'd', repoId: 'r1', name: '', workItem: { id: '1', type: 'Bug', title: 'Broken' }, slug: 'd', branch: 'bugfix/1-d', worktreePath: '/w/d', status: 'setup-failed' },
];

beforeEach(() => useStore.setState({ repos, tasks, notices: [], screen: { kind: 'workspace' }, selectedTaskId: 'a' }));

describe('groupTasks', () => {
  it('groups open tasks by repo and collects done tasks separately', () => {
    const g = groupTasks(tasks, repos);
    expect(g.open.map((x) => [x.repo.name, x.tasks.map((t) => t.id)])).toEqual([['webshop', ['a', 'b', 'd']]]);
    expect(g.done.map((t) => t.id)).toEqual(['c']);
  });
});

describe('TaskNav', () => {
  it('renders rows with id or name, state dots and selects on click', async () => {
    installFakeApi();
    render(<TaskNav />);
    expect(screen.getByText('48213')).toBeInTheDocument();
    expect(screen.getByText('spike-new-search')).toBeInTheDocument();
    expect(screen.getByLabelText('Setting up')).toBeInTheDocument();
    expect(screen.getByLabelText('Setup failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Checkout: save address/ })).toHaveAttribute('aria-current', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Broken/ }));
    expect(useStore.getState().selectedTaskId).toBe('d');
    expect(useStore.getState().screen).toEqual({ kind: 'setup', taskId: 'd' });
  });

  it('hides done tasks behind a toggle', async () => {
    installFakeApi();
    render(<TaskNav />);
    expect(screen.queryByText('47988')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Done \(1\)/ }));
    expect(screen.getByText('47988')).toBeInTheDocument();
  });
});
```

`src/renderer/screens/WorkspaceScreen.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskView } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { WorkspaceScreen } from './WorkspaceScreen';

vi.mock('../components/TerminalView', () => ({
  TerminalView: ({ terminalId, active }: { terminalId: string; active: boolean }) => <div data-testid={`term-${terminalId}`} data-active={active} />,
}));

const task: TaskView = {
  id: 'a', repoId: 'r1', name: '', workItem: { id: '48213', type: 'User Story', title: 'Checkout: allow saving a delivery address' }, slug: 'a',
  branch: 'feature/48213-save-delivery-address', worktreePath: '/src/webshop.worktrees/48213-save-delivery-address', baseRef: 'origin/main', status: 'ready',
  setup: { copy: true, commands: [], startClaude: true, openShell: true },
  terminals: [{ id: 'c1', kind: 'claude', label: 'Claude Code' }, { id: 's1', kind: 'shell', label: 'zsh' }], createdAt: 'now', finishedAt: null, worktreeMissing: false,
};
const config = { worktreeRoot: '/src/webshop.worktrees', config: { base: 'main', branch: '{type}/{id}-{slug}', copy: [], setup: [], run: { dev: 'npm run dev', test: 'npm test' }, found: true } };

beforeEach(() => useStore.setState({ repos: [{ id: 'r1', name: 'webshop', path: '/src/webshop', baseBranch: 'main', connectionId: null, miacYmlFound: true }], tasks: [task], notices: [], screen: { kind: 'workspace' }, selectedTaskId: 'a' }));

describe('WorkspaceScreen', () => {
  it('shows the task header with git summary and the terminal tabs', async () => {
    installFakeApi({ 'repos:config': () => config, 'tasks:gitSummary': () => ({ branch: 'feature/48213-save-delivery-address', ahead: 2, behind: 0, hasUpstream: true, files: [{ status: 'M', path: 'a' }, { status: 'M', path: 'b' }, { status: '?', path: 'c' }] }) });
    render(<WorkspaceScreen />);
    expect(screen.getByRole('heading', { name: 'Checkout: allow saving a delivery address' })).toBeInTheDocument();
    expect(await screen.findByText('↑2 ↓0')).toBeInTheDocument();
    expect(screen.getByText('3 changed')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Claude Code/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('term-c1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('term-s1')).toHaveAttribute('data-active', 'false');
    await userEvent.click(screen.getByRole('tab', { name: /zsh/ }));
    expect(screen.getByTestId('term-s1')).toHaveAttribute('data-active', 'true');
  });

  it('opens run commands from .miac.yml as new terminals', async () => {
    const { calls } = installFakeApi({ 'repos:config': () => config, 'tasks:gitSummary': () => ({ branch: 'x', ahead: 0, behind: 0, hasUpstream: false, files: [] }), 'terminals:open': () => ({ id: 'n1', kind: 'run', label: 'dev', command: 'npm run dev' }) });
    render(<WorkspaceScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'dev' }));
    await waitFor(() => expect(calls.find((c) => c.channel === 'terminals:open')?.args).toEqual(['a', { kind: 'run', label: 'dev', command: 'npm run dev' }]));
  });

  it('opens the editor and the finish dialog from the header', async () => {
    const { calls } = installFakeApi({ 'repos:config': () => config, 'tasks:gitSummary': () => ({ branch: 'x', ahead: 0, behind: 0, hasUpstream: false, files: [] }), 'tasks:openInEditor': () => undefined });
    render(<WorkspaceScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Open in VS Code' }));
    await waitFor(() => expect(calls.some((c) => c.channel === 'tasks:openInEditor')).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Finish task' }));
    expect(useStore.getState().screen).toEqual({ kind: 'finish', taskId: 'a' });
  });

  it('shows an empty state without a selected task', () => {
    installFakeApi();
    useStore.setState({ tasks: [], selectedTaskId: null });
    render(<WorkspaceScreen />);
    expect(screen.getByText(/No task selected/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project renderer src/renderer/components/TaskNav.test.tsx src/renderer/screens/WorkspaceScreen.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the nav, header and config hook**

Append to `src/renderer/styles/screens.css`:
```css
.tasknav { flex: 0 0 280px; background: var(--panel); border-right: 1px solid var(--border); padding: 12px 8px; display: flex; flex-direction: column; gap: 16px; overflow: auto; }
.tasknav-group { display: flex; flex-direction: column; gap: 2px; }
.tasknav-head { display: flex; align-items: center; gap: 6px; padding: 4px 8px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; background: none; border: none; width: 100%; text-align: left; }
.tasknav-head .count { margin-left: auto; font-weight: 400; }
.taskrow { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid transparent; background: transparent; color: var(--text); text-align: left; }
.taskrow[aria-current='true'] { border-color: var(--border-strong); background: var(--panel-raised); }
.taskrow-top { display: flex; align-items: center; gap: 8px; width: 100%; }
.taskrow-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.taskrow-sub { display: flex; gap: 10px; font-size: 12px; color: var(--muted); }
.taskrow-sub .cost { margin-left: auto; font-family: var(--font-mono); color: var(--text-soft); }
.tasknav-foot { margin-top: auto; padding: 10px 8px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 8px; }

.taskmain { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.taskhead { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: center; }
.taskhead-text { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1 1 360px; }
.taskhead h1 { margin: 0; font-size: 20px; font-weight: 600; }
.taskhead-meta { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--muted); }
.taskhead-git { display: flex; gap: 16px; flex-wrap: wrap; font: 12px var(--font-mono); color: var(--muted); }
.costtile { display: flex; flex-direction: column; gap: 2px; padding: 8px 14px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--panel); min-width: 200px; }
.costtile .amount { font: 600 20px var(--font-mono); }
.taskhead-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.tabs { display: flex; align-items: center; gap: 4px; padding: 8px 12px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.tab { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px; border-radius: 8px 8px 0 0; border: 1px solid transparent; border-bottom: none; background: transparent; color: var(--muted); margin-bottom: -1px; }
.tab[aria-selected='true'] { border-color: var(--border); background: var(--term); color: var(--text); }
.tabs .run { margin-left: auto; display: flex; gap: 6px; padding-bottom: 6px; align-items: center; }
.tabs .run .btn { font-family: var(--font-mono); font-size: 12px; background: transparent; }
.termhost { flex: 1; min-height: 0; background: var(--term); position: relative; }
.termview { position: absolute; inset: 0; padding: 8px 8px 8px 12px; }
.termview[hidden] { display: none; }
.term-exit { position: absolute; left: 12px; bottom: 12px; display: flex; gap: 10px; align-items: center; padding: 8px 12px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--panel); font-size: 12px; }
```

`src/renderer/hooks/useRepoConfig.ts`:
```ts
import { useEffect, useState } from 'react';
import type { MiacConfig } from '../../shared/types';
import { api } from '../api';

const cache = new Map<string, { config: MiacConfig; worktreeRoot: string }>();

/** The effective .miac.yml of a repo, cached per session. Returns null until loaded. */
export function useRepoConfig(repoId: string | null) {
  const [value, setValue] = useState(repoId ? cache.get(repoId) ?? null : null);
  useEffect(() => {
    if (!repoId) return;
    const hit = cache.get(repoId);
    if (hit) return setValue(hit);
    let live = true;
    void api().invoke('repos:config', repoId).then((r) => { cache.set(repoId, r); if (live) setValue(r); }).catch(() => { if (live) setValue(null); });
    return () => { live = false; };
  }, [repoId]);
  return value;
}

export function invalidateRepoConfig(repoId?: string) {
  if (repoId) cache.delete(repoId);
  else cache.clear();
}
```

`src/renderer/components/TaskNav.tsx`:
```tsx
import { useState } from 'react';
import type { Repo, TaskStatus, TaskView } from '../../shared/types';
import { useStore } from '../store';

export function groupTasks(tasks: TaskView[], repos: Repo[]) {
  const open = repos
    .map((repo) => ({ repo, tasks: tasks.filter((t) => t.repoId === repo.id && t.status !== 'done') }))
    .filter((g) => g.tasks.length > 0);
  const done = tasks.filter((t) => t.status === 'done');
  return { open, done };
}

const STATE: Record<TaskStatus, { color: string; label: string }> = {
  'setting-up': { color: 'var(--accent)', label: 'Setting up' },
  ready: { color: 'var(--idle)', label: 'Ready' },
  'setup-failed': { color: 'var(--red)', label: 'Setup failed' },
  finishing: { color: 'var(--accent)', label: 'Finishing' },
  done: { color: 'var(--idle)', label: 'Done' },
};

function Row({ task }: { task: TaskView }) {
  const selected = useStore((s) => s.selectedTaskId === task.id);
  const select = useStore((s) => s.select);
  const go = useStore((s) => s.go);
  const state = STATE[task.status];
  const pick = () => {
    select(task.id);
    if (task.status === 'setting-up' || task.status === 'setup-failed') go({ kind: 'setup', taskId: task.id });
    else go({ kind: 'workspace' });
  };
  return (
    <button type="button" className="taskrow" aria-current={selected ? 'true' : undefined} onClick={pick}>
      <span className="taskrow-top">
        <span className="mono small muted">{task.workItem?.id ?? task.name}</span>
        <span className="taskrow-title">{task.workItem?.title ?? task.name}</span>
        <span className="dot" aria-label={task.worktreeMissing ? 'Worktree folder missing' : state.label} style={{ background: task.worktreeMissing ? 'var(--red)' : state.color }} />
      </span>
      <span className="taskrow-sub">
        <span>{task.worktreeMissing ? 'folder missing' : task.branch}</span>
        <span className="cost">—</span>
      </span>
    </button>
  );
}

export function TaskNav() {
  const tasks = useStore((s) => s.tasks);
  const repos = useStore((s) => s.repos);
  const [showDone, setShowDone] = useState(false);
  const { open, done } = groupTasks(tasks, repos);
  return (
    <nav aria-label="Tasks" className="tasknav">
      {open.map(({ repo, tasks: list }) => (
        <div key={repo.id} className="tasknav-group">
          <div className="tasknav-head">{repo.name}<span className="count">{list.length}</span></div>
          {list.map((t) => <Row key={t.id} task={t} />)}
        </div>
      ))}
      {open.length === 0 && <div className="muted small" style={{ padding: 8 }}>No open tasks. Create one with New task.</div>}
      {done.length > 0 && (
        <div className="tasknav-group">
          <button type="button" className="tasknav-head" onClick={() => setShowDone(!showDone)}>{showDone ? '▾' : '▸'} Done ({done.length})</button>
          {showDone && done.map((t) => <Row key={t.id} task={t} />)}
        </div>
      )}
      <div className="tasknav-foot"><span className="dot" style={{ background: 'var(--idle)' }} />Azure DevOps: not connected</div>
    </nav>
  );
}
```

`src/renderer/components/TaskHeader.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { GitSummary, TaskView } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';

const POLL_MS = 5000;

export function TaskHeader({ task }: { task: TaskView }) {
  const go = useStore((s) => s.go);
  const notify = useStore((s) => s.notify);
  const [git, setGit] = useState<GitSummary | null>(null);

  useEffect(() => {
    let live = true;
    const refresh = () => api().invoke('tasks:gitSummary', task.id).then((g) => { if (live) setGit(g); }).catch(() => { if (live) setGit(null); });
    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [task.id, task.worktreeMissing]);

  const openEditor = () => tryInvoke(() => api().invoke('tasks:openInEditor', task.id), notify);

  return (
    <section className="taskhead">
      <div className="taskhead-text">
        <div className="taskhead-meta">
          {task.workItem ? <span className="pill pill-accent">{task.workItem.type} {task.workItem.id}</span> : <span className="pill pill-accent">Blank task</span>}
          <span>{task.status === 'ready' ? 'Active' : task.status}</span>
        </div>
        <h1>{task.workItem?.title ?? task.name}</h1>
        <div className="taskhead-git">
          <span>{task.branch}</span>
          {git && <span>{`↑${git.ahead} ↓${git.behind}`}</span>}
          {git && git.files.length > 0 && <span style={{ color: '#e9b75c' }}>{`${git.files.length} changed`}</span>}
          {git && git.files.length === 0 && <span>clean</span>}
          <span>{task.worktreePath}</span>
        </div>
      </div>
      <div className="costtile" aria-label="AI cost for this task">
        <span className="small muted">AI cost</span>
        <span className="amount">—</span>
        <span className="small muted">Usage tracking arrives in a later release</span>
      </div>
      <div className="taskhead-actions">
        <button type="button" className="btn" onClick={openEditor} disabled={task.worktreeMissing}>Open in VS Code</button>
        <button type="button" className="btn btn-green" onClick={() => go({ kind: 'finish', taskId: task.id })}>Finish task</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Implement the terminal tabs and the xterm view**

`src/renderer/components/TerminalTabs.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { TaskView } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { useRepoConfig } from '../hooks/useRepoConfig';
import { useStore } from '../store';
import { TerminalView } from './TerminalView';

export function TerminalTabs({ task }: { task: TaskView }) {
  const notify = useStore((s) => s.notify);
  const config = useRepoConfig(task.repoId);
  const [active, setActive] = useState<string | null>(task.terminals[0]?.id ?? null);

  useEffect(() => {
    if (!task.terminals.some((t) => t.id === active)) setActive(task.terminals[0]?.id ?? null);
  }, [task.terminals, active]);

  const open = async (def: { kind: 'shell' | 'run'; label: string; command?: string }) => {
    const created = await tryInvoke(() => api().invoke('terminals:open', task.id, def), notify);
    if (created) setActive(created.id);
  };

  const runCommands = Object.entries(config?.config.run ?? {});

  return (
    <>
      <div role="tablist" aria-label="Terminals" className="tabs">
        {task.terminals.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={active === t.id} className="tab" onClick={() => setActive(t.id)}>
            <span className="dot" style={{ background: t.kind === 'claude' ? 'var(--blue)' : t.kind === 'run' ? 'var(--green)' : 'var(--idle)' }} />
            {t.label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" aria-label="New terminal" onClick={() => open({ kind: 'shell', label: 'shell' })} disabled={task.worktreeMissing}>＋</button>
        {runCommands.length > 0 && (
          <div className="run">
            <span className="small muted">Run:</span>
            {runCommands.map(([name, command]) => (
              <button key={name} type="button" className="btn btn-sm" onClick={() => open({ kind: 'run', label: name, command })} disabled={task.worktreeMissing}>{name}</button>
            ))}
          </div>
        )}
      </div>
      <div className="termhost">
        {task.terminals.length === 0 && <div className="empty">No terminals. Open one with ＋ or a Run button.</div>}
        {task.terminals.map((t) => <TerminalView key={t.id} terminalId={t.id} active={active === t.id} />)}
      </div>
    </>
  );
}
```

`src/renderer/components/TerminalView.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';

const THEME = { background: '#0f1113', foreground: '#e7e6e2', cursor: '#f0a443', selectionBackground: '#2a2e35' };

export function TerminalView({ terminalId, active }: { terminalId: string; active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const notify = useStore((s) => s.notify);
  const [exitCode, setExitCode] = useState<number | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const t = new Terminal({ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 13, theme: THEME, cursorBlink: true, scrollback: 5000, allowProposedApi: true });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(el);
    term.current = t;
    fit.current = f;

    const sendSize = () => {
      try {
        f.fit();
        void api().invoke('terminals:resize', terminalId, t.cols, t.rows);
      } catch { /* hidden tab: no size yet */ }
    };
    void api().invoke('terminals:buffer', terminalId).then((buf) => { if (buf) t.write(buf); });
    void api().invoke('terminals:isRunning', terminalId).then((running) => { if (!running) setExitCode((c) => c ?? -1); });
    const offData = api().on('terminal:data', (e) => { if (e.id === terminalId) t.write(e.data); });
    const offExit = api().on('terminal:exit', (e) => { if (e.id === terminalId) setExitCode(e.exitCode); });
    const onData = t.onData((data) => { void api().invoke('terminals:write', terminalId, data); });
    const observer = new ResizeObserver(() => { if (el.offsetParent !== null) sendSize(); });
    observer.observe(el);
    sendSize();

    return () => {
      observer.disconnect();
      onData.dispose();
      offData();
      offExit();
      t.dispose();
      term.current = null;
    };
  }, [terminalId]);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        try {
          fit.current?.fit();
          if (term.current) void api().invoke('terminals:resize', terminalId, term.current.cols, term.current.rows);
          term.current?.focus();
        } catch { /* ignore */ }
      });
    }
  }, [active, terminalId]);

  const restart = async () => {
    const ok = await tryInvoke(async () => { await api().invoke('terminals:restart', terminalId); return true; }, notify);
    if (ok) { term.current?.reset(); setExitCode(null); }
  };
  const close = () => tryInvoke(() => api().invoke('terminals:kill', terminalId), notify);

  return (
    <div className="termview" hidden={!active}>
      <div ref={host} style={{ width: '100%', height: '100%' }} />
      {exitCode !== null && (
        <div className="term-exit" role="status">
          <span>{exitCode === -1 ? 'Process ended' : `Exited with code ${exitCode}`}</span>
          <button type="button" className="btn btn-sm" onClick={restart}>Restart</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={close}>Close</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Assemble the Workspace screen**

`src/renderer/screens/WorkspaceScreen.tsx` (replace the placeholder):
```tsx
import { TaskHeader } from '../components/TaskHeader';
import { TaskNav } from '../components/TaskNav';
import { TerminalTabs } from '../components/TerminalTabs';
import { TopBar } from '../components/TopBar';
import { useStore } from '../store';

export function WorkspaceScreen() {
  const go = useStore((s) => s.go);
  const task = useStore((s) => s.tasks.find((t) => t.id === s.selectedTaskId) ?? null);
  return (
    <>
      <TopBar>
        <div className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => go({ kind: 'new-task' })}>＋ New task</button>
        <button type="button" className="btn" aria-label="Settings" onClick={() => go({ kind: 'settings' })}>⚙</button>
      </TopBar>
      <div className="workspace">
        <TaskNav />
        <main className="taskmain">
          {task && task.status !== 'done' ? (
            <>
              <TaskHeader task={task} />
              <TerminalTabs task={task} />
            </>
          ) : task ? (
            <div className="empty">This task is done. Its worktree and branch were cleaned up on {task.finishedAt}.</div>
          ) : (
            <div className="empty">No task selected. Create one with New task.</div>
          )}
        </main>
      </div>
    </>
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run --project renderer`
Expected: PASS. If the `TerminalView` mock does not apply because the import path differs, make sure `vi.mock('../components/TerminalView', …)` matches the import in `TerminalTabs.tsx` exactly (`./TerminalView` from inside components resolves to the same module; Vitest mocks by resolved path).

- [ ] **Step 7: Start the app and work in a real terminal**

```bash
npm start
```

Expected: selecting a ready task shows the header with ahead/behind and changed count, the Claude Code tab shows Claude's welcome (or a `command not found: claude` line plus the exit bar if Claude Code is not installed), the shell tab accepts typing, resizing the window refits, a Run button opens a new tab running the command, and closing a tab removes it. Quit.

- [ ] **Step 8: Commit**

```bash
git add src/renderer
git commit -m "feat: workspace with task nav, header, terminal tabs and xterm views"
```

---

### Task 15: Finish task dialog

**Files:**
- Create: `src/renderer/screens/FinishScreen.tsx`
- Modify: `src/renderer/App.tsx` (render `FinishScreen` overlay for `screen.kind === 'finish'`), `src/renderer/styles/screens.css`
- Test: `src/renderer/screens/FinishScreen.test.tsx`

**Interfaces:**
- Consumes: `tasks:finishChecks`, `tasks:finish`, `terminals:open` (Task 10), store.
- Produces: `FinishScreen({ taskId })`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/screens/FinishScreen.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskView } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { FinishScreen } from './FinishScreen';

const task: TaskView = {
  id: 'a', repoId: 'r1', name: '', workItem: { id: '48213', type: 'User Story', title: 'Checkout: allow saving a delivery address' }, slug: 'a',
  branch: 'feature/48213-save-delivery-address', worktreePath: '/w/a', baseRef: 'origin/main', status: 'ready',
  setup: { copy: true, commands: [], startClaude: true, openShell: true },
  terminals: [{ id: 'c1', kind: 'claude', label: 'Claude Code' }, { id: 's1', kind: 'shell', label: 'zsh' }], createdAt: 'now', finishedAt: null, worktreeMissing: false,
};
const dirty = { uncommitted: [{ status: 'M', path: 'src/a.ts' }, { status: '?', path: 'src/b.ts' }], unpushed: 2, runningTerminals: 2 };
const clean = { uncommitted: [], unpushed: 0, runningTerminals: 0 };

beforeEach(() => useStore.setState({ repos: [], tasks: [task], notices: [], screen: { kind: 'finish', taskId: 'a' }, selectedTaskId: 'a' }));

describe('FinishScreen', () => {
  it('shows the safety checks and the cleanup options', async () => {
    installFakeApi({ 'tasks:finishChecks': () => dirty });
    render(<FinishScreen taskId="a" />);
    expect(await screen.findByText('2 uncommitted changes')).toBeInTheDocument();
    expect(screen.getByText(/M src\/a\.ts/)).toBeInTheDocument();
    expect(screen.getByText('2 commits not pushed')).toBeInTheDocument();
    expect(screen.getByText('2 terminals still running')).toBeInTheDocument();
    expect(screen.getByLabelText('Close 2 terminals (Claude Code, zsh)')).toBeChecked();
    expect(screen.getByLabelText('Remove worktree folder')).toBeChecked();
    expect(screen.getByLabelText(/Delete local branch/)).toBeChecked();
    expect(screen.getByRole('button', { name: 'Discard changes and clean up' })).toBeInTheDocument();
  });

  it('shows green checks and a plain finish button when clean', async () => {
    installFakeApi({ 'tasks:finishChecks': () => clean });
    render(<FinishScreen taskId="a" />);
    expect(await screen.findByText('No uncommitted changes')).toBeInTheDocument();
    expect(screen.getByText('Nothing to push')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish and clean up' })).toBeInTheDocument();
  });

  it('finishes with the chosen options and returns to the workspace', async () => {
    const { calls } = installFakeApi({ 'tasks:finishChecks': () => clean, 'tasks:finish': () => undefined });
    render(<FinishScreen taskId="a" />);
    await userEvent.click(await screen.findByLabelText(/Delete local branch/));
    await userEvent.click(screen.getByRole('button', { name: 'Finish and clean up' }));
    await waitFor(() => expect(calls.find((c) => c.channel === 'tasks:finish')?.args).toEqual(['a', { closeTerminals: true, removeWorktree: true, deleteBranch: false }]));
    expect(useStore.getState().screen).toEqual({ kind: 'workspace' });
  });

  it('opens commit and push in a terminal tab', async () => {
    const { calls } = installFakeApi({ 'tasks:finishChecks': () => dirty, 'terminals:open': () => ({ id: 'g1', kind: 'run', label: 'git commit', command: 'x' }) });
    render(<FinishScreen taskId="a" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Commit…' }));
    await waitFor(() => expect(calls.find((c) => c.channel === 'terminals:open')?.args).toEqual(['a', { kind: 'run', label: 'git commit', command: 'git add -A && git commit' }]));
    expect(useStore.getState().screen).toEqual({ kind: 'workspace' });
  });

  it('stays open and shows the error when finishing fails', async () => {
    installFakeApi({ 'tasks:finishChecks': () => clean, 'tasks:finish': () => { throw new Error('git worktree remove failed: locked'); } });
    render(<FinishScreen taskId="a" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Finish and clean up' }));
    await waitFor(() => expect(useStore.getState().notices[0]?.message).toMatch(/locked/));
    expect(useStore.getState().screen).toEqual({ kind: 'finish', taskId: 'a' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project renderer src/renderer/screens/FinishScreen.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Append to `src/renderer/styles/screens.css`:
```css
.finish { max-width: 620px; gap: 20px; padding: 24px; }
.finish h2 { margin: 0; font-size: 18px; font-weight: 600; }
.finish-section { display: flex; flex-direction: column; gap: 8px; }
.finish-section > .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
.check { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: var(--radius-lg); border: 1px solid var(--border); }
.check-warn { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-text); }
.check-ok { background: var(--green-bg); border-color: var(--green-border); color: #c9e9d2; }
.check .body { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.check .title { font-weight: 600; }
.finish-foot { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid var(--border); }
```

`src/renderer/screens/FinishScreen.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { FinishChecks } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';

export function FinishScreen({ taskId }: { taskId: string }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const go = useStore((s) => s.go);
  const notify = useStore((s) => s.notify);
  const [checks, setChecks] = useState<FinishChecks | null>(null);
  const [closeTerminals, setCloseTerminals] = useState(true);
  const [removeWorktree, setRemoveWorktree] = useState(true);
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void tryInvoke(() => api().invoke('tasks:finishChecks', taskId), notify).then((c) => { if (live && c) setChecks(c); });
    return () => { live = false; };
  }, [taskId, notify]);

  if (!task) return null;

  const openGit = async (label: string, command: string) => {
    const opened = await tryInvoke(() => api().invoke('terminals:open', taskId, { kind: 'run', label, command }), notify);
    if (opened) go({ kind: 'workspace' });
  };

  const finish = async () => {
    setBusy(true);
    const ok = await tryInvoke(async () => { await api().invoke('tasks:finish', taskId, { closeTerminals, removeWorktree, deleteBranch }); return true; }, notify);
    setBusy(false);
    if (ok) go({ kind: 'workspace' });
  };

  const dirty = checks ? checks.uncommitted.length > 0 || checks.unpushed > 0 : false;
  const terminalLabels = task.terminals.map((t) => t.label).join(', ');

  return (
    <div className="overlay" style={{ paddingTop: 72 }}>
      <div role="dialog" aria-labelledby="fn-title" className="dialog finish">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 id="fn-title">Finish task {task.workItem?.id ?? task.name}</h2>
          <div className="muted">{task.workItem?.title ?? task.branch}</div>
        </div>

        <div className="finish-section">
          <div className="label">Safety checks</div>
          {!checks && <div className="muted">Checking…</div>}
          {checks && (checks.uncommitted.length > 0 ? (
            <div className="check check-warn">
              <span aria-hidden="true">⚠</span>
              <div className="body">
                <div className="title">{`${checks.uncommitted.length} uncommitted change${checks.uncommitted.length === 1 ? '' : 's'}`}</div>
                <div className="mono small">{checks.uncommitted.map((f) => `${f.status} ${f.path}`).join('\n')}</div>
              </div>
              <button type="button" className="btn btn-warn btn-sm" onClick={() => openGit('git commit', 'git add -A && git commit')}>Commit…</button>
            </div>
          ) : (
            <div className="check check-ok"><span aria-hidden="true">✓</span><div className="body">No uncommitted changes</div></div>
          ))}
          {checks && (checks.unpushed > 0 ? (
            <div className="check check-warn">
              <span aria-hidden="true">↑</span>
              <div className="body"><div className="title">{`${checks.unpushed} commit${checks.unpushed === 1 ? '' : 's'} not pushed`}</div></div>
              <button type="button" className="btn btn-warn btn-sm" onClick={() => openGit('git push', `git push -u origin ${task.branch}`)}>Push</button>
            </div>
          ) : (
            <div className="check check-ok"><span aria-hidden="true">✓</span><div className="body">Nothing to push</div></div>
          ))}
          {checks && (checks.runningTerminals > 0 ? (
            <div className="check check-warn"><span aria-hidden="true">▶</span><div className="body"><div className="title">{`${checks.runningTerminals} terminal${checks.runningTerminals === 1 ? '' : 's'} still running`}</div><div className="small">They are closed when you finish, unless you untick it below.</div></div></div>
          ) : (
            <div className="check check-ok"><span aria-hidden="true">✓</span><div className="body">No running processes besides this task's terminals</div></div>
          ))}
        </div>

        <div className="finish-section">
          <div className="label">Clean up</div>
          <label className="checkbox"><input type="checkbox" checked={closeTerminals} onChange={(e) => setCloseTerminals(e.target.checked)} />{`Close ${task.terminals.length} terminals (${terminalLabels})`}</label>
          <label className="checkbox"><input type="checkbox" checked={removeWorktree} onChange={(e) => setRemoveWorktree(e.target.checked)} />Remove worktree folder</label>
          <label className="checkbox"><input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />Delete local branch <span className="mono small">{task.branch}</span></label>
        </div>

        <div className="finish-foot">
          <button type="button" className="btn" onClick={() => go({ kind: 'workspace' })}>Keep task</button>
          <button type="button" className={dirty ? 'btn btn-danger' : 'btn btn-green'} disabled={busy || !checks} onClick={finish}>
            {dirty ? 'Discard changes and clean up' : 'Finish and clean up'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

In `src/renderer/App.tsx` add `{screen.kind === 'finish' && <FinishScreen taskId={screen.taskId} />}` next to the New task overlay.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project renderer src/renderer/screens/FinishScreen.test.tsx`
Expected: PASS (5 tests). The label `Close 2 terminals (Claude Code, zsh)` is one text node, so `getByLabelText` with the full string matches.

- [ ] **Step 5: Start the app and finish a real task**

```bash
npm start
```

Create a task, edit a file in its worktree, click Finish task. Expected: the uncommitted change is listed, Commit… opens a tab running git commit, after committing the check is green, Finish removes the worktree folder and branch, and the task moves to the Done group. Quit.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat: finish task dialog with safety checks and cleanup"
```

---

### Task 16: Gemini art tool and app icon

Port of the "Gemini flow" from the Adem app (`~/orca/workspaces/adem/needlefish/tools/art/`), in Node instead of .NET. Allowed by the owner on 2026-10-14. The key is never printed or committed.

**Files:**
- Create: `tools/art/prompts.mjs`, `tools/art/generate.mjs`, `tools/art/prompts.md`, `tools/art/README.md`, `tools/art/incoming/.gitkeep`, `assets/ART.md` (after the pick), `assets/icon.png` (after the pick)
- Modify: `.gitignore`, `vitest.config.mts` (include `tools/art/*.test.ts` in the main project), `src/main.ts` (dock icon in dev), `forge.config.mts` (`packagerConfig.icon`)
- Test: `tools/art/prompts.test.ts`

**Interfaces:**
- Produces: `parsePrompts(markdown): Map<string, string>`, `aspectRatio(prompt): '1:1' | '9:16' | '16:9'` in `prompts.mjs`; CLI `node tools/art/generate.mjs list | generate [names…]`.

- [ ] **Step 1: Write the failing prompt-parser test**

`tools/art/prompts.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { aspectRatio, parsePrompts } from './prompts.mjs';

const md = `# Prompts

> General style, dark ground, no text.

**one.png** — A thing. Portrait.

## Icons

> Icon style, bold shapes.

**icon-a.png** — A counting hand.

**icon-b.png** — A tally. Landscape.
`;

describe('parsePrompts', () => {
  it('prefixes each subject with the style block of its section', () => {
    const p = parsePrompts(md);
    expect([...p.keys()]).toEqual(['one', 'icon-a', 'icon-b']);
    expect(p.get('one')).toBe('General style, dark ground, no text.\n\nA thing. Portrait.');
    expect(p.get('icon-a')).toBe('Icon style, bold shapes.\n\nA counting hand.');
  });
  it('falls back to the general style when a section has no block', () => {
    const p = parsePrompts(md.replace('> Icon style, bold shapes.\n\n', ''));
    expect(p.get('icon-a')).toBe('General style, dark ground, no text.\n\nA counting hand.');
  });
});

describe('aspectRatio', () => {
  it('reads the trailing orientation word', () => {
    expect(aspectRatio('x. Portrait.')).toBe('9:16');
    expect(aspectRatio('x. Landscape.')).toBe('16:9');
    expect(aspectRatio('x.')).toBe('1:1');
  });
});
```

Add `'tools/art/*.test.ts'` to the `main` project's `include` in `vitest.config.mts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project main tools/art`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the parser and the generator**

`tools/art/prompts.mjs`:
```js
// Reads prompts.md: the first "> quoted" paragraph is the general style block; a quoted paragraph inside a
// "## section" replaces it for that section. Each image is a line "**name.png** — subject".
const SUBJECT = /^\*\*([a-z0-9-]+)\.png\*\*\s*[—–-]\s*(.+)$/s;
const oneLine = (s) => s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

export function parsePrompts(markdown) {
  const result = new Map();
  let general = null;
  let style = '';
  for (const raw of markdown.replace(/\r\n/g, '\n').split(/\n\n+/)) {
    const p = raw.trim();
    if (p.length === 0) continue;
    if (p.startsWith('## ')) { style = general ?? ''; continue; }
    if (p.startsWith('>')) { style = oneLine(p.replace(/\n>/g, ' ').replace(/^>/, '')); general ??= style; continue; }
    const m = SUBJECT.exec(p);
    if (m) result.set(m[1], `${style}\n\n${oneLine(m[2])}`);
  }
  return result;
}

export function aspectRatio(prompt) {
  const p = prompt.trimEnd().toLowerCase();
  if (p.endsWith('portrait.')) return '9:16';
  if (p.endsWith('landscape.')) return '16:9';
  return '1:1';
}
```

`tools/art/generate.mjs`:
```js
#!/usr/bin/env node
// node tools/art/generate.mjs list                  print the names in prompts.md
// node tools/art/generate.mjs generate [names…]     ask Gemini for every image, or only those named, into tools/art/incoming/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aspectRatio, parsePrompts } from './prompts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

function findKey() {
  if (process.env.GEMINI_API_KEY?.trim()) return process.env.GEMINI_API_KEY.trim();
  const file = path.join(here, 'gemini.local.key');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}

async function generate(key, prompt, ratio) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ratio } },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body.slice(0, 600)}`);
  const doc = JSON.parse(body);
  for (const cand of doc.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      if (part.inlineData?.data) return Buffer.from(part.inlineData.data, 'base64');
    }
  }
  throw new Error(`Gemini returned no image: ${body.slice(0, 600)}`);
}

const [command = 'list', ...names] = process.argv.slice(2);
const prompts = parsePrompts(readFileSync(path.join(here, 'prompts.md'), 'utf8'));

if (command === 'list') {
  for (const name of prompts.keys()) console.log(name);
  process.exit(0);
}
if (command !== 'generate') {
  console.error('Usage: node tools/art/generate.mjs <list|generate [names…]>');
  process.exit(64);
}
const key = findKey();
if (!key) {
  console.error('No key: set GEMINI_API_KEY or write it to tools/art/gemini.local.key (https://aistudio.google.com/apikey)');
  process.exit(2);
}
const wanted = names.length > 0 ? names : [...prompts.keys()];
const unknown = wanted.filter((n) => !prompts.has(n));
if (unknown.length > 0) {
  console.error(`No prompt for: ${unknown.join(', ')} (known: ${[...prompts.keys()].join(', ')})`);
  process.exit(64);
}
const incoming = path.join(here, 'incoming');
mkdirSync(incoming, { recursive: true });
let failed = 0;
for (const name of wanted) {
  const prompt = prompts.get(name);
  const ratio = aspectRatio(prompt);
  process.stdout.write(`${name}: asking ${model} for ${ratio}… `);
  try {
    const png = await generate(key, prompt, ratio);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const file = path.join(incoming, `${name}-${stamp}.png`);
    writeFileSync(file, png);
    console.log(`${Math.round(png.length / 1024)} KB → tools/art/incoming/${path.basename(file)}`);
  } catch (e) {
    failed++;
    console.log(`failed: ${e.message}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
```

`tools/art/prompts.md` (colours are named in words on purpose: hex codes tend to get drawn as captions):
```markdown
# MIAC art prompts

The first quoted paragraph is the general style block; a quoted paragraph inside a section replaces it for that
section. Each image is the line starting with its file name in bold. A subject ending in "Portrait." is asked for at
9:16, one ending in "Landscape." at 16:9, anything else square.

## Style block

> Calm, precise illustration for a developer desktop app, dark and warm: a near-black charcoal ground, soft amber
> glow as the single accent, thin luminous lines, clean geometric shapes, lots of empty dark space. No text, no
> letters, no numbers, no logos, no watermark, no frame. Square image.

## App icon (the owner picks one)

> A macOS and Windows app icon, square, full-bleed artwork filling the whole square, no rounded corners, no text, no
> letters, no numbers, no border. One simple bold shape that still reads at 32 pixels. Near-black charcoal ground,
> warm amber glow as the only accent colour, a touch of pale cream for highlights.

**appicon-tally.png** — Four thin vertical amber strokes with a fifth diagonal stroke crossing them, a classic tally mark, glowing softly, centred on the dark ground.

**appicon-abacus.png** — A single horizontal rod with five small glowing amber beads, three pushed to the left and two to the right, centred on the dark ground.

**appicon-ship.png** — A sleek elongated starship seen from the side, drawn as a few thin amber lines with one bright engine glow at the back, centred on the dark ground.

**appicon-counter.png** — A rounded rectangular mechanical counter wheel showing three blank amber-lit drums, slightly tilted, on the dark ground.
```

`tools/art/README.md`:
```markdown
# Art: generated with Gemini

The same loop as the Adem app's `tools/art`, in Node.

1. Get a key at https://aistudio.google.com/apikey and put it in `tools/art/gemini.local.key` (git-ignored) or in
   `GEMINI_API_KEY`. It is sent only to generativelanguage.googleapis.com, as a header, and never printed.
2. `node tools/art/generate.mjs generate` asks the image model (`gemini-2.5-flash-image`, or `GEMINI_IMAGE_MODEL`)
   for every image in `prompts.md` and saves timestamped candidates in `tools/art/incoming/` (git-ignored).
3. Not happy with one? Edit its line in `prompts.md` and re-run with only its name: `… generate appicon-tally`.
4. `… list` prints the names in the pack.

A chosen image is copied by hand to `assets/` with a note in `assets/ART.md` that records the date, model, prompt,
which candidate won and why, and any post-processing. Rejected candidates stay local.
```

Append to `.gitignore`:
```
# Gemini art: the key and the raw candidates stay local
tools/art/gemini.local.key
tools/art/incoming/*
!tools/art/incoming/.gitkeep
```

Create the empty `tools/art/incoming/.gitkeep`.

- [ ] **Step 4: Run the parser test and the CLI without a key**

```bash
npx vitest run --project main tools/art
node tools/art/generate.mjs list
node tools/art/generate.mjs generate appicon-tally; echo "exit $?"
```

Expected: tests PASS; `list` prints the four icon names; `generate` without a key prints the "No key" line and exits 2.

- [ ] **Step 5: Generate candidates and pick the icon**

This step needs the owner's key. If none is available, stop here, commit the tool, and leave the icon for later; the app runs fine without it.

```bash
node tools/art/generate.mjs generate
open tools/art/incoming
```

Pick one candidate against this checklist: no text or letters; reads at 32 px (check with `sips -z 32 32 <file> --out /tmp/preview.png && open /tmp/preview.png`); dark ground close to `#15171a`; amber is the only accent. Then:

```bash
mkdir -p assets
sips -z 1024 1024 tools/art/incoming/<chosen>.png --out assets/icon.png
```

Write `assets/ART.md` with: date, model, the full prompt from `prompts.md`, the candidate file name that won, one line on why, one line per rejected candidate, and the `sips` command used.

- [ ] **Step 6: Use the icon**

In `src/main.ts`, after `app.whenReady()` resolves and before `boot()` runs, set the dock icon in development on macOS:
```ts
import { nativeImage } from 'electron';
import { existsSync } from 'node:fs';
// …
const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
if (process.platform === 'darwin' && existsSync(iconPath)) app.dock?.setIcon(nativeImage.createFromPath(iconPath));
```
In `forge.config.mts`, set `packagerConfig: { asar: true, icon: 'assets/icon' }` (Forge appends `.icns`/`.ico` per platform; converting `icon.png` to those formats is part of the later packaging work, so leave the PNG in place and note it in `assets/ART.md`).

- [ ] **Step 7: Commit**

```bash
git add tools/art .gitignore vitest.config.mts assets src/main.ts forge.config.mts
git commit -m "feat: Gemini art tool with app icon prompts"
```

If Step 5 was skipped, omit `assets` from the `git add` and say so in the commit body.

---

## Done criteria for the slice

- `npm test`, `npm run typecheck` and `npm run lint` are clean.
- From `npm start`: add a repo, create a task from a typed work item, watch setup, work in the Claude and shell tabs, run a `run:` command, finish the task with cleanup, and see it under Done.
- `state.json` in the user data folder round-trips across restarts, and a task interrupted mid-setup shows as failed with a retry.
