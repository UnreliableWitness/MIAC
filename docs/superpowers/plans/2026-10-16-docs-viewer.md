# Docs tab, terminal links and Send to: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-task Docs tab that renders the worktree's Markdown (GFM, Mermaid, source view), clickable file and URL links in every task terminal, and "Send to" that pastes a quoted passage into any task terminal.

**Architecture:**
- Main gets a `src/main/docs/` module: a path rule that keeps every read inside the worktree, git-based listing, reads, assets, link resolution, a reference-counted recursive watcher, and IPC handlers merged into `createHandlers`.
- The renderer gets `src/renderer/docs/` (pure helpers) and `src/renderer/components/docs/` (React views on react-markdown).
- A terminal registry lets Send to and the link provider reach the live xterm instances.

**Tech Stack:** Electron, React 19, zustand, xterm 6, react-markdown 10, remark-gfm 4, rehype-sanitize 6, rehype-slug 6, rehype-highlight 7, unist-util-visit 5, mermaid 11, Vitest with Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-16-docs-viewer-design.md`

## Global Constraints

**Main process and IPC**
- Every docs IPC call requires a task with status `ready` and an existing worktree. Otherwise it throws `Cannot read docs of a task that is <status>` or `The worktree is missing`.
- Path rule errors are exactly `Outside the worktree` and `Not found`. Size errors are exactly `Too large`.
- Limits: documents 2 MB (`2 * 1024 * 1024`), images 10 MB, at most 2,000 listed files, quotes 4,000 characters.
- Paths crossing IPC are relative to the worktree with `/` separators.
- `links:open` accepts only `http:` and `https:` without username or password. `shell:openExternal` is not changed.
- The watcher ignores `node_modules/` and `.git/` and debounces 150 ms. Cancel setup and Finish stop it before removing the worktree.
- All shell, path and spawn logic goes behind `Platform`. The new method is `editorGotoCommand(worktree, file, line?, col?)`.

**Renderer**
- Raw HTML in Markdown is never rendered: no `rehype-raw`. Mermaid runs with `securityLevel: 'strict'`. Remote images are not loaded.
- Send to never sends Enter.
- The Docs pivot sits right after Usage and before the terminal pivots. Its tab id is `DOCS_TAB = 'docs'`. The shortcut is Mod+Shift+D.

**Telemetry and checks**
- Telemetry carries no paths, file names or URLs. The events are `docs.opened { view, from }`, `docs.sentTo { kind }` and `terminal.linkOpened { type }`. Update `docs/telemetry.md`.
- Copy: "Docs", "No Markdown files in this worktree", "This file is larger than 2 MB.", "This file was deleted.", "Updated", "Open in VS Code", "Reveal in Finder" (macOS), "Show in Explorer" (Windows), "Send to <label>", "Rendered", "Source".
- Checks: `npm test`, `npm run typecheck`, `npm run lint` (`oxlint && oxfmt --check`; format with `npx oxfmt`).
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015KciGjTpgSkbzuCQD9ChUq
  ```

## Review Focus

1. **File names with spaces, umlauts or other non-ASCII characters.** git quotes them in plain output, so listing must use `-z`. Test: `docs:list` returns `notes/ü plan.md` intact (Task 1).
2. **CRLF files** (Windows checkouts). Source view line numbers and Send to ranges must count lines the same as the editor. Test: `buildQuote` with CRLF, and SourceView line count on a CRLF document (Tasks 3 and 4).
3. **A path that wraps across terminal rows.** The link provider must match on the logical line, not on the row. Test: `logicalLine` joins wrapped rows and maps indices back to cells (Task 7).
4. **A shell without bracketed paste** (old PSReadLine, cmd). A multi-line quote would execute line by line. Test: with `bracketedPasteMode` off, Send to pastes one line with no newline (Task 6).
5. **Finish or Cancel setup while the Docs tab watches the worktree.** On Windows, the watched folder cannot be removed. Test: the handlers stop the watcher before `worktreeRemove` (Task 2).

---

## File map

| File | Responsibility |
|---|---|
| `src/main/docs/worktreeFiles.ts` (new) | `isInside`, `resolveInWorktree`, `toRel`, `listDocs`, `readDoc`, `readAsset`, `resolveLink`, limits |
| `src/main/docs/DocsWatcher.ts` (new) | reference-counted recursive `fs.watch` per task, debounced events |
| `src/main/docs/docsHandlers.ts` (new) | `createDocsHandlers(deps)` for the `docs:*` and `links:open` channels |
| `src/main/platform/{Platform,darwin,windows}.ts` | `editorGotoCommand` |
| `src/main/ipc/handlers.ts` | merge the docs handlers, stop the watcher before worktree removal, `revealFile` service |
| `src/main.ts` | `revealFile: shell.showItemInFolder`, stop all watchers on quit |
| `src/shared/ipc.ts` | new channels and the `docs:changed` event |
| `src/renderer/docs/quote.ts` (new) | `buildQuote`, `MAX_QUOTE` |
| `src/renderer/docs/linkify.ts` (new) | `findLinks`, `resolveRelative` |
| `src/renderer/docs/rehypeLines.ts` (new) | rehype plugin: source lines onto block elements |
| `src/renderer/docs/docsPrefs.ts` (new) | per-task open file, view, scroll; list collapsed; send target |
| `src/renderer/components/docs/MarkdownView.tsx` (new) | react-markdown pipeline, links, images, code blocks |
| `src/renderer/components/docs/MermaidBlock.tsx` (new) | lazy Mermaid |
| `src/renderer/components/docs/SourceView.tsx` (new) | line-numbered source |
| `src/renderer/components/docs/DocsTab.tsx` (new) | list, command bar, states, reload |
| `src/renderer/components/docs/SendTo.tsx` (new) | selection button and terminal menu |
| `src/renderer/terminalRegistry.ts` (new) | terminal id to live xterm instance |
| `src/renderer/terminalLinks.ts` (new) | `logicalLine`, `createLinkProvider` |
| `src/renderer/store.ts`, `hooks/useShortcuts.ts`, `components/TerminalTabs.tsx`, `components/TerminalView.tsx` | Docs tab wiring, `openDoc`, shortcut, registry and link provider |
| `src/renderer/styles/docs.css` (new) | Docs styles |
| `docs/telemetry.md`, `docs/windows-checklist.md`, `CLAUDE.md` | docs |

---

### Task 1: Worktree file access (main, pure + fs)

**Files:**
- Create: `src/main/docs/worktreeFiles.ts`
- Test: `src/main/docs/worktreeFiles.test.ts`

**Interfaces:**
- Consumes: `GitClient.run(cwd, args): Promise<string>` (`src/main/services/GitClient.ts`); test helpers `makeRepo`, `commitFile`, `git`, `cleanupTempRepos` from `src/main/test-helpers/gitRepo.ts`.
- Produces:
  - `MAX_DOC_BYTES`, `MAX_ASSET_BYTES`, `MAX_DOCS`, `TASK_FILE = '.miac/task.md'`
  - `type DocFile = { path: string; changed: 'new' | 'modified' | null }`
  - `isInside(root: string, target: string, p?: path.PlatformPath): boolean`
  - `resolveInWorktree(worktree: string, rel: string): Promise<string>` (an absolute real path)
  - `toRel(root: string, abs: string): string`
  - `listDocs(git: GitClient, worktree: string, baseSha: string | null): Promise<DocFile[]>`
  - `readDoc(worktree, rel): Promise<{ text: string; mtimeMs: number }>`
  - `readAsset(worktree, rel): Promise<string>` (a data URL)
  - `resolveLink(worktree, rel): Promise<{ path: string; kind: 'md' | 'file' } | null>`

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/docs/worktreeFiles.test.ts
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitClient } from '../services/GitClient';
import {
  cleanupTempRepos,
  commitFile,
  git,
  makeRepo,
} from '../test-helpers/gitRepo';
import {
  isInside,
  listDocs,
  MAX_DOC_BYTES,
  readAsset,
  readDoc,
  resolveInWorktree,
  resolveLink,
} from './worktreeFiles';

afterAll(() => cleanupTempRepos());
const gc = new GitClient();
const canSymlink = process.platform !== 'win32';

describe('isInside', () => {
  it('accepts the root and children, rejects siblings and parents', () => {
    expect(isInside('/a/wt', '/a/wt', path.posix)).toBe(true);
    expect(isInside('/a/wt', '/a/wt/x/y.md', path.posix)).toBe(true);
    expect(isInside('/a/wt', '/a/wt2/y.md', path.posix)).toBe(false);
    expect(isInside('/a/wt', '/a/y.md', path.posix)).toBe(false);
  });
  it('is case-insensitive for Windows paths', () => {
    expect(isInside('C:\\Src\\WT', 'c:\\src\\wt\\a.md', path.win32)).toBe(true);
    expect(isInside('C:\\Src\\WT', 'C:\\Src\\WT2\\a.md', path.win32)).toBe(false);
  });
});

describe('resolveInWorktree', () => {
  it('resolves a relative file and an absolute path inside', async () => {
    const repo = makeRepo();
    const abs = await resolveInWorktree(repo, 'README.md');
    expect(abs.endsWith('README.md')).toBe(true);
    expect(await resolveInWorktree(repo, path.join(repo, 'README.md'))).toBe(abs);
  });
  it.each(['../outside.md', '/etc/hosts', '', 'a\0b.md'])(
    'rejects %j as outside the worktree',
    async (rel) => {
      const repo = makeRepo();
      writeFileSync(path.join(path.dirname(repo), 'outside.md'), 'x');
      await expect(resolveInWorktree(repo, rel)).rejects.toThrow(
        'Outside the worktree',
      );
    },
  );
  it('rejects a missing file and a directory as not found', async () => {
    const repo = makeRepo();
    mkdirSync(path.join(repo, 'docs'));
    await expect(resolveInWorktree(repo, 'nope.md')).rejects.toThrow('Not found');
    await expect(resolveInWorktree(repo, 'docs')).rejects.toThrow('Not found');
  });
  it.runIf(canSymlink)('rejects a symlink that points outside', async () => {
    const repo = makeRepo();
    const out = path.join(os.tmpdir(), `miac-out-${Date.now()}.md`);
    writeFileSync(out, 'secret');
    symlinkSync(out, path.join(repo, 'link.md'));
    await expect(resolveInWorktree(repo, 'link.md')).rejects.toThrow(
      'Outside the worktree',
    );
  });
  it.runIf(canSymlink)('accepts a symlink that stays inside', async () => {
    const repo = makeRepo();
    symlinkSync(path.join(repo, 'README.md'), path.join(repo, 'alias.md'));
    expect(await resolveInWorktree(repo, 'alias.md')).toBe(
      await resolveInWorktree(repo, 'README.md'),
    );
  });
});

describe('listDocs', () => {
  it('lists tracked and untracked Markdown, skips ignored, pins the task file, flags changes', async () => {
    const repo = makeRepo();
    commitFile(repo, '.gitignore', 'node_modules/\n');
    mkdirSync(path.join(repo, 'docs'));
    commitFile(repo, 'docs/old.md', 'old\n');
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    writeFileSync(path.join(repo, 'docs/old.md'), 'changed\n');
    mkdirSync(path.join(repo, 'notes'));
    writeFileSync(path.join(repo, 'notes/ü plan.md'), 'new\n');
    mkdirSync(path.join(repo, 'node_modules/pkg'), { recursive: true });
    writeFileSync(path.join(repo, 'node_modules/pkg/README.md'), 'x');
    writeFileSync(path.join(repo, 'code.ts'), 'x');
    mkdirSync(path.join(repo, '.miac'));
    writeFileSync(path.join(repo, '.miac/task.md'), '# task');
    git(repo, 'config', 'core.excludesFile', '/dev/null');
    writeFileSync(path.join(repo, '.git/info/exclude'), '.miac/\n');

    const files = await listDocs(gc, repo, base);
    expect(files).toEqual([
      { path: '.miac/task.md', changed: null },
      { path: 'README.md', changed: null },
      { path: 'docs/old.md', changed: 'modified' },
      { path: 'notes/ü plan.md', changed: 'new' },
    ]);
  });
  it('has no change flags without a base', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, 'new.md'), 'x');
    const files = await listDocs(gc, repo, null);
    expect(files.every((f) => f.changed === null)).toBe(true);
  });
  it('caps the list at 2000 files', async () => {
    const repo = makeRepo();
    mkdirSync(path.join(repo, 'many'));
    for (let i = 0; i < 2005; i++)
      writeFileSync(path.join(repo, 'many', `f${i}.md`), '');
    expect((await listDocs(gc, repo, null)).length).toBe(2000);
  });
});

describe('reads', () => {
  it('reads a document and refuses one over 2 MB', async () => {
    const repo = makeRepo();
    expect((await readDoc(repo, 'README.md')).text).toBe('# test\n');
    writeFileSync(path.join(repo, 'big.md'), 'x'.repeat(MAX_DOC_BYTES + 1));
    await expect(readDoc(repo, 'big.md')).rejects.toThrow('Too large');
  });
  it('returns images as data URLs and refuses other types', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, 'a.png'), Buffer.from([0x89, 0x50]));
    writeFileSync(path.join(repo, 'b.svg'), '<svg/>');
    expect(await readAsset(repo, 'a.png')).toBe('data:image/png;base64,iVA=');
    expect(await readAsset(repo, 'b.svg')).toMatch(/^data:image\/svg\+xml;base64,/);
    await expect(readAsset(repo, 'README.md')).rejects.toThrow('Not an image');
  });
  it('resolves links to md and other files, null for anything else', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, 'x.ts'), '');
    expect(await resolveLink(repo, './README.md')).toEqual({ path: 'README.md', kind: 'md' });
    expect(await resolveLink(repo, path.join(repo, 'x.ts'))).toEqual({ path: 'x.ts', kind: 'file' });
    expect(await resolveLink(repo, '../nope.ts')).toBeNull();
    expect(await resolveLink(repo, 'missing.md')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/docs/worktreeFiles.test.ts`
Expected: FAIL, because `./worktreeFiles` does not exist.

- [ ] **Step 3: Implement**

```ts
// src/main/docs/worktreeFiles.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GitClient } from '../services/GitClient';

export const MAX_DOC_BYTES = 2 * 1024 * 1024;
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
export const MAX_DOCS = 2000;
export const TASK_FILE = '.miac/task.md';
const SPECS = [':(icase)*.md', ':(icase)*.markdown'];
const MD = /\.(md|markdown)$/i;
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export type DocFile = { path: string; changed: 'new' | 'modified' | null };

/** True when `target` is `root` or inside it; Windows paths compare case-insensitively. */
export function isInside(
  root: string,
  target: string,
  p: path.PlatformPath = path,
): boolean {
  const norm = (x: string) => (p.sep === '\\' ? x.toLowerCase() : x);
  const r = norm(p.resolve(root));
  const t = norm(p.resolve(target));
  if (t === r) return true;
  return t.startsWith(r.endsWith(p.sep) ? r : r + p.sep);
}

export const toRel = (root: string, abs: string): string =>
  path.relative(root, abs).split(path.sep).join('/');

/** The real path of a regular file inside the worktree, after following symlinks. */
export async function resolveInWorktree(
  worktree: string,
  rel: string,
): Promise<string> {
  if (!rel || rel.includes('\0')) throw new Error('Outside the worktree');
  const lexical = path.resolve(worktree);
  const root = await fs.realpath(worktree);
  // An absolute path printed in a terminal uses the worktree path as MIAC knows it, which may differ from its realpath (macOS /var).
  const joined = path.isAbsolute(rel)
    ? isInside(lexical, rel)
      ? path.join(root, path.relative(lexical, rel))
      : path.resolve(rel)
    : path.resolve(root, rel);
  if (!isInside(root, joined)) throw new Error('Outside the worktree');
  let real: string;
  try {
    real = await fs.realpath(joined);
  } catch {
    throw new Error('Not found');
  }
  if (!isInside(root, real)) throw new Error('Outside the worktree');
  const st = await fs.stat(real);
  if (!st.isFile()) throw new Error('Not found');
  return real;
}

const splitZ = (out: string) => out.split('\0').filter(Boolean);

export async function listDocs(
  git: GitClient,
  worktree: string,
  baseSha: string | null,
): Promise<DocFile[]> {
  const listed = splitZ(
    await git.run(worktree, [
      'ls-files', '-z', '-co', '--exclude-standard', '--', ...SPECS,
    ]),
  ).filter((p) => MD.test(p));
  const changed = new Map<string, 'new' | 'modified'>();
  if (baseSha) {
    const diff = splitZ(
      await git
        .run(worktree, ['diff', '-z', '--name-status', '--no-renames', baseSha, '--', ...SPECS])
        .catch(() => ''),
    );
    for (let i = 0; i + 1 < diff.length; i += 2) {
      const status = diff[i][0];
      if (status === 'A') changed.set(diff[i + 1], 'new');
      else if (status === 'M' || status === 'T') changed.set(diff[i + 1], 'modified');
    }
    const untracked = splitZ(
      await git.run(worktree, ['ls-files', '-z', '-o', '--exclude-standard', '--', ...SPECS]),
    );
    for (const p of untracked) changed.set(p, 'new');
  }
  // -c also lists files deleted from the working tree but still in the index.
  const present = await Promise.all(
    [...new Set(listed)].map(async (p) =>
      (await fs.stat(path.join(worktree, p)).then((s) => s.isFile(), () => false)) ? p : null,
    ),
  );
  const files = present
    .filter((p): p is string => p !== null && p !== TASK_FILE)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((p) => ({ path: p, changed: changed.get(p) ?? null }));
  const hasTask = await fs
    .stat(path.join(worktree, TASK_FILE))
    .then((s) => s.isFile(), () => false);
  const all = hasTask ? [{ path: TASK_FILE, changed: null }, ...files] : files;
  return all.slice(0, MAX_DOCS);
}

export async function readDoc(
  worktree: string,
  rel: string,
): Promise<{ text: string; mtimeMs: number }> {
  const abs = await resolveInWorktree(worktree, rel);
  const st = await fs.stat(abs);
  if (st.size > MAX_DOC_BYTES) throw new Error('Too large');
  return { text: await fs.readFile(abs, 'utf8'), mtimeMs: st.mtimeMs };
}

export async function readAsset(worktree: string, rel: string): Promise<string> {
  const abs = await resolveInWorktree(worktree, rel);
  const type = IMAGE_TYPES[path.extname(abs).toLowerCase()];
  if (!type) throw new Error('Not an image');
  const st = await fs.stat(abs);
  if (st.size > MAX_ASSET_BYTES) throw new Error('Too large');
  return `data:${type};base64,${(await fs.readFile(abs)).toString('base64')}`;
}

export async function resolveLink(
  worktree: string,
  rel: string,
): Promise<{ path: string; kind: 'md' | 'file' } | null> {
  try {
    const abs = await resolveInWorktree(worktree, rel);
    const root = await fs.realpath(worktree);
    return { path: toRel(root, abs), kind: MD.test(abs) ? 'md' : 'file' };
  } catch {
    return null;
  }
}
```

Run `npx oxfmt src/main/docs` afterwards to format it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/docs/worktreeFiles.test.ts`
Expected: PASS. On Windows CI, the symlink cases are skipped.

- [ ] **Step 5: Commit**

```bash
git add src/main/docs
git commit -m "feat: worktree-scoped Markdown listing and reads for the Docs tab"
```

---

### Task 2: Watcher, IPC channels, platform editor command

**Files:**
- Create: `src/main/docs/DocsWatcher.ts`, `src/main/docs/DocsWatcher.test.ts`, `src/main/docs/docsHandlers.ts`, `src/main/docs/docsHandlers.test.ts`
- Modify:
  - `src/shared/ipc.ts`: channels and event
  - `src/main/platform/Platform.ts`, `darwin.ts`, `windows.ts`, plus their tests
  - `src/main/ipc/handlers.ts`: Services `revealFile?`, merge, stop before removal
  - `src/main/ipc/handlers.test.ts`: the stop-before-removal test
  - `src/main.ts`
  - `src/renderer/test-helpers/fakeApi.ts`: defaults

**Interfaces:**
- Consumes: Task 1 exports. `Task` (`worktreePath`, `baseSha`, `status`); `Services` in `handlers.ts`; `ps`/`psQuote`/`deps.which` in `windows.ts`.
- Produces, in `Channels`:
  ```ts
  'docs:list': { args: [taskId: string]; result: { files: DocFile[] } };
  'docs:read': { args: [taskId: string, path: string]; result: { text: string; mtimeMs: number } };
  'docs:asset': { args: [taskId: string, path: string]; result: string };
  'docs:resolve': { args: [taskId: string, path: string]; result: { path: string; kind: 'md' | 'file' } | null };
  'docs:openInEditor': { args: [taskId: string, path: string, line?: number, col?: number]; result: void };
  'docs:reveal': { args: [taskId: string, path: string]; result: void };
  'docs:watch': { args: [taskId: string, on: boolean]; result: { live: boolean } };
  'links:open': { args: [url: string]; result: void };
  ```
- Event: `'docs:changed': { taskId: string; paths: string[] }`.
- Export `DocFile` from `src/shared/types.ts` (move the type there and import it in `worktreeFiles.ts`).
- `Platform.editorGotoCommand(worktree: string, file: string, line?: number, col?: number): Command`.
- `class DocsWatcher { constructor(emit: (taskId: string, paths: string[]) => void, debounceMs = 150); start(taskId: string, dir: string): boolean; stop(taskId: string): void; stopTask(taskId: string): void; stopAll(): void }`. `start` and `stop` are reference-counted. `stopTask` closes regardless of the count.
- `allowedLink(url: string): boolean`, exported from `docsHandlers.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/docs/DocsWatcher.test.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DocsWatcher } from './DocsWatcher';

const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
};

describe('DocsWatcher', () => {
  it('debounces changes into one event with / paths and ignores node_modules', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'miac-watch-'));
    mkdirSync(path.join(dir, 'docs'));
    mkdirSync(path.join(dir, 'node_modules'));
    const events: { taskId: string; paths: string[] }[] = [];
    const w = new DocsWatcher((taskId, paths) => events.push({ taskId, paths }), 50);
    expect(w.start('t1', dir)).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(path.join(dir, 'docs', 'a.md'), '1');
    writeFileSync(path.join(dir, 'node_modules', 'x.md'), '1');
    await waitFor(() => events.length > 0);
    w.stopAll();
    expect(events[0].taskId).toBe('t1');
    expect(events[0].paths).toContain('docs/a.md');
    expect(events.flatMap((e) => e.paths).some((p) => p.startsWith('node_modules'))).toBe(false);
  });
  it('is reference-counted, and stopTask closes regardless', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'miac-watch-'));
    const w = new DocsWatcher(() => undefined, 10);
    w.start('t', dir);
    w.start('t', dir);
    w.stop('t');
    expect(w.active('t')).toBe(true);
    w.stopTask('t');
    expect(w.active('t')).toBe(false);
  });
});
```

Add `active(taskId): boolean` to the `DocsWatcher` interface above; the test needs it.

```ts
// src/main/docs/docsHandlers.test.ts
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../shared/types';
import { GitClient } from '../services/GitClient';
import { cleanupTempRepos, makeRepo } from '../test-helpers/gitRepo';
import { DocsWatcher } from './DocsWatcher';
import { allowedLink, createDocsHandlers } from './docsHandlers';

afterAll(() => cleanupTempRepos());

function setup(status: Task['status'] = 'ready') {
  const repo = makeRepo();
  const task = { id: 't1', status, worktreePath: repo, baseSha: null } as Task;
  const launch = vi.fn(async () => undefined);
  const openExternal = vi.fn(async () => undefined);
  const revealFile = vi.fn();
  const watcher = new DocsWatcher(() => undefined);
  const h = createDocsHandlers({
    taskById: () => task,
    git: new GitClient(),
    editorGoto: (wt, f, l, c) => ({ command: 'code', args: [wt, '-g', `${f}:${l ?? 1}:${c ?? 1}`] }),
    launch,
    openExternal,
    revealFile,
    watcher,
    event: () => undefined,
  });
  return { repo, h, launch, openExternal, revealFile, watcher };
}

describe('docs handlers', () => {
  it('lists and reads for a ready task', async () => {
    const { h } = setup();
    expect((await h['docs:list']('t1')).files.map((f) => f.path)).toEqual(['README.md']);
    expect((await h['docs:read']('t1', 'README.md')).text).toBe('# test\n');
  });
  it('refuses a task that is not ready', async () => {
    const { h } = setup('done');
    await expect(h['docs:list']('t1')).rejects.toThrow('Cannot read docs of a task that is done');
  });
  it('opens the editor at the file and line through the platform', async () => {
    const { h, launch, repo } = setup();
    await h['docs:openInEditor']('t1', 'README.md', 3, 2);
    const call = launch.mock.calls[0][0] as { args: string[] };
    expect(call.args[2]).toBe(`${await import('node:fs').then((f) => f.realpathSync(path.join(repo, 'README.md')))}:3:2`);
  });
  it('refuses to reveal or open outside the worktree', async () => {
    const { h, revealFile } = setup();
    await expect(h['docs:reveal']('t1', '../x')).rejects.toThrow('Outside the worktree');
    expect(revealFile).not.toHaveBeenCalled();
  });
  it('watch on/off reports live', async () => {
    const { h, watcher } = setup();
    expect(await h['docs:watch']('t1', true)).toEqual({ live: true });
    expect(watcher.active('t1')).toBe(true);
    await h['docs:watch']('t1', false);
    expect(watcher.active('t1')).toBe(false);
  });
});

describe('allowedLink', () => {
  it.each([
    ['https://example.com/a?b=1', true],
    ['http://localhost:5173/', true],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['https://user:pw@example.com', false],
    ['not a url', false],
  ])('%s -> %s', (url, ok) => expect(allowedLink(url)).toBe(ok));
});
```

Platform tests, added to `darwin.test.ts`:

```ts
it('opens VS Code at a file and line in the worktree window', () => {
  expect(p.editorGotoCommand('/wt', '/wt/a.md', 12, 3)).toEqual({
    command: 'code',
    args: ['/wt', '-g', '/wt/a.md:12:3'],
  });
  expect(p.editorGotoCommand('/wt', '/wt/a.md').args[2]).toBe('/wt/a.md:1:1');
});
```

And to `windows.test.ts`, matching the existing `editorCommand` test's `make(...)` helper:

```ts
it('opens VS Code at a file and line with quoted paths', () => {
  const cmd = make({ code: 'C:\\VS\\bin\\code.cmd' }).editorGotoCommand(
    'C:\\src\\wt', "C:\\src\\wt\\o'b.md", 4,
  );
  expect(cmd.args.at(-1)).toContain("& code 'C:\\src\\wt' -g 'C:\\src\\wt\\o''b.md:4:1'");
});
```

Handlers test, added to `handlers.test.ts`, using its `harness()` and an existing finish test as the pattern:

```ts
it('stops the docs watcher before Finish removes the worktree', async () => {
  // Arrange a ready task as the existing "finish removes the worktree" test does, then:
  await h['docs:watch'](task.id, true);
  const order: string[] = [];
  const realRemove = s.git.worktreeRemove.bind(s.git);
  vi.spyOn(s.git, 'worktreeRemove').mockImplementation(async (...a) => {
    order.push(`remove:${docsWatcherActive(task.id)}`);
    return realRemove(...a);
  });
  await h['tasks:finish'](task.id, { removeWorktree: true, deleteBranch: true, closeTerminals: true, syncUsage: false, createPullRequest: false });
  expect(order).toEqual(['remove:false']);
});
```

Here `docsWatcherActive` reads the watcher's `active()`. Expose the watcher for tests through an optional `Services.docsWatcher?: DocsWatcher`, which `createHandlers` uses when given and otherwise creates. Copy the exact finish options from the neighboring finish test, so field names match `FinishOptions`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/docs src/main/platform src/main/ipc/handlers.test.ts -t "docs|editorGoto|VS Code at|watcher|allowedLink"`
Expected: FAIL. The modules and methods are missing.

- [ ] **Step 3: Implement**

```ts
// src/main/docs/DocsWatcher.ts
import { watch, type FSWatcher } from 'node:fs';

const IGNORED = /(^|\/)(node_modules|\.git)(\/|$)/;

/** One recursive watcher per task worktree, shared by every open Docs tab, with changes debounced into one event. */
export class DocsWatcher {
  private readonly entries = new Map<
    string,
    { w: FSWatcher; count: number; pending: Set<string>; timer: NodeJS.Timeout | null }
  >();

  constructor(
    private readonly emit: (taskId: string, paths: string[]) => void,
    private readonly debounceMs = 150,
  ) {}

  /** False when the platform cannot watch the folder; the renderer then polls. */
  start(taskId: string, dir: string): boolean {
    const e = this.entries.get(taskId);
    if (e) {
      e.count++;
      return true;
    }
    let w: FSWatcher;
    try {
      w = watch(dir, { recursive: true });
    } catch {
      return false;
    }
    const entry = { w, count: 1, pending: new Set<string>(), timer: null as NodeJS.Timeout | null };
    w.on('change', (_ev, name) => {
      if (!name) return;
      const rel = String(name).split('\\').join('/');
      if (IGNORED.test(rel)) return;
      entry.pending.add(rel);
      entry.timer ??= setTimeout(() => {
        entry.timer = null;
        const paths = [...entry.pending];
        entry.pending.clear();
        this.emit(taskId, paths);
      }, this.debounceMs);
    });
    w.on('error', () => this.stopTask(taskId));
    this.entries.set(taskId, entry);
    return true;
  }

  stop(taskId: string): void {
    const e = this.entries.get(taskId);
    if (e && --e.count <= 0) this.stopTask(taskId);
  }

  stopTask(taskId: string): void {
    const e = this.entries.get(taskId);
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    e.w.close();
    this.entries.delete(taskId);
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.stopTask(id);
  }

  active(taskId: string): boolean {
    return this.entries.has(taskId);
  }
}
```

```ts
// src/main/docs/docsHandlers.ts
import { existsSync } from 'node:fs';
import type { Handlers } from '../../shared/ipc';
import type { Task } from '../../shared/types';
import type { Command } from '../platform/Platform';
import type { GitClient } from '../services/GitClient';
import type { DocsWatcher } from './DocsWatcher';
import { listDocs, readAsset, readDoc, resolveInWorktree, resolveLink } from './worktreeFiles';

type DocsChannels =
  | 'docs:list' | 'docs:read' | 'docs:asset' | 'docs:resolve'
  | 'docs:openInEditor' | 'docs:reveal' | 'docs:watch' | 'links:open';

export type DocsDeps = {
  taskById: (id: string) => Task;
  git: GitClient;
  editorGoto: (worktree: string, file: string, line?: number, col?: number) => Command;
  launch: (cmd: Command) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  revealFile: (absPath: string) => void;
  watcher: DocsWatcher;
  event: (name: string, props?: Record<string, string | number | boolean>) => void;
};

/** Web links clicked in a terminal or a document: http(s) only, no credentials in the URL. */
export function allowedLink(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
  } catch {
    return false;
  }
}

export function createDocsHandlers(d: DocsDeps): Pick<Handlers, DocsChannels> {
  const worktree = (taskId: string): string => {
    const t = d.taskById(taskId);
    if (t.status !== 'ready') throw new Error(`Cannot read docs of a task that is ${t.status}`);
    if (!existsSync(t.worktreePath)) throw new Error('The worktree is missing');
    return t.worktreePath;
  };
  return {
    'docs:list': async (taskId) => ({
      files: await listDocs(d.git, worktree(taskId), d.taskById(taskId).baseSha),
    }),
    'docs:read': async (taskId, p) => readDoc(worktree(taskId), p),
    'docs:asset': async (taskId, p) => readAsset(worktree(taskId), p),
    'docs:resolve': async (taskId, p) => resolveLink(worktree(taskId), p),
    'docs:openInEditor': async (taskId, p, line, col) => {
      const wt = worktree(taskId);
      const abs = await resolveInWorktree(wt, p);
      await d.launch(d.editorGoto(wt, abs, line, col));
      d.event('editor.opened', { at: 'file' });
    },
    'docs:reveal': async (taskId, p) => {
      d.revealFile(await resolveInWorktree(worktree(taskId), p));
    },
    'docs:watch': async (taskId, on) => {
      if (!on) {
        d.watcher.stop(taskId);
        return { live: false };
      }
      return { live: d.watcher.start(taskId, worktree(taskId)) };
    },
    'links:open': async (url) => {
      if (!allowedLink(url)) throw new Error(`Opening ${url} is not allowed`);
      await d.openExternal(url);
    },
  };
}
```

Platform:
- `Platform.ts`:
  ```ts
  /** Open a file in the editor at a line (and column), in the worktree's window. */
  editorGotoCommand(worktree: string, file: string, line?: number, col?: number): Command;
  ```
- `darwin.ts`:
  ```ts
  editorGotoCommand: (wt, f, line, col) => ({ command: 'code', args: [wt, '-g', `${f}:${line ?? 1}:${col ?? 1}`] }),
  ```
- `windows.ts`:
  ```ts
  editorGotoCommand: (wt, f, line, col) => {
    if (!deps.which('code')) throw new Error('VS Code (code) is not on PATH');
    return ps(`& code ${psQuote(wt)} -g ${psQuote(`${f}:${line ?? 1}:${col ?? 1}`)}`);
  },
  ```

`handlers.ts`:
- Add to `Services`:
  ```ts
  /** Shows a file in Finder or Explorer (main uses shell.showItemInFolder). */
  revealFile?: (absPath: string) => void;
  docsWatcher?: DocsWatcher;
  ```
- In `createHandlers`:
  ```ts
  const docsWatcher = s.docsWatcher ?? new DocsWatcher((taskId, paths) => s.broadcast('docs:changed', { taskId, paths }));
  ```
- Spread into the returned object:
  ```ts
  ...createDocsHandlers({
    taskById,
    git: s.git,
    editorGoto: (wt, f, l, c) => s.platform.editorGotoCommand(wt, f, l, c),
    launch: s.launch,
    openExternal: s.openExternal,
    revealFile: s.revealFile ?? (() => undefined),
    watcher: docsWatcher,
    event: (n, p) => tel.event(n, p),
  }),
  ```
  Check `tel.event`'s signature and adapt the wrapper if the props type differs.
- Call `docsWatcher.stopTask(taskId);` immediately before each `s.terminals.killAllForTask(taskId)`, at both the cancel-setup and the finish site (around lines 670 and 792).
- Expose the watcher on the returned handlers for `main.ts` quit: export a `stopDocsWatchers` function, or let main.ts own the instance. Do it the second way: `main.ts` creates `const docsWatcher = new DocsWatcher((taskId, paths) => broadcast('docs:changed', { taskId, paths }))`, passes it as `docsWatcher`, and calls `docsWatcher.stopAll()` in the existing `before-quit` or `will-quit` handler. If none exists, add `app.on('will-quit', () => docsWatcher.stopAll())`.
- Also pass `revealFile: (p) => shell.showItemInFolder(p)`.

Add every other test platform object that implements `Platform` with `editorGotoCommand`. Find them with `grep -rn "editorCommand" src --include=*.ts`.

`fakeApi.ts` defaults:
```ts
'docs:list': () => ({ files: [] }),
'docs:watch': () => ({ live: true }),
'docs:resolve': () => null,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
npx oxfmt src && git add -A src
git commit -m "feat: docs IPC with worktree-scoped reads, a shared watcher and editor-at-line"
```

---

### Task 3: Renderer pure helpers and dependencies

**Files:**
- Modify: `package.json`, `package-lock.json` (npm install)
- Create:
  - `src/renderer/docs/quote.ts`, `quote.test.ts`
  - `src/renderer/docs/linkify.ts`, `linkify.test.ts`
  - `src/renderer/docs/rehypeLines.ts`, `rehypeLines.test.ts`
  - `src/renderer/docs/docsPrefs.ts`, `docsPrefs.test.ts`

**Interfaces:**
- Produces:
  - `MAX_QUOTE = 4000`
  - `buildQuote(path: string, start: number, end: number, text: string, opts?: { singleLine?: boolean }): string`
  - `type FoundLink = { start: number; end: number; text: string } & ({ kind: 'url'; url: string } | { kind: 'path'; path: string; line?: number; col?: number })`
  - `findLinks(text: string): FoundLink[]`
  - `resolveRelative(fromDoc: string, href: string): string | null`
  - `rehypeLines()`, a unified plugin that adds `dataLineStart` and `dataLineEnd` on block elements
  - `docsPrefs`:
    - `readDocState(taskId): { path: string | null; view: 'rendered' | 'source'; scroll: number }`
    - `writeDocState(taskId, state)`
    - `readListCollapsed(): boolean` / `writeListCollapsed(v: boolean)`
    - `readSendTarget(taskId): string | null` / `writeSendTarget(taskId, id: string)`

- [ ] **Step 1: Install the dependencies**

Run: `npm install react-markdown@^10 remark-gfm@^4 rehype-sanitize@^6 rehype-slug@^6 rehype-highlight@^7 unist-util-visit@^5 mermaid@^11`
Expected: they're added to `dependencies`. Their licenses are MIT or ISC; check with `npx license-checker --summary --production` if it's available, else read each package's `license` field.

- [ ] **Step 2: Write the failing tests**

```ts
// src/renderer/docs/quote.test.ts
import { describe, expect, it } from 'vitest';
import { buildQuote, MAX_QUOTE } from './quote';

describe('buildQuote', () => {
  it('quotes one line', () => {
    expect(buildQuote('docs/a.md', 4, 4, 'hello')).toBe('docs/a.md:4\n> hello\n\n');
  });
  it('quotes a range, keeps empty lines as ">", normalises CRLF', () => {
    expect(buildQuote('a.md', 2, 4, 'x\r\n\r\ny\r\n')).toBe('a.md:2-4\n> x\n>\n> y\n\n');
  });
  it('truncates at 4000 characters', () => {
    const q = buildQuote('a.md', 1, 900, 'y'.repeat(5000));
    expect(q.endsWith('\n> …(truncated)\n\n')).toBe(true);
    expect(q.length).toBeLessThan(MAX_QUOTE + 60);
  });
  it('builds one line without newlines for terminals without bracketed paste', () => {
    expect(buildQuote('a.md', 1, 2, 'x\ny', { singleLine: true })).toBe('a.md:1-2 "x y" ');
  });
});
```

```ts
// src/renderer/docs/linkify.test.ts
import { describe, expect, it } from 'vitest';
import { findLinks, resolveRelative } from './linkify';

const paths = (s: string) =>
  findLinks(s).map((l) => (l.kind === 'path' ? [l.path, l.line, l.col] : ['url', l.url]));

describe('findLinks', () => {
  it('finds Claude Code style paths with lines', () => {
    expect(paths('Updated src/main/x.ts:12:5 and docs/plan.md:40')).toEqual([
      ['src/main/x.ts', 12, 5],
      ['docs/plan.md', 40, undefined],
    ]);
  });
  it('finds tsc (line,col) and ./ paths', () => {
    expect(paths('src/a.ts(3,7): error TS2322')).toEqual([['src/a.ts', 3, 7]]);
    expect(paths('see ./docs/plan.md')).toEqual([['./docs/plan.md', undefined, undefined]]);
  });
  it('finds Windows drive paths', () => {
    expect(paths('at C:\\work\\repo\\src\\a.ts:3')).toEqual([['C:\\work\\repo\\src\\a.ts', 3, undefined]]);
  });
  it('finds vitest stack paths in parentheses', () => {
    expect(paths(' ❯ src/x.test.ts:10:3')).toEqual([['src/x.test.ts', 10, 3]]);
  });
  it('finds URLs and trims trailing punctuation unless brackets balance', () => {
    expect(paths('open http://localhost:5173/.')).toEqual([['url', 'http://localhost:5173/']]);
    expect(paths('(see https://x.dev/a)')).toEqual([['url', 'https://x.dev/a']]);
    expect(paths('https://en.wikipedia.org/wiki/A_(b)')).toEqual([['url', 'https://en.wikipedia.org/wiki/A_(b)']]);
  });
  it('does not link plain words with dots or paths inside URLs', () => {
    expect(paths('e.g. v1.0.1 is done.')).toEqual([]);
    expect(paths('https://x.dev/docs/a.md')).toEqual([['url', 'https://x.dev/docs/a.md']]);
  });
  it('links bare file names with a known extension', () => {
    expect(paths('edit README.md now')).toEqual([['README.md', undefined, undefined]]);
  });
  it('reports string offsets', () => {
    const [l] = findLinks('ab docs/a.md:3 cd');
    expect([l.start, l.end, l.text]).toEqual([3, 14, 'docs/a.md:3']);
  });
});

describe('resolveRelative', () => {
  it('resolves against the document folder', () => {
    expect(resolveRelative('docs/specs/a.md', '../plans/b.md')).toBe('docs/plans/b.md');
    expect(resolveRelative('docs/a.md', './img/x.png')).toBe('docs/img/x.png');
    expect(resolveRelative('README.md', 'docs/a.md#part')).toBe('docs/a.md');
    expect(resolveRelative('docs/a.md', '/README.md')).toBe('README.md');
  });
  it('returns null when it climbs out of the worktree', () => {
    expect(resolveRelative('a.md', '../../x.md')).toBeNull();
  });
  it('decodes percent-encoding', () => {
    expect(resolveRelative('a.md', 'my%20notes.md')).toBe('my notes.md');
  });
});
```

```ts
// src/renderer/docs/rehypeLines.test.ts
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { rehypeLines } from './rehypeLines';

describe('rehypeLines', () => {
  it('marks block elements with their source lines', () => {
    const md = '# Title\n\npara one\nstill one\n\n| a |\n|---|\n| b |\n';
    const { container } = render(
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeLines]}>{md}</Markdown>,
    );
    expect(container.querySelector('h1')?.dataset).toMatchObject({ lineStart: '1', lineEnd: '1' });
    expect(container.querySelector('p')?.dataset).toMatchObject({ lineStart: '3', lineEnd: '4' });
    expect(container.querySelector('tbody tr')?.dataset).toMatchObject({ lineStart: '8', lineEnd: '8' });
  });
});
```

Name this file `rehypeLines.test.tsx`, since it uses JSX.

```ts
// src/renderer/docs/docsPrefs.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { readDocState, readSendTarget, writeDocState, writeSendTarget } from './docsPrefs';

beforeEach(() => localStorage.clear());
describe('docsPrefs', () => {
  it('defaults and round-trips per task', () => {
    expect(readDocState('t')).toEqual({ path: null, view: 'rendered', scroll: 0 });
    writeDocState('t', { path: 'a.md', view: 'source', scroll: 120 });
    expect(readDocState('t')).toEqual({ path: 'a.md', view: 'source', scroll: 120 });
    expect(readDocState('other').path).toBeNull();
  });
  it('ignores garbage', () => {
    localStorage.setItem('miac.docs.t', '{nope');
    expect(readDocState('t').view).toBe('rendered');
  });
  it('remembers the send target', () => {
    writeSendTarget('t', 'term-1');
    expect(readSendTarget('t')).toBe('term-1');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/docs`
Expected: FAIL, because the modules are missing.

- [ ] **Step 4: Implement**

```ts
// src/renderer/docs/quote.ts
export const MAX_QUOTE = 4000;

/** A quote for an agent prompt: "path:N" or "path:N-M", then the text as "> " lines and an empty line. Never ends in Enter alone: the user finishes the prompt. */
export function buildQuote(
  path: string,
  start: number,
  end: number,
  text: string,
  opts: { singleLine?: boolean } = {},
): string {
  const loc = start === end ? `${path}:${start}` : `${path}:${start}-${end}`;
  const clean = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (opts.singleLine) {
    const flat = clean.replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE);
    return `${loc} "${flat}" `;
  }
  let body = clean
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n');
  if (body.length > MAX_QUOTE) body = `${body.slice(0, MAX_QUOTE)}\n> …(truncated)`;
  return `${loc}\n${body}\n\n`;
}
```

```ts
// src/renderer/docs/linkify.ts
export type FoundLink = { start: number; end: number; text: string } & (
  | { kind: 'url'; url: string }
  | { kind: 'path'; path: string; line?: number; col?: number }
);

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const PATH_RE =
  /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w@+~.-]+[\\/])*[\w@+~-][\w@+~.-]*\.([A-Za-z0-9]{1,10})(?::(\d+)(?::(\d+))?|\((\d+),(\d+)\))?/g;
const KNOWN_EXT = new Set(
  'md markdown ts tsx js jsx mjs cjs json jsonc yml yaml toml cs csproj sln fs vb py go rs java kt swift c h cpp hpp css scss less html htm xml svg txt sh ps1 psm1 bat cmd sql vue svelte lock env ini cfg conf gradle rb php'.split(' '),
);

function trimUrl(u: string): string {
  let s = u;
  for (;;) {
    const last = s.at(-1);
    if (last && '.,;:!?\'"'.includes(last)) s = s.slice(0, -1);
    else if (last === ')' && count(s, '(') < count(s, ')')) s = s.slice(0, -1);
    else if (last === ']' && count(s, '[') < count(s, ']')) s = s.slice(0, -1);
    else return s;
  }
}
const count = (s: string, c: string) => s.split(c).length - 1;

/** File paths (with an optional :line[:col] or (line,col)) and http(s) URLs in one line of terminal text. */
export function findLinks(text: string): FoundLink[] {
  const out: FoundLink[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    out.push({ kind: 'url', url, start: m.index, end: m.index + url.length, text: url });
  }
  const inUrl = (i: number) => out.some((l) => l.kind === 'url' && i >= l.start && i < l.end);
  for (const m of text.matchAll(PATH_RE)) {
    const start = m.index;
    if (inUrl(start)) continue;
    const before = text[start - 1];
    if (before && /[\w:/\\]/.test(before)) continue;
    const full = m[0];
    const suffixAt = full.search(/(:\d+(:\d+)?|\(\d+,\d+\))$/);
    const p = suffixAt >= 0 ? full.slice(0, suffixAt) : full;
    const hasSep = /[\\/]/.test(p);
    if (!hasSep && !KNOWN_EXT.has(m[1].toLowerCase())) continue;
    const line = Number(m[2] ?? m[4]) || undefined;
    const col = Number(m[3] ?? m[5]) || undefined;
    out.push({ kind: 'path', path: p, line, col, start, end: start + full.length, text: full });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** A link in a document, resolved against that document's folder to a worktree-relative "/" path; null when it leaves the worktree. */
export function resolveRelative(fromDoc: string, href: string): string | null {
  const bare = href.split('#')[0].split('?')[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    decoded = bare;
  }
  const parts = decoded.startsWith('/') ? [] : fromDoc.split('/').slice(0, -1);
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length ? parts.join('/') : null;
}
```

If the vitest stack-line test, or any other `findLinks` case, fails because of the regex, fix the regex. Don't weaken the test.

```ts
// src/renderer/docs/rehypeLines.ts
import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';

const BLOCKS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'pre', 'blockquote', 'table', 'hr',
]);

/** Copies each block element's Markdown source lines onto it as data-line-start / data-line-end (Send to and Source view use them). */
export function rehypeLines() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (!BLOCKS.has(node.tagName) || !node.position) return;
      node.properties.dataLineStart = node.position.start.line;
      node.properties.dataLineEnd = node.position.end.line;
    });
  };
}
```

`@types/hast` comes with react-markdown. If typecheck can't find `hast`, add `@types/hast` as a devDependency.

```ts
// src/renderer/docs/docsPrefs.ts
export type DocView = 'rendered' | 'source';
export type DocState = { path: string | null; view: DocView; scroll: number };
const DEFAULT: DocState = { path: null, view: 'rendered', scroll: 0 };
const local = (): Storage | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);

export function readDocState(taskId: string, storage = local()): DocState {
  try {
    const v = JSON.parse(storage?.getItem(`miac.docs.${taskId}`) ?? 'null') as Partial<DocState> | null;
    if (!v || typeof v !== 'object') return { ...DEFAULT };
    return {
      path: typeof v.path === 'string' ? v.path : null,
      view: v.view === 'source' ? 'source' : 'rendered',
      scroll: typeof v.scroll === 'number' && v.scroll >= 0 ? v.scroll : 0,
    };
  } catch {
    return { ...DEFAULT };
  }
}
export function writeDocState(taskId: string, state: DocState, storage = local()): void {
  try {
    storage?.setItem(`miac.docs.${taskId}`, JSON.stringify(state));
  } catch {
    /* best effort */
  }
}
export const readListCollapsed = (storage = local()): boolean => {
  try {
    return storage?.getItem('miac.docs.listCollapsed') === 'true';
  } catch {
    return false;
  }
};
export const writeListCollapsed = (v: boolean, storage = local()): void => {
  try {
    storage?.setItem('miac.docs.listCollapsed', String(v));
  } catch {
    /* best effort */
  }
};
export const readSendTarget = (taskId: string, storage = local()): string | null => {
  try {
    return storage?.getItem(`miac.docs.sendTo.${taskId}`) ?? null;
  } catch {
    return null;
  }
};
export const writeSendTarget = (taskId: string, id: string, storage = local()): void => {
  try {
    storage?.setItem(`miac.docs.sendTo.${taskId}`, id);
  } catch {
    /* best effort */
  }
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/docs && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx oxfmt src && git add package.json package-lock.json src/renderer/docs
git commit -m "feat: quote, link and source-line helpers for the Docs tab"
```

---

### Task 4: Markdown, Mermaid and Source views

**Files:**
- Create:
  - `src/renderer/components/docs/MarkdownView.tsx`, `MarkdownView.test.tsx`
  - `src/renderer/components/docs/MermaidBlock.tsx`
  - `src/renderer/components/docs/SourceView.tsx`, `SourceView.test.tsx`
  - `src/renderer/styles/docs.css`, imported where the other style files are imported (find it with `grep -rn "usage.css" src/renderer`)

**Interfaces:**
- Consumes: `rehypeLines`, `resolveRelative` (Task 3); `api()` from `src/renderer/api.ts`; channels `docs:asset` and `links:open`.
- Produces:
  - `MarkdownView({ taskId, path, text, onOpenDoc, onOpenFile }: { taskId: string; path: string; text: string; onOpenDoc(path: string, anchor?: string): void; onOpenFile(path: string): void })`
  - `SourceView({ text, highlightLine }: { text: string; highlightLine?: number | null })`. Each line is a `<div class="src-line" data-line="N">`.
  - `MermaidBlock({ code }: { code: string })`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/renderer/components/docs/MarkdownView.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { MarkdownView } from './MarkdownView';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, code: string) => {
      if (code.includes('bad')) throw new Error('Parse error on line 1');
      return { svg: '<svg data-testid="diagram"></svg>' };
    }),
  },
}));

const view = (text: string, over = {}) => {
  const onOpenDoc = vi.fn();
  const onOpenFile = vi.fn();
  const api = installFakeApi({ 'docs:asset': () => 'data:image/png;base64,AA==', 'links:open': () => undefined, ...over });
  render(<MarkdownView taskId="t" path="docs/a.md" text={text} onOpenDoc={onOpenDoc} onOpenFile={onOpenFile} />);
  return { onOpenDoc, onOpenFile, api };
};

describe('MarkdownView', () => {
  it('renders GFM tables and task lists', () => {
    view('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n');
    expect(screen.getByRole('table')).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    expect(boxes.every((b) => b.disabled)).toBe(true);
  });
  it('does not render raw HTML', () => {
    const { container } = render(<MarkdownView taskId="t" path="a.md" text={'<img src=x onerror=alert(1)><script>x</script>'} onOpenDoc={() => {}} onOpenFile={() => {}} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
  it('highlights code and copies it', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    view('```ts\nconst a = 1;\n```\n');
    expect(document.querySelector('code.hljs, code .hljs-keyword')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith('const a = 1;');
  });
  it('routes links: md in the viewer, other files to the editor, web to links:open', async () => {
    const { onOpenDoc, onOpenFile, api } = view('[p](../plans/b.md#x) [c](src/x.ts) [w](https://x.dev)');
    await userEvent.click(screen.getByText('p'));
    expect(onOpenDoc).toHaveBeenCalledWith('plans/b.md', 'x');
    await userEvent.click(screen.getByText('c'));
    expect(onOpenFile).toHaveBeenCalledWith('docs/src/x.ts');
    await userEvent.click(screen.getByText('w'));
    expect(api.calls.some((c) => c.channel === 'links:open' && c.args[0] === 'https://x.dev/')).toBe(true);
  });
  it('loads relative images through docs:asset and does not load remote ones', async () => {
    view('![local](img/a.png) ![remote](https://x.dev/a.png)');
    await waitFor(() => expect((screen.getByAltText('local') as HTMLImageElement).src).toMatch(/^data:image\/png/));
    expect(screen.queryByAltText('remote')).toBeNull();
    expect(screen.getByRole('link', { name: /remote/ })).toBeTruthy();
  });
  it('renders mermaid diagrams and shows the error and source for a bad one', async () => {
    view('```mermaid\ngraph TD; A-->B\n```\n\n```mermaid\nbad\n```\n');
    expect(await screen.findByTestId('diagram')).toBeTruthy();
    expect(await screen.findByText(/Parse error on line 1/)).toBeTruthy();
    expect(screen.getByText('bad')).toBeTruthy();
  });
  it('gives headings GitHub-style ids', () => {
    view('## Send to Claude\n');
    expect(document.getElementById('send-to-claude')).toBeTruthy();
  });
});
```

```tsx
// src/renderer/components/docs/SourceView.test.tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SourceView } from './SourceView';

describe('SourceView', () => {
  it('numbers lines, counting CRLF like LF', () => {
    const { container } = render(<SourceView text={'a\r\nb\r\nc'} />);
    const lines = container.querySelectorAll('.src-line');
    expect(lines).toHaveLength(3);
    expect(lines[1].getAttribute('data-line')).toBe('2');
    expect(lines[1].textContent).toContain('b');
  });
  it('highlights the given line', () => {
    const { container } = render(<SourceView text={'a\nb'} highlightLine={2} />);
    expect(container.querySelector('.src-line.is-hl')?.getAttribute('data-line')).toBe('2');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/components/docs`
Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

```tsx
// src/renderer/components/docs/MarkdownView.tsx
import { Copy16Regular } from '@fluentui/react-icons';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { api } from '../../api';
import { resolveRelative } from '../../docs/linkify';
import { rehypeLines } from '../../docs/rehypeLines';
import { MermaidBlock } from './MermaidBlock';

const schema = {
  ...defaultSchema,
  clobberPrefix: '',
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'dataLineStart', 'dataLineEnd'],
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./]],
  },
};
const isWeb = (href: string) => /^https?:\/\//i.test(href);

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node)
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  return '';
}

function LocalImage({ taskId, path, alt }: { taskId: string; path: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api().invoke('docs:asset', taskId, path).then((s) => live && setSrc(s), () => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [taskId, path]);
  return src ? <img src={src} alt={alt} /> : <span className="muted">{alt}</span>;
}

export function MarkdownView({
  taskId,
  path,
  text,
  onOpenDoc,
  onOpenFile,
}: {
  taskId: string;
  path: string;
  text: string;
  onOpenDoc(path: string, anchor?: string): void;
  onOpenFile(path: string): void;
}) {
  const components: Components = {
    a: ({ href = '', children, node: _n, ...rest }) => (
      <a
        {...rest}
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href.startsWith('#')) {
            document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
          } else if (isWeb(href)) {
            void api().invoke('links:open', new URL(href).toString());
          } else if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
            const target = resolveRelative(path, href);
            if (!target) return;
            const anchor = href.includes('#') ? href.split('#')[1] : undefined;
            if (/\.(md|markdown)$/i.test(target)) onOpenDoc(target, anchor);
            else onOpenFile(target);
          }
        }}
      >
        {children}
      </a>
    ),
    img: ({ src = '', alt = '' }) => {
      const s = String(src);
      if (isWeb(s) || /^[a-z][a-z0-9+.-]*:/i.test(s))
        return (
          <a href={s} onClick={(e) => { e.preventDefault(); if (isWeb(s)) void api().invoke('links:open', s); }}>
            {alt || s}
          </a>
        );
      const target = resolveRelative(path, s);
      return target ? <LocalImage taskId={taskId} path={target} alt={alt} /> : <span className="muted">{alt}</span>;
    },
    input: (props: ComponentProps<'input'>) => <input {...props} disabled />,
    pre: ({ children, node: _n, ...rest }) => {
      const child = Array.isArray(children) ? children[0] : children;
      const cls = (child as { props?: { className?: string } })?.props?.className ?? '';
      const code = textOf(child).replace(/\n$/, '');
      if (/\blanguage-mermaid\b/.test(cls)) return <MermaidBlock code={code} />;
      return (
        <div className="doc-code">
          <button
            type="button"
            className="btn btn-subtle btn-sm doc-copy"
            aria-label="Copy code"
            onClick={() => void navigator.clipboard?.writeText(code)}
          >
            <Copy16Regular />
          </button>
          <pre {...rest}>{children}</pre>
        </div>
      );
    },
  };
  return (
    <article className="doc-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeLines, [rehypeSanitize, schema], rehypeSlug, [rehypeHighlight, { detect: false, plainText: ['mermaid'] }]]}
        components={components}
      >
        {text}
      </Markdown>
    </article>
  );
}
```

The Mermaid block is detected on the `pre` element through the child `code`'s `language-mermaid` class. `plainText: ['mermaid']` keeps highlight.js from rewriting that block. If `data-line-*` doesn't survive sanitize in the Task 3 test setup, keep `rehypeLines` before `rehypeSanitize` and add both property-name spellings (`dataLineStart` and `data-line-start`) to the schema. The `rehypeLines` assertions in a MarkdownView test must still pass: add `it('keeps source line attributes through sanitize')`, checking `p[data-line-start]`.

```tsx
// src/renderer/components/docs/MermaidBlock.tsx
import { useEffect, useId, useRef, useState } from 'react';

let ready: Promise<typeof import('mermaid').default> | null = null;
const load = () =>
  (ready ??= import('mermaid').then((m) => {
    m.default.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
    return m.default;
  }));

/** A ```mermaid block as a diagram; on a parse error, its source and the message. Loaded on first use. */
export function MermaidBlock({ code }: { code: string }) {
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    load()
      .then((m) => m.render(id, code))
      .then(({ svg }) => {
        if (live && host.current) host.current.innerHTML = svg;
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [id, code]);
  if (error)
    return (
      <div className="doc-mermaid-error">
        <pre><code>{code}</code></pre>
        <p className="doc-error">{error}</p>
      </div>
    );
  return <div className="doc-mermaid" ref={host} />;
}
```

`innerHTML` is acceptable here because Mermaid's `strict` level sanitizes its own SVG output with DOMPurify. Note this in a one-line comment.

```tsx
// src/renderer/components/docs/SourceView.tsx
import { useEffect, useRef } from 'react';

export function SourceView({ text, highlightLine }: { text: string; highlightLine?: number | null }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!highlightLine) return;
    host.current?.querySelector(`[data-line="${highlightLine}"]`)?.scrollIntoView({ block: 'center' });
  }, [highlightLine]);
  return (
    <div className="doc-src mono" ref={host}>
      {lines.map((l, i) => (
        <div key={i} className={`src-line${highlightLine === i + 1 ? ' is-hl' : ''}`} data-line={i + 1}>
          <span className="src-no" aria-hidden="true">{i + 1}</span>
          <span className="src-text">{l || ' '}</span>
        </div>
      ))}
    </div>
  );
}
```

`scrollIntoView` doesn't exist in jsdom. Guard it with `?.` on the method as well: `el?.scrollIntoView?.(…)`.

`docs.css`: use the tokens from `src/renderer/styles/tokens.css` only.
- `.doc-md`: max-width 860px, margin 0 auto, padding 24px 32px, 14px body, line-height 1.6.
- Headings: semibold, 20/16/14 px.
- Tables: borders `--line`, header `--bg-card`.
- `code`: the code font with a `--bg-card` background.
- `.doc-code`: position relative; `.doc-copy` absolute in the top right.
- `.doc-src`: a grid of a 48px number gutter and the text, `white-space: pre`, `overflow: auto`. `.src-no` in `--muted`, right-aligned. `.is-hl` gets a `rgba(0,120,212,0.25)` background with a 2 s fade.
- `.doc-error`: color `--red`.
- Import highlight.js's `github-dark` theme in `docs.css` with `@import 'highlight.js/styles/github-dark.css';`. highlight.js is a dependency of rehype-highlight (through lowlight). If the import path doesn't resolve, add `highlight.js` as a direct dependency.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/components/docs && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx oxfmt src && git add -A src
git commit -m "feat: Markdown, Mermaid and source views for the Docs tab"
```

---

### Task 5: Docs tab, store wiring, shortcut

**Files:**
- Create: `src/renderer/components/docs/DocsTab.tsx`, `DocsTab.test.tsx`
- Modify:
  - `src/renderer/store.ts`: `DOCS_TAB`, `docTarget`, `openDoc`, `activeTab`
  - `src/renderer/store.test.tsx`
  - `src/renderer/hooks/useShortcuts.ts`, plus a test in the existing shortcut test file (find it with `grep -rln useShortcuts src/renderer`)
  - `src/renderer/components/TerminalTabs.tsx`: the pivot, watch, dot, panel
  - `src/renderer/screens/TaskScreen.test.tsx`: the pivot order and the dot
  - `src/renderer/styles/docs.css`

**Interfaces:**
- Consumes: Tasks 2 to 4 (channels, `MarkdownView`, `SourceView`, `docsPrefs`); `TaskView`; `useStore`; `Pivots` from `components/ui`; `track` from `renderer/telemetry`.
- Produces:
  - in `store.ts`:
    - `export const DOCS_TAB = 'docs'`
    - store field `docTarget: Record<string, { path: string; line?: number; nonce: number }>`
    - action `openDoc(taskId: string, path: string, line?: number): void`. It selects the task, goes to the task page, sets the tab to `DOCS_TAB` and sets `docTarget[taskId]` with a new nonce.
  - `DocsTab({ task }: { task: TaskView })`.
  - `DocsTab` renders `SendTo` (Task 6) inside the document container. Task 5 leaves a `{/* SendTo: Task 6 */}` slot, so `DocsTab` builds without it.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/renderer/components/docs/DocsTab.test.tsx
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskView } from '../../../shared/types';
import { useStore } from '../../store';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { DocsTab } from './DocsTab';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg/>' })) } }));

const task = { id: 't1', status: 'ready', terminals: [], worktreeMissing: false } as unknown as TaskView;
const files = [
  { path: '.miac/task.md', changed: null },
  { path: 'README.md', changed: null },
  { path: 'docs/plan.md', changed: 'new' as const },
];
let texts: Record<string, string>;
beforeEach(() => {
  localStorage.clear();
  texts = { '.miac/task.md': '# Task file', 'README.md': '# Readme', 'docs/plan.md': '# Plan\n\nline 3\n' };
  useStore.setState({ docTarget: {} });
});
const mount = (over = {}) => {
  const api = installFakeApi({
    'docs:list': () => ({ files }),
    'docs:read': (_t, p) => {
      if (!(p in texts)) throw new Error('Not found');
      return { text: texts[p], mtimeMs: 1 };
    },
    'docs:openInEditor': () => undefined,
    'docs:reveal': () => undefined,
    ...over,
  });
  render(<DocsTab task={task} />);
  return api;
};

describe('DocsTab', () => {
  it('opens the task file by default and lists files grouped with badges', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Task file' })).toBeTruthy();
    expect(screen.getByText('docs')).toBeTruthy();
    expect(screen.getByText('new')).toBeTruthy();
  });
  it('shows the empty state', async () => {
    mount({ 'docs:list': () => ({ files: [] }) });
    expect(await screen.findByText('No Markdown files in this worktree')).toBeTruthy();
  });
  it('filters the list', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Task file' });
    await userEvent.type(screen.getByPlaceholderText('Filter'), 'plan');
    expect(screen.queryByRole('button', { name: /README\.md/ })).toBeNull();
    expect(screen.getByRole('button', { name: /plan\.md/ })).toBeTruthy();
  });
  it('switches to Source and remembers file and view', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /plan\.md/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'Source' }));
    expect(document.querySelectorAll('.src-line')).toHaveLength(3);
    expect(JSON.parse(localStorage.getItem('miac.docs.t1') ?? '{}')).toMatchObject({ path: 'docs/plan.md', view: 'source' });
  });
  it('reloads on docs:changed and shows the deleted bar when the file goes', async () => {
    const api = mount();
    await screen.findByRole('heading', { name: 'Task file' });
    texts['.miac/task.md'] = '# Task file v2';
    act(() => api.emit('docs:changed', { taskId: 't1', paths: ['.miac/task.md'] }));
    expect(await screen.findByRole('heading', { name: 'Task file v2' })).toBeTruthy();
    delete texts['.miac/task.md'];
    act(() => api.emit('docs:changed', { taskId: 't1', paths: ['.miac/task.md'] }));
    expect(await screen.findByText('This file was deleted.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Task file v2' })).toBeTruthy();
  });
  it('shows the too-large state with Open in VS Code', async () => {
    mount({ 'docs:read': () => { throw new Error('Too large'); } });
    expect(await screen.findByText('This file is larger than 2 MB.')).toBeTruthy();
  });
  it('opens a target set by openDoc in Source view at its line', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Task file' });
    act(() => useStore.setState({ docTarget: { t1: { path: 'docs/plan.md', line: 3, nonce: 1 } } }));
    await waitFor(() => expect(document.querySelector('.src-line.is-hl')?.getAttribute('data-line')).toBe('3'));
  });
  it('opens VS Code at the highlighted line', async () => {
    const api = mount();
    act(() => useStore.setState({ docTarget: { t1: { path: 'docs/plan.md', line: 3, nonce: 1 } } }));
    await waitFor(() => document.querySelector('.src-line.is-hl'));
    await userEvent.click(screen.getByRole('button', { name: 'Open in VS Code' }));
    expect(api.calls.find((c) => c.channel === 'docs:openInEditor')?.args).toEqual(['t1', 'docs/plan.md', 3]);
  });
});
```

Store tests, added to `store.test.tsx`:

```ts
it('openDoc selects the task, opens the Docs tab and sets a fresh target', () => {
  useStore.setState({ tasks: [readyTask('t1')] });
  useStore.getState().openDoc('t1', 'a.md', 4);
  const s = useStore.getState();
  expect(s.selectedTaskId).toBe('t1');
  expect(s.screen.kind).toBe('task');
  expect(s.activeTab('t1')).toBe('docs');
  const first = s.docTarget.t1.nonce;
  s.openDoc('t1', 'a.md', 4);
  expect(useStore.getState().docTarget.t1.nonce).not.toBe(first);
});
```

Use the existing task factory in `store.test.tsx`, and adapt the name `readyTask` to it.

Shortcut test, next to the existing Mod+digit tests: Mod+Shift+D on a ready task page sets the tab to `docs`.

`TaskScreen.test.tsx`:
- Pivot order: `Usage`, `Docs`, then the terminal labels.
- A `docs:changed` for the task while a terminal tab is active shows the dot (`aria-label="Docs, changed"`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

`store.ts`:
```ts
export const DOCS_TAB = 'docs';
// in Store type:
docTarget: Record<string, { path: string; line?: number; nonce: number }>;
openDoc(taskId: string, path: string, line?: number): void;
// initial state:
docTarget: {},
// actions:
openDoc: (taskId, path, line) => {
  get().select(taskId);
  get().go({ kind: 'task' });
  set({
    tabByTask: { ...get().tabByTask, [taskId]: DOCS_TAB },
    docTarget: { ...get().docTarget, [taskId]: { path, line, nonce: Date.now() + Math.random() } },
  });
},
// activeTab: after the USAGE_TAB line
if (want === DOCS_TAB) return DOCS_TAB;
```

`useShortcuts.ts`: add a branch before the digit branch.
```ts
} else if (e.shiftKey && e.code === 'KeyD') {
  const task = tasks.find((t) => t.id === selectedTaskId);
  if (screen.kind !== 'task' || !task || task.status !== 'ready') return;
  setTab(task.id, DOCS_TAB);
}
```

`TerminalTabs.tsx`:
- Import `Document16Regular`, `DOCS_TAB` and `DocsTab`.
- Insert the pivot right after the Usage pivot. Show it only when `ready`:
  ```tsx
  {ready && (
    <button type="button" role="tab" aria-selected={active === DOCS_TAB}
      aria-label={docsUnseen ? 'Docs, changed' : 'Docs'} className="pivot"
      title={`Docs (${modKey}+Shift+D)`} onClick={() => setTab(task.id, DOCS_TAB)}>
      <Document16Regular aria-hidden="true" />
      Docs
      {docsUnseen && <span className="tab-new" aria-hidden="true" />}
    </button>
  )}
  ```
- State `docsUnseen`, set by a `docs:changed` listener for this task when `activeTab !== DOCS_TAB`, and cleared when `active === DOCS_TAB`, as Usage's `unseen` is.
- Watch effect:
  ```ts
  useEffect(() => {
    if (!visible || !ready || task.worktreeMissing) return;
    void api().invoke('docs:watch', task.id, true).catch(() => undefined);
    return () => void api().invoke('docs:watch', task.id, false).catch(() => undefined);
  }, [task.id, visible, ready, task.worktreeMissing]);
  ```
- In `.termhost`: `{visible && active === DOCS_TAB && <DocsTab task={task} />}`.

`DocsTab.tsx` behavior:
- **State:**
  - `files`, from `docs:list` on mount and on every `docs:changed` for the task;
  - `filter`;
  - `listCollapsed`, from `readListCollapsed`;
  - `doc: { path; text: string | null; error: 'too-large' | string | null; deleted: boolean }`;
  - `view`;
  - `highlight: number | null`;
  - `updatedChip`.
- **Initial file:** `readDocState(task.id).path` if it's in `files`, else `.miac/task.md`, then `README.md`, then `files[0]`.
- **Reading:**
  - `docs:read` with a 150 ms delayed spinner on the first load only. Reloads keep the old content until the new text arrives.
  - `Not found` after content was shown sets `deleted: true` and keeps the text. On the first load it shows the error with Retry.
  - `Too large` shows "This file is larger than 2 MB." with an "Open in VS Code" button.
- **`docs:changed` containing the open path:** re-read. If the scroll container's `scrollTop > 0`, show the "Updated" chip for 2 s.
- **`watch` returning `{ live: false }`:** this tab polls `docs:read` every 2000 ms and re-renders when `mtimeMs` changes. Write the call inside `DocsTab`: invoke `docs:watch(task.id, true)` once to learn `live`, and `docs:watch(task.id, false)` on unmount.
- **`docTarget[task.id]` changes (by nonce):** open that path. If it has a line, set the view to `source` and the highlight to that line, and clear the highlight after 2000 ms. Track `docs.opened` with `from: 'terminal'`.
- **Persistence:** `writeDocState(task.id, { path, view, scroll })` on file or view change, and on scroll, throttled to 300 ms. Restore the scroll after the first render of the remembered file.
- **Telemetry:** `track('docs.opened', { view, from: 'list' | 'link' | 'terminal' })`.
- **Layout:**
  ```
  <div class="docs">
    <aside class="docs-list" hidden={listCollapsed}> filter input (placeholder "Filter"), "Task" pinned entry, folder groups (folder name as muted subheader, root files under no header), each file a button with name and optional badge "new"/"modified" </aside>
    <section class="docs-doc">
      <div class="docs-bar"> collapse toggle (aria-label "Hide file list"/"Show file list"), breadcrumb of path, <Pivots label="View" items=[{key:'rendered',label:'Rendered'},{key:'source',label:'Source'}] />, "Open in VS Code" (subtle), Reveal label by platform </div>
      {deleted && <div class="notice warn">This file was deleted.</div>}
      <div class="docs-scroll" ref=scrollRef> MarkdownView | SourceView | states </div>
      {/* SendTo: Task 6 */}
    </section>
  </div>
  ```
- **The "Task" entry** shows the label "Task" for `.miac/task.md`. The heading test above finds the rendered `# Task file` heading.
- **Open in VS Code:** `docs:openInEditor(task.id, path, highlight ?? undefined)`. Omit the trailing argument when there's no line, so the test's `toEqual(['t1','docs/plan.md',3])` holds only when a line is set.
- **MarkdownView callbacks:**
  - `onOpenDoc(p, anchor)` opens `p` in rendered view, then scrolls to the anchor id after render, with `from: 'link'`;
  - `onOpenFile(p)` calls `docs:openInEditor(task.id, p)`.
- **Reveal:** label "Reveal in Finder" when `modKey === 'Cmd'`, else "Show in Explorer". It calls `docs:reveal`.

`docs.css` additions:
- `.docs`: a flex row filling `.termhost` (height 100%).
- `.docs-list`: 240px, `--bg-chrome`, border-right `--line`, overflow auto.
- `.docs-doc`: flex column.
- `.docs-bar`: 36px, border-bottom `--line`.
- `.docs-scroll`: flex 1, overflow auto, position relative.
- The badges reuse the status tint pattern: `--green` for new, `--warn` for modified, at 12% alpha.
- `.docs-updated`: an absolute chip in the top right.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx oxfmt src && git add -A src
git commit -m "feat: Docs tab with file list, rendered and source views, live reload"
```

---

### Task 6: Terminal registry and Send to

**Files:**
- Create:
  - `src/renderer/terminalRegistry.ts`, `terminalRegistry.test.ts`
  - `src/renderer/components/docs/SendTo.tsx`, `SendTo.test.tsx`
- Modify:
  - `src/renderer/components/TerminalView.tsx`: register and unregister
  - `src/renderer/components/docs/DocsTab.tsx`: render `SendTo`
  - `docs.css`

**Interfaces:**
- Consumes: `buildQuote` and `readSendTarget`/`writeSendTarget` (Task 3); `DocsTab` scroll container and open path (Task 5); `TaskView.terminals: TerminalDef[]` (`kind`, `label`, `id`); `terminals:isRunning`; `useStore.setTab`; `track`.
- Produces:
  - `registerTerminal(id: string, t: Pick<Terminal, 'paste' | 'focus' | 'modes'>): () => void`
  - `pasteInto(id: string, text: (bracketed: boolean) => string): boolean`. It returns false when no live terminal has the id, calls the builder with `t.modes.bracketedPasteMode`, then `paste`s the result.
  - `focusTerminal(id: string): void`
  - `SendTo({ task, container, path, view }: { task: TaskView; container: HTMLElement | null; path: string; view: 'rendered' | 'source' })`
  - pure `selectionLines(range: Range): { start: number; end: number } | null` (exported from `SendTo.tsx`). It reads `data-line` (source) or `data-line-start`/`data-line-end` (rendered) from the closest ancestors of the range's start and end containers.

- [ ] **Step 1: Write the failing tests**

```ts
// src/renderer/terminalRegistry.test.ts
import { describe, expect, it, vi } from 'vitest';
import { pasteInto, registerTerminal } from './terminalRegistry';

const fake = (bracketed: boolean) => ({ paste: vi.fn(), focus: vi.fn(), modes: { bracketedPasteMode: bracketed } }) as never;

describe('terminalRegistry', () => {
  it('pastes into a registered terminal with the bracketed flag, and not after unregister', () => {
    const t = fake(true);
    const off = registerTerminal('a', t);
    expect(pasteInto('a', (b) => (b ? 'multi\nline' : 'one'))).toBe(true);
    expect((t as { paste: ReturnType<typeof vi.fn> }).paste).toHaveBeenCalledWith('multi\nline');
    off();
    expect(pasteInto('a', () => 'x')).toBe(false);
  });
  it('builds a single line when bracketed paste is off', () => {
    const t = fake(false);
    registerTerminal('b', t);
    pasteInto('b', (b) => (b ? 'multi\nline' : 'one'));
    expect((t as { paste: ReturnType<typeof vi.fn> }).paste).toHaveBeenCalledWith('one');
  });
});
```

```tsx
// src/renderer/components/docs/SendTo.test.tsx
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskView } from '../../../shared/types';
import { useStore } from '../../store';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { registerTerminal } from '../../terminalRegistry';
import { SendTo } from './SendTo';

const task = {
  id: 't1', status: 'ready', worktreeMissing: false,
  terminals: [
    { id: 'sh', kind: 'shell', label: 'zsh' },
    { id: 'cl', kind: 'claude', label: 'Claude' },
    { id: 'oc', kind: 'run', label: 'opencode' },
  ],
} as unknown as TaskView;

function Doc() {
  return (
    <div data-testid="doc">
      <p data-line-start="3" data-line-end="4">first para</p>
      <p data-line-start="6" data-line-end="6">second para</p>
    </div>
  );
}
const select = (from: Node, to: Node) => {
  const r = document.createRange();
  r.setStart(from, 0);
  r.setEnd(to, (to.textContent ?? '').length);
  const s = window.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
};

let pastes: Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => {
  localStorage.clear();
  pastes = {};
  for (const id of ['sh', 'cl', 'oc']) {
    pastes[id] = vi.fn();
    registerTerminal(id, { paste: pastes[id], focus: vi.fn(), modes: { bracketedPasteMode: true } } as never);
  }
  useStore.setState({ tabByTask: {}, tasks: [task] });
});

const mount = (running: Record<string, boolean> = { sh: true, cl: true, oc: true }) => {
  const api = installFakeApi({ 'terminals:isRunning': (id) => running[id] ?? false });
  const { getByTestId } = render(<Doc />);
  const container = getByTestId('doc');
  render(<SendTo task={task} container={container} path="docs/plan.md" view="rendered" />);
  return { api, container };
};

describe('SendTo', () => {
  it('defaults to the first agent terminal and pastes the quote without Enter', async () => {
    const { container } = mount();
    const [p1, p2] = container.querySelectorAll('p');
    act(() => select(p1.firstChild!, p2.firstChild!));
    await userEvent.click(await screen.findByRole('button', { name: 'Send to Claude' }));
    expect(pastes.cl).toHaveBeenCalledWith('docs/plan.md:3-6\n> first para\n> second para\n\n');
    expect(pastes.cl.mock.calls[0][0].endsWith('\r')).toBe(false);
    expect(useStore.getState().activeTab('t1')).toBe('cl');
  });
  it('remembers the chosen target and disables exited terminals', async () => {
    const { container } = mount({ sh: true, cl: true, oc: false });
    act(() => select(container.querySelector('p')!.firstChild!, container.querySelector('p')!.firstChild!));
    await userEvent.click(await screen.findByRole('button', { name: 'Choose terminal' }));
    expect((await screen.findByRole('menuitem', { name: /opencode/ })).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(screen.getByRole('menuitem', { name: /zsh/ }));
    expect(pastes.sh).toHaveBeenCalled();
    expect(localStorage.getItem('miac.docs.sendTo.t1')).toBe('sh');
  });
  it('hides on Escape', async () => {
    const { container } = mount();
    act(() => select(container.querySelector('p')!.firstChild!, container.querySelector('p')!.firstChild!));
    await screen.findByRole('button', { name: 'Send to Claude' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Send to Claude' })).toBeNull());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/terminalRegistry.test.ts src/renderer/components/docs/SendTo.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/renderer/terminalRegistry.ts
import type { Terminal } from '@xterm/xterm';

type Live = Pick<Terminal, 'paste' | 'focus' | 'modes'>;
const live = new Map<string, Live>();

/** TerminalView registers its xterm while mounted, so Send to and links can reach it. */
export function registerTerminal(id: string, t: Live): () => void {
  live.set(id, t);
  return () => {
    if (live.get(id) === t) live.delete(id);
  };
}

/** Pastes as the user would (bracketed when the program asked for it); never sends Enter on its own. */
export function pasteInto(id: string, text: (bracketed: boolean) => string): boolean {
  const t = live.get(id);
  if (!t) return false;
  t.paste(text(Boolean(t.modes.bracketedPasteMode)));
  return true;
}

export function focusTerminal(id: string): void {
  live.get(id)?.focus();
}
```

In `TerminalView.tsx`, after `term.current = t;`, add `const unregister = registerTerminal(terminalId, t);`, and call `unregister()` in the cleanup.

Without bracketed paste, xterm's `paste` turns `\n` into `\r`, which would run each line. That's why the builder gets the flag: SendTo passes `(b) => buildQuote(path, s, e, text, { singleLine: !b })`.

`SendTo.tsx`:
- **Selection:** listen to `document` `selectionchange`. If the selection is non-empty and both ends are inside `container`, compute `selectionLines(range)` and the rect (`range.getBoundingClientRect()`, guarded for jsdom, where it can be zeros). Show the floating control at the end of the selection, positioned relative to `container`.
- **Control:** a primary small button "Send to <label>" plus a chevron button with `aria-label="Choose terminal"`.
- **Menu:** `role="menu"`, with one `role="menuitem"` per `task.terminals` entry, labeled `${label}`. When opening it, query `terminals:isRunning` for each; an exited one gets `aria-disabled="true"` and ignores clicks.
- **Default target:**
  1. `readSendTarget(task.id)` if it's still in `task.terminals`;
  2. else the first terminal with kind `claude` or `copilot`;
  3. else `task.terminals[0]`.
  With no terminals, render nothing.
- **Send:**
  1. `const text = selection.toString()`;
  2. `pasteInto(target, (b) => buildQuote(path, start, end, text, { singleLine: !b }))`;
  3. if that returns false, `notify('warn', 'That terminal is not open')`;
  4. else `writeSendTarget`, `useStore.getState().setTab(task.id, target)`, `focusTerminal(target)` in a `requestAnimationFrame`, `track('docs.sentTo', { kind })`, and clear the selection.
- **Hide:** on Escape (a keydown listener on document while shown) and on an empty selection.

`selectionLines`:
```ts
export function selectionLines(range: Range): { start: number; end: number } | null {
  const el = (n: Node) => (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement);
  const block = (n: Node) => el(n)?.closest('[data-line],[data-line-start]') as HTMLElement | null;
  const a = block(range.startContainer);
  const b = block(range.endContainer);
  if (!a || !b) return null;
  const s = (x: HTMLElement) => Number(x.dataset.line ?? x.dataset.lineStart);
  const e = (x: HTMLElement) => Number(x.dataset.line ?? x.dataset.lineEnd);
  const start = Math.min(s(a), s(b));
  const end = Math.max(e(a), e(b));
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}
```

In `DocsTab.tsx`, replace the slot with `<SendTo task={task} container={scrollRef.current} path={doc.path} view={view} />`, rendered when the text is loaded. Pass the element through a state set by a ref callback, so `SendTo` gets the element after mount.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx oxfmt src && git add -A src
git commit -m "feat: Send to pastes a quoted passage into any task terminal"
```

---

### Task 7: Clickable links in terminals

**Files:**
- Create: `src/renderer/terminalLinks.ts`, `terminalLinks.test.ts`
- Modify:
  - `src/renderer/components/TerminalView.tsx`: a `taskId` prop; register the provider after `t.open(el)`
  - `src/renderer/components/TerminalTabs.tsx`: pass `taskId={task.id}`
  - `TaskScreen.test.tsx`, if it asserts on TerminalView props

**Interfaces:**
- Consumes: `findLinks` (Task 3); `docs:resolve`, `docs:openInEditor`, `links:open` (Task 2); `useStore.openDoc` (Task 5); `track`.
- Produces:
  - `type BufferLike = { cols: number; getLine(y: number): { isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined }`. `y` is 0-based, like xterm's `buffer.active.getLine`.
  - `logicalLine(buf: BufferLike, y: number): { text: string; firstRow: number }`
  - `cellAt(cols: number, firstRow: number, index: number): { x: number; y: number }`. Coordinates are 1-based, as xterm's `ILink.range` expects.
  - `createLinkProvider(term: Terminal, taskId: string, deps?: { resolve?, open? }): ILinkProvider`

- [ ] **Step 1: Write the failing tests**

```ts
// src/renderer/terminalLinks.test.ts
import { describe, expect, it, vi } from 'vitest';
import { cellAt, createLinkProvider, logicalLine } from './terminalLinks';

const buffer = (rows: { text: string; wrapped: boolean }[], cols: number) => ({
  cols,
  getLine: (y: number) =>
    rows[y] && {
      isWrapped: rows[y].wrapped,
      translateToString: (trim?: boolean) => (trim ? rows[y].text.trimEnd() : rows[y].text.padEnd(cols)),
    },
});

describe('logicalLine', () => {
  it('joins wrapped rows from any row of the line', () => {
    const b = buffer([
      { text: 'see docs/pl', wrapped: false },
      { text: 'an.md:12 ok', wrapped: true },
      { text: 'next', wrapped: false },
    ], 11);
    expect(logicalLine(b, 1)).toEqual({ text: 'see docs/plan.md:12 ok', firstRow: 0 });
    expect(logicalLine(b, 2)).toEqual({ text: 'next', firstRow: 2 });
  });
  it('maps string indices back to 1-based cells', () => {
    expect(cellAt(11, 0, 4)).toEqual({ x: 5, y: 1 });
    expect(cellAt(11, 0, 12)).toEqual({ x: 2, y: 2 });
  });
});

describe('createLinkProvider', () => {
  it('offers validated path links and URLs, and routes activation', async () => {
    const b = buffer([{ text: 'x docs/a.md:3 y nope/z.ts http://localhost:3000', wrapped: false }], 80);
    const term = { cols: 80, buffer: { active: b } } as never;
    const resolve = vi.fn(async (_t: string, p: string) => (p === 'docs/a.md' ? { path: 'docs/a.md', kind: 'md' as const } : null));
    const open = vi.fn();
    const provider = createLinkProvider(term, 't1', { resolve, open });
    const links = await new Promise<{ text: string; activate(e: MouseEvent, t: string): void }[] | undefined>((r) => provider.provideLinks(1, r));
    expect(links?.map((l) => l.text)).toEqual(['docs/a.md:3', 'http://localhost:3000']);
    links![0].activate(new MouseEvent('click'), links![0].text);
    expect(open).toHaveBeenCalledWith({ type: 'md', path: 'docs/a.md', line: 3, col: undefined });
    links![1].activate(new MouseEvent('click'), links![1].text);
    expect(open).toHaveBeenCalledWith({ type: 'url', url: 'http://localhost:3000' });
  });
  it('caches resolution per line text', async () => {
    const b = buffer([{ text: 'docs/a.md', wrapped: false }], 80);
    const term = { cols: 80, buffer: { active: b } } as never;
    const resolve = vi.fn(async () => ({ path: 'docs/a.md', kind: 'md' as const }));
    const p = createLinkProvider(term, 't1', { resolve, open: vi.fn() });
    await new Promise((r) => p.provideLinks(1, r));
    await new Promise((r) => p.provideLinks(1, r));
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
```

Routing test in `TerminalView`: skip it. Instead, test the default `open` exported from `terminalLinks.ts` as `openLink(taskId, target)`:
- `md` calls `useStore.getState().openDoc(taskId, path, line)`;
- `file` invokes `docs:openInEditor(taskId, path, line, col)`;
- `url` invokes `links:open(url)`.
Each also tracks `terminal.linkOpened { type }`. Add these three cases to `terminalLinks.test.ts` with `installFakeApi`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/terminalLinks.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/renderer/terminalLinks.ts
import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { api } from './api';
import { findLinks } from './docs/linkify';
import { useStore } from './store';
import { track } from './telemetry';

export type BufferLike = {
  cols: number;
  getLine(y: number): { isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined;
};
export type LinkTarget =
  | { type: 'md' | 'file'; path: string; line?: number; col?: number }
  | { type: 'url'; url: string };
type Resolve = (taskId: string, path: string) => Promise<{ path: string; kind: 'md' | 'file' } | null>;

/** The whole logical line a row belongs to (xterm splits long lines into wrapped rows). */
export function logicalLine(buf: BufferLike, y: number): { text: string; firstRow: number } {
  let first = y;
  while (first > 0 && buf.getLine(first)?.isWrapped) first--;
  let text = '';
  let row = first;
  for (;;) {
    const line = buf.getLine(row);
    if (!line) break;
    const next = buf.getLine(row + 1);
    const continues = Boolean(next?.isWrapped);
    text += line.translateToString(!continues);
    if (!continues) break;
    row++;
  }
  return { text, firstRow: first };
}

/** One cell per character: wide characters before a link shift it; acceptable for paths and URLs, which are ASCII in practice. */
export const cellAt = (cols: number, firstRow: number, index: number) => ({
  x: (index % cols) + 1,
  y: firstRow + Math.floor(index / cols) + 1,
});

export function openLink(taskId: string, target: LinkTarget): void {
  track('terminal.linkOpened', { type: target.type });
  if (target.type === 'url') void api().invoke('links:open', target.url).catch(() => undefined);
  else if (target.type === 'md') useStore.getState().openDoc(taskId, target.path, target.line);
  else
    void api()
      .invoke('docs:openInEditor', taskId, target.path, ...(target.line ? [target.line, ...(target.col ? [target.col] : [])] : []))
      .catch((e: unknown) => useStore.getState().notify('error', e instanceof Error ? e.message : String(e)));
}

export function createLinkProvider(
  term: Pick<Terminal, 'cols'> & { buffer: { active: BufferLike } },
  taskId: string,
  deps: { resolve?: Resolve; open?: (t: LinkTarget) => void } = {},
): ILinkProvider {
  const resolve: Resolve = deps.resolve ?? ((t, p) => api().invoke('docs:resolve', t, p).catch(() => null));
  const open = deps.open ?? ((t: LinkTarget) => openLink(taskId, t));
  const cache = new Map<string, Promise<ILink[]>>();
  return {
    provideLinks(lineNumber, callback) {
      const { text, firstRow } = logicalLine(term.buffer.active, lineNumber - 1);
      let pending = cache.get(text);
      if (!pending) {
        pending = Promise.all(
          findLinks(text).map(async (l): Promise<ILink | null> => {
            const range = { start: cellAt(term.cols, firstRow, l.start), end: cellAt(term.cols, firstRow, l.end - 1) };
            if (l.kind === 'url')
              return { range, text: l.text, activate: () => open({ type: 'url', url: l.url }) };
            const r = await resolve(taskId, l.path);
            if (!r) return null;
            return { range, text: l.text, activate: () => open({ type: r.kind, path: r.path, line: l.line, col: l.col }) };
          }),
        ).then((ls) => ls.filter((x): x is ILink => x !== null));
        if (cache.size > 500) cache.clear();
        cache.set(text, pending);
      }
      void pending.then((links) => {
        const row = lineNumber;
        callback(links.filter((k) => k.range.start.y <= row && k.range.end.y >= row));
      });
    },
  };
}
```

Fix the test expectation if it differs: the provider returns only links that touch the requested row. The test uses one-row lines, so both links are returned.

Hover tooltip: in the returned link, add `hover: (e) => { (e.target as HTMLElement).title = label }` and `leave: (e) => { (e.target as HTMLElement).title = '' }`. The labels are "Open in Docs", "Open in VS Code" and "Open in browser".

`TerminalView.tsx`:
- Add a `taskId: string` prop.
- After `loadRenderer(t)`: `const links = t.registerLinkProvider(createLinkProvider(t, taskId));`
- Keep the disposable in the effect scope and dispose it in the cleanup.
- Add `taskId` to the effect deps (it never changes for a terminal).
- Some links run while another task is selected. `openDoc` handles that, because it selects the link's task.

`TerminalTabs.tsx`: `<TerminalView key={t.id} terminalId={t.id} taskId={task.id} active={…} />`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx oxfmt src && git add -A src
git commit -m "feat: clickable file and URL links in task terminals"
```

---

### Task 8: Docs, checklist, live check

**Files:**
- Modify: `docs/telemetry.md`, `docs/windows-checklist.md`, `CLAUDE.md` (the Status section), `README.md` (if it lists task tabs)

- [ ] **Step 1: Telemetry doc.** Add rows to the events table in `docs/telemetry.md`, in its existing format:
  - `docs.opened`: view (`rendered`, `source`); from (`list`, `link`, `terminal`)
  - `docs.sentTo`: terminal kind
  - `terminal.linkOpened`: type (`md`, `file`, `url`)
  - `editor.opened`: now also with `at: file` when opened from Docs or a link

  Confirm that the "never collected" paragraph already covers file contents and paths. It does.

- [ ] **Step 2: Windows checklist.** Append the next numbered item to `docs/windows-checklist.md`, in its style. The steps:
  1. Open a task and press Ctrl+Shift+D.
  2. Check that `.miac\task.md` renders.
  3. Ask Claude to write `docs\x.md` and check that the tab reloads.
  4. Click a printed `src\a.ts:3` link and check that VS Code opens at line 3.
  5. Select text and use Send to Claude, then Send to PowerShell. PowerShell 7 should get a multi-line paste; 5.1 without PSReadLine should get one line.
  6. Finish the task with the Docs tab open, and check that the worktree is removed with no "in use" error.

- [ ] **Step 3: CLAUDE.md status.** Add one sentence to Status in the existing style: "Docs tab, terminal links and Send to (spec `docs/superpowers/specs/2026-10-16-docs-viewer-design.md`) implemented 2026-10-16 on `feature/docs-viewer`: …". Summarize the behavior in at most three short clauses.

- [ ] **Step 4: Live check (Playwright `_electron`).**
  1. Build with `npm run package`.
  2. Seed a fixture: create `docs/fixture.md` in a task worktree, with a GFM table, a `ts` code block, a Mermaid `graph TD` block, a relative link and a task list.
  3. Drive the app as the earlier live checks did, with the scratchpad `pw` scripts. Screenshot:
     - the rendered fixture (table, highlighted code, a diagram drawn as SVG);
     - Source view after clicking `docs/fixture.md:5` printed in a shell (`echo docs/fixture.md:5`);
     - the Send to button over a selection, then the shell tab with the pasted quote;
     - a URL hover underline.
  4. Look at each screenshot. A blank or broken render is a failure: fix it and repeat.

- [ ] **Step 5: Full checks and commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add docs CLAUDE.md README.md
git commit -m "docs: Docs tab telemetry, Windows checklist item and status"
```
