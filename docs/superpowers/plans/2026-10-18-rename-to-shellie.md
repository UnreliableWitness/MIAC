# Rename MIAC to Shellie Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app, repo and Azure resources are called Shellie; existing data, connections, repos with `.miac.yml` and running tasks keep working.

**Architecture:** One mechanical rename across code, tests, tools, CI and current docs (Task 1), then small compatibility readers that accept the old names (Tasks 2-3), then a first-start migration of the old `miac` data folder with macOS token re-encryption (Tasks 4-5), then the outside operations done by the session itself (Tasks 6-7).

**Tech Stack:** Electron 44 + Forge (Vite, React, TypeScript), Vitest, Node `crypto`, macOS `security` CLI, `gh`, `az`, Azure DevOps REST.

**Spec:** `docs/superpowers/specs/2026-10-18-rename-to-shellie-design.md`

## Global Constraints

- Display name `Shellie`; package `name` `shellie`, `productName` `Shellie`, `executableName` `Shellie`, Squirrel `name` `shellie`, `setupExe` `Shellie-Setup.exe`, icons `assets/icon/shellie*`.
- Release titles `Shellie vX.Y.Z` (`(unsigned)` suffix kept); CI artifacts `Shellie-Setup-<sha>`.
- `UPDATE_REPO = 'UnreliableWitness/Shellie'`; `iconUrl` `https://raw.githubusercontent.com/UnreliableWitness/Shellie/main/assets/icon/shellie.ico`.
- Env vars `MIAC_*` become `SHELLIE_*`. Kept for compatibility: `MIAC_TELEMETRY=0` still turns telemetry off; terminals get `MIAC_TASK_ID` alongside `SHELLIE_TASK_ID` (user scripts in `.miac.yml` may read it).
- `.shellie.yml` wins; `.miac.yml` is read only when `.shellie.yml` is absent. UI text names `.shellie.yml` only.
- Agents get `shellie.task.id`; the receiver accepts `shellie.task.id`, else `miac.task.id`.
- The old data folder and the old Keychain item are never changed or deleted.
- Not renamed: `docs/superpowers/**` (history), `design/**` (mockups), the Azure signing account and its variables, the `Custom.AI*` field names.
- Checks: `npm test`, `npm run typecheck`, `npm run lint` all pass after every task.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018pN36d8qmj82BVJLA1wM2L
  ```

## Review Focus

- A repo registered before the update (state.json with `miacYmlFound`) must load, not reset the task store. Pinned in Task 2.
- A task that was `ready` before the update: its worktree has `.miac/task.md`; the Docs tab and the Claude prompt must point at a file that exists. Pinned in Task 3.
- A Mac user who clicks "Deny" on the Keychain prompt: Shellie still starts, tasks are there, the connection asks for the PAT. Pinned in Task 5.
- A second launch after migration (or a fresh install with no old folder) must not copy again or overwrite newer data. Pinned in Task 4.
- UI prefs (last PR choice per repo, nav collapsed, docs state) survive: `Local Storage` is copied and `miac.*` keys are carried to `shellie.*`. Pinned in Tasks 3 and 4.

Note on the spec: the spec's skip list contains `Local Storage`; this plan copies it (it holds the UI prefs above). Chromium's other caches stay skipped.

---

### Task 1: Mechanical rename

**Files:** everything `git grep -il miac -- ':!docs/superpowers' ':!design'` lists (about 150 files), plus file renames:
- `git mv src/main/services/MiacConfig.ts src/main/services/ShellieConfig.ts`
- `git mv src/main/services/MiacConfig.test.ts src/main/services/ShellieConfig.test.ts`
- `git mv assets/icon/miac.svg assets/icon/shellie.svg` (and `miac-small.svg`, `miac-mac.svg`, `miac-mac-small.svg`, `miac.ico`, `miac.icns`, plus any generated `miac*.png` under `assets/`)

**Interfaces:**
- Produces: `loadShellieConfig(repoPath): Promise<ShellieConfig>`, `ShellieConfigError`, type `ShellieConfig` (was `MiacConfig`), `ShellieApi` (was `MiacApi`), `window.shellie`, `TASK_FILE = '.shellie/task.md'`, env var `SHELLIE_CLAUDE_PROMPT`, `SHELLIE_TASK_ID`, `SHELLIE_SMOKE`, marker `SHELLIE_SMOKE_OK`, OTel attribute `shellie.task.id`, localStorage prefix `shellie.`, repo field `configFound` (was `miacYmlFound`), config file `.shellie.yml`.

Rules for the replace (apply by hand per occurrence class, not one blind `sed`):
- `MIAC` (display) → `Shellie`; `Miac` (identifiers) → `Shellie`; `miac` (identifiers, ids, keys, file names) → `shellie`; `MIAC_` (env) → `SHELLIE_`.
- `miacYmlFound` → `configFound`; `.miac.yml` → `.shellie.yml`; `.miac/` → `.shellie/`; `$miacFailed` → `$shellieFailed`.
- Azure DevOps fixtures that model the test project (`'MIAC'`, `'MIAC\\Sprint 1'`, `MIAC Team`) → `'Shellie'`, `'Shellie\\Sprint 1'`, `Shellie Team`.
- `AI usage for this work item (MIAC)` → `AI usage for this work item (Shellie)` (nothing matches on this text; checked).
- `claudeContext` text: `This folder is a Shellie task for ...`, `Shellie picks it up automatically.`
- `docs/telemetry.md`, `docs/windows-checklist.md`, `README.md`, `tools/**/README.md`: rename; keep the Azure signing names as they are.
- `CLAUDE.md`: title `# Shellie`, first paragraph says the app was called MIAC ("Me, I'm Counting", a Culture ship) until 2026-10-18; rest renamed. Test project, Keychain and App Insights names are updated in Tasks 6-7, not here.
- `tools/art/build-icons.mjs`: source and output names `shellie*`.
- `.github/workflows/ci.yml`: `Shellie-Setup.exe`, `Shellie-Setup-${{ github.sha }}`, release title `Shellie $env:TAG`.

- [ ] **Step 1: Rename the files** with the `git mv` commands above.
- [ ] **Step 2: Replace the occurrences** by the rules above, file by file.
- [ ] **Step 3: Regenerate icons** with `npm run icons` and check that `assets/icon/shellie.ico` and `shellie.icns` exist and nothing named `miac*` is left under `assets/`.
- [ ] **Step 4: Run the checks**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass. Tests that assert the old names were updated in Step 2, not skipped.

- [ ] **Step 5: Check the leftovers**

Run: `git grep -in miac -- ':!docs/superpowers' ':!design'`
Expected: only the `CLAUDE.md` history sentence. (Tasks 2-5 add the deliberate fallbacks.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename MIAC to Shellie"
```

---

### Task 2: Main-side compatibility readers

**Files:**
- Modify: `src/main/services/ShellieConfig.ts`, `src/main/services/ShellieConfig.test.ts`
- Modify: `src/main/usage/otlp.ts`, `src/main/usage/otlp.test.ts`
- Modify: `src/main.ts` (telemetry opt-out), `src/main/services/TerminalManager.ts` (+ its test)
- Modify: `src/shared/types.ts` (repo schema), `src/shared/types.test.ts`

**Interfaces:**
- Produces: `configFileFor(repoPath: string): Promise<string | null>` exported from `ShellieConfig.ts`: path of `.shellie.yml` if it exists, else `.miac.yml` if it exists, else `null`. `loadShellieConfig` uses it; error messages name the file that was read.
- Produces: `telemetryOptedOut(env: NodeJS.ProcessEnv): boolean` in `src/main/telemetry/helpers.ts`.

- [ ] **Step 1: Write the failing tests**

`ShellieConfig.test.ts`:
```ts
it('reads .miac.yml when there is no .shellie.yml', async () => {
  const dir = tmpRepo();
  writeFileSync(path.join(dir, '.miac.yml'), 'base: develop\n');
  const c = await loadShellieConfig(dir);
  expect(c.base).toBe('develop');
  expect(c.found).toBe(true);
});

it('prefers .shellie.yml over .miac.yml', async () => {
  const dir = tmpRepo();
  writeFileSync(path.join(dir, '.miac.yml'), 'base: old\n');
  writeFileSync(path.join(dir, '.shellie.yml'), 'base: new\n');
  expect((await loadShellieConfig(dir)).base).toBe('new');
});

it('names the file it read in errors', async () => {
  const dir = tmpRepo();
  writeFileSync(path.join(dir, '.miac.yml'), 'nope: 1\n');
  await expect(loadShellieConfig(dir)).rejects.toThrow(/\.miac\.yml/);
});
```
(`tmpRepo` = the existing temp-dir helper in that test file; reuse whatever it uses today.)

`otlp.test.ts`: copy the existing "picks api_request events" test with `resource = [kv('miac.task.id', { stringValue: 'task-old' })]` and expect `taskId: 'task-old'`; same for the metrics parser.

`types.test.ts`:
```ts
it('reads a repo saved with miacYmlFound', () => {
  const r = RepoSchema.parse({ ...repoFixture, configFound: undefined, miacYmlFound: true });
  expect(r.configFound).toBe(true);
});
```
(Use the repo schema's real name from `src/shared/types.ts:152` area and an existing repo fixture.)

`helpers.test.ts`:
```ts
it('honours both opt-out variables', () => {
  expect(telemetryOptedOut({ SHELLIE_TELEMETRY: '0' })).toBe(true);
  expect(telemetryOptedOut({ MIAC_TELEMETRY: '0' })).toBe(true);
  expect(telemetryOptedOut({})).toBe(false);
});
```

`TerminalManager` test: the spawned env has `SHELLIE_TASK_ID` and `MIAC_TASK_ID`, both the task id.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/services/ShellieConfig.test.ts src/main/usage/otlp.test.ts src/shared/types.test.ts src/main/telemetry src/main/services/TerminalManager.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

`ShellieConfig.ts`:
```ts
/** `.shellie.yml`, else the pre-rename `.miac.yml`, else null. */
export async function configFileFor(repoPath: string): Promise<string | null> {
  for (const name of ['.shellie.yml', '.miac.yml']) {
    const file = path.join(repoPath, name);
    if (await exists(file)) return file;
  }
  return null;
}
```
In `loadShellieConfig`, replace the fixed path and the ENOENT read with `const file = await configFileFor(repoPath)`; `text = file ? await fs.readFile(file, 'utf8') : null`; errors use `path.basename(file)`-relative naming as today (`new ShellieConfigError(file, ...)`).

`otlp.ts` (both places): `const taskId = str(attrs['shellie.task.id']) ?? str(attrs['miac.task.id']);` (match `str`'s real return; if it returns `''` use `||`).

`types.ts` repo schema:
```ts
// Repos saved before the rename have miacYmlFound.
export const RepoSchema = z.preprocess(
  (v) => v && typeof v === 'object' && 'miacYmlFound' in v && !('configFound' in v)
    ? { ...(v as object), configFound: (v as { miacYmlFound: unknown }).miacYmlFound }
    : v,
  RepoObjectSchema,
);
```
(Keep the existing object schema under a new name if it is extended elsewhere; zod strips the unknown `miacYmlFound` key.)

`helpers.ts`:
```ts
/** `SHELLIE_TELEMETRY=0`, or the pre-rename `MIAC_TELEMETRY=0`, turns telemetry off for a launch. */
export const telemetryOptedOut = (env: NodeJS.ProcessEnv): boolean =>
  env.SHELLIE_TELEMETRY === '0' || env.MIAC_TELEMETRY === '0';
```
`main.ts`: `if (__APPINSIGHTS_CONNECTION_STRING__ && !telemetryOptedOut(process.env))`.

`TerminalManager.ts`: `env.SHELLIE_TASK_ID = options.taskId; env.MIAC_TASK_ID = options.taskId; // for scripts written before the rename`.

- [ ] **Step 4: Run the tests** (command from Step 2). Expected: PASS. Then `npm run typecheck && npm run lint && npm test`.
- [ ] **Step 5: Commit** `git commit -am "feat: read .miac.yml, miac.task.id and old repo records after the rename"`

---

### Task 3: Worktree task folder and UI prefs

**Files:**
- Create: `src/main/migrate/taskFolders.ts`, `src/main/migrate/taskFolders.test.ts`
- Create: `src/renderer/migratePrefs.ts`, `src/renderer/migratePrefs.test.ts`
- Modify: `src/main.ts` (call after the task store loads), `src/renderer.tsx` (call before React renders)

**Interfaces:**
- Consumes: `TaskStore` (loaded), `ensureExcluded(git, repoPath, pattern)` from `SetupRunner.ts` (export it if it is not exported), `taskWorkspaces(task)` from `src/shared/workspaces.ts` for every worktree of a task.
- Produces: `migrateTaskFolders(worktrees: { worktreePath: string; repoPath: string }[], exclude: (repoPath: string) => Promise<void>): Promise<number>`; `migratePrefs(storage: Storage): number`.

- [ ] **Step 1: Write the failing tests**

`taskFolders.test.ts`:
```ts
it('moves .miac to .shellie and excludes it', async () => {
  const wt = mkdtempSync(path.join(os.tmpdir(), 'shellie-wt-'));
  mkdirSync(path.join(wt, '.miac'));
  writeFileSync(path.join(wt, '.miac', 'task.md'), '# t');
  const excluded: string[] = [];
  const n = await migrateTaskFolders([{ worktreePath: wt, repoPath: '/repo' }], async (r) => { excluded.push(r); });
  expect(n).toBe(1);
  expect(readFileSync(path.join(wt, '.shellie', 'task.md'), 'utf8')).toBe('# t');
  expect(existsSync(path.join(wt, '.miac'))).toBe(false);
  expect(excluded).toEqual(['/repo']);
});

it('leaves a worktree that already has .shellie alone', async () => { /* both dirs exist → n 0, both still there */ });
it('skips worktrees that are gone', async () => { /* path does not exist → n 0, no throw */ });
```

`migratePrefs.test.ts`:
```ts
it('copies miac.* keys to shellie.* without overwriting', () => {
  localStorage.clear();
  localStorage.setItem('miac.ui.focus', 'true');
  localStorage.setItem('miac.ui.pr.r1', 'false');
  localStorage.setItem('shellie.ui.pr.r1', 'true');
  expect(migratePrefs(localStorage)).toBe(1);
  expect(localStorage.getItem('shellie.ui.focus')).toBe('true');
  expect(localStorage.getItem('shellie.ui.pr.r1')).toBe('true');
});
it('runs once', () => { /* second call returns 0 because shellie.migrated is set */ });
```

- [ ] **Step 2: Run them to see them fail**: `npx vitest run src/main/migrate src/renderer/migratePrefs.test.ts`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`taskFolders.ts`:
```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** Worktrees made before the rename keep their task file in `.miac/`; move it to `.shellie/` so the Docs tab and Claude's prompt find it. */
export async function migrateTaskFolders(
  worktrees: { worktreePath: string; repoPath: string }[],
  exclude: (repoPath: string) => Promise<void>,
): Promise<number> {
  let moved = 0;
  for (const w of worktrees) {
    const from = path.join(w.worktreePath, '.miac');
    const to = path.join(w.worktreePath, '.shellie');
    if (!(await exists(from)) || (await exists(to))) continue;
    try {
      await fs.rename(from, to);
      await exclude(w.repoPath);
      moved++;
    } catch {
      // A locked folder on Windows: the next start tries again.
    }
  }
  return moved;
}
```
Wire in `main.ts` right after `store.load()`: collect `{ worktreePath, repoPath }` for every non-finished task over `taskWorkspaces(task)`, call with `(repo) => ensureExcluded(git, repo, '.shellie/')`, in the background (`void ...catch(() => {})`), so boot is not slower.

`migratePrefs.ts`:
```ts
const DONE = 'shellie.migrated';

/** UI prefs were saved under `miac.*` before the rename; copy them to `shellie.*` once. */
export function migratePrefs(storage: Storage): number {
  if (storage.getItem(DONE)) return 0;
  let n = 0;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith('miac.')) continue;
    const next = `shellie.${key.slice(5)}`;
    if (storage.getItem(next) !== null) continue;
    storage.setItem(next, storage.getItem(key) ?? '');
    n++;
  }
  storage.setItem(DONE, '1');
  return n;
}
```
Call `migratePrefs(window.localStorage)` at the top of `src/renderer.tsx` inside a try/catch.

- [ ] **Step 4: Run the tests**, then `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: carry task folders and UI prefs over from MIAC"`

---

### Task 4: Copy the old data folder

**Files:**
- Create: `src/main/migrate/dataFolder.ts`, `src/main/migrate/dataFolder.test.ts`
- Modify: `src/main.ts` (`boot()`, first lines), `docs/telemetry.md` (event `migration.miac`)

**Interfaces:**
- Produces: `migrateDataFolder(opts: { from: string; to: string; platform: NodeJS.Platform }): Promise<DataMigration | null>` where `type DataMigration = { copied: string[]; connections: boolean }`; `null` means nothing to do. Writes `migrated-from-miac.json` in `to` last.

- [ ] **Step 1: Write the failing tests** (`dataFolder.test.ts`, temp dirs per test):
  - copies `settings.json`, `state.json`, `connections.json`, `home.json`, `telemetry-id`, `usage/` (nested file), `review/`, `Local Storage/` (nested file); skips `Cache/`, `Code Cache/`, `GPUCache/`, `blob_storage/`, `Cookies`, `Cookies-journal`, `Session Storage/`, `DawnWebGPUCache/`, `GraphiteDawnCache/`, `DIPS`, `Trust Tokens`, `Shared Dictionary/`, `Network Persistent State`, `Preferences`, `DevToolsActivePort`, `declarative_performance_observer.db`; result `copied` lists the copied top-level names.
  - `Local State` is copied when `platform: 'win32'` and skipped when `'darwin'`.
  - returns `null` and copies nothing when `from` does not exist; when `from` has neither `state.json` nor `connections.json`; when `to` already has `state.json` or `connections.json` (assert the file in `to` is unchanged).
  - the marker exists after a run and holds `copied`; a second run returns `null`.
  - interrupted copy: make the copy of one file throw (pass an injectable `copy` fn, default `fs.cp`) → no `state.json` in `to`, no marker, and a later run copies everything.

- [ ] **Step 2: Run to see them fail**: `npx vitest run src/main/migrate/dataFolder.test.ts`.

- [ ] **Step 3: Implement**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Chromium's own entries in the profile folder; everything else is the app's. */
const CHROMIUM = [
  /^Cache$/, /^Code Cache$/, /^GPUCache$/, /^GPUPersistentCache$/, /^blob_storage$/, /^Cookies/,
  /^Session Storage$/, /^Dawn/, /^Graphite/, /^DIPS/, /^Trust Tokens/, /^Shared Dictionary$/,
  /^Network Persistent State$/, /^Preferences$/, /^DevToolsActivePort$/, /^declarative_performance_observer/,
  /^Crashpad$/, /^SingletonLock$/, /^SingletonSocket$/, /^SingletonCookie$/,
];
export const MARKER = 'migrated-from-miac.json';
const DATA = ['state.json', 'connections.json'];

export type DataMigration = { copied: string[]; connections: boolean };

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** First start of Shellie on a machine that ran MIAC: copy the app's files from the old `miac` folder. The old folder is left as it is. */
export async function migrateDataFolder(opts: {
  from: string;
  to: string;
  platform: NodeJS.Platform;
  copy?: (src: string, dest: string) => Promise<void>;
}): Promise<DataMigration | null> {
  const copy = opts.copy ?? ((s, d) => fs.cp(s, d, { recursive: true, errorOnExist: false, force: true }));
  if (await exists(path.join(opts.to, MARKER))) return null;
  for (const f of DATA) if (await exists(path.join(opts.to, f))) return null;
  const hasData = await Promise.all(DATA.map((f) => exists(path.join(opts.from, f))));
  if (!hasData.some(Boolean)) return null;

  const names = (await fs.readdir(opts.from)).filter(
    (n) => !CHROMIUM.some((r) => r.test(n)) && (n !== 'Local State' || opts.platform === 'win32'),
  );
  await fs.mkdir(opts.to, { recursive: true });
  // Data files last, each through a temp name, so an interrupted run leaves no state.json and runs again.
  const ordered = [...names.filter((n) => !DATA.includes(n)), ...names.filter((n) => DATA.includes(n))];
  for (const n of ordered) {
    const dest = path.join(opts.to, n);
    if (DATA.includes(n)) {
      await copy(path.join(opts.from, n), `${dest}.migrating`);
      await fs.rename(`${dest}.migrating`, dest);
    } else {
      await copy(path.join(opts.from, n), dest);
    }
  }
  const result = { copied: ordered, connections: ordered.includes('connections.json') };
  await fs.writeFile(path.join(opts.to, MARKER), JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2));
  return result;
}
```
(If the interrupted-copy test shows a stray `state.json.migrating`, remove it at the start of a run.)

Wire as the first lines of `boot()`:
```ts
const userData = app.getPath('userData');
const migrationStart = performance.now();
const migration = await migrateDataFolder({
  from: path.join(app.getPath('appData'), 'miac'),
  to: userData,
  platform: process.platform,
}).catch(() => null);
```
After telemetry is set up: `if (migration) telemetry?.event('migration.miac', { tokens: tokenResult }, { copied: migration.copied.length, ms })` (use the real AppInsightsClient method name; `tokenResult` comes from Task 5, `'none'` until then). Add the event to `docs/telemetry.md` in the table's format.

- [ ] **Step 4: Run the tests**, then the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: copy MIAC's data on Shellie's first start"`

---

### Task 5: Re-encrypt connection tokens on macOS

**Files:**
- Create: `src/main/migrate/macTokens.ts`, `src/main/migrate/macTokens.test.ts`
- Modify: `src/main.ts` (after `app.whenReady`, before `ConnectionStore.load()`)

**Interfaces:**
- Consumes: `DataMigration` from Task 4 (`connections: true`), `ConnectionsFileSchema` from `src/shared/types.ts`, `renameWithRetry` from `src/main/fsRetry.ts`.
- Produces: `decryptChromiumMac(cipher: Buffer, password: string): string`; `migrateMacTokens(opts: { file: string; readOldPassword: () => Promise<string>; encrypt: (plain: string) => Buffer }): Promise<'migrated' | 'partial' | 'refused' | 'none'>`.

- [ ] **Step 1: Write the failing tests** (`macTokens.test.ts`):

```ts
import { createCipheriv, pbkdf2Sync } from 'node:crypto';

// Chromium's macOS os_crypt: "v10" + AES-128-CBC, key PBKDF2-SHA1(password, "saltysalt", 1003, 16), IV 16 spaces.
function chromiumEncrypt(plain: string, password: string): Buffer {
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
  const c = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from('v10'), c.update(plain, 'utf8'), c.final()]);
}

it('decrypts what Chromium encrypted', () => {
  expect(decryptChromiumMac(chromiumEncrypt('pat-123', 'pw'), 'pw')).toBe('pat-123');
});

it('re-encrypts every token with the new key', async () => {
  const file = writeConnections([conn('a', chromiumEncrypt('pat-a', 'pw')), conn('b', chromiumEncrypt('pat-b', 'pw'))]);
  const r = await migrateMacTokens({ file, readOldPassword: async () => 'pw', encrypt: (p) => Buffer.from(`new:${p}`) });
  expect(r).toBe('migrated');
  expect(tokens(file)).toEqual(['new:pat-a', 'new:pat-b']);
});

it('marks a token that does not decrypt as unauthorized and keeps the others', async () => {
  const file = writeConnections([conn('a', chromiumEncrypt('pat-a', 'pw')), conn('b', Buffer.from('v10garbage-garbage'))]);
  expect(await migrateMacTokens({ file, readOldPassword: async () => 'pw', encrypt: (p) => Buffer.from(`new:${p}`) })).toBe('partial');
  const [a, b] = read(file).connections;
  expect(Buffer.from(a.tokenCiphertext, 'base64').toString()).toBe('new:pat-a');
  expect(b.status).toBe('unauthorized');
});

it('keeps every connection, unauthorized, when the Keychain prompt is refused', async () => {
  const file = writeConnections([conn('a', chromiumEncrypt('pat-a', 'pw'))]);
  expect(await migrateMacTokens({ file, readOldPassword: async () => { throw new Error('User canceled'); }, encrypt: () => Buffer.alloc(0) })).toBe('refused');
  expect(read(file).connections[0].status).toBe('unauthorized');
});

it('does nothing for an empty connections file', async () => {
  const file = writeConnections([]);
  expect(await migrateMacTokens({ file, readOldPassword: async () => 'pw', encrypt: () => Buffer.alloc(0) })).toBe('none');
});
```
(`conn`, `writeConnections`, `read`, `tokens` are small helpers in the test file that write/read a valid `ConnectionsFileSchema` document in a temp dir; build `conn` from an existing connection fixture in `ConnectionStore.test.ts`.)

- [ ] **Step 2: Run to see them fail**: `npx vitest run src/main/migrate/macTokens.test.ts`.

- [ ] **Step 3: Implement**

```ts
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { ConnectionsFileSchema } from '../../shared/types';
import { renameWithRetry } from '../fsRetry';

/** Chromium's macOS safeStorage format, which MIAC's tokens are in: "v10" + AES-128-CBC with a key derived from the Keychain password. */
export function decryptChromiumMac(cipher: Buffer, password: string): string {
  if (cipher.subarray(0, 3).toString() !== 'v10') throw new Error('not a v10 ciphertext');
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
  const d = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  return Buffer.concat([d.update(cipher.subarray(3)), d.final()]).toString('utf8');
}

/** MIAC's key, from the Keychain item Electron made for it. macOS asks the user once. */
export const readMiacKeychainPassword = (): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile('security', ['find-generic-password', '-w', '-s', 'miac Safe Storage', '-a', 'miac Key'], (err, out) =>
      err ? reject(err) : resolve(out.trim()),
    ),
  );

export async function migrateMacTokens(opts: {
  file: string;
  readOldPassword: () => Promise<string>;
  encrypt: (plain: string) => Buffer;
}): Promise<'migrated' | 'partial' | 'refused' | 'none'> {
  const doc = ConnectionsFileSchema.parse(JSON.parse(await fs.readFile(opts.file, 'utf8')));
  if (doc.connections.length === 0) return 'none';
  let password: string | null = null;
  try {
    password = await opts.readOldPassword();
  } catch {
    password = null;
  }
  let failed = 0;
  for (const c of doc.connections) {
    try {
      if (password === null) throw new Error('no key');
      const plain = decryptChromiumMac(Buffer.from(c.tokenCiphertext, 'base64'), password);
      c.tokenCiphertext = opts.encrypt(plain).toString('base64');
    } catch {
      c.status = 'unauthorized';
      failed++;
    }
  }
  const tmp = `${opts.file}.tokens`;
  await fs.writeFile(tmp, JSON.stringify(doc, null, 2));
  await renameWithRetry(tmp, opts.file);
  if (password === null) return 'refused';
  return failed === 0 ? 'migrated' : 'partial';
}
```
(Match the JSON formatting `ConnectionStore` writes; check its save method.)

Wire in `main.ts` before `ConnectionStore.load()`:
```ts
let tokenResult: 'migrated' | 'partial' | 'refused' | 'none' = 'none';
if (migration?.connections && process.platform === 'darwin' && safeStorage.isEncryptionAvailable()) {
  tokenResult = await migrateMacTokens({
    file: path.join(userData, 'connections.json'),
    readOldPassword: readMiacKeychainPassword,
    encrypt: (p) => safeStorage.encryptString(p),
  }).catch(() => 'refused' as const);
}
```
Check that `ConnectionStore.load()` keeps a stored `status: 'unauthorized'` (it does for invalid URLs; confirm it does not reset status), so the connection chip shows red and asks for the PAT.

- [ ] **Step 4: Run the tests**, then the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: move MIAC's connection tokens to Shellie's key on macOS"`

---

### Task 6: Leftover check, live check, PR (session-run)

- [ ] **Step 1: Leftovers**: `git grep -in miac -- ':!docs/superpowers' ':!design'`. Allowed: `CLAUDE.md` history line, `ShellieConfig.ts` fallback, `otlp.ts` fallback + its test, `types.ts` preprocess + test, `helpers.ts` opt-out + test, `TerminalManager.ts` `MIAC_TASK_ID` + test, `src/main/migrate/**`, `src/renderer/migratePrefs*`, `main.ts` migration wiring, `docs/telemetry.md` `migration.miac`. Anything else gets renamed.
- [ ] **Step 2: Live check on this Mac** (memory: real click-through checks with asserted results). Back up `~/Library/Application Support/miac` to the scratchpad first. Run `npm start`; assert: `~/Library/Application Support/Shellie/migrated-from-miac.json` exists with `copied`; the Keychain prompt appears once; after Allow, Settings shows the test connection green, Home and Sprint load, existing tasks and Done tasks are listed, Usage figures match MIAC's. Quit, start again: no prompt, no second migration. Remove `Shellie/` and start with Deny: the app starts, the connection asks for the PAT.
- [ ] **Step 3: Push the branch and open the PR** (after Task 7 Steps 1-2, so the repo and the telemetry resource already have the new names). Title `Rename MIAC to Shellie`; body lists the migration and the Windows reinstall note.

---

### Task 7: Outside operations (session-run, in this order)

- [ ] **Step 1: App Insights**: `az monitor app-insights component show --app miac-app -g miac-telemetry --query '{loc:location,ws:workspaceResourceId}'`; create `az group create -n shellie-telemetry -l <loc>`, a Log Analytics workspace `shellie-logs` in it, and `az monitor app-insights component create --app shellie-app -g shellie-telemetry -l <loc> --workspace <id> --kind web --application-type web`; `gh variable set APPINSIGHTS_CONNECTION_STRING --body "$(az ... --query connectionString -o tsv)"` (the value is piped, never printed). Keep `miac-app` until the owner says it can go.
- [ ] **Step 2: GitHub repo**: `gh repo rename Shellie --yes`; `git remote set-url origin https://github.com/UnreliableWitness/Shellie.git`; `git fetch` works.
- [ ] **Step 3: After the owner merges the PR**: watch the release job; check the release is titled `Shellie vX.Y.Z` with `Shellie-Setup.exe`.
- [ ] **Step 4: Azure DevOps**: with the PAT read in-process from the Keychain, `GET _apis/projects/MIAC` for the id, `PATCH _apis/projects/{id}?api-version=7.1` `{ "name": "Shellie" }`, poll the operation; rename team `MIAC Team` to `Shellie Team` (`PATCH _apis/projects/{id}/teams/{teamId}`). Update `tools/ado/` defaults, `CLAUDE.md`, and `~/.claude.json`'s Azure DevOps MCP entry if it names the project. Edit the test connection's project in the app's Settings.
- [ ] **Step 5: Dev Keychain**: `security add-generic-password -a shellie -s shellie-ado-unreliablewitness -w "$(security find-generic-password -a miac -s miac-ado-unreliablewitness -w)"`; run `node tools/ado/seed-test-items.mjs --help` style read with the new entry; update `CLAUDE.md`; then `security delete-generic-password -a miac -s miac-ado-unreliablewitness`.
- [ ] **Step 6: Local folder** (last): `mv ~/Projects/MIAC ~/Projects/Shellie`; move `~/.claude/projects/-Users-drieshoebeke-Projects-MIAC` to `-Users-drieshoebeke-Projects-Shellie`; update `MEMORY.md` entries that name MIAC paths; `npm install` in the new folder (node-pty postinstall). Tell the owner to start new sessions in `~/Projects/Shellie`.
