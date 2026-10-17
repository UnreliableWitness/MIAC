# Changes review page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Changes pivot on the task page that shows everything a task changed since its base (committed or not, every repo of the task) in the Monaco diff editor, with viewed tracking, tracked review comments that can be sent to a Claude tab, and an Open in IDE choice (VS Code, Visual Studio).

**Architecture:** Main owns git and state: `src/main/review/` (git queries per scope, per-task `review/<taskId>.json`, re-anchoring, a git-dir watcher) and `src/main/editors/` (detection and launch of VS Code and Visual Studio, replacing the hardcoded `code`). The renderer gets a `ChangesTab` next to Docs and Usage that talks to main over typed `review:*` and `editor:*` IPC channels and lazy-loads Monaco from a local chunk.

**Tech Stack:** Electron, React 19, TypeScript, zustand, zod, Vitest + Testing Library, `monaco-editor` 0.57 (new), git CLI through `GitClient.run`.

**Spec:** `docs/superpowers/specs/2026-10-17-changes-review-design.md`

## Global Constraints

- Windows is the release target, macOS is the dev platform: every shell, path and spawn detail goes through `Platform` or the editor registry; paths from git are root-relative with `/`, convert with `path.join` before touching disk.
- The renderer never runs git or reads the disk; every path or ref it sends is validated in main (paths stay inside the worktree, commit refs match `/^[0-9a-f]{7,64}$/`).
- No CDN or network for Monaco: it is bundled, loaded lazily, and must work under the packaged CSP `default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; script-src 'self'`.
- Files over 2 MB (`MAX_CONTENT = 2 * 1024 * 1024`) and binary files are never sent to the renderer.
- Pastes into terminals never send Enter; control characters other than `\n` and `\t` are stripped (same rule as `src/renderer/docs/quote.ts`).
- Telemetry carries no paths, repo names or comment text; every new event is listed in `docs/telemetry.md`.
- UI copy: plain sentences, no exclamation marks, ADO look (Segoe UI, tokens from `src/renderer/styles/tokens.css`, Fluent icons from `@fluentui/react-icons`).
- Comments are made and shown in the **All changes** scope only (other scopes show a hint); their lines refer to the working-tree file (after side) or the base file (before side).
- Checks before every commit: `npm test`, `npm run typecheck`, `npm run lint:fix` then `npm run lint` (lint is oxlint plus `oxfmt --check`, so the code blocks in this plan get reformatted by `lint:fix`; run the relevant test file during TDD and the full set before each commit).

## Review Focus

1. **A file path with spaces, unicode or a leading dash** (`docs/My File.md`, `-x.ts`): diff, content and hashes must still work. Every git call puts paths after `--`, and `-z` output is parsed (Task 3 test "odd file names").
2. **A non-bracketed terminal** (a plain shell tab picked as the Send target): a multi-line paste would run each line. The prompt must be flattened to one line when bracketed paste is off (Task 11 test "flattens for a terminal without bracketed paste").
3. **The agent keeps writing while the page is open**: refreshes must not lose the open file, the scroll position or a half-typed comment draft (Task 10 test "keeps a draft across a refresh").
4. **A path or ref from the renderer that escapes the worktree** (`../../etc/passwd`, `HEAD; rm`): main must refuse (Task 5 tests "rejects a path outside the worktree" and "rejects a bad commit ref").
5. **A worktree with hundreds of changed files** (a lockfile regeneration or a mass rename): one git call per kind, hashes in chunks of 200 paths so Windows' command-line limit is not hit (Task 3 test "hashes many files in chunks").

---

## File Structure

**Shared**
- Create `src/shared/review.ts`: review types and zod schemas (scope, files, comments, state), `viewedKey`, generated-file globs.
- Create `src/shared/reviewAnchor.ts`: `captureAnchor` and `anchorComment` (re-locating a comment in new text).
- Create `src/shared/editors.ts`: editor ids, labels, prefs schema, `pickEditor`.
- Modify `src/shared/usage.ts`: `editor` prefs in `AppSettingsSchema` and `defaultSettings`.
- Modify `src/shared/types.ts`: `MiacConfig.reviewCollapse?`.
- Modify `src/shared/ipc.ts`: `review:*` and `editor:*` channels, `review:changed` event.

**Main**
- Modify `src/main/services/GitClient.ts`: `resolveBase` (extracted from `finishSummary`) and `gitDir`.
- Create `src/main/review/reviewGit.ts`: parsing and git queries per scope.
- Create `src/main/review/ReviewStore.ts`: per-task JSON state.
- Create `src/main/review/ReviewService.ts`: files, content, state with re-anchoring, comment operations, summary.
- Create `src/main/review/GitDirWatcher.ts`: watches a worktree's git dir for commits, resets and staging.
- Create `src/main/review/reviewHandlers.ts`: the `review:*` IPC handlers.
- Create `src/main/editors/editors.ts`: detection, solution scan, Visual Studio commands.
- Create `src/main/editors/EditorService.ts`: choice, launch, remembered solution, telemetry.
- Modify `src/main/services/MiacConfig.ts`: `review.collapse` in `.miac.yml`.
- Modify `src/main/docs/docsHandlers.ts`: open files through the editor service.
- Modify `src/main/ipc/handlers.ts`, `src/main.ts`: wiring.

**Renderer**
- Create `src/renderer/review/monacoSetup.ts`: Monaco import, worker, theme, language lookup (loaded lazily).
- Create `src/renderer/review/reviewPrompt.ts`: the text sent to the agent.
- Create `src/renderer/review/useReview.ts`: loads files and state, follows the watchers, polls when it cannot watch.
- Create `src/renderer/review/holdWatch.ts`: generalises `holdDocsWatch` for both watch channels.
- Create `src/renderer/components/review/ChangesTab.tsx`, `FileTree.tsx`, `ScopePicker.tsx`, `DiffView.tsx`, `CommentCard.tsx`, `CommentsList.tsx`, `SendComments.tsx`.
- Create `src/renderer/components/OpenInEditor.tsx`: the split button.
- Create `src/renderer/styles/review.css`.
- Modify `src/renderer/store.ts` (`CHANGES_TAB`, `openChanges`), `src/renderer/components/TerminalTabs.tsx` (pivot, badge, editor button), `src/renderer/screens/SettingsScreen.tsx` (editor choices), `src/renderer/screens/FinishScreen.tsx` (review line), `src/renderer/docs/quote.ts` (export `cleanPasteText`), `src/renderer/docs/holdDocsWatch.ts` (uses `holdWatch`).

**Docs**
- Modify `docs/telemetry.md`, `docs/windows-checklist.md`, `CLAUDE.md` (Status), the spec (implementation notes).

---
### Task 1: Shared review types, generated-file globs

**Files:**
- Create: `src/shared/review.ts`
- Test: `src/shared/review.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - `ReviewScope = { kind: 'all' } | { kind: 'uncommitted' } | { kind: 'commits'; workspaceId: string; from: string; to: string }` and `ReviewScopeSchema`
  - `ReviewFileStatus = 'A' | 'M' | 'D' | 'R'`
  - `ReviewFile = { path: string; oldPath?: string; status: ReviewFileStatus; added: number; removed: number; binary: boolean; hash: string }`
  - `ReviewFileRef = Pick<ReviewFile, 'path' | 'oldPath' | 'status' | 'binary'>` and `ReviewFileRefSchema`
  - `ReviewCommit = { sha: string; subject: string; author: string; date: string }`
  - `ReviewRepo = { workspaceId: string; name: string; base: string | null; commits: ReviewCommit[]; files: ReviewFile[]; collapse: string[]; error?: string }`
  - `ReviewFiles = { repos: ReviewRepo[] }`
  - `FileContent = { before: string | null; after: string | null; binary: boolean; tooLarge: boolean; beforeSize: number; afterSize: number }`
  - `ReviewSide = 'before' | 'after'`, `ReviewCommentStatus = 'open' | 'sent' | 'resolved' | 'outdated'`
  - `ReviewComment` (zod-inferred, fields below), `NewReviewComment = { workspaceId: string; path: string; side: ReviewSide; startLine: number; endLine: number; text: string }`
  - `ReviewState = { version: 1; viewed: Record<string, string>; comments: ReviewComment[] }`, `ReviewStateSchema`, `emptyReviewState()`
  - `ReviewSummary = { files: number; notViewed: number; unresolved: number }`
  - `viewedKey(workspaceId: string, path: string): string`
  - `DEFAULT_COLLAPSE: string[]`, `globToRegExp(glob: string): RegExp`, `isGenerated(path: string, extra?: string[]): boolean`
  - `DELETED_HASH = 'deleted'`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/review.test.ts
import { describe, expect, it } from 'vitest';
import {
  emptyReviewState,
  globToRegExp,
  isGenerated,
  ReviewScopeSchema,
  ReviewStateSchema,
  viewedKey,
} from './review';

describe('globToRegExp', () => {
  it('matches a bare name in any folder', () => {
    const re = globToRegExp('package-lock.json');
    expect(re.test('package-lock.json')).toBe(true);
    expect(re.test('apps/web/package-lock.json')).toBe(true);
    expect(re.test('package-lock.json.bak')).toBe(false);
  });
  it('anchors a pattern with a slash at the root', () => {
    const re = globToRegExp('dist/**');
    expect(re.test('dist/a.js')).toBe(true);
    expect(re.test('dist/x/y/a.js')).toBe(true);
    expect(re.test('src/dist/a.js')).toBe(false);
  });
  it('keeps * inside one folder and **/ across folders', () => {
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/x/a.ts')).toBe(false);
    expect(globToRegExp('src/**/gen.ts').test('src/gen.ts')).toBe(true);
    expect(globToRegExp('src/**/gen.ts').test('src/a/b/gen.ts')).toBe(true);
  });
  it('escapes regex characters', () => {
    expect(globToRegExp('a+b.(c).js').test('a+b.(c).js')).toBe(true);
    expect(globToRegExp('a+b.(c).js').test('aab.(c).js')).toBe(false);
  });
});

describe('isGenerated', () => {
  it('collapses lock files, minified files, maps and dist by default', () => {
    for (const p of [
      'package-lock.json',
      'web/yarn.lock',
      'pnpm-lock.yaml',
      'vendor/x.min.js',
      'out/app.js.map',
      'dist/index.js',
    ])
      expect(isGenerated(p)).toBe(true);
    expect(isGenerated('src/index.ts')).toBe(false);
  });
  it('adds the repo patterns', () => {
    expect(isGenerated('src/api/generated.ts', ['src/api/*.ts'])).toBe(true);
  });
});

describe('schemas', () => {
  it('accepts the three scopes and refuses a bad commit ref', () => {
    expect(ReviewScopeSchema.parse({ kind: 'all' })).toEqual({ kind: 'all' });
    expect(
      ReviewScopeSchema.safeParse({
        kind: 'commits',
        workspaceId: 'home',
        from: 'abc1234',
        to: 'abc1234',
      }).success,
    ).toBe(true);
    expect(
      ReviewScopeSchema.safeParse({
        kind: 'commits',
        workspaceId: 'home',
        from: 'HEAD; rm -rf /',
        to: 'abc1234',
      }).success,
    ).toBe(false);
  });
  it('fills defaults for an old or empty state', () => {
    expect(ReviewStateSchema.parse({ version: 1 })).toEqual(emptyReviewState());
  });
  it('keys viewed files by workspace and path', () => {
    expect(viewedKey('home', 'src/a.ts')).toBe('home:src/a.ts');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/review.test.ts`
Expected: FAIL, "Failed to resolve import ./review".

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/review.ts
import { z } from 'zod';

const sha = z.string().regex(/^[0-9a-f]{7,64}$/, 'a commit id');

export const ReviewScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('uncommitted') }),
  /** One commit (from === to) or a range, oldest first, in one repo of the task. */
  z.object({
    kind: z.literal('commits'),
    workspaceId: z.string().min(1),
    from: sha,
    to: sha,
  }),
]);
export type ReviewScope = z.infer<typeof ReviewScopeSchema>;

export type ReviewFileStatus = 'A' | 'M' | 'D' | 'R';
/** `hash` is the git blob id of the after side (DELETED_HASH for a deleted file); "viewed" is stored against it. */
export type ReviewFile = {
  path: string;
  oldPath?: string;
  status: ReviewFileStatus;
  added: number;
  removed: number;
  binary: boolean;
  hash: string;
};
export const DELETED_HASH = 'deleted';
/** What the renderer sends to name a file it wants to read; main validates the paths. */
export type ReviewFileRef = Pick<ReviewFile, 'path' | 'oldPath' | 'status' | 'binary'>;
export const ReviewFileRefSchema = z.object({
  path: z.string().min(1),
  oldPath: z.string().min(1).optional(),
  status: z.enum(['A', 'M', 'D', 'R']),
  binary: z.boolean(),
});
export type ReviewCommit = {
  sha: string;
  subject: string;
  author: string;
  date: string;
};
/** One repo of the task. `error` replaces the file list when git failed or the worktree is gone. */
export type ReviewRepo = {
  workspaceId: string;
  name: string;
  base: string | null;
  commits: ReviewCommit[];
  files: ReviewFile[];
  /** The repo's `review.collapse` globs from `.miac.yml`, added to DEFAULT_COLLAPSE. */
  collapse: string[];
  error?: string;
};
export type ReviewFiles = { repos: ReviewRepo[] };
/** Text is null for binary files and files over the size limit; sizes are in bytes. */
export type FileContent = {
  before: string | null;
  after: string | null;
  binary: boolean;
  tooLarge: boolean;
  beforeSize: number;
  afterSize: number;
};

export const ReviewSideSchema = z.enum(['before', 'after']);
export type ReviewSide = z.infer<typeof ReviewSideSchema>;
export const ReviewCommentStatusSchema = z.enum([
  'open',
  'sent',
  'resolved',
  'outdated',
]);
export type ReviewCommentStatus = z.infer<typeof ReviewCommentStatusSchema>;

/** Lines are 1-based and refer to the working-tree file (after) or the base file (before). */
export const ReviewCommentSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  path: z.string().min(1),
  side: ReviewSideSchema,
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  /** The commented lines when the comment was made, used to find them again. */
  snippet: z.string(),
  /** Up to 3 lines above and below the snippet, to choose between equal snippets. */
  contextBefore: z.string(),
  contextAfter: z.string(),
  text: z.string(),
  status: ReviewCommentStatusSchema,
  createdAt: z.string(),
  sentAt: z.string().nullable().default(null),
  resolvedAt: z.string().nullable().default(null),
});
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

export const NewReviewCommentSchema = z.object({
  workspaceId: z.string().min(1),
  path: z.string().min(1),
  side: ReviewSideSchema,
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  text: z.string().min(1).max(20000),
});
export type NewReviewComment = z.infer<typeof NewReviewCommentSchema>;

export const ReviewStateSchema = z.object({
  version: z.literal(1),
  /** viewedKey → the file's hash when it was marked viewed. */
  viewed: z.record(z.string(), z.string()).default({}),
  comments: z.array(ReviewCommentSchema).default([]),
});
export type ReviewState = z.infer<typeof ReviewStateSchema>;
export const emptyReviewState = (): ReviewState => ({
  version: 1,
  viewed: {},
  comments: [],
});

/** What Finish shows: files in All changes, those not viewed at their current content, comments open or sent. */
export type ReviewSummary = {
  files: number;
  notViewed: number;
  unresolved: number;
};

export const viewedKey = (workspaceId: string, path: string): string =>
  `${workspaceId}:${path}`;

/** Collapsed under "Generated" in every repo. */
export const DEFAULT_COLLAPSE = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '*.min.js',
  '*.map',
  'dist/**',
];

/**
 * A gitignore-like glob: `*` stays inside a folder, `**` crosses folders, `?` is one character. A pattern
 * without a slash matches the file name in any folder; with a slash it is anchored at the repo root.
 */
export function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/^\.?\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(g.includes('/') ? `^${re}$` : `(?:^|/)${re}$`);
}

export function isGenerated(path: string, extra: string[] = []): boolean {
  return [...DEFAULT_COLLAPSE, ...extra].some((g) =>
    globToRegExp(g).test(path),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/review.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/review.ts src/shared/review.test.ts
git commit -m "feat(review): shared review types and generated-file globs"
```

---

### Task 2: Comment anchoring

**Files:**
- Create: `src/shared/reviewAnchor.ts`
- Test: `src/shared/reviewAnchor.test.ts`

**Interfaces:**
- Consumes: `ReviewComment` from Task 1.
- Produces:
  - `captureAnchor(text: string, startLine: number, endLine: number): { snippet: string; contextBefore: string; contextAfter: string; startLine: number; endLine: number }` (lines clamped to the text)
  - `anchorComment(c: Pick<ReviewComment, 'startLine' | 'snippet' | 'contextBefore' | 'contextAfter'>, text: string): { startLine: number; endLine: number } | null`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/reviewAnchor.test.ts
import { describe, expect, it } from 'vitest';
import { anchorComment, captureAnchor } from './reviewAnchor';

const file = (lines: string[]) => `${lines.join('\n')}\n`;
const base = file(['a', 'b', 'c', 'target();', 'd', 'e', 'f']);

describe('captureAnchor', () => {
  it('takes the lines and up to 3 lines of context each side', () => {
    expect(captureAnchor(base, 4, 4)).toEqual({
      snippet: 'target();',
      contextBefore: 'a\nb\nc',
      contextAfter: 'd\ne\nf',
      startLine: 4,
      endLine: 4,
    });
  });
  it('clamps a range past the end', () => {
    expect(captureAnchor('x\ny', 2, 9)).toMatchObject({
      snippet: 'y',
      startLine: 2,
      endLine: 2,
    });
  });
});

describe('anchorComment', () => {
  const c = { startLine: 4, ...captureAnchor(base, 4, 4) };

  it('stays put when nothing changed', () => {
    expect(anchorComment(c, base)).toEqual({ startLine: 4, endLine: 4 });
  });
  it('follows lines inserted above', () => {
    const moved = file(['new1', 'new2', 'a', 'b', 'c', 'target();', 'd']);
    expect(anchorComment(c, moved)).toEqual({ startLine: 6, endLine: 6 });
  });
  it('is gone when the snippet changed', () => {
    const edited = file(['a', 'b', 'c', 'target(1);', 'd', 'e', 'f']);
    expect(anchorComment(c, edited)).toBeNull();
  });
  it('ignores trailing whitespace and CRLF', () => {
    const crlf = base.replace(/\n/g, '\r\n').replace('target();', 'target();  ');
    expect(anchorComment(c, crlf)).toEqual({ startLine: 4, endLine: 4 });
  });
  it('picks the copy with matching context among duplicates', () => {
    const dup = file([
      'x', 'y', 'z', 'target();', 'q',
      'a', 'b', 'c', 'target();', 'd', 'e', 'f',
    ]);
    expect(anchorComment(c, dup)).toEqual({ startLine: 9, endLine: 9 });
  });
  it('picks the nearest copy when context does not decide', () => {
    const plain = { startLine: 5, snippet: 'x', contextBefore: '', contextAfter: '' };
    expect(anchorComment(plain, file(['x', '1', '2', '3', '4', 'x']))).toEqual({
      startLine: 6,
      endLine: 6,
    });
  });
  it('handles a multi-line snippet', () => {
    const m = { startLine: 2, ...captureAnchor(base, 2, 3) };
    expect(anchorComment(m, file(['top', ...base.split('\n')]))).toEqual({
      startLine: 3,
      endLine: 4,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/reviewAnchor.test.ts`
Expected: FAIL, "Failed to resolve import ./reviewAnchor".

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/reviewAnchor.ts
import type { ReviewComment } from './review';

const CONTEXT = 3;
const toLines = (text: string): string[] =>
  text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd());
const fromLines = (lines: string[]): string => lines.join('\n');

/** The lines a new comment covers, with context, from the text it was made on. */
export function captureAnchor(
  text: string,
  startLine: number,
  endLine: number,
): {
  snippet: string;
  contextBefore: string;
  contextAfter: string;
  startLine: number;
  endLine: number;
} {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  const last = Math.max(1, lines.length);
  const s = Math.min(Math.max(1, startLine), last);
  const e = Math.min(Math.max(s, endLine), last);
  return {
    snippet: fromLines(lines.slice(s - 1, e)),
    contextBefore: fromLines(lines.slice(Math.max(0, s - 1 - CONTEXT), s - 1)),
    contextAfter: fromLines(lines.slice(e, e + CONTEXT)),
    startLine: s,
    endLine: e,
  };
}

/**
 * Finds a comment's lines again in new text: every place the snippet occurs exactly (ignoring trailing
 * whitespace and line endings), scored by matching context lines, ties broken by distance to the old line.
 * Null when the snippet is no longer there.
 */
export function anchorComment(
  c: Pick<ReviewComment, 'startLine' | 'snippet' | 'contextBefore' | 'contextAfter'>,
  text: string,
): { startLine: number; endLine: number } | null {
  const lines = toLines(text);
  const want = toLines(c.snippet);
  const before = c.contextBefore ? toLines(c.contextBefore) : [];
  const after = c.contextAfter ? toLines(c.contextAfter) : [];
  const n = want.length;
  let best: { start: number; score: number; dist: number } | null = null;
  for (let i = 0; i + n <= lines.length; i++) {
    let same = true;
    for (let k = 0; k < n && same; k++) same = lines[i + k] === want[k];
    if (!same) continue;
    let score = 0;
    for (let k = 1; k <= before.length; k++)
      if (lines[i - k] === before[before.length - k]) score++;
    for (let k = 0; k < after.length; k++)
      if (lines[i + n + k] === after[k]) score++;
    const dist = Math.abs(i + 1 - c.startLine);
    if (
      !best ||
      score > best.score ||
      (score === best.score && dist < best.dist)
    )
      best = { start: i, score, dist };
  }
  return best ? { startLine: best.start + 1, endLine: best.start + n } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/reviewAnchor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/reviewAnchor.ts src/shared/reviewAnchor.test.ts
git commit -m "feat(review): find review comments again after the code moves"
```

---
### Task 3: Git queries per scope

**Files:**
- Modify: `src/main/services/GitClient.ts` (add `resolveBase`, `gitDir`; `finishSummary` uses `resolveBase`)
- Create: `src/main/review/reviewGit.ts`
- Test: `src/main/review/reviewGit.test.ts`, `src/main/services/GitClient.test.ts` (one new test)

**Interfaces:**
- Consumes: `ReviewScope`, `ReviewFile`, `ReviewCommit`, `FileContent`, `DELETED_HASH` (Task 1); `GitClient.run(cwd, args)`; `resolveInWorktree(worktree, rel)` from `src/main/docs/worktreeFiles.ts`.
- Produces:
  - `GitClient.resolveBase(worktree: string, o: { baseRef: string; baseSha: string | null }): Promise<string | null>`
  - `GitClient.gitDir(worktree: string): Promise<string>` (absolute, native form)
  - `EMPTY_TREE`, `MAX_CONTENT`, `class NoBaseError extends Error`
  - `type DiffRange = { from: string; to: string | null }` (`to: null` is the working tree)
  - `rangeFor(git: GitClient, worktree: string, scope: ReviewScope, base: string | null): Promise<DiffRange>`
  - `listFiles(git: GitClient, worktree: string, range: DiffRange): Promise<ReviewFile[]>` (sorted by path)
  - `listCommits(git: GitClient, worktree: string, base: string | null): Promise<ReviewCommit[]>` (newest first, at most 200)
  - `readContent(git: GitClient, worktree: string, range: DiffRange, file: Pick<ReviewFile, 'path' | 'oldPath' | 'status' | 'binary'>): Promise<FileContent>`
  - `readSide(git: GitClient, worktree: string, ref: string | null, path: string): Promise<string | null>` (null when absent; `ref: null` reads the working tree)
  - `assertRelPath(p: string): void` (throws `Outside the worktree`)
  - `parseNameStatus(out: string)`, `parseNumstat(out: string)` (exported for tests)

- [ ] **Step 1: Write the failing GitClient test**

Add to `src/main/services/GitClient.test.ts` inside `describe('GitClient', ...)`:

```ts
  it('resolveBase prefers the recorded baseSha, else the merge base, else null', async () => {
    const repo = makeRepo();
    const first = git(repo, 'rev-parse', 'HEAD').trim();
    git(repo, 'checkout', '-q', '-b', 'task');
    commitFile(repo, 'a.txt', 'a\n');
    expect(
      await client.resolveBase(repo, { baseRef: 'main', baseSha: first }),
    ).toBe(first);
    expect(
      await client.resolveBase(repo, { baseRef: 'main', baseSha: 'f'.repeat(40) }),
    ).toBe(first);
    expect(
      await client.resolveBase(repo, { baseRef: 'nope', baseSha: null }),
    ).toBeNull();
  });

  it('gitDir is the worktree’s own git dir', async () => {
    const repo = makeRepo();
    const wt = path.join(path.dirname(repo), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'x', wt);
    const dir = await client.gitDir(wt);
    expect(dir).toBe(path.join(repo, '.git', 'worktrees', 'wt'));
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/services/GitClient.test.ts -t "resolveBase|gitDir"`
Expected: FAIL, "client.resolveBase is not a function".

- [ ] **Step 3: Implement `resolveBase` and `gitDir`, use it in `finishSummary`**

In `src/main/services/GitClient.ts`, add above `finishSummary`:

```ts
  /**
   * Where the task's branch left its base: the recorded `baseSha` when it is still a commit, else the merge
   * base with `baseRef` (tasks from before MIAC recorded it), else null.
   */
  async resolveBase(
    worktree: string,
    o: { baseRef: string; baseSha: string | null },
  ): Promise<string | null> {
    if (o.baseSha) {
      try {
        const sha = (
          await this.run(worktree, [
            'rev-parse',
            '--verify',
            '--quiet',
            `${o.baseSha}^{commit}`,
          ])
        ).trim();
        if (sha) return sha;
      } catch {
        /* fall through to the merge base */
      }
    }
    try {
      return (
        (await this.run(worktree, ['merge-base', o.baseRef, 'HEAD'])).trim() ||
        null
      );
    } catch {
      return null;
    }
  }

  /** The worktree's own git dir (`.git/worktrees/<name>` for a linked worktree), absolute. */
  async gitDir(worktree: string): Promise<string> {
    const out = await this.run(worktree, ['rev-parse', '--absolute-git-dir']);
    return nativePath(out.trim());
  }
```

In `finishSummary`, replace the two `try` blocks that compute `base` (from `let base: string | null = null;` down to the end of the merge-base `if (!base) { ... }`) with:

```ts
    const base = await this.resolveBase(worktree, o);
```

(`nativePath` is already imported in GitClient.ts; if not, add `import { nativePath } from '../paths';`.)

- [ ] **Step 4: Run the GitClient tests**

Run: `npx vitest run src/main/services/GitClient.test.ts`
Expected: PASS (the existing finishSummary tests prove the refactor kept behaviour).

- [ ] **Step 5: Write the failing reviewGit tests**

```ts
// src/main/review/reviewGit.test.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { DELETED_HASH } from '../../shared/review';
import { GitClient } from '../services/GitClient';
import {
  cleanupTempRepos,
  commitFile,
  git,
  makeRepo,
} from '../test-helpers/gitRepo';
import {
  assertRelPath,
  EMPTY_TREE,
  listCommits,
  listFiles,
  MAX_CONTENT,
  NoBaseError,
  parseNameStatus,
  parseNumstat,
  rangeFor,
  readContent,
  readSide,
} from './reviewGit';

const client = new GitClient();
afterAll(cleanupTempRepos);

/** A repo on branch `task` from `main`, with one commit, one staged, one unstaged and one untracked change. */
function taskRepo() {
  const repo = makeRepo();
  commitFile(repo, 'keep.ts', 'one\ntwo\nthree\n');
  commitFile(repo, 'old-name.ts', 'moved content\nline 2\nline 3\n');
  commitFile(repo, 'gone.ts', 'bye\n');
  const base = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', '-b', 'task');
  commitFile(repo, 'committed.ts', 'c1\nc2\n', 'add committed');
  git(repo, 'mv', 'old-name.ts', 'new-name.ts');
  git(repo, 'rm', '-q', 'gone.ts');
  git(repo, 'commit', '-q', '-m', 'rename and delete');
  writeFileSync(path.join(repo, 'keep.ts'), 'one\nTWO\nthree\n');
  writeFileSync(path.join(repo, 'staged.ts'), 's\n');
  git(repo, 'add', 'staged.ts');
  writeFileSync(path.join(repo, 'untracked.ts'), 'u1\nu2\nu3\n');
  return { repo, base };
}

describe('parsers', () => {
  it('reads -z name-status with renames', () => {
    expect(
      parseNameStatus('M\0a.ts\0R087\0old.ts\0new.ts\0A\0b c.ts\0'),
    ).toEqual([
      { status: 'M', path: 'a.ts' },
      { status: 'R', path: 'new.ts', oldPath: 'old.ts' },
      { status: 'A', path: 'b c.ts' },
    ]);
  });
  it('reads -z numstat with renames and binaries', () => {
    const m = parseNumstat('3\t1\ta.ts\0' + '2\t0\t\0old.ts\0new.ts\0' + '-\t-\tlogo.png\0');
    expect(m.get('a.ts')).toEqual({ added: 3, removed: 1, binary: false });
    expect(m.get('new.ts')).toEqual({ added: 2, removed: 0, binary: false });
    expect(m.get('logo.png')).toEqual({ added: 0, removed: 0, binary: true });
  });
});

describe('assertRelPath', () => {
  it('refuses absolute paths, parent folders and NUL', () => {
    for (const bad of ['/etc/passwd', '../x', 'a/../../x', 'a\0b', '', 'C:\\x'])
      expect(() => assertRelPath(bad)).toThrow('Outside the worktree');
    expect(() => assertRelPath('src/a b.ts')).not.toThrow();
  });
});

describe('listFiles', () => {
  it('All: committed, staged, unstaged and untracked together, sorted', async () => {
    const { repo, base } = taskRepo();
    const files = await listFiles(client, repo, await rangeFor(client, repo, { kind: 'all' }, base));
    expect(files.map((f) => [f.status, f.path, f.oldPath])).toEqual([
      ['A', 'committed.ts', undefined],
      ['D', 'gone.ts', undefined],
      ['M', 'keep.ts', undefined],
      ['R', 'new-name.ts', 'old-name.ts'],
      ['A', 'staged.ts', undefined],
      ['A', 'untracked.ts', undefined],
    ]);
    const keep = files.find((f) => f.path === 'keep.ts')!;
    expect([keep.added, keep.removed]).toEqual([1, 1]);
    const untracked = files.find((f) => f.path === 'untracked.ts')!;
    expect(untracked.added).toBe(3);
    expect(files.find((f) => f.path === 'gone.ts')!.hash).toBe(DELETED_HASH);
    expect(keep.hash).toBe(git(repo, 'hash-object', 'keep.ts').trim());
  });

  it('Uncommitted: only what is not in HEAD', async () => {
    const { repo, base } = taskRepo();
    const files = await listFiles(client, repo, await rangeFor(client, repo, { kind: 'uncommitted' }, base));
    expect(files.map((f) => f.path)).toEqual(['keep.ts', 'staged.ts', 'untracked.ts']);
  });

  it('Commit: one commit, hashes from the commit', async () => {
    const { repo, base } = taskRepo();
    const sha = git(repo, 'rev-list', '--reverse', `${base}..HEAD`).trim().split('\n')[0];
    const files = await listFiles(
      client,
      repo,
      await rangeFor(client, repo, { kind: 'commits', workspaceId: 'home', from: sha, to: sha }, base),
    );
    expect(files.map((f) => f.path)).toEqual(['committed.ts']);
    expect(files[0].hash).toBe(git(repo, 'rev-parse', `${sha}:committed.ts`).trim());
  });

  it('a root commit diffs against the empty tree', async () => {
    const repo = makeRepo();
    const root = git(repo, 'rev-list', '--max-parents=0', 'HEAD').trim();
    const range = await rangeFor(client, repo, { kind: 'commits', workspaceId: 'home', from: root, to: root }, null);
    expect(range.from).toBe(EMPTY_TREE);
    expect((await listFiles(client, repo, range)).map((f) => f.path)).toEqual(['README.md']);
  });

  it('All without a base throws NoBaseError', async () => {
    const repo = makeRepo();
    await expect(rangeFor(client, repo, { kind: 'all' }, null)).rejects.toBeInstanceOf(NoBaseError);
  });

  it('odd file names: spaces, unicode, a leading dash', async () => {
    const repo = makeRepo();
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    mkdirSync(path.join(repo, 'my docs'));
    writeFileSync(path.join(repo, 'my docs', 'ünï côde.md'), 'x\n');
    writeFileSync(path.join(repo, '-dash.ts'), 'y\n');
    commitFile(repo, 'README.md', '# changed\n');
    const files = await listFiles(client, repo, { from: base, to: null });
    expect(files.map((f) => f.path)).toEqual(['-dash.ts', 'README.md', 'my docs/ünï côde.md']);
    for (const f of files) expect(f.hash).toMatch(/^[0-9a-f]{40,64}$/);
  });

  it('hashes many files in chunks', async () => {
    const repo = makeRepo();
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    for (let i = 0; i < 450; i++) writeFileSync(path.join(repo, `f${i}.txt`), `${i}\n`);
    const spy = vi.spyOn(client, 'run');
    const files = await listFiles(client, repo, { from: base, to: null });
    expect(files).toHaveLength(450);
    const hashCalls = spy.mock.calls.filter(([, args]) => args.includes('hash-object'));
    expect(hashCalls).toHaveLength(3);
    spy.mockRestore();
  });

  it('marks a binary untracked file', async () => {
    const repo = makeRepo();
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    writeFileSync(path.join(repo, 'logo.bin'), Buffer.from([0, 1, 2, 0, 3]));
    const [f] = await listFiles(client, repo, { from: base, to: null });
    expect(f).toMatchObject({ path: 'logo.bin', binary: true, added: 0 });
  });
});

describe('listCommits', () => {
  it('lists the branch commits newest first, none without a base', async () => {
    const { repo, base } = taskRepo();
    const commits = await listCommits(client, repo, base);
    expect(commits.map((c) => c.subject)).toEqual(['rename and delete', 'add committed']);
    expect(commits[0].sha).toMatch(/^[0-9a-f]{40}$/);
    expect(commits[0].author).toBe('MIAC tests');
    expect(await listCommits(client, repo, null)).toEqual([]);
  });
});

describe('readContent', () => {
  it('reads base and working tree sides, renames from the old path', async () => {
    const { repo, base } = taskRepo();
    const range = { from: base, to: null };
    const files = await listFiles(client, repo, range);
    const keep = await readContent(client, repo, range, files.find((f) => f.path === 'keep.ts')!);
    expect(keep).toMatchObject({ before: 'one\ntwo\nthree\n', after: 'one\nTWO\nthree\n', binary: false, tooLarge: false });
    const renamed = await readContent(client, repo, range, files.find((f) => f.path === 'new-name.ts')!);
    expect(renamed.before).toBe('moved content\nline 2\nline 3\n');
    const gone = await readContent(client, repo, range, files.find((f) => f.path === 'gone.ts')!);
    expect(gone).toMatchObject({ before: 'bye\n', after: '' });
    const added = await readContent(client, repo, range, files.find((f) => f.path === 'untracked.ts')!);
    expect(added.before).toBe('');
  });

  it('sends no text for a file over the limit', async () => {
    const repo = makeRepo();
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    writeFileSync(path.join(repo, 'big.txt'), 'x'.repeat(MAX_CONTENT + 1));
    const range = { from: base, to: null };
    const [f] = await listFiles(client, repo, range);
    const c = await readContent(client, repo, range, f);
    expect(c).toMatchObject({ before: null, after: null, tooLarge: true, afterSize: MAX_CONTENT + 1 });
  });

  it('readSide reads a ref or the disk and is null when absent', async () => {
    const { repo, base } = taskRepo();
    expect(await readSide(client, repo, base, 'keep.ts')).toBe('one\ntwo\nthree\n');
    expect(await readSide(client, repo, null, 'keep.ts')).toBe('one\nTWO\nthree\n');
    expect(await readSide(client, repo, null, 'gone.ts')).toBeNull();
    expect(await readSide(client, repo, base, 'nope.ts')).toBeNull();
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/main/review/reviewGit.test.ts`
Expected: FAIL, "Failed to resolve import ./reviewGit".

- [ ] **Step 7: Write `reviewGit.ts`**

```ts
// src/main/review/reviewGit.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  DELETED_HASH,
  type FileContent,
  type ReviewCommit,
  type ReviewFile,
  type ReviewFileStatus,
  type ReviewScope,
} from '../../shared/review';
import { resolveInWorktree } from '../docs/worktreeFiles';
import type { GitClient } from '../services/GitClient';

/** Git's empty tree (SHA-1 repos): the "before" of a root commit. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
export const MAX_CONTENT = 2 * 1024 * 1024;
const MAX_COMMITS = 200;
/** Paths per git call, so Windows' 32k command line is never reached. */
const CHUNK = 200;
const BINARY_SNIFF = 8000;

export class NoBaseError extends Error {
  constructor() {
    super('No base for this task: only uncommitted changes can be shown');
  }
}

/** `to: null` is the working tree (staged and unstaged together). */
export type DiffRange = { from: string; to: string | null };

/** Root-relative, inside the worktree: no absolute paths, no `..`, no NUL. */
export function assertRelPath(p: string): void {
  if (
    !p ||
    p.includes('\0') ||
    path.isAbsolute(p) ||
    path.win32.isAbsolute(p) ||
    p.split(/[\\/]/).includes('..')
  )
    throw new Error('Outside the worktree');
}

const DIFF = ['--no-optional-locks', 'diff', '--no-color', '--no-ext-diff', '-z', '-M'];

export async function rangeFor(
  git: GitClient,
  worktree: string,
  scope: ReviewScope,
  base: string | null,
): Promise<DiffRange> {
  if (scope.kind === 'all') {
    if (!base) throw new NoBaseError();
    return { from: base, to: null };
  }
  if (scope.kind === 'uncommitted') return { from: 'HEAD', to: null };
  const parent = await git
    .run(worktree, ['rev-parse', '--verify', '--quiet', `${scope.from}^`])
    .then((s) => s.trim())
    .catch(() => '');
  return { from: parent || EMPTY_TREE, to: scope.to };
}

const STATUS: Record<string, ReviewFileStatus> = {
  A: 'A',
  C: 'A',
  M: 'M',
  T: 'M',
  U: 'M',
  D: 'D',
  R: 'R',
};

export function parseNameStatus(
  out: string,
): { status: ReviewFileStatus; path: string; oldPath?: string }[] {
  const t = out.split('\0');
  const rows: { status: ReviewFileStatus; path: string; oldPath?: string }[] = [];
  for (let i = 0; i < t.length; ) {
    const code = t[i++];
    if (!code) continue;
    const status = STATUS[code[0]] ?? 'M';
    if (code[0] === 'R' || code[0] === 'C') {
      const oldPath = t[i++];
      const p = t[i++];
      rows.push(code[0] === 'R' ? { status, path: p, oldPath } : { status, path: p });
    } else rows.push({ status, path: t[i++] });
  }
  return rows;
}

export function parseNumstat(
  out: string,
): Map<string, { added: number; removed: number; binary: boolean }> {
  const t = out.split('\0');
  const m = new Map<string, { added: number; removed: number; binary: boolean }>();
  for (let i = 0; i < t.length; i++) {
    const r = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(t[i]);
    if (!r) continue;
    let p = r[3];
    // A rename leaves the path empty and puts old and new in the next two fields.
    if (p === '') {
      i += 2;
      p = t[i];
    }
    const binary = r[1] === '-';
    m.set(p, {
      added: binary ? 0 : Number(r[1]),
      removed: binary ? 0 : Number(r[2]),
      binary,
    });
  }
  return m;
}

const chunks = <T>(xs: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
};

/** Line count and binary sniff of a new file that git does not track yet. */
async function untrackedStats(
  worktree: string,
  rel: string,
): Promise<{ added: number; binary: boolean }> {
  const abs = path.join(worktree, rel);
  const st = await fs.stat(abs);
  if (st.size > MAX_CONTENT) return { added: 0, binary: false };
  const buf = await fs.readFile(abs);
  if (buf.subarray(0, BINARY_SNIFF).includes(0)) return { added: 0, binary: true };
  const text = buf.toString('utf8');
  if (text === '') return { added: 0, binary: false };
  return { added: text.split('\n').length - (text.endsWith('\n') ? 1 : 0), binary: false };
}

async function hashes(
  git: GitClient,
  worktree: string,
  range: DiffRange,
  paths: string[],
): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const part of chunks(paths)) {
    if (range.to === null) {
      const out = await git.run(worktree, ['hash-object', '--', ...part]);
      out.trim().split('\n').forEach((h, i) => m.set(part[i], h.trim()));
    } else {
      const out = await git.run(worktree, ['ls-tree', '-r', '-z', range.to, '--', ...part]);
      for (const entry of out.split('\0')) {
        const tab = entry.indexOf('\t');
        if (tab < 0) continue;
        m.set(entry.slice(tab + 1), entry.slice(0, tab).split(' ')[2]);
      }
    }
  }
  return m;
}

export async function listFiles(
  git: GitClient,
  worktree: string,
  range: DiffRange,
): Promise<ReviewFile[]> {
  const refs = range.to === null ? [range.from] : [range.from, range.to];
  const [ns, num, others] = await Promise.all([
    git.run(worktree, [...DIFF, '--name-status', ...refs, '--']),
    git.run(worktree, [...DIFF, '--numstat', ...refs, '--']),
    range.to === null
      ? git.run(worktree, ['--no-optional-locks', 'ls-files', '-z', '--others', '--exclude-standard'])
      : Promise.resolve(''),
  ]);
  const stats = parseNumstat(num);
  const files: Omit<ReviewFile, 'hash'>[] = parseNameStatus(ns).map((r) => ({
    ...r,
    ...(stats.get(r.path) ?? { added: 0, removed: 0, binary: false }),
  }));
  for (const p of others.split('\0')) {
    // A nested repo shows as a folder with a trailing slash; it has no diff.
    if (!p || p.endsWith('/')) continue;
    const s = await untrackedStats(worktree, p).catch(() => null);
    if (s) files.push({ status: 'A', path: p, removed: 0, ...s });
  }
  const live = files.filter((f) => f.status !== 'D').map((f) => f.path);
  const h = await hashes(git, worktree, range, live);
  return files
    .map((f) => ({ ...f, hash: f.status === 'D' ? DELETED_HASH : (h.get(f.path) ?? '') }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function listCommits(
  git: GitClient,
  worktree: string,
  base: string | null,
): Promise<ReviewCommit[]> {
  if (!base) return [];
  const out = await git.run(worktree, [
    'log',
    '--no-color',
    '-z',
    `--max-count=${MAX_COMMITS}`,
    '--format=%H%x1f%s%x1f%an%x1f%aI',
    `${base}..HEAD`,
  ]);
  return out
    .split('\0')
    .filter((l) => l.trim())
    .map((l) => {
      const [sha, subject, author, date] = l.replace(/^\n/, '').split('\x1f');
      return { sha, subject: subject ?? '', author: author ?? '', date: date ?? '' };
    });
}

async function sizeAt(git: GitClient, worktree: string, ref: string | null, p: string): Promise<number | null> {
  if (ref === null) {
    try {
      return (await fs.stat(await resolveInWorktree(worktree, p))).size;
    } catch {
      return null;
    }
  }
  try {
    return Number((await git.run(worktree, ['cat-file', '-s', `${ref}:${p}`])).trim());
  } catch {
    return null;
  }
}

/** One side of a file: a ref's blob, or the working tree when `ref` is null. Null when it does not exist there. */
export async function readSide(
  git: GitClient,
  worktree: string,
  ref: string | null,
  p: string,
): Promise<string | null> {
  assertRelPath(p);
  if (ref === null) {
    try {
      return await fs.readFile(await resolveInWorktree(worktree, p), 'utf8');
    } catch {
      return null;
    }
  }
  try {
    return await git.run(worktree, ['cat-file', 'blob', `${ref}:${p}`]);
  } catch {
    return null;
  }
}

export async function readContent(
  git: GitClient,
  worktree: string,
  range: DiffRange,
  file: Pick<ReviewFile, 'path' | 'oldPath' | 'status' | 'binary'>,
): Promise<FileContent> {
  assertRelPath(file.path);
  if (file.oldPath) assertRelPath(file.oldPath);
  const beforePath = file.oldPath ?? file.path;
  const beforeSize = file.status === 'A' ? 0 : ((await sizeAt(git, worktree, range.from, beforePath)) ?? 0);
  const afterSize = file.status === 'D' ? 0 : ((await sizeAt(git, worktree, range.to, file.path)) ?? 0);
  const tooLarge = !file.binary && Math.max(beforeSize, afterSize) > MAX_CONTENT;
  if (file.binary || tooLarge)
    return { before: null, after: null, binary: file.binary, tooLarge, beforeSize, afterSize };
  const before = file.status === 'A' ? '' : ((await readSide(git, worktree, range.from, beforePath)) ?? '');
  const after = file.status === 'D' ? '' : ((await readSide(git, worktree, range.to, file.path)) ?? '');
  return { before, after, binary: false, tooLarge: false, beforeSize, afterSize };
}
```

Note: `GitClient.run` returns stdout as a UTF-8 string and has a 16 MB `maxBuffer`; that is enough because content over 2 MB is never read.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/main/review/reviewGit.test.ts`
Expected: PASS. If "hashes many files in chunks" counts more than 3 calls, check that `hash-object` is called once per chunk only (450 files → 200 + 200 + 50).

- [ ] **Step 9: Commit**

```bash
npm run typecheck && npm run lint:fix && npm run lint
git add src/main/services/GitClient.ts src/main/services/GitClient.test.ts src/main/review/reviewGit.ts src/main/review/reviewGit.test.ts
git commit -m "feat(review): git file lists, commits and contents per review scope"
```

---
### Task 4: Review state store and service

**Files:**
- Create: `src/main/review/ReviewStore.ts`, `src/main/review/ReviewService.ts`
- Create: `src/main/review/testTask.ts` (test fixture, used by Tasks 4 and 5)
- Test: `src/main/review/ReviewStore.test.ts`, `src/main/review/ReviewService.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `captureAnchor` / `anchorComment` (Task 2), `rangeFor`, `listFiles`, `listCommits`, `readContent`, `readSide`, `assertRelPath`, `NoBaseError` (Task 3), `GitClient.resolveBase`, `JsonFileStore` (`src/main/usage/JsonFileStore.ts`), `activeWorkspaces` (`src/shared/workspaces.ts`).
- Produces:
  - `class ReviewStore { constructor(dir: string, onRecovered?: (taskId: string) => void); get(taskId): Promise<ReviewState>; update(taskId, mutate: (s: ReviewState) => void): Promise<ReviewState> }`
  - `type ReviewServiceDeps = { git: GitClient; store: ReviewStore; repoName: (repoId: string) => string; collapseOf: (worktree: string) => Promise<string[]>; now?: () => Date; newId?: () => string }`
  - `class ReviewService` with:
    - `files(task: Task, scope: ReviewScope): Promise<ReviewFiles>`
    - `file(task: Task, workspaceId: string, file: ReviewFileRef, scope: ReviewScope): Promise<FileContent>`
    - `state(task: Task): Promise<ReviewState>` (re-anchors open, sent and outdated comments, saves only when something moved)
    - `setViewed(task: Task, key: string, hash: string | null): Promise<ReviewState>`
    - `addComment(task: Task, input: NewReviewComment): Promise<ReviewState>`
    - `updateComment(task: Task, id: string, patch: { text?: string; status?: 'open' | 'resolved' }): Promise<ReviewState>`
    - `deleteComment(task: Task, id: string): Promise<ReviewState>`
    - `markSent(task: Task, ids: string[]): Promise<ReviewState>`
    - `summary(task: Task): Promise<ReviewSummary>`
  - `testTask(over: Partial<Task>): Task` fixture

- [ ] **Step 1: Write the fixture**

```ts
// src/main/review/testTask.ts
import { type Task, TaskSchema } from '../../shared/types';

/** A ready task on `worktreePath` for review tests; fields override the defaults. */
export function testTask(over: Partial<Task> & { worktreePath: string }): Task {
  return TaskSchema.parse({
    id: 't1',
    repoId: 'r1',
    name: 'Task',
    workItem: null,
    slug: 'task',
    branch: 'task',
    baseRef: 'main',
    status: 'ready',
    setup: { copy: false, commands: [], startClaude: false, openShell: false },
    terminals: [],
    createdAt: '2026-10-17T08:00:00.000Z',
    finishedAt: null,
    ...over,
  });
}
```

- [ ] **Step 2: Write the failing store test**

```ts
// src/main/review/ReviewStore.test.ts
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { emptyReviewState } from '../../shared/review';
import { ReviewStore } from './ReviewStore';

const dir = () => mkdtempSync(path.join(os.tmpdir(), 'miac-review-'));

describe('ReviewStore', () => {
  it('starts empty and keeps updates across instances', async () => {
    const d = dir();
    const a = new ReviewStore(d);
    expect(await a.get('t1')).toEqual(emptyReviewState());
    await a.update('t1', (s) => {
      s.viewed['home:a.ts'] = 'abc';
    });
    expect((await new ReviewStore(d).get('t1')).viewed).toEqual({ 'home:a.ts': 'abc' });
  });

  it('starts empty when the file is unreadable, keeps it aside, and reports it', async () => {
    const d = dir();
    writeFileSync(path.join(d, 't1.json'), '{not json');
    const onRecovered = vi.fn();
    expect(await new ReviewStore(d, onRecovered).get('t1')).toEqual(emptyReviewState());
    expect(onRecovered).toHaveBeenCalledWith('t1');
    expect(readdirSync(d).some((f) => f.startsWith('t1.json.corrupt-'))).toBe(true);
  });

  it('refuses a task id that is not a plain name', async () => {
    await expect(new ReviewStore(dir()).get('../x')).rejects.toThrow('Bad task id');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/main/review/ReviewStore.test.ts`
Expected: FAIL, "Failed to resolve import ./ReviewStore".

- [ ] **Step 4: Write `ReviewStore.ts`**

```ts
// src/main/review/ReviewStore.ts
import path from 'node:path';
import {
  emptyReviewState,
  type ReviewState,
  ReviewStateSchema,
} from '../../shared/review';
import { JsonFileStore } from '../usage/JsonFileStore';

/** One `<taskId>.json` per task under `dir`, loaded on first use; writes are queued and atomic (JsonFileStore). */
export class ReviewStore {
  private readonly open = new Map<string, Promise<JsonFileStore<ReviewState>>>();

  constructor(
    private readonly dir: string,
    private readonly onRecovered: (taskId: string) => void = () => {},
  ) {}

  private store(taskId: string): Promise<JsonFileStore<ReviewState>> {
    if (!/^[\w-]+$/.test(taskId)) return Promise.reject(new Error('Bad task id'));
    let p = this.open.get(taskId);
    if (!p) {
      p = (async () => {
        const s = new JsonFileStore(
          path.join(this.dir, `${taskId}.json`),
          ReviewStateSchema,
          emptyReviewState,
        );
        if ((await s.load()).recovered) this.onRecovered(taskId);
        return s;
      })();
      // A failed load is retried on the next call.
      p.catch(() => this.open.delete(taskId));
      this.open.set(taskId, p);
    }
    return p;
  }

  async get(taskId: string): Promise<ReviewState> {
    return (await this.store(taskId)).value;
  }

  async update(taskId: string, mutate: (s: ReviewState) => void): Promise<ReviewState> {
    return (await this.store(taskId)).update((s) => {
      mutate(s);
    });
  }
}
```

- [ ] **Step 5: Run the store test**

Run: `npx vitest run src/main/review/ReviewStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing service test**

```ts
// src/main/review/ReviewService.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { viewedKey } from '../../shared/review';
import { GitClient } from '../services/GitClient';
import { cleanupTempRepos, commitFile, git, makeRepo } from '../test-helpers/gitRepo';
import { ReviewService } from './ReviewService';
import { ReviewStore } from './ReviewStore';
import { testTask } from './testTask';

afterAll(cleanupTempRepos);

function setup() {
  const repo = makeRepo();
  commitFile(repo, 'a.ts', 'l1\nl2\nl3\nl4\nl5\n');
  const baseSha = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', '-b', 'task');
  commitFile(repo, 'b.ts', 'b1\nb2\n');
  writeFileSync(path.join(repo, 'a.ts'), 'l1\nl2\nCHANGED\nl4\nl5\n');
  let n = 0;
  const service = new ReviewService({
    git: new GitClient(),
    store: new ReviewStore(mkdtempSync(path.join(os.tmpdir(), 'miac-rs-'))),
    repoName: () => 'web',
    collapseOf: async () => ['gen/**'],
    now: () => new Date('2026-10-17T10:00:00.000Z'),
    newId: () => `c${++n}`,
  });
  const task = testTask({ worktreePath: repo, baseSha });
  return { repo, task, service };
}

describe('ReviewService', () => {
  it('lists every repo with its base, commits, files and collapse globs', async () => {
    const { task, service } = setup();
    const r = await service.files(task, { kind: 'all' });
    expect(r.repos).toHaveLength(1);
    expect(r.repos[0]).toMatchObject({ workspaceId: 'home', name: 'web', collapse: ['gen/**'] });
    expect(r.repos[0].files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(r.repos[0].commits.map((c) => c.subject)).toEqual(['add b.ts']);
  });

  it('reports a missing worktree and no base per repo instead of failing', async () => {
    const { task, service, repo } = setup();
    const noBase = testTask({ worktreePath: repo, baseSha: null, baseRef: 'nope' });
    expect((await service.files(noBase, { kind: 'all' })).repos[0].error).toMatch(/No base/);
    rmSync(repo, { recursive: true, force: true });
    expect((await service.files(task, { kind: 'all' })).repos[0].error).toBe('The worktree is missing');
  });

  it('refuses a task that is not ready', async () => {
    const { repo, service } = setup();
    const done = testTask({ worktreePath: repo, status: 'done' });
    await expect(service.files(done, { kind: 'all' })).rejects.toThrow('not ready');
  });

  it('rejects a path outside the worktree', async () => {
    const { task, service } = setup();
    await expect(
      service.file(task, 'home', { path: '../../etc/passwd', status: 'M', binary: false }, { kind: 'all' }),
    ).rejects.toThrow('Outside the worktree');
  });

  it('adds a comment with its snippet and context from the working tree', async () => {
    const { task, service } = setup();
    const s = await service.addComment(task, {
      workspaceId: 'home', path: 'a.ts', side: 'after', startLine: 3, endLine: 3, text: 'Why?',
    });
    expect(s.comments[0]).toMatchObject({
      id: 'c1', status: 'open', snippet: 'CHANGED', contextBefore: 'l1\nl2', contextAfter: 'l4\nl5',
      createdAt: '2026-10-17T10:00:00.000Z',
    });
  });

  it('anchors a before-side comment on the base file', async () => {
    const { task, service } = setup();
    const s = await service.addComment(task, {
      workspaceId: 'home', path: 'a.ts', side: 'before', startLine: 3, endLine: 3, text: 'Removed?',
    });
    expect(s.comments[0].snippet).toBe('l3');
  });

  it('moves comments with the code, marks them outdated when it changes, and revives them', async () => {
    const { task, service, repo } = setup();
    await service.addComment(task, {
      workspaceId: 'home', path: 'a.ts', side: 'after', startLine: 3, endLine: 3, text: 'x',
    });
    writeFileSync(path.join(repo, 'a.ts'), 'new\nl1\nl2\nCHANGED\nl4\nl5\n');
    expect((await service.state(task)).comments[0]).toMatchObject({ startLine: 4, status: 'open' });
    writeFileSync(path.join(repo, 'a.ts'), 'l1\nl2\nFIXED\nl4\nl5\n');
    expect((await service.state(task)).comments[0].status).toBe('outdated');
    writeFileSync(path.join(repo, 'a.ts'), 'l1\nl2\nCHANGED\nl4\nl5\n');
    expect((await service.state(task)).comments[0]).toMatchObject({ status: 'open', startLine: 3 });
  });

  it('a sent comment that goes outdated comes back as sent', async () => {
    const { task, service, repo } = setup();
    await service.addComment(task, {
      workspaceId: 'home', path: 'a.ts', side: 'after', startLine: 3, endLine: 3, text: 'x',
    });
    await service.markSent(task, ['c1']);
    writeFileSync(path.join(repo, 'a.ts'), 'gone\n');
    expect((await service.state(task)).comments[0]).toMatchObject({ status: 'outdated', sentAt: '2026-10-17T10:00:00.000Z' });
    writeFileSync(path.join(repo, 'a.ts'), 'l1\nl2\nCHANGED\nl4\nl5\n');
    expect((await service.state(task)).comments[0].status).toBe('sent');
  });

  it('a comment on a repo that left the task goes outdated', async () => {
    const { task, service } = setup();
    await service.addComment(task, {
      workspaceId: 'home', path: 'a.ts', side: 'after', startLine: 3, endLine: 3, text: 'x',
    });
    const dropped = { ...task, homeDropped: true, extraWorkspaces: [] };
    expect((await service.state(dropped)).comments[0].status).toBe('outdated');
  });

  it('resolves, reopens, edits and deletes comments; markSent only touches open ones', async () => {
    const { task, service } = setup();
    for (const line of [1, 2])
      await service.addComment(task, {
        workspaceId: 'home', path: 'a.ts', side: 'after', startLine: line, endLine: line, text: 't',
      });
    await service.updateComment(task, 'c2', { status: 'resolved' });
    let s = await service.markSent(task, ['c1', 'c2']);
    expect(s.comments.map((c) => c.status)).toEqual(['sent', 'resolved']);
    s = await service.updateComment(task, 'c2', { status: 'open', text: 'edited' });
    expect(s.comments[1]).toMatchObject({ status: 'open', text: 'edited', resolvedAt: null });
    s = await service.deleteComment(task, 'c1');
    expect(s.comments.map((c) => c.id)).toEqual(['c2']);
  });

  it('summary counts files not viewed at their current content and unresolved comments', async () => {
    const { task, service, repo } = setup();
    const files = (await service.files(task, { kind: 'all' })).repos[0].files;
    const a = files.find((f) => f.path === 'a.ts')!;
    await service.setViewed(task, viewedKey('home', 'a.ts'), a.hash);
    await service.addComment(task, {
      workspaceId: 'home', path: 'a.ts', side: 'after', startLine: 3, endLine: 3, text: 'x',
    });
    expect(await service.summary(task)).toEqual({ files: 2, notViewed: 1, unresolved: 1 });
    writeFileSync(path.join(repo, 'a.ts'), 'l1\nl2\nCHANGED\nl4\nl5\nmore\n');
    expect((await service.summary(task)).notViewed).toBe(2);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run src/main/review/ReviewService.test.ts`
Expected: FAIL, "Failed to resolve import ./ReviewService".

- [ ] **Step 8: Write `ReviewService.ts`**

```ts
// src/main/review/ReviewService.ts
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  type FileContent,
  type NewReviewComment,
  type ReviewFileRef,
  type ReviewFiles,
  type ReviewRepo,
  type ReviewScope,
  type ReviewState,
  type ReviewSummary,
  viewedKey,
} from '../../shared/review';
import { anchorComment, captureAnchor } from '../../shared/reviewAnchor';
import type { Task } from '../../shared/types';
import { activeWorkspaces, type WorkspaceView } from '../../shared/workspaces';
import { GitError, type GitClient } from '../services/GitClient';
import type { ReviewStore } from './ReviewStore';
import {
  assertRelPath,
  listCommits,
  listFiles,
  rangeFor,
  readContent,
  readSide,
} from './reviewGit';

export type ReviewServiceDeps = {
  git: GitClient;
  store: ReviewStore;
  repoName: (repoId: string) => string;
  /** The repo's `review.collapse` globs, read from the worktree's `.miac.yml`. */
  collapseOf: (worktree: string) => Promise<string[]>;
  now?: () => Date;
  newId?: () => string;
};

const message = (e: unknown): string =>
  e instanceof GitError ? e.stderr : e instanceof Error ? e.message : String(e);

export class ReviewService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly d: ReviewServiceDeps) {
    this.now = d.now ?? (() => new Date());
    this.newId = d.newId ?? randomUUID;
  }

  private workspaces(task: Task): WorkspaceView[] {
    if (task.status !== 'ready')
      throw new Error(`The task is not ready (${task.status})`);
    return activeWorkspaces(task);
  }

  private workspace(task: Task, id: string): WorkspaceView {
    const ws = this.workspaces(task).find((w) => w.id === id);
    if (!ws) throw new Error(`Unknown workspace ${id}`);
    if (!existsSync(ws.worktreePath)) throw new Error('The worktree is missing');
    return ws;
  }

  private base(ws: WorkspaceView): Promise<string | null> {
    return this.d.git.resolveBase(ws.worktreePath, ws);
  }

  async files(task: Task, scope: ReviewScope): Promise<ReviewFiles> {
    const all = this.workspaces(task);
    const shown = scope.kind === 'commits' ? all.filter((w) => w.id === scope.workspaceId) : all;
    const repos = await Promise.all(
      shown.map(async (ws): Promise<ReviewRepo> => {
        const repo: ReviewRepo = {
          workspaceId: ws.id,
          name: this.d.repoName(ws.repoId),
          base: null,
          commits: [],
          files: [],
          collapse: [],
        };
        if (!existsSync(ws.worktreePath)) return { ...repo, error: 'The worktree is missing' };
        try {
          const wt = ws.worktreePath;
          const base = await this.base(ws);
          const [commits, collapse] = await Promise.all([
            listCommits(this.d.git, wt, base),
            this.d.collapseOf(wt).catch(() => []),
          ]);
          Object.assign(repo, { base, commits, collapse });
          repo.files = await listFiles(this.d.git, wt, await rangeFor(this.d.git, wt, scope, base));
          return repo;
        } catch (e) {
          return { ...repo, error: message(e) };
        }
      }),
    );
    return { repos };
  }

  async file(task: Task, workspaceId: string, file: ReviewFileRef, scope: ReviewScope): Promise<FileContent> {
    assertRelPath(file.path);
    if (file.oldPath) assertRelPath(file.oldPath);
    const ws = this.workspace(task, workspaceId);
    const range = await rangeFor(this.d.git, ws.worktreePath, scope, await this.base(ws));
    return readContent(this.d.git, ws.worktreePath, range, file);
  }

  /** The state with every unresolved comment located again in the current files; saved only when one moved. */
  async state(task: Task): Promise<ReviewState> {
    const cur = await this.d.store.get(task.id);
    const active = new Map(activeWorkspaces(task).map((w) => [w.id, w]));
    const texts = new Map<string, Promise<string | null>>();
    const textOf = (ws: WorkspaceView, side: 'before' | 'after', p: string) => {
      const key = `${ws.id}\0${side}\0${p}`;
      let t = texts.get(key);
      if (!t) {
        t = (async () => {
          if (!existsSync(ws.worktreePath)) return null;
          const ref = side === 'after' ? null : await this.base(ws);
          if (side === 'before' && !ref) return null;
          return readSide(this.d.git, ws.worktreePath, ref, p).catch(() => null);
        })();
        texts.set(key, t);
      }
      return t;
    };
    type Change = { at: { startLine: number; endLine: number } | null };
    const changes = new Map<string, Change>();
    for (const c of cur.comments) {
      if (c.status === 'resolved') continue;
      const ws = active.get(c.workspaceId);
      const text = ws ? await textOf(ws, c.side, c.path) : null;
      const at = text === null ? null : anchorComment(c, text);
      const revived = at && c.status === 'outdated';
      const moved = at && (at.startLine !== c.startLine || at.endLine !== c.endLine);
      if (!at ? c.status !== 'outdated' : revived || moved) changes.set(c.id, { at });
    }
    if (changes.size === 0) return cur;
    return this.d.store.update(task.id, (s) => {
      for (const c of s.comments) {
        const ch = changes.get(c.id);
        if (!ch) continue;
        if (!ch.at) c.status = 'outdated';
        else {
          c.startLine = ch.at.startLine;
          c.endLine = ch.at.endLine;
          if (c.status === 'outdated') c.status = c.sentAt ? 'sent' : 'open';
        }
      }
    });
  }

  setViewed(task: Task, key: string, hash: string | null): Promise<ReviewState> {
    if (key.length > 4096) throw new Error('Bad key');
    return this.d.store.update(task.id, (s) => {
      if (hash === null) delete s.viewed[key];
      else s.viewed[key] = hash;
    });
  }

  async addComment(task: Task, input: NewReviewComment): Promise<ReviewState> {
    assertRelPath(input.path);
    const ws = this.workspace(task, input.workspaceId);
    const ref = input.side === 'after' ? null : await this.base(ws);
    if (input.side === 'before' && !ref) throw new Error('No base for this task');
    const text = await readSide(this.d.git, ws.worktreePath, ref, input.path);
    if (text === null) throw new Error('The file is not there any more');
    const at = captureAnchor(text, input.startLine, input.endLine);
    return this.d.store.update(task.id, (s) => {
      s.comments.push({
        id: this.newId(),
        workspaceId: input.workspaceId,
        path: input.path,
        side: input.side,
        text: input.text,
        ...at,
        status: 'open',
        createdAt: this.now().toISOString(),
        sentAt: null,
        resolvedAt: null,
      });
    });
  }

  updateComment(
    task: Task,
    id: string,
    patch: { text?: string; status?: 'open' | 'resolved' },
  ): Promise<ReviewState> {
    return this.d.store.update(task.id, (s) => {
      const c = s.comments.find((x) => x.id === id);
      if (!c) throw new Error('That comment is gone');
      if (patch.text !== undefined) c.text = patch.text;
      if (patch.status === 'resolved') {
        c.status = 'resolved';
        c.resolvedAt = this.now().toISOString();
      } else if (patch.status === 'open') {
        c.status = 'open';
        c.resolvedAt = null;
      }
    });
  }

  deleteComment(task: Task, id: string): Promise<ReviewState> {
    return this.d.store.update(task.id, (s) => {
      s.comments = s.comments.filter((c) => c.id !== id);
    });
  }

  markSent(task: Task, ids: string[]): Promise<ReviewState> {
    const want = new Set(ids);
    const at = this.now().toISOString();
    return this.d.store.update(task.id, (s) => {
      for (const c of s.comments)
        if (want.has(c.id) && c.status === 'open') {
          c.status = 'sent';
          c.sentAt = at;
        }
    });
  }

  async summary(task: Task): Promise<ReviewSummary> {
    const [{ repos }, state] = await Promise.all([this.files(task, { kind: 'all' }), this.state(task)]);
    const files = repos.flatMap((r) => r.files.map((f) => ({ key: viewedKey(r.workspaceId, f.path), hash: f.hash })));
    return {
      files: files.length,
      notViewed: files.filter((f) => state.viewed[f.key] !== f.hash).length,
      unresolved: state.comments.filter((c) => c.status !== 'resolved').length,
    };
  }
}
```

- [ ] **Step 9: Run the service test**

Run: `npx vitest run src/main/review/ReviewService.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
npm run typecheck && npm run lint:fix && npm run lint
git add src/main/review/ReviewStore.ts src/main/review/ReviewStore.test.ts src/main/review/ReviewService.ts src/main/review/ReviewService.test.ts src/main/review/testTask.ts
git commit -m "feat(review): per-task review state with re-anchored comments"
```

---
### Task 5: Git-dir watcher, `review:*` IPC, `.miac.yml` `review.collapse`, wiring

**Files:**
- Create: `src/main/review/GitDirWatcher.ts`, `src/main/review/reviewHandlers.ts`
- Modify: `src/shared/ipc.ts`, `src/shared/types.ts` (`MiacConfig.reviewCollapse?`), `src/main/services/MiacConfig.ts`, `src/main/ipc/handlers.ts`, `src/main.ts`
- Test: `src/main/review/GitDirWatcher.test.ts`, `src/main/review/reviewHandlers.test.ts`, `src/main/services/MiacConfig.test.ts` (one new test)

**Interfaces:**
- Consumes: `ReviewService`, `ReviewStore` (Task 4); `DocsWatcher` (`src/main/docs/DocsWatcher.ts`: `start(target, dir): boolean`, `stop(target)`, `stopTask(taskId)`); `parseDocsTarget`, `workspaceById` (`src/shared/workspaces.ts`); `GitClient.gitDir` (Task 3).
- Produces:
  - `class GitDirWatcher { constructor(gitDir: (worktree: string) => Promise<string>, emit: (target: string) => void, debounceMs?: number); start(target: string, worktree: string): Promise<boolean>; stop(target: string): void; stopTarget(target: string): void; stopTask(taskId: string): void; stopAll(): void }`
  - IPC channels (renderer calls them through `api().invoke`):
    - `'review:files'(taskId, scope) → ReviewFiles`
    - `'review:file'(taskId, workspaceId, file: ReviewFileRef, scope) → FileContent`
    - `'review:state'(taskId) → ReviewState`
    - `'review:setViewed'(taskId, key, hash: string | null) → ReviewState`
    - `'review:addComment'(taskId, input: NewReviewComment) → ReviewState`
    - `'review:updateComment'(taskId, id, patch: { text?: string; status?: 'open' | 'resolved' }) → ReviewState`
    - `'review:deleteComment'(taskId, id) → ReviewState`
    - `'review:markSent'(taskId, ids: string[]) → ReviewState`
    - `'review:summary'(taskId) → ReviewSummary`
    - `'review:watch'(target: string, on: boolean) → { live: boolean }` (target is a docs target: the task id for the home repo, `<taskId>#<workspaceId>` for another)
  - Event `'review:changed': { taskId: string }` (a docs target), sent when a worktree's git dir changes (commit, amend, reset, staging). File edits arrive as the existing `'docs:changed'`.
  - `MiacConfig.reviewCollapse?: string[]` (only set when `.miac.yml` has `review:`)

- [ ] **Step 1: Write the failing GitDirWatcher test**

```ts
// src/main/review/GitDirWatcher.test.ts
import { afterAll, describe, expect, it, vi } from 'vitest';
import { GitClient } from '../services/GitClient';
import { cleanupTempRepos, commitFile, makeRepo } from '../test-helpers/gitRepo';
import { GitDirWatcher } from './GitDirWatcher';

afterAll(cleanupTempRepos);
const client = new GitClient();

describe('GitDirWatcher', () => {
  it('reports a commit once, debounced, and stops when the last holder leaves', async () => {
    const repo = makeRepo();
    const emit = vi.fn();
    const w = new GitDirWatcher((wt) => client.gitDir(wt), emit, 50);
    expect(await w.start('t1', repo)).toBe(true);
    expect(await w.start('t1', repo)).toBe(true);
    commitFile(repo, 'a.txt', 'a\n');
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('t1'), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 120));
    expect(emit).toHaveBeenCalledTimes(1);
    w.stop('t1');
    w.stop('t1');
    emit.mockClear();
    commitFile(repo, 'b.txt', 'b\n');
    await new Promise((r) => setTimeout(r, 300));
    expect(emit).not.toHaveBeenCalled();
  });

  it('is false for a folder that is not a git worktree', async () => {
    const w = new GitDirWatcher((wt) => client.gitDir(wt), () => undefined);
    expect(await w.start('t1', '/definitely/not/here')).toBe(false);
  });

  it('stopTask closes the task and its workspaces, stopTarget one target', async () => {
    const a = makeRepo('a');
    const emit = vi.fn();
    const w = new GitDirWatcher((wt) => client.gitDir(wt), emit, 20);
    await w.start('t1', a);
    await w.start('t1#ws2', a);
    await w.start('t2', a);
    w.stopTarget('t2');
    w.stopTask('t1');
    commitFile(a, 'x.txt', 'x\n');
    await new Promise((r) => setTimeout(r, 300));
    expect(emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/review/GitDirWatcher.test.ts`
Expected: FAIL, "Failed to resolve import ./GitDirWatcher".

- [ ] **Step 3: Write `GitDirWatcher.ts`**

```ts
// src/main/review/GitDirWatcher.ts
import { existsSync, type FSWatcher, watch } from 'node:fs';
import path from 'node:path';

/** Files in a worktree's git dir that change on commit, amend, reset, checkout and staging. */
const WATCHED = new Set(['HEAD', 'index', 'ORIG_HEAD']);

type Entry = { watchers: FSWatcher[]; count: number; timer: NodeJS.Timeout | null };

/**
 * Watches the git dir of a worktree (DocsWatcher ignores `.git`), reference-counted per target like
 * DocsWatcher, and reports changes debounced into one call per burst.
 */
export class GitDirWatcher {
  private readonly entries = new Map<string, Entry>();
  private readonly starting = new Map<string, Promise<boolean>>();

  constructor(
    private readonly gitDir: (worktree: string) => Promise<string>,
    private readonly emit: (target: string) => void,
    private readonly debounceMs = 300,
  ) {}

  async start(target: string, worktree: string): Promise<boolean> {
    const e = this.entries.get(target);
    if (e) {
      e.count++;
      return true;
    }
    const pending = this.starting.get(target);
    if (pending) {
      const ok = await pending;
      const now = this.entries.get(target);
      if (ok && now) now.count++;
      return ok && Boolean(now);
    }
    const p = this.open(target, worktree);
    this.starting.set(target, p);
    try {
      return await p;
    } finally {
      this.starting.delete(target);
    }
  }

  private async open(target: string, worktree: string): Promise<boolean> {
    let dir: string;
    try {
      dir = await this.gitDir(worktree);
    } catch {
      return false;
    }
    const entry: Entry = { watchers: [], count: 1, timer: null };
    const fire = () => {
      entry.timer ??= setTimeout(() => {
        entry.timer = null;
        this.emit(target);
      }, this.debounceMs);
    };
    const add = (folder: string, names: Set<string>) => {
      const w = watch(folder);
      w.on('change', (_ev, name) => {
        if (name && names.has(String(name))) fire();
      });
      w.on('error', () => this.close(target));
      entry.watchers.push(w);
    };
    try {
      add(dir, WATCHED);
      const logs = path.join(dir, 'logs');
      if (existsSync(logs)) add(logs, new Set(['HEAD']));
    } catch {
      for (const w of entry.watchers) w.close();
      return false;
    }
    this.entries.set(target, entry);
    return true;
  }

  stop(target: string): void {
    const e = this.entries.get(target);
    if (e && --e.count <= 0) this.close(target);
  }

  /** Closes one target whatever its count (its DocsWatcher stopped, so the holders fall back to polling). */
  stopTarget(target: string): void {
    this.close(target);
  }

  stopTask(taskId: string): void {
    const prefix = `${taskId}#`;
    for (const key of [...this.entries.keys()])
      if (key === taskId || key.startsWith(prefix)) this.close(key);
  }

  stopAll(): void {
    for (const key of [...this.entries.keys()]) this.close(key);
  }

  private close(target: string): void {
    const e = this.entries.get(target);
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    for (const w of e.watchers) w.close();
    this.entries.delete(target);
  }
}
```

- [ ] **Step 4: Run the watcher test**

Run: `npx vitest run src/main/review/GitDirWatcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `review.collapse` to `.miac.yml` (test first)**

Add to `src/main/services/MiacConfig.test.ts`:

```ts
  it('reads review.collapse globs', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.miac.yml'), 'review:\n  collapse: [src/gen/**, "*.snap"]\n');
    expect((await loadMiacConfig(r)).reviewCollapse).toEqual(['src/gen/**', '*.snap']);
  });
```

Run: `npx vitest run src/main/services/MiacConfig.test.ts -t "review.collapse"` → FAIL (`review` is an unknown key in the strict schema).

In `src/main/services/MiacConfig.ts`, add to `MiacYmlSchema`:

```ts
  review: z.strictObject({ collapse: listOrString.default([]) }).optional(),
```

and in the returned object after the `apm` line:

```ts
    ...(c.review ? { reviewCollapse: c.review.collapse } : {}),
```

In `src/shared/types.ts`, add to `MiacConfig`:

```ts
  /** Extra globs collapsed under "Generated" on the Changes page (`review.collapse`). */
  reviewCollapse?: string[];
```

Run: `npx vitest run src/main/services/MiacConfig.test.ts` → PASS.

- [ ] **Step 6: Add the IPC contract**

In `src/shared/ipc.ts`, import the review types:

```ts
import type {
  FileContent,
  NewReviewComment,
  ReviewFileRef,
  ReviewFiles,
  ReviewScope,
  ReviewState,
  ReviewSummary,
} from './review';
```

Add to `Channels` (after `'links:open'`):

```ts
  /** Everything the task changed in the scope, per repo; a repo that fails carries `error`. */
  'review:files': { args: [taskId: string, scope: ReviewScope]; result: ReviewFiles };
  'review:file': {
    args: [taskId: string, workspaceId: string, file: ReviewFileRef, scope: ReviewScope];
    result: FileContent;
  };
  /** Viewed files and comments, with comments located again in the current files. */
  'review:state': { args: [taskId: string]; result: ReviewState };
  'review:setViewed': {
    args: [taskId: string, key: string, hash: string | null];
    result: ReviewState;
  };
  'review:addComment': { args: [taskId: string, input: NewReviewComment]; result: ReviewState };
  'review:updateComment': {
    args: [taskId: string, id: string, patch: { text?: string; status?: 'open' | 'resolved' }];
    result: ReviewState;
  };
  'review:deleteComment': { args: [taskId: string, id: string]; result: ReviewState };
  'review:markSent': { args: [taskId: string, ids: string[]]; result: ReviewState };
  'review:summary': { args: [taskId: string]; result: ReviewSummary };
  /** Holds the file and git-dir watchers of one worktree (a docs target); `live` false means poll. */
  'review:watch': { args: [target: string, on: boolean]; result: { live: boolean } };
```

Add to `Events` (after `'docs:watchStopped'`):

```ts
  /** A worktree's git dir changed (commit, amend, reset, staging); `taskId` is a docs target. */
  'review:changed': { taskId: string };
```

- [ ] **Step 7: Write the failing handler test**

```ts
// src/main/review/reviewHandlers.test.ts
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { DocsWatcher } from '../docs/DocsWatcher';
import { GitClient } from '../services/GitClient';
import { cleanupTempRepos, commitFile, git, makeRepo } from '../test-helpers/gitRepo';
import { GitDirWatcher } from './GitDirWatcher';
import { createReviewHandlers } from './reviewHandlers';
import { ReviewService } from './ReviewService';
import { ReviewStore } from './ReviewStore';
import { testTask } from './testTask';

afterAll(cleanupTempRepos);

function setup() {
  const repo = makeRepo();
  const baseSha = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', '-b', 'task');
  commitFile(repo, 'a.ts', 'a\n');
  const task = testTask({ worktreePath: repo, baseSha });
  const gitClient = new GitClient();
  const changed = vi.fn();
  const docsWatcher = new DocsWatcher(() => undefined, 20);
  const gitDirWatcher = new GitDirWatcher((wt) => gitClient.gitDir(wt), changed, 20);
  const h = createReviewHandlers({
    taskById: () => task,
    review: new ReviewService({
      git: gitClient,
      store: new ReviewStore(mkdtempSync(path.join(os.tmpdir(), 'miac-rh-'))),
      repoName: () => 'web',
      collapseOf: async () => [],
    }),
    docsWatcher,
    gitDirWatcher,
  });
  return { repo, h, changed, docsWatcher, gitDirWatcher };
}

describe('review handlers', () => {
  it('lists files for a valid scope', async () => {
    const { h } = setup();
    const r = await h['review:files']('t1', { kind: 'all' });
    expect(r.repos[0].files.map((f) => f.path)).toEqual(['a.ts']);
  });

  it('rejects a bad commit ref', async () => {
    const { h } = setup();
    await expect(
      h['review:files']('t1', { kind: 'commits', workspaceId: 'home', from: 'HEAD; rm', to: 'abc1234' } as never),
    ).rejects.toThrow();
  });

  it('rejects a path outside the worktree', async () => {
    const { h } = setup();
    await expect(
      h['review:file']('t1', 'home', { path: '../x', status: 'M', binary: false }, { kind: 'all' }),
    ).rejects.toThrow('Outside the worktree');
  });

  it('validates comment input', async () => {
    const { h } = setup();
    await expect(
      h['review:addComment']('t1', { workspaceId: 'home', path: 'a.ts', side: 'after', startLine: 0, endLine: 1, text: 'x' }),
    ).rejects.toThrow();
    const s = await h['review:addComment']('t1', {
      workspaceId: 'home', path: 'a.ts', side: 'after', startLine: 1, endLine: 1, text: 'x',
    });
    expect(s.comments).toHaveLength(1);
  });

  it('watch holds both watchers and reports commits', async () => {
    const { h, repo, changed, gitDirWatcher } = setup();
    expect(await h['review:watch']('t1', true)).toEqual({ live: true });
    commitFile(repo, 'b.ts', 'b\n');
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith('t1'), { timeout: 3000 });
    expect(await h['review:watch']('t1', false)).toEqual({ live: false });
    const stop = vi.spyOn(gitDirWatcher, 'stop');
    await h['review:watch']('t1', false);
    expect(stop).toHaveBeenCalledWith('t1');
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npx vitest run src/main/review/reviewHandlers.test.ts`
Expected: FAIL, "Failed to resolve import ./reviewHandlers".

- [ ] **Step 9: Write `reviewHandlers.ts`**

```ts
// src/main/review/reviewHandlers.ts
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { Handlers } from '../../shared/ipc';
import {
  NewReviewCommentSchema,
  ReviewFileRefSchema,
  ReviewScopeSchema,
} from '../../shared/review';
import type { Task } from '../../shared/types';
import { parseDocsTarget, workspaceById } from '../../shared/workspaces';
import type { DocsWatcher } from '../docs/DocsWatcher';
import type { GitDirWatcher } from './GitDirWatcher';
import type { ReviewService } from './ReviewService';

type ReviewChannels =
  | 'review:files'
  | 'review:file'
  | 'review:state'
  | 'review:setViewed'
  | 'review:addComment'
  | 'review:updateComment'
  | 'review:deleteComment'
  | 'review:markSent'
  | 'review:summary'
  | 'review:watch';

export type ReviewHandlerDeps = {
  taskById: (id: string) => Task;
  review: ReviewService;
  docsWatcher: DocsWatcher;
  gitDirWatcher: GitDirWatcher;
};

const PatchSchema = z.object({
  text: z.string().min(1).max(20000).optional(),
  status: z.enum(['open', 'resolved']).optional(),
});
const Id = z.string().min(1).max(200);

export function createReviewHandlers(d: ReviewHandlerDeps): Pick<Handlers, ReviewChannels> {
  const task = (id: string) => d.taskById(Id.parse(id));
  return {
    'review:files': async (taskId, scope) => d.review.files(task(taskId), ReviewScopeSchema.parse(scope)),
    'review:file': async (taskId, workspaceId, file, scope) =>
      d.review.file(task(taskId), Id.parse(workspaceId), ReviewFileRefSchema.parse(file), ReviewScopeSchema.parse(scope)),
    'review:state': async (taskId) => d.review.state(task(taskId)),
    'review:setViewed': async (taskId, key, hash) =>
      d.review.setViewed(task(taskId), z.string().min(1).max(4096).parse(key), z.string().max(80).nullable().parse(hash)),
    'review:addComment': async (taskId, input) =>
      d.review.addComment(task(taskId), NewReviewCommentSchema.parse(input)),
    'review:updateComment': async (taskId, id, patch) =>
      d.review.updateComment(task(taskId), Id.parse(id), PatchSchema.parse(patch)),
    'review:deleteComment': async (taskId, id) => d.review.deleteComment(task(taskId), Id.parse(id)),
    'review:markSent': async (taskId, ids) => d.review.markSent(task(taskId), z.array(Id).max(500).parse(ids)),
    'review:summary': async (taskId) => d.review.summary(task(taskId)),
    'review:watch': async (target, on) => {
      if (!on) {
        d.docsWatcher.stop(target);
        d.gitDirWatcher.stop(target);
        return { live: false };
      }
      const { taskId, workspaceId } = parseDocsTarget(target);
      const t = task(taskId);
      if (t.status !== 'ready') throw new Error(`The task is not ready (${t.status})`);
      const ws = workspaceById(t, workspaceId);
      if (!existsSync(ws.worktreePath)) throw new Error('The worktree is missing');
      const files = d.docsWatcher.start(target, ws.worktreePath);
      const gitDir = await d.gitDirWatcher.start(target, ws.worktreePath);
      return { live: files && gitDir };
    },
  };
}
```

Check `NewReviewCommentSchema` refuses `startLine: 0`: it is `z.number().int().min(1)` in Task 1, so the "validates comment input" test passes.

- [ ] **Step 10: Run the handler tests**

Run: `npx vitest run src/main/review/`
Expected: PASS.

- [ ] **Step 11: Wire into `handlers.ts`**

In `src/main/ipc/handlers.ts`:

1. Imports:

```ts
import { GitDirWatcher } from '../review/GitDirWatcher';
import { createReviewHandlers } from '../review/reviewHandlers';
import { ReviewService } from '../review/ReviewService';
import { ReviewStore } from '../review/ReviewStore';
```

2. In `Services`, after `docsWatcher?: DocsWatcher;`:

```ts
  /** Watches worktrees' git dirs for the Changes page; owned by main so it stops on quit. */
  gitDirWatcher?: GitDirWatcher;
  /** Where `review/<taskId>.json` files live (main: `<userData>/review`); defaults to `<usageDir>/review`. */
  reviewDir?: string;
```

3. Replace the `const docsWatcher = s.docsWatcher ?? new DocsWatcher(...)` block with:

```ts
  const gitDirWatcher =
    s.gitDirWatcher ??
    new GitDirWatcher(
      (wt) => s.git.gitDir(wt),
      (target) => s.broadcast('review:changed', { taskId: target }),
    );
  const docsWatcher =
    s.docsWatcher ??
    new DocsWatcher(
      (taskId, paths) => s.broadcast('docs:changed', { taskId, paths }),
      undefined,
      (taskId) => {
        gitDirWatcher.stopTarget(taskId);
        s.broadcast('docs:watchStopped', { taskId });
      },
    );
  const review = new ReviewService({
    git: s.git,
    store: new ReviewStore(s.reviewDir ?? path.join(s.usageDir, 'review'), () =>
      s.broadcast('notice', {
        level: 'warn',
        message: 'The review notes of a task could not be read and were started again',
      }),
    ),
    repoName: (id) => s.repos.list().find((r) => r.id === id)?.name ?? id,
    collapseOf: async (wt) => (await s.loadConfig(wt)).reviewCollapse ?? [],
  });
```

4. Next to both existing `docsWatcher.stopTask(taskId);` calls (in `closeTaskTerminals` and `'tasks:cancelSetup'`), add `gitDirWatcher.stopTask(taskId);`.

5. In the returned object, after `...createDocsHandlers({...}),` add:

```ts
    ...createReviewHandlers({ taskById, review, docsWatcher, gitDirWatcher }),
```

- [ ] **Step 12: Wire into `main.ts`**

In `src/main.ts` (`GitClient` is already imported; `git` is only created later inside the ready handler, so the watcher builds its own client):

```ts
import { GitDirWatcher } from './main/review/GitDirWatcher';
```

Replace the module-level `const docsWatcher = new DocsWatcher(...)` with:

```ts
const gitDirWatcher = new GitDirWatcher(
  (wt) => new GitClient().gitDir(wt),
  (target) => broadcast('review:changed', { taskId: target }),
);
const docsWatcher = new DocsWatcher(
  (taskId, paths) => broadcast('docs:changed', { taskId, paths }),
  undefined,
  (taskId) => {
    gitDirWatcher.stopTarget(taskId);
    broadcast('docs:watchStopped', { taskId });
  },
);
```

Pass both into `createHandlers({...})` next to `docsWatcher,`:

```ts
      gitDirWatcher,
      reviewDir: path.join(userData, 'review'),
```

In `app.on('before-quit', ...)`, after `docsWatcher.stopAll();` add `gitDirWatcher.stopAll();`.

- [ ] **Step 13: Full checks and commit**

Run: `npm test && npm run typecheck && npm run lint:fix && npm run lint`
Expected: all PASS.

```bash
git add src/main/review src/shared/ipc.ts src/shared/types.ts src/main/services/MiacConfig.ts src/main/services/MiacConfig.test.ts src/main/ipc/handlers.ts src/main.ts
git commit -m "feat(review): review IPC, git-dir watcher and review.collapse"
```

---
### Task 6: Editor registry (VS Code, Visual Studio) and editor settings

**Files:**
- Create: `src/shared/editors.ts`, `src/main/editors/editors.ts`, `src/main/editors/EditorService.ts`
- Modify: `src/shared/usage.ts` (`editor` in `AppSettingsSchema`, `defaultSettings`)
- Test: `src/shared/editors.test.ts`, `src/main/editors/editors.test.ts`, `src/main/editors/EditorService.test.ts`

**Interfaces:**
- Consumes: `Command`, `Platform` (`src/main/platform/Platform.ts`: `editorCommand(path)`, `editorGotoCommand(worktree, file, line?, col?)`); `which` (`src/main/platform/which.ts`); `TelemetryProps`.
- Produces:
  - `EditorIdSchema`, `type EditorId = 'vscode' | 'visualstudio'`, `EDITOR_IDS`, `EDITOR_LABELS: Record<EditorId, string>`, `type EditorChoice = { id: EditorId; label: string }`
  - `EditorPrefsSchema`, `type EditorPrefs = { default: EditorId | null; repos: Record<string, { editor: EditorId | null; solution: string | null }> }`, `defaultEditorPrefs()`
  - `type EditorOptions = { editors: EditorChoice[]; chosen: EditorId | null; solutions: string[]; solution: string | null }`
  - `pickEditor(installed: EditorId[], prefs: { repo: EditorId | null; global: EditorId | null }, hints: { dotnet: boolean }): EditorId | null`
  - `AppSettings.editor: EditorPrefs`
  - `type Installed = Partial<Record<EditorId, string>>` (id → executable)
  - `detectEditors(d: DetectDeps): Promise<Installed>`, `systemDetectDeps(): DetectDeps`
  - `scanProject(worktree: string): Promise<{ solutions: string[]; dotnet: boolean }>`
  - `visualStudioFolder(exe: string, worktree: string, solution: string | null): Command`, `visualStudioFile(exe: string, file: string, line?: number): Command`
  - `class EditorService` with `choices(refresh?: boolean): Promise<EditorChoice[]>`, `options(repoId: string, worktree: string): Promise<EditorOptions>`, `openFolder(repoId: string, worktree: string, o?: { editorId?: EditorId; solution?: string }): Promise<void>`, `openFile(repoId: string, worktree: string, absFile: string, line?: number, col?: number, editorId?: EditorId): Promise<void>`

- [ ] **Step 1: Write the failing shared test**

```ts
// src/shared/editors.test.ts
import { describe, expect, it } from 'vitest';
import { pickEditor } from './editors';
import { AppSettingsSchema, defaultSettings } from './usage';

describe('pickEditor', () => {
  const both = ['vscode', 'visualstudio'] as const;
  it('takes the repo choice, then the global default, when installed', () => {
    expect(pickEditor([...both], { repo: 'visualstudio', global: 'vscode' }, { dotnet: false })).toBe('visualstudio');
    expect(pickEditor([...both], { repo: null, global: 'visualstudio' }, { dotnet: false })).toBe('visualstudio');
  });
  it('skips a choice that is not installed', () => {
    expect(pickEditor(['vscode'], { repo: 'visualstudio', global: null }, { dotnet: true })).toBe('vscode');
  });
  it('suggests Visual Studio for a .NET repo, else VS Code', () => {
    expect(pickEditor([...both], { repo: null, global: null }, { dotnet: true })).toBe('visualstudio');
    expect(pickEditor([...both], { repo: null, global: null }, { dotnet: false })).toBe('vscode');
  });
  it('is null when nothing is installed', () => {
    expect(pickEditor([], { repo: 'vscode', global: 'vscode' }, { dotnet: false })).toBeNull();
  });
});

describe('editor settings', () => {
  it('defaults for settings saved before editors existed', () => {
    const old: Record<string, unknown> = { ...defaultSettings() };
    delete old.editor;
    expect(AppSettingsSchema.parse(old).editor).toEqual({ default: null, repos: {} });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shared/editors.test.ts`
Expected: FAIL, "Failed to resolve import ./editors".

- [ ] **Step 3: Write `src/shared/editors.ts` and the settings field**

```ts
// src/shared/editors.ts
import { z } from 'zod';

export const EDITOR_IDS = ['vscode', 'visualstudio'] as const;
export const EditorIdSchema = z.enum(EDITOR_IDS);
export type EditorId = z.infer<typeof EditorIdSchema>;
export const EDITOR_LABELS: Record<EditorId, string> = {
  vscode: 'VS Code',
  visualstudio: 'Visual Studio',
};
export type EditorChoice = { id: EditorId; label: string };

/** Personal editor choices (settings.json, never `.miac.yml`): a default and one per repo, with Visual Studio's solution. */
export const EditorPrefsSchema = z.object({
  default: EditorIdSchema.nullable().default(null),
  repos: z
    .record(
      z.string(),
      z.object({
        editor: EditorIdSchema.nullable().default(null),
        solution: z.string().nullable().default(null),
      }),
    )
    .default({}),
});
export type EditorPrefs = z.infer<typeof EditorPrefsSchema>;
export const defaultEditorPrefs = (): EditorPrefs => ({ default: null, repos: {} });

/** What the Open in editor button offers for one worktree. */
export type EditorOptions = {
  editors: EditorChoice[];
  chosen: EditorId | null;
  /** Visual Studio solutions (`.sln`, `.slnx`) in the worktree root or one folder down, relative. */
  solutions: string[];
  solution: string | null;
};

/** First installed of: the repo's choice, the global default, Visual Studio for a .NET repo, VS Code, anything. */
export function pickEditor(
  installed: EditorId[],
  prefs: { repo: EditorId | null; global: EditorId | null },
  hints: { dotnet: boolean },
): EditorId | null {
  const has = (id: EditorId | null): id is EditorId => id !== null && installed.includes(id);
  if (has(prefs.repo)) return prefs.repo;
  if (has(prefs.global)) return prefs.global;
  if (hints.dotnet && has('visualstudio')) return 'visualstudio';
  if (has('vscode')) return 'vscode';
  return installed[0] ?? null;
}
```

In `src/shared/usage.ts`, import `EditorPrefsSchema` and `defaultEditorPrefs` from `./editors`, add to `AppSettingsSchema` after `sendTelemetry`:

```ts
  /** Which editor Open in editor uses, globally and per repo. */
  editor: EditorPrefsSchema.default(defaultEditorPrefs()),
```

and to `defaultSettings()` after `sendTelemetry: true,`:

```ts
  editor: defaultEditorPrefs(),
```

Run: `npx vitest run src/shared/editors.test.ts` → PASS. Then `npm run typecheck`: fix any test that builds an `AppSettings` literal by spreading `defaultSettings()` or adding `editor: defaultEditorPrefs()`.

- [ ] **Step 4: Write the failing registry test**

```ts
// src/main/editors/editors.test.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { detectEditors, scanProject, visualStudioFile, visualStudioFolder } from './editors';

const VSWHERE = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
const DEVENV = 'C:\\VS\\Common7\\IDE\\devenv.exe';

describe('detectEditors', () => {
  it('macOS: VS Code as before (code), never Visual Studio', async () => {
    const execFile = vi.fn();
    expect(
      await detectEditors({ platform: 'darwin', env: {}, which: () => null, exists: () => false, execFile }),
    ).toEqual({ vscode: 'code' });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('Windows: VS Code when code is on PATH, Visual Studio through vswhere', async () => {
    const execFile = vi.fn(async () => `${DEVENV}\r\n`);
    const found = await detectEditors({
      platform: 'win32',
      env: { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
      which: (n) => (n === 'code' ? 'C:\\bin\\code.cmd' : null),
      exists: (p) => p === VSWHERE || p === DEVENV,
      execFile,
    });
    expect(found).toEqual({ vscode: 'code', visualstudio: DEVENV });
    expect(execFile).toHaveBeenCalledWith(VSWHERE, ['-latest', '-property', 'productPath', '-nologo']);
  });

  it('Windows: nothing when neither is installed or vswhere fails', async () => {
    expect(
      await detectEditors({
        platform: 'win32',
        env: {},
        which: () => null,
        exists: (p) => p === VSWHERE,
        execFile: async () => {
          throw new Error('boom');
        },
      }),
    ).toEqual({});
  });
});

describe('scanProject', () => {
  it('finds solutions at the root and one folder down, root first; .csproj marks .NET', async () => {
    const wt = mkdtempSync(path.join(os.tmpdir(), 'miac-ed-'));
    writeFileSync(path.join(wt, 'App.sln'), '');
    mkdirSync(path.join(wt, 'tools'));
    writeFileSync(path.join(wt, 'tools', 'Tools.slnx'), '');
    mkdirSync(path.join(wt, 'node_modules', 'x'), { recursive: true });
    writeFileSync(path.join(wt, 'node_modules', 'x', 'No.sln'), '');
    mkdirSync(path.join(wt, 'a', 'deep'), { recursive: true });
    writeFileSync(path.join(wt, 'a', 'deep', 'Deep.sln'), '');
    expect(await scanProject(wt)).toEqual({
      solutions: ['App.sln', path.join('tools', 'Tools.slnx')],
      dotnet: true,
    });
  });

  it('a .csproj alone is .NET without solutions; a plain repo is neither', async () => {
    const a = mkdtempSync(path.join(os.tmpdir(), 'miac-ed-'));
    mkdirSync(path.join(a, 'src'));
    writeFileSync(path.join(a, 'src', 'Api.csproj'), '');
    expect(await scanProject(a)).toEqual({ solutions: [], dotnet: true });
    const b = mkdtempSync(path.join(os.tmpdir(), 'miac-ed-'));
    writeFileSync(path.join(b, 'package.json'), '{}');
    expect(await scanProject(b)).toEqual({ solutions: [], dotnet: false });
  });
});

describe('Visual Studio commands', () => {
  it('opens the worktree’s own solution, else the folder', () => {
    expect(visualStudioFolder(DEVENV, 'C:\\wt', 'App.sln')).toEqual({ command: DEVENV, args: [path.join('C:\\wt', 'App.sln')] });
    expect(visualStudioFolder(DEVENV, 'C:\\wt', null)).toEqual({ command: DEVENV, args: ['C:\\wt'] });
  });
  it('opens a file in the running instance and goes to the line', () => {
    expect(visualStudioFile(DEVENV, 'C:\\wt\\a.cs', 42)).toEqual({
      command: DEVENV,
      args: ['/edit', 'C:\\wt\\a.cs', '/command', 'Edit.GoTo 42'],
    });
    expect(visualStudioFile(DEVENV, 'C:\\wt\\a.cs')).toEqual({ command: DEVENV, args: ['/edit', 'C:\\wt\\a.cs'] });
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run src/main/editors/editors.test.ts`
Expected: FAIL, "Failed to resolve import ./editors".

- [ ] **Step 6: Write `src/main/editors/editors.ts`**

```ts
// src/main/editors/editors.ts
import { execFile as execFileCb } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { EditorId } from '../../shared/editors';
import type { Command } from '../platform/Platform';
import { which } from '../platform/which';

const execFileAsync = promisify(execFileCb);

/** Editor id → its executable. VS Code is `code`, started through the Platform's editor commands. */
export type Installed = Partial<Record<EditorId, string>>;

export type DetectDeps = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  which: (name: string) => string | null;
  exists: (p: string) => boolean;
  execFile: (file: string, args: string[]) => Promise<string>;
};

export function systemDetectDeps(): DetectDeps {
  return {
    platform: process.platform,
    env: process.env,
    which: (n) => which(n),
    exists: existsSync,
    execFile: async (file, args) =>
      (await execFileAsync(file, args, { windowsHide: true, timeout: 10000 })).stdout,
  };
}

/**
 * What is installed. macOS keeps today's behaviour (VS Code through `code`, not checked). Windows: VS Code
 * when `code` is on PATH; Visual Studio (any edition, the latest) from vswhere, which every installer ships.
 */
export async function detectEditors(d: DetectDeps): Promise<Installed> {
  if (d.platform !== 'win32') return { vscode: 'code' };
  const found: Installed = {};
  if (d.which('code')) found.vscode = 'code';
  const pf = d.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const vswhere = path.win32.join(pf, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (d.exists(vswhere)) {
    try {
      const out = await d.execFile(vswhere, ['-latest', '-property', 'productPath', '-nologo']);
      const exe = out.trim().split(/\r?\n/)[0]?.trim();
      if (exe && d.exists(exe)) found.visualstudio = exe;
    } catch {
      /* Visual Studio stays absent */
    }
  }
  return found;
}

const SKIP = new Set(['node_modules', 'bin', 'obj', 'dist', 'build', 'out', 'packages']);
const SOLUTION = /\.slnx?$/i;
const PROJECT = /\.csproj$/i;

/** Solutions and .NET projects in the worktree root and one folder down (build and dependency folders skipped). */
export async function scanProject(worktree: string): Promise<{ solutions: string[]; dotnet: boolean }> {
  const root: string[] = [];
  const nested: string[] = [];
  let dotnet = false;
  const read = async (dir: string) => {
    try {
      return await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const e of await read(worktree)) {
    if (e.isFile()) {
      if (SOLUTION.test(e.name)) root.push(e.name);
      if (PROJECT.test(e.name)) dotnet = true;
    } else if (e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)) {
      for (const f of await read(path.join(worktree, e.name))) {
        if (!f.isFile()) continue;
        if (SOLUTION.test(f.name)) nested.push(path.join(e.name, f.name));
        if (PROJECT.test(f.name)) dotnet = true;
      }
    }
  }
  const solutions = [...root.sort(), ...nested.sort()];
  return { solutions, dotnet: dotnet || solutions.length > 0 };
}

export function visualStudioFolder(exe: string, worktree: string, solution: string | null): Command {
  return { command: exe, args: [solution ? path.join(worktree, solution) : worktree] };
}

/** `/edit` reuses the running Visual Studio; `Edit.GoTo` moves to the line (to verify on Windows hardware). */
export function visualStudioFile(exe: string, file: string, line?: number): Command {
  return {
    command: exe,
    args: ['/edit', file, ...(line ? ['/command', `Edit.GoTo ${line}`] : [])],
  };
}
```

Note for the `visualStudioFolder` test on macOS: `path.join('C:\\wt', 'App.sln')` is `C:\wt/App.sln` there; the test uses `path.join` on both sides, so it holds on both platforms.

- [ ] **Step 7: Run the registry test**

Run: `npx vitest run src/main/editors/editors.test.ts`
Expected: PASS.

- [ ] **Step 8: Write the failing EditorService test**

```ts
// src/main/editors/EditorService.test.ts
import { describe, expect, it, vi } from 'vitest';
import { defaultEditorPrefs, type EditorPrefs } from '../../shared/editors';
import type { Command } from '../platform/Platform';
import { EditorService } from './EditorService';

const DEVENV = 'C:\\VS\\devenv.exe';

function make(o: { installed?: Record<string, string>; solutions?: string[]; dotnet?: boolean; prefs?: EditorPrefs } = {}) {
  let prefs = o.prefs ?? defaultEditorPrefs();
  const launch = vi.fn(async (_c: Command) => undefined);
  const event = vi.fn();
  const detect = vi.fn(async () => o.installed ?? { vscode: 'code', visualstudio: DEVENV });
  const service = new EditorService({
    platform: {
      editorCommand: (p) => ({ command: 'code', args: [p] }),
      editorGotoCommand: (wt, f, l, c) => ({ command: 'code', args: [wt, '-g', `${f}:${l ?? 1}:${c ?? 1}`] }),
    },
    detect,
    scan: async () => ({ solutions: o.solutions ?? [], dotnet: o.dotnet ?? false }),
    prefs: () => prefs,
    savePrefs: async (p) => {
      prefs = p;
    },
    launch,
    event,
  });
  return { service, launch, event, detect, prefs: () => prefs };
}

describe('EditorService', () => {
  it('lists installed editors and detects once until asked again', async () => {
    const { service, detect } = make();
    expect(await service.choices()).toEqual([
      { id: 'vscode', label: 'VS Code' },
      { id: 'visualstudio', label: 'Visual Studio' },
    ]);
    await service.choices();
    expect(detect).toHaveBeenCalledTimes(1);
    await service.choices(true);
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('opens a .NET worktree’s solution in Visual Studio and reports it', async () => {
    const { service, launch, event } = make({ solutions: ['App.sln'], dotnet: true });
    await service.openFolder('r1', '/wt');
    expect(launch.mock.calls[0][0]).toEqual({ command: DEVENV, args: [expect.stringContaining('App.sln')] });
    expect(event).toHaveBeenCalledWith('editor.opened', { editor: 'visualstudio', at: 'folder' });
  });

  it('remembers a picked solution per repo, and refuses one that is not in the worktree', async () => {
    const { service, prefs } = make({ solutions: ['A.sln', 'B.sln'], dotnet: true });
    expect((await service.options('r1', '/wt')).solution).toBe('A.sln');
    await service.openFolder('r1', '/wt', { solution: 'B.sln' });
    expect(prefs().repos.r1).toEqual({ editor: null, solution: 'B.sln' });
    expect((await service.options('r1', '/wt')).solution).toBe('B.sln');
    await expect(service.openFolder('r1', '/wt', { solution: '../evil.sln' })).rejects.toThrow('Unknown solution');
  });

  it('a one-off editor from the menu does not change the choice', async () => {
    const { service, launch, prefs } = make({ dotnet: true });
    await service.openFolder('r1', '/wt', { editorId: 'vscode' });
    expect(launch.mock.calls[0][0]).toEqual({ command: 'code', args: ['/wt'] });
    expect(prefs()).toEqual(defaultEditorPrefs());
  });

  it('opens a file at a line in either editor', async () => {
    const { service, launch, event } = make();
    await service.openFile('r1', '/wt', '/wt/a.ts', 3, 2);
    expect(launch.mock.calls[0][0]).toEqual({ command: 'code', args: ['/wt', '-g', '/wt/a.ts:3:2'] });
    await service.openFile('r1', '/wt', '/wt/a.cs', 9, undefined, 'visualstudio');
    expect(launch.mock.calls[1][0]).toEqual({ command: DEVENV, args: ['/edit', '/wt/a.cs', '/command', 'Edit.GoTo 9'] });
    expect(event).toHaveBeenLastCalledWith('editor.opened', { editor: 'visualstudio', at: 'file' });
  });

  it('says so when no editor is installed', async () => {
    const { service } = make({ installed: {} });
    expect((await service.options('r1', '/wt')).chosen).toBeNull();
    await expect(service.openFolder('r1', '/wt')).rejects.toThrow('No editor found');
  });
});
```

- [ ] **Step 9: Run it to verify it fails**

Run: `npx vitest run src/main/editors/EditorService.test.ts`
Expected: FAIL, "Failed to resolve import ./EditorService".

- [ ] **Step 10: Write `EditorService.ts`**

```ts
// src/main/editors/EditorService.ts
import {
  EDITOR_IDS,
  EDITOR_LABELS,
  type EditorChoice,
  type EditorId,
  type EditorOptions,
  type EditorPrefs,
  pickEditor,
} from '../../shared/editors';
import type { TelemetryProps } from '../../shared/telemetry';
import type { Command, Platform } from '../platform/Platform';
import { type Installed, visualStudioFile, visualStudioFolder } from './editors';

export type EditorServiceDeps = {
  platform: Pick<Platform, 'editorCommand' | 'editorGotoCommand'>;
  detect: () => Promise<Installed>;
  scan: (worktree: string) => Promise<{ solutions: string[]; dotnet: boolean }>;
  prefs: () => EditorPrefs;
  savePrefs: (prefs: EditorPrefs) => Promise<void>;
  launch: (cmd: Command) => Promise<void>;
  event: (name: string, props?: TelemetryProps) => void;
};

/** Picks and starts the developer's editor for a worktree; detection is cached until `choices(true)`. */
export class EditorService {
  private found: Promise<Installed> | null = null;

  constructor(private readonly d: EditorServiceDeps) {}

  private installed(refresh = false): Promise<Installed> {
    if (refresh || !this.found) this.found = this.d.detect().catch(() => ({}));
    return this.found;
  }

  async choices(refresh = false): Promise<EditorChoice[]> {
    const found = await this.installed(refresh);
    return EDITOR_IDS.filter((id) => found[id]).map((id) => ({ id, label: EDITOR_LABELS[id] }));
  }

  async options(repoId: string, worktree: string): Promise<EditorOptions> {
    const [editors, project] = await Promise.all([
      this.choices(),
      this.d.scan(worktree).catch(() => ({ solutions: [], dotnet: false })),
    ]);
    const prefs = this.d.prefs();
    const repo = prefs.repos[repoId];
    const chosen = pickEditor(
      editors.map((e) => e.id),
      { repo: repo?.editor ?? null, global: prefs.default },
      { dotnet: project.dotnet },
    );
    const remembered =
      repo?.solution && project.solutions.includes(repo.solution) ? repo.solution : null;
    return {
      editors,
      chosen,
      solutions: project.solutions,
      solution: remembered ?? project.solutions[0] ?? null,
    };
  }

  private async resolve(repoId: string, worktree: string, editorId?: EditorId) {
    const opts = await this.options(repoId, worktree);
    const id = editorId ?? opts.chosen;
    const exe = id ? (await this.installed())[id] : undefined;
    if (!id || !exe) throw new Error('No editor found. Pick one in Settings.');
    return { id, exe, opts };
  }

  async openFolder(
    repoId: string,
    worktree: string,
    o: { editorId?: EditorId; solution?: string } = {},
  ): Promise<void> {
    const { id, exe, opts } = await this.resolve(repoId, worktree, o.editorId);
    if (o.solution !== undefined && !opts.solutions.includes(o.solution))
      throw new Error('Unknown solution');
    if (id === 'vscode') await this.d.launch(this.d.platform.editorCommand(worktree));
    else await this.d.launch(visualStudioFolder(exe, worktree, o.solution ?? opts.solution));
    if (o.solution !== undefined) await this.remember(repoId, { solution: o.solution });
    this.d.event('editor.opened', { editor: id, at: 'folder' });
  }

  async openFile(
    repoId: string,
    worktree: string,
    absFile: string,
    line?: number,
    col?: number,
    editorId?: EditorId,
  ): Promise<void> {
    const { id, exe } = await this.resolve(repoId, worktree, editorId);
    await this.d.launch(
      id === 'vscode'
        ? this.d.platform.editorGotoCommand(worktree, absFile, line, col)
        : visualStudioFile(exe, absFile, line),
    );
    this.d.event('editor.opened', { editor: id, at: 'file' });
  }

  private async remember(repoId: string, patch: { solution: string }): Promise<void> {
    const prefs = this.d.prefs();
    const cur = prefs.repos[repoId] ?? { editor: null, solution: null };
    await this.d.savePrefs({ ...prefs, repos: { ...prefs.repos, [repoId]: { ...cur, ...patch } } });
  }
}
```

- [ ] **Step 11: Run the editor tests and commit**

Run: `npx vitest run src/main/editors src/shared/editors.test.ts && npm run typecheck && npm run lint:fix && npm run lint`
Expected: PASS.

```bash
git add src/shared/editors.ts src/shared/editors.test.ts src/shared/usage.ts src/main/editors
git commit -m "feat(editors): VS Code and Visual Studio registry with per-repo choice"
```

---
### Task 7: Editor IPC, Open in editor button, Settings section

**Files:**
- Create: `src/main/editors/editorHandlers.ts`, `src/renderer/components/ui/PopupMenu.tsx`, `src/renderer/components/OpenInEditor.tsx`, `src/renderer/components/EditorSection.tsx`, `src/renderer/styles/review.css`
- Modify: `src/shared/ipc.ts`, `src/main/docs/docsHandlers.ts`, `src/main/docs/docsHandlers.test.ts`, `src/main/ipc/handlers.ts`, `src/renderer/test-helpers/fakeApi.ts`, `src/renderer/components/ui/index.ts`, `src/renderer/components/TerminalTabs.tsx`, `src/renderer/screens/SettingsScreen.tsx`, `src/renderer.tsx`
- Test: `src/main/editors/editorHandlers.test.ts`, `src/renderer/components/OpenInEditor.test.tsx`, `src/renderer/components/EditorSection.test.tsx`

**Interfaces:**
- Consumes: `EditorService`, `scanProject`, `detectEditors`, `systemDetectDeps` (Task 6); `resolveInWorktree`; `workspaceById`.
- Produces:
  - IPC: `'editor:installed'(refresh?: boolean) → EditorChoice[]`; `'editor:options'(taskId, workspaceId?: string) → EditorOptions`; `'editor:openFolder'(taskId, workspaceId: string | undefined, o: { editorId?: EditorId; solution?: string }) → void`; `'editor:openFile'(taskId, workspaceId: string | undefined, path: string, line?: number, editorId?: EditorId) → void`
  - `'tasks:openInEditor'` and `'docs:openInEditor'` go through `EditorService` (same channels, same arguments).
  - `PopupMenu` component: `<PopupMenu label: string; anchor: HTMLElement | null; open: boolean; onClose(): void; children>` (fixed-position menu under `anchor`, closes on outside click and Escape, arrow keys move between `role="menuitem"`).
  - `OpenInEditor` component: `<OpenInEditor taskId: string; workspaceId?: string; disabled?: boolean />`.
  - `EditorSection` (Settings, `id="editor"`).

- [ ] **Step 1: Write the failing editor handler test**

```ts
// src/main/editors/editorHandlers.test.ts
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { defaultEditorPrefs } from '../../shared/editors';
import { testTask } from '../review/testTask';
import { cleanupTempRepos, makeRepo } from '../test-helpers/gitRepo';
import { createEditorHandlers } from './editorHandlers';
import { EditorService } from './EditorService';

afterAll(cleanupTempRepos);

function setup() {
  const repo = makeRepo();
  const launch = vi.fn(async () => undefined);
  const editors = new EditorService({
    platform: {
      editorCommand: (p) => ({ command: 'code', args: [p] }),
      editorGotoCommand: (wt, f, l) => ({ command: 'code', args: [wt, '-g', `${f}:${l ?? 1}:1`] }),
    },
    detect: async () => ({ vscode: 'code' }),
    scan: async () => ({ solutions: [], dotnet: false }),
    prefs: defaultEditorPrefs,
    savePrefs: async () => undefined,
    launch,
    event: () => undefined,
  });
  const task = testTask({ worktreePath: repo });
  return { repo, launch, h: createEditorHandlers({ taskById: () => task, editors }) };
}

describe('editor handlers', () => {
  it('lists options for the task’s home worktree', async () => {
    const { h } = setup();
    expect((await h['editor:options']('t1')).chosen).toBe('vscode');
  });
  it('opens a file inside the worktree at a line', async () => {
    const { h, launch, repo } = setup();
    await h['editor:openFile']('t1', undefined, 'README.md', 7);
    expect(launch.mock.calls[0][0].args[2]).toBe(`${realpathSync(path.join(repo, 'README.md'))}:7:1`);
  });
  it('refuses a file outside the worktree and an unknown editor id', async () => {
    const { h } = setup();
    await expect(h['editor:openFile']('t1', undefined, '../x', 1)).rejects.toThrow('Outside the worktree');
    await expect(h['editor:openFolder']('t1', undefined, { editorId: 'notepad' as never })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/editors/editorHandlers.test.ts`
Expected: FAIL, "Failed to resolve import ./editorHandlers".

- [ ] **Step 3: Add the channels and write the handlers**

In `src/shared/ipc.ts`, import `import type { EditorChoice, EditorId, EditorOptions } from './editors';` and add to `Channels`:

```ts
  /** Installed editors; `refresh` looks again instead of using this launch's cached detection. */
  'editor:installed': { args: [refresh?: boolean]; result: EditorChoice[] };
  'editor:options': { args: [taskId: string, workspaceId?: string]; result: EditorOptions };
  'editor:openFolder': {
    args: [taskId: string, workspaceId: string | undefined, o: { editorId?: EditorId; solution?: string }];
    result: void;
  };
  /** Opens a worktree file (root-relative) at a line in the chosen editor, or in `editorId`. */
  'editor:openFile': {
    args: [taskId: string, workspaceId: string | undefined, path: string, line?: number, editorId?: EditorId];
    result: void;
  };
```

```ts
// src/main/editors/editorHandlers.ts
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { EditorIdSchema } from '../../shared/editors';
import type { Handlers } from '../../shared/ipc';
import type { Task } from '../../shared/types';
import { workspaceById } from '../../shared/workspaces';
import { resolveInWorktree } from '../docs/worktreeFiles';
import type { EditorService } from './EditorService';

type EditorChannels = 'editor:installed' | 'editor:options' | 'editor:openFolder' | 'editor:openFile';

const OpenSchema = z.object({
  editorId: EditorIdSchema.optional(),
  solution: z.string().min(1).max(1000).optional(),
});
const Line = z.number().int().min(1).optional();

export function createEditorHandlers(d: {
  taskById: (id: string) => Task;
  editors: EditorService;
}): Pick<Handlers, EditorChannels> {
  const worktree = (taskId: string, workspaceId: string | undefined) => {
    const ws = workspaceById(d.taskById(taskId), workspaceId);
    if (!existsSync(ws.worktreePath)) throw new Error('The worktree is missing');
    return ws;
  };
  return {
    'editor:installed': async (refresh) => d.editors.choices(Boolean(refresh)),
    'editor:options': async (taskId, workspaceId) => {
      const ws = worktree(taskId, workspaceId);
      return d.editors.options(ws.repoId, ws.worktreePath);
    },
    'editor:openFolder': async (taskId, workspaceId, o) => {
      const ws = worktree(taskId, workspaceId);
      await d.editors.openFolder(ws.repoId, ws.worktreePath, OpenSchema.parse(o ?? {}));
    },
    'editor:openFile': async (taskId, workspaceId, rel, line, editorId) => {
      const ws = worktree(taskId, workspaceId);
      const abs = await resolveInWorktree(ws.worktreePath, rel);
      await d.editors.openFile(
        ws.repoId,
        ws.worktreePath,
        abs,
        Line.parse(line),
        undefined,
        editorId === undefined ? undefined : EditorIdSchema.parse(editorId),
      );
    },
  };
}
```

Run: `npx vitest run src/main/editors/editorHandlers.test.ts` → PASS.

- [ ] **Step 4: Route Docs through the editor service (test first)**

In `src/main/docs/docsHandlers.test.ts` `setup()`, replace the `editorGoto: ...` and `launch,` deps with:

```ts
    openFile: launch,
```

where `launch` becomes `const launch = vi.fn(async (_ws: unknown, _file: string, _line?: number, _col?: number) => undefined);`. Change the test "opens the editor at the file and line through the platform" to:

```ts
  it('opens the editor at the file and line', async () => {
    const { h, launch, repo } = setup();
    await h['docs:openInEditor']('t1', 'README.md', 3, 2);
    expect(launch.mock.calls[0].slice(1)).toEqual([realpathSync(path.join(repo, 'README.md')), 3, 2]);
  });
```

Leave the second `createDocsHandlers({...})` in that file (around line 109) the same way: replace `editorGoto` and `launch` with `openFile: vi.fn(async () => undefined)`. Remove the `Command` import if it is now unused.

Run: `npx vitest run src/main/docs/docsHandlers.test.ts` → FAIL (type and runtime: `openFile` is not a dep yet).

In `src/main/docs/docsHandlers.ts`: in `DocsDeps`, replace `editorGoto: (...) => Command;` and `launch: (cmd: Command) => Promise<void>;` with:

```ts
  /** Opens a file of the workspace at a line in the developer's editor (EditorService). */
  openFile: (ws: WorkspaceView, absFile: string, line?: number, col?: number) => Promise<void>;
```

(import `type WorkspaceView` from `../../shared/workspaces`; drop the `Command` import). Replace the `'docs:openInEditor'` handler with:

```ts
    'docs:openInEditor': async (target, p, line, col) => {
      const ws = workspace(target);
      const abs = await resolveInWorktree(ws.worktreePath, p);
      await d.openFile(ws, abs, line, col);
    },
```

(`editor.opened` is now sent by EditorService with `editor` and `at`.)

Run: `npx vitest run src/main/docs/docsHandlers.test.ts` → PASS.

- [ ] **Step 5: Wire the service into `handlers.ts`**

In `src/main/ipc/handlers.ts`:

```ts
import { createEditorHandlers } from '../editors/editorHandlers';
import { detectEditors, scanProject, systemDetectDeps } from '../editors/editors';
import { EditorService } from '../editors/EditorService';
```

In `Services` add:

```ts
  /** Editor detection and launch; handlers build one from platform, settings and launch when absent (tests). */
  editors?: EditorService;
```

After the `review` service from Task 5:

```ts
  const editors =
    s.editors ??
    new EditorService({
      platform: s.platform,
      detect: () => detectEditors(systemDetectDeps()),
      scan: scanProject,
      prefs: () => s.settings.get().editor,
      savePrefs: async (editor) => {
        await s.settings.save({ ...s.settings.get(), editor });
      },
      launch: s.launch,
      event: (n, p) => tel.event(n, p),
    });
```

In `createDocsHandlers({...})`, replace `editorGoto: ...,` and `launch: s.launch,` with:

```ts
      openFile: (ws, abs, line, col) => editors.openFile(ws.repoId, ws.worktreePath, abs, line, col),
```

Replace the body of `'tasks:openInEditor'` with:

```ts
    'tasks:openInEditor': async (taskId, workspaceId) => {
      const ws = workspaceById(taskById(taskId), workspaceId);
      await editors.openFolder(ws.repoId, ws.worktreePath);
    },
```

Add `...createEditorHandlers({ taskById, editors }),` next to the review handlers.

Run: `npm test -- src/main && npm run typecheck`. In `src/main/ipc/handlers.test.ts`, a test that asserts `launch` was called with `{ command: 'code', ... }` for `tasks:openInEditor` keeps passing on macOS (detection returns `vscode: 'code'` without checking PATH). On Windows CI, `detectEditors` checks PATH for `code`: if such a test fails there, pass `editors` in that test's services built with `detect: async () => ({ vscode: 'code' })`.

- [ ] **Step 6: Write `PopupMenu` and the failing OpenInEditor test**

```tsx
// src/renderer/components/ui/PopupMenu.tsx
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** A menu under an anchor button: outside click and Escape close it, arrows move between items. */
export function PopupMenu({
  label,
  anchor,
  open,
  onClose,
  children,
}: {
  label: string;
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onClose);
    };
  }, [open, anchor, onClose]);
  if (!open || !anchor) return null;
  const r = anchor.getBoundingClientRect();
  const onKey = (e: KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      anchor.focus();
    } else if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i < 0 ? -1 : i - 1);
    else if (e.key === 'Tab') onClose();
  };
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="menu popup-menu"
      style={{ left: Math.max(4, r.right - 240), top: r.bottom + 2 }}
      onKeyDown={onKey}
    >
      {children}
    </div>,
    document.body,
  );
}
```

Export it from `src/renderer/components/ui/index.ts`: `export { PopupMenu } from './PopupMenu';`.

Create `src/renderer/styles/review.css` with the menu rule (later tasks add to this file) and import it in `src/renderer.tsx` after `app.css`: `import './renderer/styles/review.css';`

```css
/* Changes page and its menus */
.popup-menu {
  position: fixed;
  right: auto;
  width: 240px;
  z-index: 40;
}
.split-btn {
  display: inline-flex;
  align-items: stretch;
}
.split-btn > .btn + .btn {
  padding-left: 4px;
  padding-right: 4px;
  border-left: 1px solid var(--line);
}
```

Renderer tests use `installFakeApi` from `src/renderer/test-helpers/fakeApi.ts` (it installs `window.miac`, logs calls in `calls`, and `emit` pushes events). Add editor defaults to its `defaults` map so every existing screen test that renders the task row keeps working:

```ts
  'editor:options': () => ({
    editors: [{ id: 'vscode', label: 'VS Code' }],
    chosen: 'vscode',
    solutions: [],
    solution: null,
  }),
  'editor:installed': () => [{ id: 'vscode', label: 'VS Code' }],
  'editor:openFolder': () => undefined,
  'editor:openFile': () => undefined,
```

and add `editor: { default: null, repos: {} },` to its `'settings:get'` default.

```tsx
// src/renderer/components/OpenInEditor.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installFakeApi } from '../test-helpers/fakeApi';
import { OpenInEditor } from './OpenInEditor';

const vs = { id: 'visualstudio', label: 'Visual Studio' } as const;
const code = { id: 'vscode', label: 'VS Code' } as const;
const opened = (calls: { channel: string; args: unknown[] }[]) =>
  calls.filter((c) => c.channel === 'editor:openFolder').map((c) => c.args);

describe('OpenInEditor', () => {
  it('names the chosen editor and opens the folder with it', async () => {
    const { calls } = installFakeApi({
      'editor:options': () => ({ editors: [code, vs], chosen: 'visualstudio', solutions: ['App.sln'], solution: 'App.sln' }),
    });
    render(<OpenInEditor taskId="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open in Visual Studio' }));
    expect(opened(calls)).toEqual([['t1', undefined, {}]]);
  });

  it('offers the other editors and the solutions in its menu', async () => {
    const { calls } = installFakeApi({
      'editor:options': () => ({ editors: [code, vs], chosen: 'visualstudio', solutions: ['A.sln', 'tools/B.sln'], solution: 'A.sln' }),
    });
    render(<OpenInEditor taskId="t1" workspaceId="w2" />);
    fireEvent.click(await screen.findByRole('button', { name: 'More ways to open' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open B.sln' }));
    fireEvent.click(screen.getByRole('button', { name: 'More ways to open' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in VS Code' }));
    expect(opened(calls)).toEqual([
      ['t1', 'w2', { solution: 'tools/B.sln' }],
      ['t1', 'w2', { editorId: 'vscode' }],
    ]);
  });

  it('says when no editor is found', async () => {
    installFakeApi({ 'editor:options': () => ({ editors: [], chosen: null, solutions: [], solution: null }) });
    render(<OpenInEditor taskId="t1" />);
    expect(await screen.findByRole('button', { name: 'No editor found' })).toBeTruthy();
  });
});
```

Run: `npx vitest run src/renderer/components/OpenInEditor.test.tsx` → FAIL, "Failed to resolve import ./OpenInEditor".

- [ ] **Step 7: Write `OpenInEditor.tsx`**

```tsx
// src/renderer/components/OpenInEditor.tsx
import { ChevronDown16Regular, Code16Regular } from '@fluentui/react-icons';
import { useCallback, useEffect, useState } from 'react';
import { EDITOR_LABELS, type EditorId, type EditorOptions } from '../../shared/editors';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';
import { PopupMenu } from './ui';

const fileName = (p: string) => p.split(/[\\/]/).at(-1) ?? p;

/** Opens the worktree in the developer's editor; the menu holds the other editors and Visual Studio's solutions. */
export function OpenInEditor({
  taskId,
  workspaceId,
  disabled,
}: {
  taskId: string;
  workspaceId?: string;
  disabled?: boolean;
}) {
  const notify = useStore((s) => s.notify);
  const go = useStore((s) => s.go);
  const [opts, setOpts] = useState<EditorOptions | null>(null);
  const [menu, setMenu] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const close = useCallback(() => setMenu(false), []);

  useEffect(() => {
    let live = true;
    void api()
      .invoke('editor:options', taskId, workspaceId)
      .then((o) => {
        if (live) setOpts(o);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [taskId, workspaceId]);

  const open = (o: { editorId?: EditorId; solution?: string } = {}) => {
    setMenu(false);
    void tryInvoke(() => api().invoke('editor:openFolder', taskId, workspaceId, o), notify);
  };

  if (opts && !opts.chosen)
    return (
      <button type="button" className="btn btn-subtle btn-sm" onClick={() => go({ kind: 'settings' })}>
        No editor found
      </button>
    );
  const label = opts?.chosen ? EDITOR_LABELS[opts.chosen] : 'editor';
  const others = opts?.editors.filter((e) => e.id !== opts.chosen) ?? [];
  const solutions = opts?.chosen === 'visualstudio' && opts.solutions.length > 1 ? opts.solutions : [];
  return (
    <span className="split-btn">
      <button
        type="button"
        className="btn btn-subtle btn-sm"
        disabled={disabled || !opts}
        onClick={() => open()}
      >
        <Code16Regular aria-hidden="true" />
        {`Open in ${label}`}
      </button>
      {(others.length > 0 || solutions.length > 0) && (
        <button
          ref={setAnchor}
          type="button"
          className="btn btn-subtle btn-sm"
          aria-label="More ways to open"
          aria-haspopup="menu"
          aria-expanded={menu}
          disabled={disabled}
          onClick={() => setMenu(!menu)}
        >
          <ChevronDown16Regular aria-hidden="true" />
        </button>
      )}
      <PopupMenu label="Open in editor" anchor={anchor} open={menu} onClose={close}>
        {solutions.map((s) => (
          <button
            key={s}
            type="button"
            role="menuitem"
            className="menu-item"
            aria-label={`Open ${fileName(s)}`}
            onClick={() => open({ solution: s })}
          >
            <span className="menu-title">{`Open ${fileName(s)}`}</span>
            <span className="small muted mono">{s}</span>
          </button>
        ))}
        {others.map((e) => (
          <button key={e.id} type="button" role="menuitem" className="menu-item" onClick={() => open({ editorId: e.id })}>
            <span className="menu-title">{`Open in ${e.label}`}</span>
          </button>
        ))}
      </PopupMenu>
    </span>
  );
}
```

The solution menuitem carries `aria-label={`Open ${fileName(s)}`}` so its accessible name is not joined with the path line.

Run: `npx vitest run src/renderer/components/OpenInEditor.test.tsx` → PASS.

- [ ] **Step 8: Use it on the task row and in the repo chip menu**

In `src/renderer/components/TerminalTabs.tsx`, replace the `<button ...>Open in VS Code</button>` block with:

```tsx
              <OpenInEditor taskId={task.id} disabled={task.worktreeMissing} />
```

and import `OpenInEditor` from `./OpenInEditor`; drop `Code16Regular` from the icon import if unused. `WorkspaceChips.tsx`'s "Open in editor" item keeps calling `tasks:openInEditor`, which now uses the chosen editor.

Run: `npx vitest run src/renderer`. A test that looked for the "Open in VS Code" button synchronously must now use `findByRole`, since the label appears once `editor:options` answers (the fakeApi default answers VS Code).

- [ ] **Step 9: Write the failing Settings section test**

```tsx
// src/renderer/components/EditorSection.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppSettings } from '../../shared/usage';
import { defaultSettings } from '../../shared/usage';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { EditorSection } from './EditorSection';

describe('EditorSection', () => {
  it('saves the default and a repo’s editor, keeping the other settings', async () => {
    useStore.setState({
      repos: [{ id: 'r1', name: 'web', path: '/x', baseBranch: 'main', connectionId: null, miacYmlFound: true, discovered: false } as never],
    });
    let current: AppSettings = { ...defaultSettings(), idleMinutes: 9 };
    installFakeApi({
      'editor:installed': () => [
        { id: 'vscode', label: 'VS Code' },
        { id: 'visualstudio', label: 'Visual Studio' },
      ],
      'settings:get': () => current,
      'settings:save': (s) => (current = s),
    });
    render(<EditorSection />);
    fireEvent.change(await screen.findByLabelText('Default editor'), { target: { value: 'visualstudio' } });
    await waitFor(() => expect(current.editor.default).toBe('visualstudio'));
    fireEvent.change(screen.getByLabelText('Editor for web'), { target: { value: 'vscode' } });
    await waitFor(() =>
      expect(current.editor).toEqual({ default: 'visualstudio', repos: { r1: { editor: 'vscode', solution: null } } }),
    );
    expect(current.idleMinutes).toBe(9);
  });
});
```

Run: `npx vitest run src/renderer/components/EditorSection.test.tsx` → FAIL, "Failed to resolve import ./EditorSection".

- [ ] **Step 10: Write `EditorSection.tsx` and add it to Settings**

```tsx
// src/renderer/components/EditorSection.tsx
import { useEffect, useState } from 'react';
import type { EditorChoice, EditorId, EditorPrefs } from '../../shared/editors';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';

/** Settings > Editor: the default editor and one per repo ("Automatic" picks from the project). */
export function EditorSection() {
  const notify = useStore((s) => s.notify);
  const repos = useStore((s) => s.repos);
  const [choices, setChoices] = useState<EditorChoice[] | null>(null);
  const [prefs, setPrefs] = useState<EditorPrefs | null>(null);

  const load = async (refresh: boolean) => {
    const [c, s] = await Promise.all([
      tryInvoke(() => api().invoke('editor:installed', refresh), notify),
      tryInvoke(() => api().invoke('settings:get'), notify),
    ]);
    if (c) setChoices(c);
    if (s) setPrefs(s.editor);
  };
  // Detection runs again whenever Settings opens, so a just-installed editor shows up.
  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, []);

  const save = async (change: (p: EditorPrefs) => EditorPrefs) => {
    const saved = await tryInvoke(async () => {
      const fresh = await api().invoke('settings:get');
      return api().invoke('settings:save', { ...fresh, editor: change(fresh.editor) });
    }, notify);
    if (saved) setPrefs(saved.editor);
  };
  const value = (id: EditorId | null) => id ?? '';
  const parse = (v: string): EditorId | null => (v === '' ? null : (v as EditorId));

  return (
    <section id="editor" className="section">
      <div className="section-head">
        <h2>Editor</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load(true)}>
          Look again
        </button>
      </div>
      {choices && choices.length === 0 && (
        <p className="muted">No editor found. Install VS Code (with `code` on PATH) or Visual Studio, then choose Look again.</p>
      )}
      {choices && prefs && (
        <div className="list">
          <label className="list-row">
            <span className="grow">Default editor</span>
            <select
              className="field"
              aria-label="Default editor"
              value={value(prefs.default)}
              onChange={(e) => void save((p) => ({ ...p, default: parse(e.target.value) }))}
            >
              <option value="">Automatic</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {repos.map((r) => (
            <label key={r.id} className="list-row">
              <span className="grow">{r.name}</span>
              <select
                className="field"
                aria-label={`Editor for ${r.name}`}
                value={value(prefs.repos[r.id]?.editor ?? null)}
                onChange={(e) =>
                  void save((p) => ({
                    ...p,
                    repos: {
                      ...p.repos,
                      [r.id]: { solution: p.repos[r.id]?.solution ?? null, editor: parse(e.target.value) },
                    },
                  }))
                }
              >
                <option value="">Default</option>
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      <p className="small muted">Automatic opens Visual Studio for a repo with a .sln or .csproj when it is installed, else VS Code.</p>
    </section>
  );
}
```

In `src/renderer/screens/SettingsScreen.tsx`: import `EditorSection`, add `<a href="#editor">Editor</a>` to the nav after Repositories, and render `<EditorSection />` after the repositories `</section>`.

Run: `npx vitest run src/renderer/components/EditorSection.test.tsx src/renderer/screens/SettingsScreen.test.tsx` → PASS.

- [ ] **Step 11: Full checks and commit**

Run: `npm test && npm run typecheck && npm run lint:fix && npm run lint`
Expected: PASS.

```bash
git add -A src/main/editors src/main/docs src/main/ipc/handlers.ts src/shared/ipc.ts src/renderer
git commit -m "feat(editors): open worktrees in VS Code or Visual Studio, chosen per repo"
```

---
### Task 8: Monaco, lazily loaded, and the DiffView component

**Files:**
- Modify: `package.json` / `package-lock.json` (dependency `monaco-editor@0.57.0`), `vite.renderer.config.mts` (`worker.format: 'es'`)
- Create: `src/renderer/review/monacoSetup.ts`, `src/renderer/review/loadMonaco.ts`, `src/renderer/components/review/DiffView.tsx`
- Modify: `src/renderer/styles/review.css`

**Interfaces:**
- Consumes: `ReviewSide` (Task 1).
- Produces:
  - `loadMonaco(): Promise<typeof import('monaco-editor')>` (one shared promise; the first call loads the chunk, sets workers and the theme)
  - `DiffView` component and its types:
    - `type DiffZone = { id: string; side: ReviewSide; afterLine: number; node: ReactNode }`
    - `type DiffKey = 'j' | 'k' | 'n' | 'p' | 'v' | 'c'`
    - `type DiffViewHandle = { goToChange(dir: 'next' | 'previous'): void; selection(): { side: ReviewSide; startLine: number; endLine: number } | null; focus(): void }`
    - props `{ uriKey: string; before: string; after: string; sideBySide: boolean; ignoreWhitespace: boolean; hideUnchanged: boolean; zones?: DiffZone[]; onGlyph?(side, line): void; onKey?(key: DiffKey): void; onReady?(h: DiffViewHandle | null): void }`

Monaco cannot run under jsdom, so `DiffView` has no unit test: Tasks 9–11 mock it, and Task 13's live check covers it. This task's check is a dev run.

- [ ] **Step 1: Install Monaco and check its entry points**

```bash
npm install monaco-editor@0.57.0
ls node_modules/monaco-editor/esm/vs/editor/editor.worker.js \
   node_modules/monaco-editor/esm/vs/language/json/json.worker.js \
   node_modules/monaco-editor/esm/vs/language/css/css.worker.js \
   node_modules/monaco-editor/esm/vs/language/html/html.worker.js \
   node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js
```

Expected: all five files listed. Monaco 0.57's `package.json` maps `monaco-editor/<x>` to `esm/vs/<x>.js`, so the imports below have no `esm/vs` prefix. If a file is missing, look for its new place with `ls node_modules/monaco-editor/esm/vs/language*/*/` and adjust the import path in Step 3.

- [ ] **Step 2: Let Vite bundle module workers**

In `vite.renderer.config.mts`:

```ts
export default defineConfig({
  plugins: [react(), cspForBuild()],
  // Monaco's workers are ES modules with imports.
  worker: { format: 'es' },
});
```

- [ ] **Step 3: Write `monacoSetup.ts` and `loadMonaco.ts`**

```ts
// src/renderer/review/monacoSetup.ts
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

// Bundled workers only: no CDN, and the packaged CSP allows scripts from 'self'.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

// A diff is read, not compiled: no squiggles from missing imports or types.
type Diagnostics = { setDiagnosticsOptions?: (o: Record<string, boolean>) => void };
const ts = (monaco as unknown as { typescript?: { typescriptDefaults?: Diagnostics; javascriptDefaults?: Diagnostics } }).typescript;
for (const d of [ts?.typescriptDefaults, ts?.javascriptDefaults])
  d?.setDiagnosticsOptions?.({ noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true });
(monaco as unknown as { json?: { jsonDefaults?: Diagnostics } }).json?.jsonDefaults?.setDiagnosticsOptions?.({ validate: false });

// The ADO dark palette (src/renderer/styles/tokens.css).
monaco.editor.defineTheme('miac-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#201f1e',
    'editorGutter.background': '#201f1e',
    'editor.lineHighlightBackground': '#ffffff0a',
    'editorLineNumber.foreground': '#ffffff59',
    'editorLineNumber.activeForeground': '#ffffffe6',
    'diffEditor.insertedTextBackground': '#6ccb5f33',
    'diffEditor.removedTextBackground': '#f1707b33',
    'diffEditor.insertedLineBackground': '#6ccb5f14',
    'diffEditor.removedLineBackground': '#f1707b14',
    'diffEditor.unchangedRegionBackground': '#252423',
    'scrollbarSlider.background': '#ffffff1f',
  },
});

export { monaco };
```

```ts
// src/renderer/review/loadMonaco.ts
type MonacoModule = typeof import('monaco-editor');
let loading: Promise<MonacoModule> | null = null;

/** Monaco is several MB: loaded as its own chunk the first time the Changes tab opens. */
export function loadMonaco(): Promise<MonacoModule> {
  loading ??= import('./monacoSetup').then((m) => m.monaco);
  // A failed load (a broken chunk) can be tried again.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
```

Check: `npm run typecheck`. If `self.MonacoEnvironment` is not typed, add to `src/declarations.d.ts`:

```ts
interface Window {
  MonacoEnvironment?: { getWorker(id: string, label: string): Worker };
}
```

(Monaco's own types usually declare `MonacoEnvironment` on the global scope; only add this if typecheck reports it missing.)

- [ ] **Step 4: Write `DiffView.tsx`**

```tsx
// src/renderer/components/review/DiffView.tsx
import type * as Monaco from 'monaco-editor';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReviewSide } from '../../../shared/review';
import { loadMonaco } from '../../review/loadMonaco';

export type DiffZone = { id: string; side: ReviewSide; afterLine: number; node: ReactNode };
export type DiffKey = 'j' | 'k' | 'n' | 'p' | 'v' | 'c';
export type DiffViewHandle = {
  goToChange(dir: 'next' | 'previous'): void;
  selection(): { side: ReviewSide; startLine: number; endLine: number } | null;
  focus(): void;
};
type Props = {
  /** Unique per file (`<workspaceId>/<path>`); a new key is a new file, the same key keeps scroll and zones. */
  uriKey: string;
  before: string;
  after: string;
  sideBySide: boolean;
  ignoreWhitespace: boolean;
  hideUnchanged: boolean;
  zones?: DiffZone[];
  onGlyph?: (side: ReviewSide, line: number) => void;
  onKey?: (key: DiffKey) => void;
  onReady?: (h: DiffViewHandle | null) => void;
};

/** Events inside a comment card must not reach Monaco (its keybindings and mouse handling). */
const SHIELD = ['keydown', 'keyup', 'keypress', 'mousedown', 'pointerdown', 'contextmenu', 'paste', 'copy', 'cut'];

export function DiffView(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(p);
  latest.current = p;
  const [m, setM] = useState<typeof Monaco | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [diff, setDiff] = useState<Monaco.editor.IStandaloneDiffEditor | null>(null);
  const [mounted, setMounted] = useState<{ id: string; dom: HTMLElement }[]>([]);

  useEffect(() => {
    let live = true;
    loadMonaco().then(
      (x) => live && setM(x),
      (e) => live && setFailed(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!m || !host.current) return;
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-code').trim();
    const d = m.editor.createDiffEditor(host.current, {
      theme: 'miac-dark',
      readOnly: true,
      originalEditable: false,
      domReadOnly: true,
      automaticLayout: true,
      glyphMargin: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderSideBySide: latest.current.sideBySide,
      useInlineViewWhenSpaceIsLimited: true,
      ignoreTrimWhitespace: latest.current.ignoreWhitespace,
      hideUnchangedRegions: { enabled: latest.current.hideUnchanged },
      fontSize: 13,
      ...(font ? { fontFamily: font } : {}),
    });
    const sides: [ReviewSide, Monaco.editor.ICodeEditor][] = [
      ['before', d.getOriginalEditor()],
      ['after', d.getModifiedEditor()],
    ];
    const subs: Monaco.IDisposable[] = [];
    const keys: [DiffKey, number][] = [
      ['j', m.KeyCode.KeyJ],
      ['k', m.KeyCode.KeyK],
      ['n', m.KeyCode.KeyN],
      ['p', m.KeyCode.KeyP],
      ['v', m.KeyCode.KeyV],
      ['c', m.KeyCode.KeyC],
    ];
    for (const [side, ed] of sides) {
      let hover: string[] = [];
      subs.push(
        ed.onMouseMove((e) => {
          const line = e.target.position?.lineNumber;
          hover = ed.deltaDecorations(
            hover,
            line && latest.current.onGlyph
              ? [{ range: new m.Range(line, 1, line, 1), options: { glyphMarginClassName: 'review-add-glyph' } }]
              : [],
          );
        }),
        ed.onMouseLeave(() => {
          hover = ed.deltaDecorations(hover, []);
        }),
        ed.onMouseDown((e) => {
          if (e.target.type === m.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position)
            latest.current.onGlyph?.(side, e.target.position.lineNumber);
        }),
      );
      // Plain letters only: Cmd/Ctrl+C still copies.
      for (const [key, code] of keys) ed.addCommand(code, () => latest.current.onKey?.(key));
    }
    const handle: DiffViewHandle = {
      goToChange: (dir) => d.goToDiff(dir),
      selection: () => {
        const focused = sides.find(([, ed]) => ed.hasTextFocus()) ?? sides[1];
        const s = focused[1].getSelection();
        if (!s) return null;
        // A selection that ends at column 1 of the next line covers the lines above it.
        const end = s.endLineNumber > s.startLineNumber && s.endColumn === 1 ? s.endLineNumber - 1 : s.endLineNumber;
        return { side: focused[0], startLine: s.startLineNumber, endLine: end };
      },
      focus: () => d.getModifiedEditor().focus(),
    };
    setDiff(d);
    latest.current.onReady?.(handle);
    return () => {
      latest.current.onReady?.(null);
      for (const s of subs) s.dispose();
      const model = d.getModel();
      d.dispose();
      model?.original.dispose();
      model?.modified.dispose();
      setDiff(null);
    };
  }, [m]);

  useEffect(() => {
    diff?.updateOptions({
      renderSideBySide: p.sideBySide,
      ignoreTrimWhitespace: p.ignoreWhitespace,
      hideUnchangedRegions: { enabled: p.hideUnchanged },
    });
  }, [diff, p.sideBySide, p.ignoreWhitespace, p.hideUnchanged]);

  useEffect(() => {
    if (!m || !diff) return;
    const uri = (side: ReviewSide) => m.Uri.from({ scheme: 'miac-review', path: `/${side}/${p.uriKey}` });
    const cur = diff.getModel();
    if (cur && cur.modified.uri.toString() === uri('after').toString()) {
      // The same file changed on disk: keep the reader's place.
      const view = diff.saveViewState();
      if (cur.original.getValue() !== p.before) cur.original.setValue(p.before);
      if (cur.modified.getValue() !== p.after) cur.modified.setValue(p.after);
      if (view) diff.restoreViewState(view);
      return;
    }
    const original = m.editor.createModel(p.before, undefined, uri('before'));
    const modified = m.editor.createModel(p.after, undefined, uri('after'));
    diff.setModel({ original, modified });
    cur?.original.dispose();
    cur?.modified.dispose();
  }, [m, diff, p.uriKey, p.before, p.after]);

  const zoneSig = useMemo(
    () => JSON.stringify((p.zones ?? []).map((z) => [z.id, z.side, z.afterLine])),
    [p.zones],
  );

  useEffect(() => {
    if (!diff) return;
    const eds = { before: diff.getOriginalEditor(), after: diff.getModifiedEditor() };
    const made: { id: string; side: ReviewSide; zoneId: string; zone: Monaco.editor.IViewZone; inner: HTMLElement; ro: ResizeObserver }[] = [];
    for (const side of ['before', 'after'] as const) {
      eds[side].changeViewZones((acc) => {
        for (const z of (latest.current.zones ?? []).filter((x) => x.side === side)) {
          const dom = document.createElement('div');
          dom.className = 'review-zone';
          for (const ev of SHIELD) dom.addEventListener(ev, (e) => e.stopPropagation());
          const inner = document.createElement('div');
          dom.appendChild(inner);
          const zone: Monaco.editor.IViewZone = { afterLineNumber: z.afterLine, heightInPx: 96, domNode: dom, suppressMouseDown: true };
          const zoneId = acc.addZone(zone);
          const ro = new ResizeObserver(() => {
            const h = inner.offsetHeight + 8;
            if (h > 8 && Math.abs(h - (zone.heightInPx ?? 0)) > 1) {
              zone.heightInPx = h;
              eds[side].changeViewZones((a) => a.layoutZone(zoneId));
            }
          });
          ro.observe(inner);
          made.push({ id: z.id, side, zoneId, zone, inner, ro });
        }
      });
    }
    setMounted(made.map((x) => ({ id: x.id, dom: x.inner })));
    return () => {
      for (const x of made) x.ro.disconnect();
      for (const side of ['before', 'after'] as const)
        eds[side].changeViewZones((acc) => {
          for (const x of made) if (x.side === side) acc.removeZone(x.zoneId);
        });
      setMounted([]);
    };
    // Zones are rebuilt when their ids or lines change, or a new file is shown (setModel clears them).
  }, [diff, zoneSig, p.uriKey]);

  const nodes = new Map((p.zones ?? []).map((z) => [z.id, z.node]));
  if (failed) return <div className="review-empty">{`The diff viewer could not load: ${failed}`}</div>;
  return (
    <>
      <div ref={host} className="review-diff" />
      {mounted.map((x) => createPortal(nodes.get(x.id) ?? null, x.dom, x.id))}
    </>
  );
}
```

- [ ] **Step 5: Styles**

Append to `src/renderer/styles/review.css`:

```css
.review-diff {
  flex: 1;
  min-height: 0;
  width: 100%;
}
.review-empty {
  padding: 24px;
  color: var(--muted);
}
/* The + that starts a comment, in the glyph margin of the hovered line. */
.review-add-glyph {
  cursor: pointer;
}
.review-add-glyph::before {
  content: '+';
  display: block;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  line-height: 16px;
  text-align: center;
  border-radius: var(--radius);
  background: var(--accent);
  color: #fff;
  font: 600 13px var(--font-ui);
}
.review-zone {
  padding: 4px 16px 4px 8px;
  font-family: var(--font-ui);
}
```

- [ ] **Step 6: Check it builds and the chunk is separate**

Run: `npm run typecheck && npm run lint:fix && npm run lint && npm test`
Expected: PASS (nothing imports DiffView yet, so tests are unchanged).

Run: `npm run package`
Expected: success; `ls out/*/` shows the app. Then check the renderer bundle has separate chunks for Monaco and its workers:

```bash
find out -path '*renderer*' -name '*.js' -size +1M | head
```

Expected: several files (the Monaco chunk and the `ts.worker` file), none of them the main renderer entry.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.renderer.config.mts src/renderer/review/monacoSetup.ts src/renderer/review/loadMonaco.ts src/renderer/components/review/DiffView.tsx src/renderer/styles/review.css src/declarations.d.ts
git commit -m "feat(review): Monaco diff viewer, bundled and loaded on first use"
```

---

### Task 9: Changes pivot, file tree, scopes, viewed

**Files:**
- Modify: `src/renderer/store.ts` (`CHANGES_TAB`, `activeTab`, `openChanges`), `src/renderer/components/TerminalTabs.tsx` (pivot, badge, panel), `src/renderer/test-helpers/fakeApi.ts` (review defaults), `src/renderer/docs/holdDocsWatch.ts`, `src/renderer/styles/review.css`
- Create: `src/renderer/review/holdWatch.ts`, `src/renderer/review/useReview.ts`, `src/renderer/review/reviewPrefs.ts`, `src/renderer/components/review/ChangesTab.tsx`, `src/renderer/components/review/FileTree.tsx`, `src/renderer/components/review/ScopePicker.tsx`
- Test: `src/renderer/review/holdWatch.test.ts`, `src/renderer/components/review/ChangesTab.test.tsx`, `src/renderer/store.test.tsx` (one new test)

**Interfaces:**
- Consumes: `review:*` IPC (Task 5), `DiffView` (Task 8), `OpenInEditor` (Task 7), `PopupMenu`, `isGenerated`, `viewedKey`, `docsTarget`, `activeWorkspaces`, `HOME_ID`.
- Produces:
  - `CHANGES_TAB = 'changes'`, store action `openChanges(taskId: string): void`
  - `holdWatch(channel: 'docs:watch' | 'review:watch', target: string, onLive?: (live: boolean) => void): () => void` (`holdDocsWatch(taskId, onLive)` becomes `holdWatch('docs:watch', taskId, onLive)`)
  - `reviewTarget(taskId: string, workspaceId: string): string` (the task id for the home repo, else `docsTarget(taskId, workspaceId)`)
  - `useReview(task: TaskView, scope: ReviewScope, visible: boolean): { files: ReviewFiles | null; state: ReviewState | null; setState(s: ReviewState): void; refresh(): void; changedAt: number }` (`changedAt` increases on each watcher event, so the open file reloads)
  - `useChangeCount(task: TaskView, visible: boolean): number | null`
  - `readReviewPrefs()/writeReviewPrefs(p)` with `{ sideBySide: boolean; ignoreWhitespace: boolean; hideUnchanged: boolean }`
  - `ChangesTab` component `<ChangesTab task: TaskView />`

- [ ] **Step 1: Generalise the watch hold (test first)**

```ts
// src/renderer/review/holdWatch.test.ts
import { describe, expect, it } from 'vitest';
import { installFakeApi } from '../test-helpers/fakeApi';
import { holdWatch } from './holdWatch';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('holdWatch', () => {
  it('sends on, reports live, and off on release', async () => {
    const { calls } = installFakeApi({ 'review:watch': () => ({ live: true }) });
    const lives: boolean[] = [];
    const release = holdWatch('review:watch', 't1#w2', (l) => lives.push(l));
    await flush();
    release();
    await flush();
    expect(calls.filter((c) => c.channel === 'review:watch').map((c) => c.args)).toEqual([
      ['t1#w2', true],
      ['t1#w2', false],
    ]);
    expect(lives).toEqual([true]);
  });

  it('sends no off for a watcher main already stopped', async () => {
    const { calls, emit } = installFakeApi({ 'review:watch': () => ({ live: true }) });
    const lives: boolean[] = [];
    const release = holdWatch('review:watch', 't1', (l) => lives.push(l));
    await flush();
    emit('docs:watchStopped', { taskId: 't1' });
    release();
    await flush();
    expect(calls.filter((c) => c.channel === 'review:watch')).toHaveLength(1);
    expect(lives).toEqual([true, false]);
  });
});
```

Run: `npx vitest run src/renderer/review/holdWatch.test.ts` → FAIL.

Create `src/renderer/review/holdWatch.ts` by moving the body of `holdDocsWatch` (in `src/renderer/docs/holdDocsWatch.ts`) into:

```ts
// src/renderer/review/holdWatch.ts
import { api } from '../api';

/**
 * Holds a watcher in main until the returned release is called. Main reference-counts, so an off is sent only
 * for an on that succeeded, and not for a watcher main already stopped (`docs:watchStopped`, which covers both
 * watch channels), which would decrement a newer holder's count. `onLive` learns whether changes are pushed
 * (true) or must be polled (false).
 */
export function holdWatch(
  channel: 'docs:watch' | 'review:watch',
  target: string,
  onLive: (live: boolean) => void = () => {},
): () => void {
  let released = false;
  let held = false;
  let stopped = false;
  const offStopped = api().on('docs:watchStopped', (p) => {
    if (p.taskId !== target) return;
    stopped = true;
    if (!released) onLive(false);
  });
  const sendOff = () => {
    if (!stopped)
      void api()
        .invoke(channel, target, false)
        .catch(() => undefined);
  };
  const pendingOn = api()
    .invoke(channel, target, true)
    .then(
      (r) => {
        held = true;
        // A stop reported before this reply was for the watcher before ours: this on started a new one.
        stopped = false;
        if (!released) onLive(r.live);
        return true;
      },
      () => false,
    );
  return () => {
    released = true;
    offStopped();
    if (held) sendOff();
    else void pendingOn.then((ok) => ok && sendOff());
  };
}
```

and reduce `src/renderer/docs/holdDocsWatch.ts` to:

```ts
import { holdWatch } from '../review/holdWatch';

/** Holds the task's docs watcher; see holdWatch. */
export function holdDocsWatch(taskId: string, onLive: (live: boolean) => void = () => {}): () => void {
  return holdWatch('docs:watch', taskId, onLive);
}
```

Run: `npx vitest run src/renderer/review/holdWatch.test.ts src/renderer/components/docs` → PASS.

- [ ] **Step 2: Store tab (test first)**

Add to `src/renderer/store.test.tsx`:

```ts
it('keeps the Changes tab and opens it for a task', () => {
  useStore.setState({ tasks: [{ id: 't1', terminals: [] } as never], tabByTask: {} });
  useStore.getState().openChanges('t1');
  expect(useStore.getState().selectedTaskId).toBe('t1');
  expect(useStore.getState().activeTab('t1')).toBe(CHANGES_TAB);
});
```

(import `CHANGES_TAB` from `./store`.) Run → FAIL.

In `src/renderer/store.ts`: add `export const CHANGES_TAB = 'changes';`; in `activeTab` add `if (want === CHANGES_TAB) return CHANGES_TAB;` after the `DOCS_TAB` line; add `openChanges: (taskId: string) => void;` to the store type and implement it like `openUsage` without the telemetry:

```ts
  openChanges: (taskId) => {
    get().select(taskId);
    get().go({ kind: 'task' });
    set({ tabByTask: { ...get().tabByTask, [taskId]: CHANGES_TAB } });
  },
```

Run → PASS.

- [ ] **Step 3: Review defaults in the fake API**

In `src/renderer/test-helpers/fakeApi.ts` `defaults`:

```ts
  'review:files': () => ({ repos: [] }),
  'review:state': () => ({ version: 1, viewed: {}, comments: [] }),
  'review:summary': () => ({ files: 0, notViewed: 0, unresolved: 0 }),
  'review:watch': () => ({ live: true }),
```

- [ ] **Step 4: Write the failing ChangesTab test**

```tsx
// src/renderer/components/review/ChangesTab.test.tsx
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewFiles, ReviewState } from '../../../shared/review';
import type { TaskView } from '../../../shared/types';
import { useStore } from '../../store';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { ChangesTab } from './ChangesTab';

// Monaco does not run in jsdom: a stand-in that shows what it was given and renders the zones inline.
vi.mock('./DiffView', () => ({
  DiffView: (p: { uriKey: string; before: string; after: string; zones?: { id: string; node: unknown }[] }) => (
    <div data-testid="diff" data-key={p.uriKey}>
      <pre data-testid="before">{p.before}</pre>
      <pre data-testid="after">{p.after}</pre>
      {(p.zones ?? []).map((z) => (
        <div key={z.id} data-testid={`zone-${z.id}`}>
          {z.node as never}
        </div>
      ))}
    </div>
  ),
}));

const task = {
  id: 't1',
  repoId: 'r1',
  status: 'ready',
  branch: 'task',
  worktreePath: '/wt',
  terminals: [{ id: 'c1', kind: 'claude', label: 'Claude Code' }],
  worktreeMissing: false,
  extraWorkspaces: [],
  homeDropped: false,
} as unknown as TaskView;

const file = (path: string, hash: string, status = 'M') =>
  ({ path, status, added: 1, removed: 1, binary: false, hash }) as const;
let files: ReviewFiles;
let state: ReviewState;

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ repos: [], tabByTask: {} });
  files = {
    repos: [
      {
        workspaceId: 'home',
        name: 'web',
        base: 'b'.repeat(40),
        commits: [
          { sha: 'c'.repeat(40), subject: 'second', author: 'Dev', date: '2026-10-17T09:00:00Z' },
          { sha: 'd'.repeat(40), subject: 'first', author: 'Dev', date: '2026-10-17T08:00:00Z' },
        ],
        collapse: [],
        files: [file('src/a.ts', 'h1'), file('package-lock.json', 'h2'), file('src/b.ts', 'h3', 'A')],
      },
    ],
  };
  state = { version: 1, viewed: {}, comments: [] };
});

function mount(over = {}) {
  const api = installFakeApi({
    'review:files': () => files,
    'review:state': () => state,
    'review:file': (_t, _w, f) => ({ before: `old ${f.path}`, after: `new ${f.path}`, binary: false, tooLarge: false, beforeSize: 1, afterSize: 1 }),
    'review:setViewed': (_t, key, hash) => {
      state = { ...state, viewed: { ...state.viewed } };
      if (hash) state.viewed[key] = hash;
      else delete state.viewed[key];
      return state;
    },
    ...over,
  });
  render(<ChangesTab task={task} />);
  return api;
}

describe('ChangesTab', () => {
  it('lists files with generated ones collapsed, and opens the first file', async () => {
    mount();
    const tree = await screen.findByRole('tree', { name: 'Changed files' });
    expect(within(tree).getByText('a.ts')).toBeTruthy();
    expect(within(tree).getByText('b.ts')).toBeTruthy();
    expect(within(tree).getByText('Generated (1)')).toBeTruthy();
    expect(within(tree).queryByText('package-lock.json')).toBeNull();
    expect((await screen.findByTestId('after')).textContent).toBe('new src/a.ts');
    expect(screen.getByText('0 / 3 viewed')).toBeTruthy();
  });

  it('marks a file viewed, and shows it changed since when its hash moves', async () => {
    const api = mount();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Viewed src/a.ts' }));
    await screen.findByText('1 / 3 viewed');
    expect(api.calls.find((c) => c.channel === 'review:setViewed')?.args).toEqual(['t1', 'home:src/a.ts', 'h1']);
    files = { repos: [{ ...files.repos[0], files: [file('src/a.ts', 'h9'), ...files.repos[0].files.slice(1)] }] };
    act(() => api.emit('review:changed', { taskId: 't1' }));
    await screen.findByText('Changed since viewed');
    expect(screen.getByText('0 / 3 viewed')).toBeTruthy();
  });

  it('shows another file when clicked, and reloads the open file on a change', async () => {
    const api = mount();
    fireEvent.click(await screen.findByText('b.ts'));
    await waitFor(() => expect(screen.getByTestId('after').textContent).toBe('new src/b.ts'));
    const reads = () => api.calls.filter((c) => c.channel === 'review:file').length;
    const before = reads();
    act(() => api.emit('docs:changed', { taskId: 't1', paths: ['src/b.ts'] }));
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });

  it('switches to Uncommitted and to one commit', async () => {
    const api = mount();
    await screen.findByRole('tree', { name: 'Changed files' });
    fireEvent.click(screen.getByRole('button', { name: 'Uncommitted' }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.channel === 'review:files' && (c.args[1] as { kind: string }).kind === 'uncommitted')).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Commits' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /first/ }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.channel === 'review:files' && (c.args[1] as { kind: string; from?: string }).from === 'd'.repeat(40))).toBe(true),
    );
    expect(screen.getByText('Comments are shown in All changes')).toBeTruthy();
  });

  it('shows a repo error and the no-base message without losing other repos', async () => {
    files = {
      repos: [
        { ...files.repos[0], error: 'No base for this task: only uncommitted changes can be shown', files: [] },
        { workspaceId: 'w2', name: 'api', base: null, commits: [], collapse: [], files: [file('x.cs', 'h4')] },
      ],
    };
    mount();
    expect(await screen.findByText('No base for this task: only uncommitted changes can be shown')).toBeTruthy();
    expect(screen.getByText('x.cs')).toBeTruthy();
  });

  it('says so when nothing changed', async () => {
    files = { repos: [{ ...files.repos[0], files: [] }] };
    mount();
    expect(await screen.findByText('No changes since the task started.')).toBeTruthy();
  });

  it('shows sizes instead of a diff for a binary file', async () => {
    files = { repos: [{ ...files.repos[0], files: [{ ...file('logo.png', 'h5'), binary: true }] }] };
    mount({
      'review:file': () => ({ before: null, after: null, binary: true, tooLarge: false, beforeSize: 1200, afterSize: 3482 }),
    });
    expect(await screen.findByText('Binary file, 1.2 KB → 3.4 KB')).toBeTruthy();
  });
});
```

Run: `npx vitest run src/renderer/components/review/ChangesTab.test.tsx` → FAIL, "Failed to resolve import ./ChangesTab".

- [ ] **Step 5: Write `reviewPrefs.ts` and `useReview.ts`**

```ts
// src/renderer/review/reviewPrefs.ts
export type ReviewPrefs = { sideBySide: boolean; ignoreWhitespace: boolean; hideUnchanged: boolean };
const KEY = 'miac.review.prefs';
const DEFAULT: ReviewPrefs = { sideBySide: true, ignoreWhitespace: false, hideUnchanged: true };

export function readReviewPrefs(storage: Storage | undefined = globalThis.localStorage): ReviewPrefs {
  try {
    const v = JSON.parse(storage?.getItem(KEY) ?? 'null') as Partial<ReviewPrefs> | null;
    return {
      sideBySide: typeof v?.sideBySide === 'boolean' ? v.sideBySide : DEFAULT.sideBySide,
      ignoreWhitespace: typeof v?.ignoreWhitespace === 'boolean' ? v.ignoreWhitespace : DEFAULT.ignoreWhitespace,
      hideUnchanged: typeof v?.hideUnchanged === 'boolean' ? v.hideUnchanged : DEFAULT.hideUnchanged,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function writeReviewPrefs(p: ReviewPrefs, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify(p));
  } catch {
    /* best effort */
  }
}
```

```ts
// src/renderer/review/useReview.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewFiles, ReviewScope, ReviewState } from '../../shared/review';
import type { TaskView } from '../../shared/types';
import { activeWorkspaces, docsTarget, HOME_ID, parseDocsTarget } from '../../shared/workspaces';
import { api } from '../api';
import { holdWatch } from './holdWatch';

const POLL_MS = 5000;
const SETTLE_MS = 200;

/** The home repo shares the Docs tab's watcher key (the task id); other repos use `<taskId>#<workspaceId>`. */
export const reviewTarget = (taskId: string, workspaceId: string): string =>
  workspaceId === HOME_ID ? taskId : docsTarget(taskId, workspaceId);

/** Follows the task's worktrees (files and git dirs) while `visible`; polls when a watcher is not live. */
function useWorktreeChanges(task: TaskView, visible: boolean, onChange: () => void) {
  const latest = useRef(onChange);
  latest.current = onChange;
  const ids = activeWorkspaces(task)
    .map((w) => w.id)
    .join(',');
  useEffect(() => {
    if (!visible || task.status !== 'ready' || task.worktreeMissing) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      timer ??= setTimeout(() => {
        timer = null;
        latest.current();
      }, SETTLE_MS);
    };
    const mine = (target: string) => parseDocsTarget(target).taskId === task.id;
    const offs = [
      api().on('docs:changed', (p) => mine(p.taskId) && soon()),
      api().on('review:changed', (p) => mine(p.taskId) && soon()),
    ];
    let poll: ReturnType<typeof setInterval> | null = null;
    const releases = ids.split(',').map((id) =>
      holdWatch('review:watch', reviewTarget(task.id, id), (live) => {
        if (!live && !poll) poll = setInterval(() => latest.current(), POLL_MS);
      }),
    );
    return () => {
      for (const off of offs) off();
      for (const r of releases) r();
      if (poll) clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [task.id, task.status, task.worktreeMissing, visible, ids]);
}

export function useReview(task: TaskView, scope: ReviewScope, visible: boolean) {
  const [files, setFiles] = useState<ReviewFiles | null>(null);
  const [state, setState] = useState<ReviewState | null>(null);
  const [changedAt, setChangedAt] = useState(0);
  const scopeKey = JSON.stringify(scope);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    const n = ++seq.current;
    void Promise.all([
      api().invoke('review:files', task.id, JSON.parse(scopeKey) as ReviewScope),
      api().invoke('review:state', task.id),
    ]).then(
      ([f, s]) => {
        // An answer for an older scope or refresh is dropped.
        if (n !== seq.current) return;
        setFiles(f);
        setState(s);
        setChangedAt((x) => x + 1);
      },
      () => undefined,
    );
  }, [task.id, scopeKey]);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);
  useWorktreeChanges(task, visible, refresh);

  return { files, state, setState, refresh, changedAt };
}

/** The number of files in All changes, for the pivot's badge. */
export function useChangeCount(task: TaskView, visible: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  const refresh = useCallback(() => {
    void api()
      .invoke('review:files', task.id, { kind: 'all' })
      .then(
        (f) => setCount(f.repos.reduce((n, r) => n + r.files.length, 0)),
        () => setCount(null),
      );
  }, [task.id]);
  useEffect(() => {
    if (visible && task.status === 'ready' && !task.worktreeMissing) refresh();
  }, [visible, task.status, task.worktreeMissing, refresh]);
  useWorktreeChanges(task, visible, refresh);
  return count;
}
```

Note: `useChangeCount` and `useReview` both hold `review:watch` for the same targets while Changes is open; main counts holders, so this is two holds and two offs, which is correct.

- [ ] **Step 6: Write `ScopePicker.tsx` and `FileTree.tsx`**

```tsx
// src/renderer/components/review/ScopePicker.tsx
import { ChevronDown16Regular } from '@fluentui/react-icons';
import { useCallback, useState } from 'react';
import type { ReviewRepo, ReviewScope } from '../../../shared/review';
import { PopupMenu } from '../ui';

const short = (sha: string) => sha.slice(0, 7);

/** All changes / Uncommitted / Commits (one commit, or a range with Shift). */
export function ScopePicker({
  scope,
  repos,
  onChange,
}: {
  scope: ReviewScope;
  repos: ReviewRepo[];
  onChange: (s: ReviewScope) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const withCommits = repos.filter((r) => r.commits.length > 0);
  const pick = (r: ReviewRepo, index: number, range: boolean) => {
    const sha = r.commits[index].sha;
    if (range && scope.kind === 'commits' && scope.workspaceId === r.workspaceId) {
      // Commits are newest first: the older end of the range has the higher index.
      const ia = r.commits.findIndex((c) => c.sha === scope.from);
      const lo = Math.max(ia, index);
      const hi = Math.min(r.commits.findIndex((c) => c.sha === scope.to), index);
      onChange({ kind: 'commits', workspaceId: r.workspaceId, from: r.commits[lo].sha, to: r.commits[hi].sha });
    } else onChange({ kind: 'commits', workspaceId: r.workspaceId, from: sha, to: sha });
    setOpen(false);
  };
  const commitLabel =
    scope.kind === 'commits'
      ? scope.from === scope.to
        ? `Commit ${short(scope.from)}`
        : `${short(scope.from)}..${short(scope.to)}`
      : 'Commits';
  return (
    <div className="review-scope" role="group" aria-label="Scope">
      <button type="button" className="btn btn-sm" aria-pressed={scope.kind === 'all'} onClick={() => onChange({ kind: 'all' })}>
        All changes
      </button>
      <button type="button" className="btn btn-sm" aria-pressed={scope.kind === 'uncommitted'} onClick={() => onChange({ kind: 'uncommitted' })}>
        Uncommitted
      </button>
      <button
        ref={setAnchor}
        type="button"
        className="btn btn-sm"
        aria-label="Commits"
        aria-pressed={scope.kind === 'commits'}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={withCommits.length === 0}
        onClick={() => setOpen(!open)}
      >
        {commitLabel}
        <ChevronDown16Regular aria-hidden="true" />
      </button>
      <PopupMenu label="Commits" anchor={anchor} open={open} onClose={close}>
        {withCommits.map((r) =>
          r.commits.map((c, i) => (
            <button
              key={`${r.workspaceId}:${c.sha}`}
              type="button"
              role="menuitem"
              className="menu-item"
              aria-label={`${c.subject} ${short(c.sha)}`}
              onClick={(e) => pick(r, i, e.shiftKey)}
            >
              <span className="menu-title">{c.subject}</span>
              <span className="small muted mono">
                {`${withCommits.length > 1 ? `${r.name} · ` : ''}${short(c.sha)} · ${c.author}`}
              </span>
            </button>
          )),
        )}
        <div className="small muted review-scope-hint">Shift-click a second commit for a range.</div>
      </PopupMenu>
    </div>
  );
}
```

```tsx
// src/renderer/components/review/FileTree.tsx
import { useState } from 'react';
import { isGenerated, type ReviewFile, type ReviewRepo, viewedKey } from '../../../shared/review';

export type FileRef = { workspaceId: string; path: string };
const STATUS_LABEL = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed' } as const;
const split = (p: string) => {
  const i = p.lastIndexOf('/');
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i + 1), name: p.slice(i + 1) };
};

function Row({
  repo,
  file,
  selected,
  viewedHash,
  comments,
  onSelect,
  onViewed,
}: {
  repo: ReviewRepo;
  file: ReviewFile;
  selected: boolean;
  viewedHash: string | undefined;
  comments: number;
  onSelect: () => void;
  onViewed: (on: boolean) => void;
}) {
  const { dir, name } = split(file.path);
  const viewed = viewedHash === file.hash;
  const changedSince = viewedHash !== undefined && !viewed;
  return (
    <div role="treeitem" aria-selected={selected} className={`review-file${selected ? ' selected' : ''}`} onClick={onSelect}>
      <span className={`review-status review-status-${file.status}`} title={STATUS_LABEL[file.status]}>
        {file.status}
      </span>
      <span className="review-name" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
        <span>{name}</span>
        {dir && <span className="muted small"> {dir}</span>}
        {changedSince && <span className="tag tag-warn review-changed">Changed since viewed</span>}
      </span>
      {comments > 0 && <span className="small review-count" aria-label={`${comments} comments`}>{comments}</span>}
      <span className="small mono review-stat">
        {file.binary ? 'bin' : <><span className="review-plus">+{file.added}</span> <span className="review-minus">−{file.removed}</span></>}
      </span>
      <input
        type="checkbox"
        aria-label={`Viewed ${file.path}`}
        checked={viewed}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onViewed(e.target.checked)}
      />
    </div>
  );
}

/** Changed files per repo; generated files (lock files, dist, the repo's review.collapse) folded away. */
export function FileTree({
  repos,
  selected,
  viewed,
  commentCount,
  onSelect,
  onViewed,
}: {
  repos: ReviewRepo[];
  selected: FileRef | null;
  viewed: Record<string, string>;
  commentCount: (ref: FileRef) => number;
  onSelect: (ref: FileRef) => void;
  onViewed: (repo: ReviewRepo, file: ReviewFile, on: boolean) => void;
}) {
  const [openGenerated, setOpenGenerated] = useState<Record<string, boolean>>({});
  const grouped = repos.length > 1;
  return (
    <div role="tree" aria-label="Changed files" className="review-tree">
      {repos.map((r) => {
        const normal = r.files.filter((f) => !isGenerated(f.path, r.collapse));
        const generated = r.files.filter((f) => isGenerated(f.path, r.collapse));
        const row = (f: ReviewFile) => (
          <Row
            key={f.path}
            repo={r}
            file={f}
            selected={selected?.workspaceId === r.workspaceId && selected.path === f.path}
            viewedHash={viewed[viewedKey(r.workspaceId, f.path)]}
            comments={commentCount({ workspaceId: r.workspaceId, path: f.path })}
            onSelect={() => onSelect({ workspaceId: r.workspaceId, path: f.path })}
            onViewed={(on) => onViewed(r, f, on)}
          />
        );
        return (
          <div key={r.workspaceId} role="group" aria-label={r.name} className="review-repo">
            {grouped && <div className="review-repo-name">{r.name}</div>}
            {r.error && (
              <div role="alert" className="review-repo-error small">
                {r.error}
              </div>
            )}
            {normal.map(row)}
            {generated.length > 0 && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm review-generated"
                  aria-expanded={Boolean(openGenerated[r.workspaceId])}
                  onClick={() => setOpenGenerated({ ...openGenerated, [r.workspaceId]: !openGenerated[r.workspaceId] })}
                >
                  {`Generated (${generated.length})`}
                </button>
                {openGenerated[r.workspaceId] && generated.map(row)}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7: Write `ChangesTab.tsx`**

```tsx
// src/renderer/components/review/ChangesTab.tsx
import { ArrowDown16Regular, ArrowUp16Regular } from '@fluentui/react-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type FileContent,
  isGenerated,
  type ReviewFile,
  type ReviewRepo,
  type ReviewScope,
  viewedKey,
} from '../../../shared/review';
import type { TaskView } from '../../../shared/types';
import { api, tryInvoke } from '../../api';
import { readReviewPrefs, type ReviewPrefs, writeReviewPrefs } from '../../review/reviewPrefs';
import { useReview } from '../../review/useReview';
import { useStore } from '../../store';
import { track } from '../../telemetry';
import { OpenInEditor } from '../OpenInEditor';
import { DiffView, type DiffKey, type DiffViewHandle } from './DiffView';
import { FileTree, type FileRef } from './FileTree';
import { ScopePicker } from './ScopePicker';

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Files in tree order (generated files last), for next/previous file. */
function ordered(repos: ReviewRepo[]): { repo: ReviewRepo; file: ReviewFile }[] {
  return repos.flatMap((r) => {
    const all = r.files.map((file) => ({ repo: r, file }));
    return [...all.filter((x) => !isGenerated(x.file.path, r.collapse)), ...all.filter((x) => isGenerated(x.file.path, r.collapse))];
  });
}

export function ChangesTab({ task }: { task: TaskView }) {
  const notify = useStore((s) => s.notify);
  const [scope, setScope] = useState<ReviewScope>({ kind: 'all' });
  const { files, state, setState, changedAt } = useReview(task, scope, true);
  const [selected, setSelected] = useState<FileRef | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [prefs, setPrefs] = useState<ReviewPrefs>(() => readReviewPrefs());
  const handle = useRef<DiffViewHandle | null>(null);
  const tracked = useRef(false);

  const list = useMemo(() => (files ? ordered(files.repos) : []), [files]);
  const current = list.find((x) => x.repo.workspaceId === selected?.workspaceId && x.file.path === selected.path) ?? null;

  // Keep the selection while the file is still listed; otherwise open the first file.
  useEffect(() => {
    if (!files) return;
    if (!current) setSelected(list[0] ? { workspaceId: list[0].repo.workspaceId, path: list[0].file.path } : null);
  }, [files, current, list]);

  useEffect(() => {
    if (!files || tracked.current) return;
    tracked.current = true;
    track('review.opened', { scope: scope.kind, files: list.length, repos: files.repos.length });
  }, [files, list.length, scope.kind]);

  const fileKey = current ? `${current.repo.workspaceId}/${current.file.path}/${current.file.hash}` : null;
  useEffect(() => {
    if (!current) {
      setContent(null);
      return;
    }
    let live = true;
    const { path, oldPath, status, binary } = current.file;
    void api()
      .invoke('review:file', task.id, current.repo.workspaceId, { path, ...(oldPath ? { oldPath } : {}), status, binary }, scope)
      .then((c) => live && setContent(c))
      .catch(() => live && setContent(null));
    return () => {
      live = false;
    };
    // fileKey covers the file and its content hash; changedAt reloads after a watcher event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey, changedAt, task.id, JSON.stringify(scope)]);

  const setPref = (patch: Partial<ReviewPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writeReviewPrefs(next);
  };

  const setViewed = async (repo: ReviewRepo, file: ReviewFile, on: boolean) => {
    const s = await tryInvoke(
      () => api().invoke('review:setViewed', task.id, viewedKey(repo.workspaceId, file.path), on ? file.hash : null),
      notify,
    );
    if (s) {
      setState(s);
      if (on) track('review.fileViewed');
    }
  };

  const step = (by: number) => {
    if (list.length === 0) return;
    const i = list.findIndex((x) => x === current);
    const next = list[(i + by + list.length) % list.length];
    setSelected({ workspaceId: next.repo.workspaceId, path: next.file.path });
  };
  const onKey = (key: DiffKey) => {
    if (key === 'j') step(1);
    else if (key === 'k') step(-1);
    else if (key === 'n') handle.current?.goToChange('next');
    else if (key === 'p') handle.current?.goToChange('previous');
    else if (key === 'v' && current) void setViewed(current.repo, current.file, state?.viewed[viewedKey(current.repo.workspaceId, current.file.path)] !== current.file.hash);
  };

  const total = list.length;
  const viewedCount = state ? list.filter((x) => state.viewed[viewedKey(x.repo.workspaceId, x.file.path)] === x.file.hash).length : 0;

  const body = () => {
    if (!files) return <div className="review-empty">Loading changes…</div>;
    if (total === 0 && files.repos.every((r) => !r.error))
      return <div className="review-empty">{scope.kind === 'uncommitted' ? 'Nothing uncommitted.' : 'No changes since the task started.'}</div>;
    if (!current) return null;
    if (!content) return <div className="review-empty">Loading {current.file.path}…</div>;
    if (content.binary) return <div className="review-empty">{`Binary file, ${kb(content.beforeSize)} → ${kb(content.afterSize)}`}</div>;
    if (content.tooLarge) return <div className="review-empty">{`Too large to show here (${kb(Math.max(content.beforeSize, content.afterSize))}). Open it in your editor.`}</div>;
    return (
      <DiffView
        uriKey={`${current.repo.workspaceId}/${current.file.path}`}
        before={content.before ?? ''}
        after={content.after ?? ''}
        sideBySide={prefs.sideBySide}
        ignoreWhitespace={prefs.ignoreWhitespace}
        hideUnchanged={prefs.hideUnchanged}
        onKey={onKey}
        onReady={(h) => {
          handle.current = h;
        }}
      />
    );
  };

  return (
    <section className="review" aria-label="Changes">
      <div className="review-head">
        <ScopePicker scope={scope} repos={files?.repos ?? []} onChange={(s) => setScope(s)} />
        <span className="small muted">{`${viewedCount} / ${total} viewed`}</span>
        <span className="grow" />
        <OpenInEditor taskId={task.id} workspaceId={current?.repo.workspaceId} />
      </div>
      {scope.kind !== 'all' && <div className="review-note small muted">Comments are shown in All changes</div>}
      <div className="review-body">
        <FileTree
          repos={files?.repos ?? []}
          selected={selected}
          viewed={state?.viewed ?? {}}
          commentCount={() => 0}
          onSelect={setSelected}
          onViewed={(r, f, on) => void setViewed(r, f, on)}
        />
        <div className="review-main">
          {current && (
            <div className="review-toolbar">
              <span className="mono small review-path">{current.file.oldPath ? `${current.file.oldPath} → ${current.file.path}` : current.file.path}</span>
              <span className="grow" />
              <label className="small">
                <input type="checkbox" checked={prefs.sideBySide} onChange={(e) => setPref({ sideBySide: e.target.checked })} /> Side by side
              </label>
              <label className="small">
                <input type="checkbox" checked={prefs.ignoreWhitespace} onChange={(e) => setPref({ ignoreWhitespace: e.target.checked })} /> Ignore whitespace
              </label>
              <label className="small">
                <input type="checkbox" checked={prefs.hideUnchanged} onChange={(e) => setPref({ hideUnchanged: e.target.checked })} /> Hide unchanged
              </label>
              <button type="button" className="btn btn-subtle btn-sm" aria-label="Previous change (p)" title="Previous change (p)" onClick={() => onKey('p')}>
                <ArrowUp16Regular />
              </button>
              <button type="button" className="btn btn-subtle btn-sm" aria-label="Next change (n)" title="Next change (n)" onClick={() => onKey('n')}>
                <ArrowDown16Regular />
              </button>
              <button type="button" className="btn btn-subtle btn-sm" title="Previous file (k)" onClick={() => onKey('k')}>
                Previous file
              </button>
              <button type="button" className="btn btn-subtle btn-sm" title="Next file (j)" onClick={() => onKey('j')}>
                Next file
              </button>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                disabled={current.file.status === 'D'}
                onClick={() =>
                  tryInvoke(
                    () => api().invoke('editor:openFile', task.id, current.repo.workspaceId, current.file.path, handle.current?.selection()?.startLine),
                    notify,
                  )
                }
              >
                Open file in editor
              </button>
            </div>
          )}
          {body()}
        </div>
      </div>
    </section>
  );
}
```

Page-level keys (focus outside the editor) arrive in Task 11; this task's keys come from `DiffView.onKey`.

- [ ] **Step 8: Styles**

Append to `src/renderer/styles/review.css`:

```css
.review {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.review-head,
.review-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
}
.review-head .grow,
.review-toolbar .grow {
  flex: 1;
}
.review-note {
  padding: 4px 12px;
  background: var(--bg-card);
}
.review-scope {
  display: inline-flex;
  gap: 2px;
}
.review-scope [aria-pressed='true'] {
  background: var(--bg-selected);
}
.review-scope-hint {
  padding: 6px 12px;
}
.review-body {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.review-tree {
  overflow: auto;
  border-right: 1px solid var(--line);
  padding: 4px 0;
}
.review-repo-name {
  padding: 6px 12px 2px;
  font-weight: 600;
}
.review-repo-error {
  margin: 4px 12px;
  color: var(--warn);
}
.review-file {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto auto 16px;
  align-items: center;
  gap: 6px;
  padding: 3px 12px;
  cursor: pointer;
}
.review-file:hover {
  background: var(--bg-hover);
}
.review-file.selected {
  background: var(--bg-selected);
}
.review-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.review-status {
  font: 600 11px var(--font-code);
  text-align: center;
}
.review-status-A {
  color: var(--green);
}
.review-status-D {
  color: var(--red);
}
.review-status-R,
.review-status-M {
  color: var(--link);
}
.review-plus {
  color: var(--green);
}
.review-minus {
  color: var(--red);
}
.review-count {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--accent-bg);
}
.review-changed {
  margin-left: 6px;
}
.review-generated {
  margin: 4px 8px;
}
.review-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.review-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 9: Run the ChangesTab tests**

Run: `npx vitest run src/renderer/components/review/ChangesTab.test.tsx`
Expected: PASS. If "Changed since viewed" is not found: the `Row` shows it when `viewedHash` is set and differs from `file.hash`; check that the refresh after `review:changed` replaced `files` (the 200 ms settle timer runs in real time in this test; `findByText` waits up to 1 s).

- [ ] **Step 10: The pivot on the task row**

In `src/renderer/components/TerminalTabs.tsx`:

1. Imports: `CHANGES_TAB` from `../store`, `ChangesTab` from `./review/ChangesTab`, `useChangeCount` from `../review/useReview`, and `BranchCompare16Regular` from `@fluentui/react-icons`.
2. Inside `TerminalTabs`: `const changeCount = useChangeCount(task, visible && ready);` (ChangesTab sends `review.opened` itself).
3. After the Docs pivot button, add:

```tsx
          {ready && !task.worktreeMissing && (
            <button
              type="button"
              role="tab"
              aria-selected={active === CHANGES_TAB}
              aria-label={changeCount ? `Changes, ${changeCount} files` : 'Changes'}
              className="pivot"
              onClick={() => setTab(task.id, CHANGES_TAB)}
            >
              <BranchCompare16Regular aria-hidden="true" />
              Changes
              {changeCount ? <span className="pivot-count">{changeCount}</span> : null}
            </button>
          )}
```

4. In `.termhost`, after the Docs panel line:

```tsx
        {visible && active === CHANGES_TAB && !task.worktreeMissing && <ChangesTab task={task} />}
```

Add to `review.css`:

```css
.pivot-count {
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--bg-selected);
  font-size: 11px;
}
```

Run: `npx vitest run src/renderer` → PASS (the fake API answers `review:files` with no repos, so the badge is hidden in existing tests).

- [ ] **Step 11: Full checks and commit**

Run: `npm test && npm run typecheck && npm run lint:fix && npm run lint`

```bash
git add -A src/renderer
git commit -m "feat(review): Changes tab with scopes, file tree and viewed files"
```

---
### Task 10: Review comments in the diff

**Files:**
- Create: `src/renderer/components/review/CommentCard.tsx`, `src/renderer/components/review/CommentsList.tsx`
- Modify: `src/renderer/components/review/DiffView.tsx` (`reveal` prop), `src/renderer/components/review/ChangesTab.tsx`, `src/renderer/styles/review.css`
- Test: `src/renderer/components/review/ChangesTab.test.tsx` (new tests), `src/renderer/components/review/CommentCard.test.tsx`

**Interfaces:**
- Consumes: `review:addComment`, `review:updateComment`, `review:deleteComment` (Task 5), `DiffZone`, `DiffView` (Task 8), `ChangesTab` (Task 9).
- Produces:
  - `DiffView` prop `reveal?: { side: ReviewSide; line: number; seq: number }` (scrolls the line into the centre when `seq` changes)
  - `<CommentBox initial?: string; onSave(text: string): void; onCancel(): void; saveLabel?: string />`
  - `<CommentCard comment: ReviewComment; onEdit(text: string): void; onResolve(): void; onReopen(): void; onDelete(): void; onOpen?(): void />`
  - `<CommentsList comments: ReviewComment[]; repoName(workspaceId: string): string; onOpen(c: ReviewComment): void />`

- [ ] **Step 1: Write the failing CommentCard test**

```tsx
// src/renderer/components/review/CommentCard.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewComment } from '../../../shared/review';
import { CommentBox, CommentCard } from './CommentCard';

const base: ReviewComment = {
  id: 'c1', workspaceId: 'home', path: 'src/a.ts', side: 'after', startLine: 3, endLine: 4,
  snippet: 'x()\ny()', contextBefore: '', contextAfter: '', text: 'Use **the cache**',
  status: 'open', createdAt: '2026-10-17T10:00:00.000Z', sentAt: null, resolvedAt: null,
};

describe('CommentBox', () => {
  it('saves trimmed text with the button or Ctrl/Cmd+Enter, and cancels with Escape', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<CommentBox onSave={onSave} onCancel={onCancel} />);
    const box = screen.getByRole('textbox', { name: 'Comment' });
    expect((screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: '  fix it  ' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith('fix it');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('CommentCard', () => {
  it('renders Markdown and its lines, and resolves', () => {
    const onResolve = vi.fn();
    render(<CommentCard comment={base} onEdit={vi.fn()} onResolve={onResolve} onReopen={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('the cache').tagName).toBe('STRONG');
    expect(screen.getByText('Lines 3-4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(onResolve).toHaveBeenCalled();
  });

  it('shows sent, and outdated with the old lines', () => {
    const { rerender } = render(
      <CommentCard comment={{ ...base, status: 'sent', sentAt: '2026-10-17T10:05:00.000Z' }} onEdit={vi.fn()} onResolve={vi.fn()} onReopen={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText(/^Sent/)).toBeTruthy();
    rerender(
      <CommentCard comment={{ ...base, status: 'outdated', sentAt: '2026-10-17T10:05:00.000Z' }} onEdit={vi.fn()} onResolve={vi.fn()} onReopen={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText('Code changed, probably addressed')).toBeTruthy();
    expect(screen.getByText(/x\(\)/)).toBeTruthy();
  });

  it('edits in place', () => {
    const onEdit = vi.fn();
    render(<CommentCard comment={base} onEdit={onEdit} onResolve={vi.fn()} onReopen={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: 'new text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith('new text');
  });
});
```

Run: `npx vitest run src/renderer/components/review/CommentCard.test.tsx` → FAIL.

- [ ] **Step 2: Write `CommentCard.tsx`**

```tsx
// src/renderer/components/review/CommentCard.tsx
import { type KeyboardEvent, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReviewComment } from '../../../shared/review';

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const lines = (c: Pick<ReviewComment, 'startLine' | 'endLine'>) =>
  c.startLine === c.endLine ? `Line ${c.startLine}` : `Lines ${c.startLine}-${c.endLine}`;

export function CommentBox({
  initial = '',
  saveLabel = 'Comment',
  onSave,
  onCancel,
}: {
  initial?: string;
  saveLabel?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const save = () => {
    if (text.trim()) onSave(text.trim());
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <div className="review-card review-box">
      <textarea
        className="field"
        aria-label="Comment"
        // eslint-disable-next-line jsx-a11y/no-autofocus -- a new comment box is where the user types next
        autoFocus
        rows={3}
        value={text}
        placeholder="What should change here? Markdown works."
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      <div className="review-card-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={save}>
          {saveLabel}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function CommentCard({
  comment: c,
  onEdit,
  onResolve,
  onReopen,
  onDelete,
  onOpen,
}: {
  comment: ReviewComment;
  onEdit: (text: string) => void;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onOpen?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <CommentBox
        initial={c.text}
        saveLabel="Save"
        onSave={(t) => {
          setEditing(false);
          onEdit(t);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  const status =
    c.status === 'sent'
      ? `Sent ${c.sentAt ? time(c.sentAt) : ''}`.trim()
      : c.status === 'outdated'
        ? c.sentAt
          ? 'Code changed, probably addressed'
          : 'Code changed'
        : c.status === 'resolved'
          ? 'Resolved'
          : 'Open';
  return (
    <div className={`review-card review-card-${c.status}`}>
      <div className="review-card-head small">
        <span className={`tag${c.status === 'outdated' ? ' tag-warn' : c.status === 'sent' ? ' tag-green' : ''}`}>{status}</span>
        {onOpen ? (
          <button type="button" className="btn btn-ghost btn-sm mono" onClick={onOpen}>
            {`${c.path}:${c.startLine}`}
          </button>
        ) : (
          <span className="muted">{lines(c)}</span>
        )}
      </div>
      {c.status === 'outdated' && <pre className="review-snippet mono small">{c.snippet}</pre>}
      <div className="review-card-text">
        <Markdown remarkPlugins={[remarkGfm]}>{c.text}</Markdown>
      </div>
      <div className="review-card-actions">
        {c.status === 'resolved' ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReopen}>
            Reopen
          </button>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onResolve}>
            Resolve
          </button>
        )}
        {c.status !== 'resolved' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
```

Check the lint rule names in the `eslint-disable` comment: the repo lints with oxlint; if oxlint does not report `jsx-a11y/no-autofocus`, delete the comment line (an unused disable comment is fine for oxlint but keep the code clean).

Run: `npx vitest run src/renderer/components/review/CommentCard.test.tsx` → PASS.

- [ ] **Step 3: Write `CommentsList.tsx`**

```tsx
// src/renderer/components/review/CommentsList.tsx
import type { ReviewComment } from '../../../shared/review';

const ORDER = { open: 0, sent: 1, outdated: 2, resolved: 3 } as const;

/** Every comment of the task, unresolved first; a click opens its file at its line. */
export function CommentsList({
  comments,
  repoName,
  multiRepo,
  onOpen,
}: {
  comments: ReviewComment[];
  repoName: (workspaceId: string) => string;
  multiRepo: boolean;
  onOpen: (c: ReviewComment) => void;
}) {
  if (comments.length === 0) return <div className="review-empty small">No comments yet. Hover a line and click + to add one.</div>;
  const sorted = [...comments].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.createdAt.localeCompare(b.createdAt));
  return (
    <div role="list" aria-label="Comments" className="review-comments">
      {sorted.map((c) => (
        <button key={c.id} type="button" role="listitem" className={`review-comment-row review-card-${c.status}`} onClick={() => onOpen(c)}>
          <span className="mono small">{`${multiRepo ? `${repoName(c.workspaceId)}/` : ''}${c.path}:${c.startLine}`}</span>
          <span className="small review-comment-text">{c.text}</span>
          <span className="small muted">{c.status}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add `reveal` to `DiffView`**

In `src/renderer/components/review/DiffView.tsx`, add to `Props`:

```ts
  /** Scrolls a line into the centre of a side whenever `seq` changes. */
  reveal?: { side: ReviewSide; line: number; seq: number };
```

and after the models effect:

```ts
  useEffect(() => {
    if (!diff || !p.reveal) return;
    const ed = p.reveal.side === 'before' ? diff.getOriginalEditor() : diff.getModifiedEditor();
    ed.revealLineInCenter(p.reveal.line);
    ed.setPosition({ lineNumber: p.reveal.line, column: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new seq moves the view
  }, [diff, p.reveal?.seq, p.uriKey]);
```

- [ ] **Step 5: Write the failing ChangesTab comment tests**

In `src/renderer/components/review/ChangesTab.test.tsx`, change the `DiffView` mock so it exposes the glyph callback:

```tsx
vi.mock('./DiffView', () => ({
  DiffView: (p: {
    uriKey: string;
    before: string;
    after: string;
    zones?: { id: string; node: unknown }[];
    onGlyph?: (side: 'before' | 'after', line: number) => void;
  }) => (
    <div data-testid="diff" data-key={p.uriKey}>
      <pre data-testid="before">{p.before}</pre>
      <pre data-testid="after">{p.after}</pre>
      {p.onGlyph && (
        <button type="button" onClick={() => p.onGlyph?.('after', 2)}>
          add on line 2
        </button>
      )}
      {(p.zones ?? []).map((z) => (
        <div key={z.id} data-testid={`zone-${z.id}`}>
          {z.node as never}
        </div>
      ))}
    </div>
  ),
}));
```

Add `import userEvent from '@testing-library/user-event';` and these tests:

```tsx
const comment = (over: Partial<ReviewState['comments'][number]> = {}) => ({
  id: 'c1', workspaceId: 'home', path: 'src/a.ts', side: 'after' as const, startLine: 2, endLine: 2,
  snippet: 'x', contextBefore: '', contextAfter: '', text: 'Please rename', status: 'open' as const,
  createdAt: '2026-10-17T10:00:00.000Z', sentAt: null, resolvedAt: null, ...over,
});

describe('ChangesTab comments', () => {
  it('adds a comment from the gutter', async () => {
    const api = mount({
      'review:addComment': (_t, input) => (state = { ...state, comments: [comment({ text: input.text })] }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'add on line 2' }));
    await userEvent.type(within(screen.getByTestId('zone-draft')).getByRole('textbox', { name: 'Comment' }), 'Rename this');
    fireEvent.click(within(screen.getByTestId('zone-draft')).getByRole('button', { name: 'Comment' }));
    await screen.findByTestId('zone-c1');
    expect(api.calls.find((c) => c.channel === 'review:addComment')?.args).toEqual([
      't1',
      { workspaceId: 'home', path: 'src/a.ts', side: 'after', startLine: 2, endLine: 2, text: 'Rename this' },
    ]);
    expect(screen.queryByTestId('zone-draft')).toBeNull();
    expect(screen.getByLabelText('1 comments')).toBeTruthy();
  });

  it('keeps a draft across a refresh', async () => {
    const api = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'add on line 2' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'half a thought');
    const reads = api.calls.filter((c) => c.channel === 'review:files').length;
    act(() => api.emit('review:changed', { taskId: 't1' }));
    await waitFor(() => expect(api.calls.filter((c) => c.channel === 'review:files').length).toBeGreaterThan(reads));
    expect((screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement).value).toBe('half a thought');
  });

  it('resolves a comment and counts it out', async () => {
    state = { ...state, comments: [comment()] };
    const api = mount({
      'review:updateComment': (_t, _id, patch) =>
        (state = { ...state, comments: [comment({ status: patch.status === 'resolved' ? 'resolved' : 'open' })] }),
    });
    fireEvent.click(within(await screen.findByTestId('zone-c1')).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(screen.queryByTestId('zone-c1')).toBeNull());
    expect(api.calls.find((c) => c.channel === 'review:updateComment')?.args).toEqual(['t1', 'c1', { status: 'resolved' }]);
    expect(api.tracked).toContainEqual({ type: 'event', name: 'review.commentResolved', props: { outdated: false } });
  });

  it('shows outdated comments of the file above the diff', async () => {
    state = { ...state, comments: [comment({ status: 'outdated', sentAt: '2026-10-17T10:05:00.000Z' })] };
    mount();
    expect(await screen.findByText('Code changed, probably addressed')).toBeTruthy();
  });

  it('lists all comments and opens one', async () => {
    state = { ...state, comments: [comment({ path: 'src/b.ts', text: 'On b' })] };
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Comments (1)' }));
    fireEvent.click(screen.getByRole('listitem'));
    await waitFor(() => expect(screen.getByTestId('after').textContent).toBe('new src/b.ts'));
  });

  it('offers no new comments outside All changes', async () => {
    mount();
    await screen.findByRole('button', { name: 'add on line 2' });
    fireEvent.click(screen.getByRole('button', { name: 'Uncommitted' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'add on line 2' })).toBeNull());
  });
});
```

Run: `npx vitest run src/renderer/components/review/ChangesTab.test.tsx` → the new tests FAIL.

- [ ] **Step 6: Comments in `ChangesTab.tsx`**

Make these changes to `src/renderer/components/review/ChangesTab.tsx`:

1. Imports:

```ts
import type { ReviewComment, ReviewSide } from '../../../shared/review';
import { CommentBox, CommentCard } from './CommentCard';
import { CommentsList } from './CommentsList';
import type { DiffZone } from './DiffView';
```

2. State, after `prefs`:

```ts
  type Draft = { workspaceId: string; path: string; side: ReviewSide; startLine: number; endLine: number };
  const [draft, setDraft] = useState<Draft | null>(null);
  const [panel, setPanel] = useState<'files' | 'comments'>('files');
  const [reveal, setReveal] = useState<{ side: ReviewSide; line: number; seq: number } | undefined>();
  const repos = useStore((s) => s.repos);
```

3. Helpers, after `setViewed`:

```ts
  const canComment = scope.kind === 'all';
  const comments = state?.comments ?? [];
  const onThisFile = (c: ReviewComment) =>
    current !== null && c.workspaceId === current.repo.workspaceId && c.path === current.file.path;
  const startDraft = (side: ReviewSide, startLine: number, endLine = startLine) => {
    if (!canComment || !current) return;
    setDraft({ workspaceId: current.repo.workspaceId, path: current.file.path, side, startLine, endLine });
  };
  const apply = async (run: () => Promise<ReviewState>) => {
    const s = await tryInvoke(run, notify);
    if (s) setState(s);
    return s;
  };
  const saveDraft = async (text: string) => {
    if (!draft) return;
    if (await apply(() => api().invoke('review:addComment', task.id, { ...draft, text }))) setDraft(null);
  };
  const resolve = (c: ReviewComment) => {
    track('review.commentResolved', { outdated: c.status === 'outdated' });
    void apply(() => api().invoke('review:updateComment', task.id, c.id, { status: 'resolved' }));
  };
  const card = (c: ReviewComment, onOpen?: () => void) => (
    <CommentCard
      comment={c}
      onOpen={onOpen}
      onEdit={(text) => void apply(() => api().invoke('review:updateComment', task.id, c.id, { text }))}
      onResolve={() => resolve(c)}
      onReopen={() => void apply(() => api().invoke('review:updateComment', task.id, c.id, { status: 'open' }))}
      onDelete={() => void apply(() => api().invoke('review:deleteComment', task.id, c.id))}
    />
  );
  const zones: DiffZone[] = canComment
    ? [
        ...comments
          .filter((c) => onThisFile(c) && (c.status === 'open' || c.status === 'sent'))
          .map((c) => ({ id: c.id, side: c.side, afterLine: c.endLine, node: card(c) })),
        ...(draft && current && draft.workspaceId === current.repo.workspaceId && draft.path === current.file.path
          ? [{ id: 'draft', side: draft.side, afterLine: draft.endLine, node: <CommentBox onSave={(t) => void saveDraft(t)} onCancel={() => setDraft(null)} /> }]
          : []),
      ]
    : [];
  const outdatedHere = canComment ? comments.filter((c) => onThisFile(c) && c.status === 'outdated') : [];
  const openComment = (c: ReviewComment) => {
    setScope({ kind: 'all' });
    setPanel('files');
    setSelected({ workspaceId: c.workspaceId, path: c.path });
    setReveal({ side: c.side, line: c.startLine, seq: Date.now() });
  };
  const unresolved = comments.filter((c) => c.status !== 'resolved').length;
```

(`ReviewState` must be imported as a type from `../../../shared/review` too.)

4. Key `c` in `onKey`:

```ts
    else if (key === 'c') {
      const s = handle.current?.selection();
      if (s) startDraft(s.side, s.startLine, s.endLine);
    }
```

5. `DiffView` gets the comment props:

```tsx
        zones={zones}
        onGlyph={canComment ? (side, line) => startDraft(side, line) : undefined}
        reveal={reveal}
```

and above `{body()}` in `.review-main`:

```tsx
          {outdatedHere.length > 0 && (
            <div className="review-outdated" aria-label="Outdated comments">
              {outdatedHere.map((c) => (
                <div key={c.id}>{card(c)}</div>
              ))}
            </div>
          )}
```

6. Header: after the viewed count, `<span className="small muted">{`${unresolved} open comments`}</span>`.

7. Left column: replace `<FileTree ... />` with a small tab switch and either list:

```tsx
        <div className="review-side">
          <div role="tablist" aria-label="Review lists" className="review-side-tabs">
            <button type="button" role="tab" aria-selected={panel === 'files'} className="pivot" onClick={() => setPanel('files')}>
              Files
            </button>
            <button type="button" role="tab" aria-selected={panel === 'comments'} className="pivot" onClick={() => setPanel('comments')}>
              {`Comments (${comments.length})`}
            </button>
          </div>
          {panel === 'files' ? (
            <FileTree
              repos={files?.repos ?? []}
              selected={selected}
              viewed={state?.viewed ?? {}}
              commentCount={(ref) =>
                comments.filter((c) => c.workspaceId === ref.workspaceId && c.path === ref.path && c.status !== 'resolved').length
              }
              onSelect={setSelected}
              onViewed={(r, f, on) => void setViewed(r, f, on)}
            />
          ) : (
            <CommentsList
              comments={comments}
              multiRepo={(files?.repos.length ?? 0) > 1}
              repoName={(id) => files?.repos.find((r) => r.workspaceId === id)?.name ?? repos.find((r) => r.id === id)?.name ?? id}
              onOpen={openComment}
            />
          )}
        </div>
```

- [ ] **Step 7: Styles**

Append to `src/renderer/styles/review.css`:

```css
.review-side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--line);
}
.review-side .review-tree {
  border-right: 0;
  flex: 1;
}
.review-side-tabs {
  display: flex;
  border-bottom: 1px solid var(--line);
}
.review-card {
  max-width: 720px;
  padding: 8px 12px;
  border: 1px solid var(--line-strong);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.review-card-sent {
  border-left-color: var(--green);
}
.review-card-outdated {
  border-left-color: var(--warn);
}
.review-card-resolved {
  opacity: 0.6;
}
.review-card-head,
.review-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.review-card-text p {
  margin: 0;
}
.review-box textarea {
  width: 100%;
  resize: vertical;
}
.review-snippet {
  margin: 0;
  padding: 4px 8px;
  background: var(--bg-page);
  white-space: pre-wrap;
  max-height: 120px;
  overflow: auto;
}
.review-outdated {
  display: grid;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
}
.review-comments {
  overflow: auto;
}
.review-comment-row {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 6px 12px;
  border: 0;
  border-left: 3px solid var(--accent);
  background: none;
  text-align: left;
}
.review-comment-row:hover {
  background: var(--bg-hover);
}
.review-comment-row.review-card-sent {
  border-left-color: var(--green);
}
.review-comment-row.review-card-outdated {
  border-left-color: var(--warn);
}
.review-comment-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/renderer/components/review`
Expected: PASS. In Task 9's test "marks a file viewed", the file list is now inside the Files tab; it is the default panel, so that test is unchanged.

- [ ] **Step 9: Full checks and commit**

Run: `npm test && npm run typecheck && npm run lint:fix && npm run lint`

```bash
git add -A src/renderer
git commit -m "feat(review): comment on lines, resolve, edit and list review comments"
```

---

### Task 11: Send comments to Claude, page keys

**Files:**
- Create: `src/renderer/review/reviewPrompt.ts`, `src/renderer/components/review/SendComments.tsx`
- Modify: `src/renderer/docs/quote.ts` (export `cleanPasteText`), `src/renderer/components/review/ChangesTab.tsx`
- Test: `src/renderer/review/reviewPrompt.test.ts`, `src/renderer/components/review/SendComments.test.tsx`, `src/renderer/components/review/ChangesTab.test.tsx` (one key test)

**Interfaces:**
- Consumes: `pasteInto(id, text: (bracketed: boolean) => string): boolean`, `focusTerminal(id)` (`src/renderer/terminalRegistry.ts`); `readSendTarget`/`writeSendTarget` (`src/renderer/docs/docsPrefs.ts`); `review:markSent` (Task 5); `terminals:isRunning`.
- Produces:
  - `cleanPasteText(text: string): string` (CRLF → LF, control characters except `\n` and `\t` removed, trailing newlines removed)
  - `type PromptComment = { path: string; startLine: number; endLine: number; snippet: string; text: string }`
  - `buildReviewPrompt(items: PromptComment[], opts?: { singleLine?: boolean }): string`
  - `<SendComments task: TaskView; comments: ReviewComment[]; repoName(workspaceId: string): string; multiRepo: boolean; onSent(s: ReviewState): void />`

- [ ] **Step 1: Write the failing prompt test**

```ts
// src/renderer/review/reviewPrompt.test.ts
import { describe, expect, it } from 'vitest';
import { buildReviewPrompt } from './reviewPrompt';

const a = { path: 'src/a.ts', startLine: 42, endLine: 45, snippet: 'const x = compute(a);\nreturn x;', text: 'Use the cached value.' };
const b = { path: 'web/src/b.tsx', startLine: 10, endLine: 10, snippet: '<div/>', text: 'Why a div?\nUse a button.' };

describe('buildReviewPrompt', () => {
  it('numbers the comments with their location, quoted lines and text, ending without Enter', () => {
    expect(buildReviewPrompt([a, b])).toBe(
      [
        'Review comments on the changes in this task:',
        '',
        '1. src/a.ts:42-45',
        '   > const x = compute(a);',
        '   > return x;',
        '   Use the cached value.',
        '',
        '2. web/src/b.tsx:10',
        '   > <div/>',
        '   Why a div?',
        '   Use a button.',
        '',
        '',
      ].join('\n'),
    );
  });

  it('strips control characters a comment could use to send keys', () => {
    const out = buildReviewPrompt([{ ...a, text: 'ok\x1b[201~\rrm -rf /\x03' }]);
    expect(out).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/);
    // CR becomes a line break (indented like the rest of the comment); ESC and Ctrl-C are gone.
    expect(out).toContain('   ok[201~\n   rm -rf /\n');
  });

  it('shortens long snippets', () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const out = buildReviewPrompt([{ ...a, snippet: long }]);
    expect(out).toContain('   > line 11\n   > …');
    expect(out).not.toContain('line 12');
  });

  it('flattens for a terminal without bracketed paste', () => {
    const out = buildReviewPrompt([a, b], { singleLine: true });
    expect(out).not.toContain('\n');
    expect(out).toBe(
      'Review comments on the changes in this task: 1. src/a.ts:42-45: Use the cached value. 2. web/src/b.tsx:10: Why a div? Use a button. ',
    );
  });
});
```

Run: `npx vitest run src/renderer/review/reviewPrompt.test.ts` → FAIL.

- [ ] **Step 2: Export the cleaning from `quote.ts` and write `reviewPrompt.ts`**

In `src/renderer/docs/quote.ts`, move the cleaning into an exported function and use it in `buildQuote`:

```ts
/**
 * Control characters (ESC of a bracketed-paste end marker, CR, Ctrl-C, ...) would let pasted text send
 * input to the terminal; keep only \n and \t. Trailing newlines go too.
 */
export function cleanPasteText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex -- matching control characters is the point
      .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
      .replace(/\n+$/, '')
  );
}
```

and in `buildQuote` replace the `const clean = text...` statement with `const clean = cleanPasteText(text);`. Run `npx vitest run src/renderer/docs` → PASS (behaviour unchanged).

```ts
// src/renderer/review/reviewPrompt.ts
import { cleanPasteText } from '../docs/quote';

export type PromptComment = { path: string; startLine: number; endLine: number; snippet: string; text: string };

const HEAD = 'Review comments on the changes in this task:';
const MAX_SNIPPET_LINES = 12;
const loc = (c: PromptComment) => (c.startLine === c.endLine ? `${c.path}:${c.startLine}` : `${c.path}:${c.startLine}-${c.endLine}`);

/**
 * The text pasted into the agent's terminal. Never ends in Enter alone: the developer can add a sentence and
 * send it. `singleLine` is for terminals without bracketed paste, where each line break would submit.
 */
export function buildReviewPrompt(items: PromptComment[], opts: { singleLine?: boolean } = {}): string {
  if (opts.singleLine) {
    const flat = (s: string) => cleanPasteText(s).replace(/\s+/g, ' ').trim();
    return `${HEAD} ${items.map((c, i) => `${i + 1}. ${loc(c)}: ${flat(c.text)}`).join(' ')} `;
  }
  const blocks = items.map((c, i) => {
    const snippet = cleanPasteText(c.snippet).split('\n');
    const shown = snippet.length > MAX_SNIPPET_LINES ? [...snippet.slice(0, MAX_SNIPPET_LINES), '…'] : snippet;
    const quote = shown.map((l) => (l ? `   > ${l}` : '   >')).join('\n');
    const text = cleanPasteText(c.text)
      .split('\n')
      .map((l) => `   ${l}`)
      .join('\n');
    return `${i + 1}. ${loc(c)}\n${quote}\n${text}`;
  });
  return `${HEAD}\n\n${blocks.join('\n\n')}\n\n`;
}
```

Run: `npx vitest run src/renderer/review/reviewPrompt.test.ts` → PASS.

- [ ] **Step 3: Write the failing SendComments test**

```tsx
// src/renderer/components/review/SendComments.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewComment } from '../../../shared/review';
import type { TaskView } from '../../../shared/types';
import { useStore } from '../../store';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { registerTerminal } from '../../terminalRegistry';
import { SendComments } from './SendComments';

const c = (id: string, status: ReviewComment['status'], path = 'src/a.ts'): ReviewComment => ({
  id, workspaceId: 'home', path, side: 'after', startLine: 1, endLine: 1, snippet: 'x', contextBefore: '',
  contextAfter: '', text: `note ${id}`, status, createdAt: '2026-10-17T10:00:00.000Z', sentAt: null, resolvedAt: null,
});
const task = (terminals: { id: string; kind: string; label: string }[]) =>
  ({ id: 't1', terminals, extraWorkspaces: [], homeDropped: false }) as unknown as TaskView;

beforeEach(() => localStorage.clear());

describe('SendComments', () => {
  it('pastes the open comments into the Claude tab, marks them sent, and reports the count', async () => {
    const paste = vi.fn();
    const off = registerTerminal('cl', { paste, focus: vi.fn(), modes: { bracketedPasteMode: true } } as never);
    const onSent = vi.fn();
    const { calls, tracked } = installFakeApi({
      'terminals:isRunning': () => true,
      'review:markSent': () => ({ version: 1, viewed: {}, comments: [] }),
    });
    render(
      <SendComments
        task={task([{ id: 'sh', kind: 'shell', label: 'zsh' }, { id: 'cl', kind: 'claude', label: 'Claude Code' }])}
        comments={[c('a', 'open'), c('b', 'sent'), c('d', 'open')]}
        repoName={() => 'web'}
        multiRepo={false}
        onSent={onSent}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send 2 comments to Claude Code' }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(paste.mock.calls[0][0]).toContain('1. src/a.ts:1');
    expect(paste.mock.calls[0][0]).toContain('note d');
    expect(paste.mock.calls[0][0]).not.toContain('note b');
    expect(calls.find((x) => x.channel === 'review:markSent')?.args).toEqual(['t1', ['a', 'd']]);
    expect(tracked).toContainEqual({ type: 'event', name: 'review.commentsSent', props: { count: 2 } });
    off();
  });

  it('prefixes the repo name in a multi-repo task and flattens without bracketed paste', async () => {
    const paste = vi.fn();
    const off = registerTerminal('cp', { paste, focus: vi.fn(), modes: { bracketedPasteMode: false } } as never);
    installFakeApi({
      'terminals:isRunning': () => true,
      'review:markSent': () => ({ version: 1, viewed: {}, comments: [] }),
    });
    render(
      <SendComments task={task([{ id: 'cp', kind: 'copilot', label: 'Copilot CLI' }])} comments={[c('a', 'open')]} repoName={() => 'web'} multiRepo onSent={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send 1 comment to Copilot CLI' }));
    await waitFor(() => expect(paste).toHaveBeenCalled());
    expect(paste.mock.calls[0][0]).toContain('web/src/a.ts:1');
    expect(paste.mock.calls[0][0]).not.toContain('\n');
    off();
  });

  it('is disabled without an agent tab or without open comments', () => {
    installFakeApi();
    const { rerender } = render(
      <SendComments task={task([{ id: 'sh', kind: 'shell', label: 'zsh' }])} comments={[c('a', 'open')]} repoName={() => ''} multiRepo={false} onSent={vi.fn()} />,
    );
    expect((screen.getByRole('button', { name: /Open a Claude Code tab first/ }) as HTMLButtonElement).disabled).toBe(true);
    rerender(
      <SendComments task={task([{ id: 'cl', kind: 'claude', label: 'Claude Code' }])} comments={[c('a', 'sent')]} repoName={() => ''} multiRepo={false} onSent={vi.fn()} />,
    );
    expect((screen.getByRole('button', { name: 'No open comments to send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('warns when the target terminal is not running', async () => {
    installFakeApi({ 'terminals:isRunning': () => false });
    useStore.setState({ notices: [] });
    render(
      <SendComments task={task([{ id: 'cl', kind: 'claude', label: 'Claude Code' }])} comments={[c('a', 'open')]} repoName={() => ''} multiRepo={false} onSent={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send 1 comment to Claude Code' }));
    await waitFor(() =>
      expect(useStore.getState().notices).toContainEqual(
        expect.objectContaining({ level: 'warn', message: 'Claude Code is not running' }),
      ),
    );
  });
});
```

Run: `npx vitest run src/renderer/components/review/SendComments.test.tsx` → FAIL.

- [ ] **Step 4: Write `SendComments.tsx`**

```tsx
// src/renderer/components/review/SendComments.tsx
import { ChevronDown16Regular, Send16Regular } from '@fluentui/react-icons';
import { useCallback, useState } from 'react';
import type { ReviewComment, ReviewState } from '../../../shared/review';
import type { TaskView } from '../../../shared/types';
import { api, tryInvoke } from '../../api';
import { readSendTarget, writeSendTarget } from '../../docs/docsPrefs';
import { buildReviewPrompt } from '../../review/reviewPrompt';
import { useStore } from '../../store';
import { track } from '../../telemetry';
import { focusTerminal, pasteInto } from '../../terminalRegistry';
import { PopupMenu } from '../ui';

/** Agent tabs only: a shell would run each line of the paste. */
const AGENTS = new Set(['claude', 'copilot', 'opencode']);

export function SendComments({
  task,
  comments,
  repoName,
  multiRepo,
  onSent,
}: {
  task: TaskView;
  comments: ReviewComment[];
  repoName: (workspaceId: string) => string;
  multiRepo: boolean;
  onSent: (s: ReviewState) => void;
}) {
  const notify = useStore((s) => s.notify);
  const [menu, setMenu] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [chosen, setChosen] = useState<string | null>(() => readSendTarget(task.id));
  const close = useCallback(() => setMenu(false), []);
  const targets = task.terminals.filter((t) => AGENTS.has(t.kind));
  const open = comments.filter((c) => c.status === 'open');
  const target = targets.find((t) => t.id === chosen) ?? targets.find((t) => t.kind === 'claude') ?? targets[0];

  const send = async (id: string) => {
    setMenu(false);
    const t = targets.find((x) => x.id === id);
    if (!t || open.length === 0) return;
    const running = await api()
      .invoke('terminals:isRunning', id)
      .catch(() => false);
    if (!running) {
      notify('warn', `${t.label} is not running`);
      return;
    }
    const items = open.map((c) => ({
      path: multiRepo ? `${repoName(c.workspaceId)}/${c.path}` : c.path,
      startLine: c.startLine,
      endLine: c.endLine,
      snippet: c.snippet,
      text: c.text,
    }));
    if (!pasteInto(id, (bracketed) => buildReviewPrompt(items, { singleLine: !bracketed }))) {
      notify('warn', `${t.label} is not open`);
      return;
    }
    writeSendTarget(task.id, id);
    setChosen(id);
    const s = await tryInvoke(() => api().invoke('review:markSent', task.id, open.map((c) => c.id)), notify);
    if (s) onSent(s);
    track('review.commentsSent', { count: open.length });
    useStore.getState().setTab(task.id, id);
    requestAnimationFrame(() => focusTerminal(id));
  };

  if (!target)
    return (
      <button type="button" className="btn btn-sm" disabled>
        <Send16Regular aria-hidden="true" />
        Send comments: Open a Claude Code tab first
      </button>
    );
  if (open.length === 0)
    return (
      <button type="button" className="btn btn-sm" disabled>
        No open comments to send
      </button>
    );
  return (
    <span className="split-btn">
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void send(target.id)}>
        <Send16Regular aria-hidden="true" />
        {`Send ${open.length} ${open.length === 1 ? 'comment' : 'comments'} to ${target.label}`}
      </button>
      {targets.length > 1 && (
        <button
          ref={setAnchor}
          type="button"
          className="btn btn-primary btn-sm"
          aria-label="Choose terminal"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <ChevronDown16Regular aria-hidden="true" />
        </button>
      )}
      <PopupMenu label="Send to" anchor={anchor} open={menu} onClose={close}>
        {targets.map((t) => (
          <button key={t.id} type="button" role="menuitem" className="menu-item" onClick={() => void send(t.id)}>
            <span className="menu-title">{t.label}</span>
          </button>
        ))}
      </PopupMenu>
    </span>
  );
}
```

Run: `npx vitest run src/renderer/components/review/SendComments.test.tsx` → PASS.

- [ ] **Step 5: Put it in the header, and add page keys**

In `ChangesTab.tsx`, import `SendComments` and add it to `.review-head` before the spacer:

```tsx
        <SendComments
          task={task}
          comments={comments}
          multiRepo={(files?.repos.length ?? 0) > 1}
          repoName={(id) => files?.repos.find((r) => r.workspaceId === id)?.name ?? id}
          onSent={setState}
        />
```

Page keys when focus is on the page but not in Monaco or a text field: on the `<section className="review">` add `tabIndex={-1}` and

```tsx
      onKeyDown={(e) => {
        const t = e.target as HTMLElement;
        if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, .monaco-editor, [role="menu"]')) return;
        if (['j', 'k', 'n', 'p', 'v', 'c'].includes(e.key)) {
          e.preventDefault();
          onKey(e.key as DiffKey);
        }
      }}
```

Add to `ChangesTab.test.tsx`:

```tsx
  it('moves to the next file with j on the page', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('after').textContent).toBe('new src/a.ts'));
    fireEvent.keyDown(screen.getByRole('region', { name: 'Changes' }), { key: 'j' });
    await waitFor(() => expect(screen.getByTestId('after').textContent).toBe('new src/b.ts'));
  });
```

(Order is tree order with generated files last: `src/a.ts`, `src/b.ts`, then `package-lock.json`.)

Run: `npx vitest run src/renderer/components/review` → PASS.

- [ ] **Step 6: Full checks and commit**

Run: `npm test && npm run typecheck && npm run lint:fix && npm run lint`

```bash
git add -A src/renderer
git commit -m "feat(review): send open review comments to an agent tab"
```

---

### Task 12: The review line on Finish

**Files:**
- Modify: `src/renderer/screens/FinishScreen.tsx`
- Test: `src/renderer/screens/FinishScreen.test.tsx` (new tests)

**Interfaces:**
- Consumes: `review:summary` (Task 5), `openChanges` (Task 9).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/screens/FinishScreen.test.tsx` (the file's `beforeEach` puts task `a` in the store; import `fireEvent` from `@testing-library/react` and `CHANGES_TAB` from `../store`):

```tsx
describe('FinishScreen review reminder', () => {
  it('shows files not viewed and unresolved comments, and opens Changes', async () => {
    installFakeApi({
      'tasks:finishChecks': () => clean,
      'review:summary': () => ({ files: 5, notViewed: 2, unresolved: 1 }),
    });
    render(<FinishScreen taskId="a" />);
    expect(await screen.findByText('2 files not viewed · 1 comment unresolved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(useStore.getState().activeTab('a')).toBe(CHANGES_TAB);
    expect(useStore.getState().screen.kind).toBe('task');
  });

  it('stays hidden when everything is viewed and resolved', async () => {
    installFakeApi({
      'tasks:finishChecks': () => clean,
      'review:summary': () => ({ files: 5, notViewed: 0, unresolved: 0 }),
    });
    render(<FinishScreen taskId="a" />);
    await screen.findByText('No uncommitted changes');
    expect(screen.queryByText(/not viewed/)).toBeNull();
  });
});
```

Run: `npx vitest run src/renderer/screens/FinishScreen.test.tsx -t "review reminder"` → FAIL.

- [ ] **Step 2: Implement**

In `FinishScreen.tsx`, next to the other state and effects near the top of `FinishScreen`:

```ts
  const [review, setReview] = useState<ReviewSummary | null>(null);
  useEffect(() => {
    let live = true;
    void api()
      .invoke('review:summary', taskId)
      .then((r) => live && setReview(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [taskId]);
```

(import `type ReviewSummary` from `../../shared/review`, `CHANGES_TAB`/`useStore` as already used in the file.) Inside the Safety checks section, after its heading, add:

```tsx
          {review && (review.notViewed > 0 || review.unresolved > 0) && (
            <div className="check check-warn">
              <span aria-hidden="true">{G.WARN}</span>
              <div className="body">
                {[
                  review.notViewed > 0 && `${review.notViewed} ${review.notViewed === 1 ? 'file' : 'files'} not viewed`,
                  review.unresolved > 0 && `${review.unresolved} ${review.unresolved === 1 ? 'comment' : 'comments'} unresolved`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              <button type="button" className="btn btn-sm" onClick={() => useStore.getState().openChanges(taskId)}>
                Review changes
              </button>
            </div>
          )}
```

It never blocks Finish.

Run: `npx vitest run src/renderer/screens/FinishScreen.test.tsx` → PASS (the fake API default answers zeros, so existing tests see no new line).

- [ ] **Step 3: Commit**

Run: `npm test && npm run typecheck && npm run lint:fix && npm run lint`

```bash
git add src/renderer/screens/FinishScreen.tsx src/renderer/screens/FinishScreen.test.tsx
git commit -m "feat(review): Finish reminds of files not viewed and open comments"
```

---

### Task 13: Docs, telemetry list, live check

**Files:**
- Modify: `docs/telemetry.md`, `docs/windows-checklist.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-17-changes-review-design.md`

- [ ] **Step 1: Telemetry list**

In `docs/telemetry.md`, in the events table, change the `editor.opened` row to:

```
| `editor.opened` | `editor` (`vscode`, `visualstudio`); `at` (`folder`, or `file` when opened at a line from Changes, Docs or a terminal link) |
```

and add rows:

```
| `review.opened` | scope (`all`, `uncommitted`, `commits`); number of files; number of repos |
| `review.fileViewed` | none |
| `review.commentsSent` | number of comments sent |
| `review.commentResolved` | `outdated`: whether the comment was outdated when resolved |
```

- [ ] **Step 2: Windows checklist**

Add a section to `docs/windows-checklist.md`:

```
## Changes page and Visual Studio

- [ ] With Visual Studio installed, Settings > Editor lists it; a repo with a `.sln` opens that solution from the task row's Open in Visual Studio, from the worktree (not the main checkout).
- [ ] With two solutions, the menu lists both and the pick is remembered for the repo.
- [ ] Open file in editor on the Changes page opens the file in the running Visual Studio at the cursor line (`/command "Edit.GoTo <line>"`). If it opens at the top, record it as a known gap.
- [ ] The Changes tab shows a diff (Monaco loads in the packaged build, no CSP errors in the DevTools console).
- [ ] A commit made in the task's shell refreshes the Changes tab within a second.
```

- [ ] **Step 3: Spec implementation notes**

The spec's "Implementation notes" section was written together with this plan. Reread it against what was built and correct anything that turned out differently (for example the Visual Studio go-to-line result once checked on Windows).

- [ ] **Step 4: CLAUDE.md status**

Add one entry to the Status list in `CLAUDE.md` (same style as the others): Changes review page (spec `docs/superpowers/specs/2026-10-17-changes-review-design.md`) implemented 2026-10-17 on `feature/changes-review`: a Changes pivot with All changes (base to working tree, committed or not), Uncommitted and commit scopes in the Monaco diff editor, viewed files that clear when the content changes, comments on lines kept in `review/<taskId>.json` that move with the code, go outdated and can be sent to an agent tab, a Finish reminder, and Open in VS Code or Visual Studio chosen per repo (Settings > Editor). Add the Visual Studio go-to-line check to the known gaps.

- [ ] **Step 5: Live check in the app (macOS)**

Run `npm start`. In a ready task of the test repo (start one from the Sprint page if none is open), with a real result asserted at each step:

1. Make a commit in the task's shell tab (`echo a > a.txt && git add a.txt && git commit -m a`) and edit a tracked file without committing. Open Changes: both files are listed under All changes, with the right status letters and +/- counts; the badge on the pivot shows the count.
2. Switch to Uncommitted: only the edited file. Switch to Commits, pick the commit: only `a.txt`.
3. Back in All changes, hover a line of the edited file: the + shows; click it, type a comment, press Cmd+Enter: the card shows under the line and the file row shows 1 comment.
4. Mark the file viewed; edit the file again in the shell: within a second the row says "Changed since viewed" and the count drops.
5. Send the comment to the Claude Code tab: the Claude tab opens with the numbered comment pasted and not sent; the card shows Sent. Let Claude fix the line: the comment turns to "Code changed, probably addressed"; Resolve it.
6. Press j and k on the page: the selection moves between files; n and p move between changes.
7. Open in VS Code from the header and Open file in editor from the toolbar: VS Code opens the worktree and the file at the line.
8. Open Finish: the reminder line shows the remaining not-viewed files; Review changes goes back to the Changes tab.
9. Quit and relaunch MIAC: comments and viewed marks are still there.

Write down anything that failed, fix it, and repeat the step.

- [ ] **Step 6: Commit**

```bash
git add docs/telemetry.md docs/windows-checklist.md CLAUDE.md docs/superpowers/specs/2026-10-17-changes-review-design.md
git commit -m "docs: Changes review page, editor choice, telemetry and Windows checks"
```
