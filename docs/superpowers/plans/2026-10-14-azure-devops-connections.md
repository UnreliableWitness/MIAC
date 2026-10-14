# MIAC Azure DevOps Connections (sub-project 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect MIAC to one or more Azure DevOps organizations with personal access tokens, link each repo to a connection, and create tasks by picking real work items from the current sprint or the user's own list.

**Architecture:** A `ConnectionStore` keeps connections in `connections.json` with PATs encrypted by Electron `safeStorage` (injected as a small crypto interface). An `AdoClient` wraps four REST calls over `fetch` with Basic auth; an `AdoRegistry` caches one client per connection. The handler bundle gains connection, repo-link and work-item channels; the renderer gains a connections section in Settings, a work item picker in New task, a link on the header badge and a connection status in the nav footer.

**Tech Stack:** Existing stack (Electron 44 / Forge 8, React 19, zustand, zod 4, Vitest 5). No new runtime dependencies: `fetch` and `node:http` (test fixture) are built in.

**Spec:** `docs/superpowers/specs/2026-10-14-azure-devops-connections-design.md`

## Global Constraints

- PATs are encrypted with Electron `safeStorage` and stored only in `connections.json`; `state.json` never holds secrets. If `safeStorage.isEncryptionAvailable()` is false, saving is refused with a notice. The renderer sends the PAT once on save and never receives it back; no log line, error message or notice may contain a token.
- REST calls use `api-version=7.1` (`connectionData` uses `7.1-preview`), Basic auth `:<pat>` base64, and strip a UTF-8 BOM before JSON parsing. Responses with status 401 or 203 map to `unauthorized`, 404 to `not-found`, network errors to `unreachable`, 429 retries once after `Retry-After` (max 10 s).
- Work item `type` is a plain string read from the project. `branchType` stays: `Bug` gives `bugfix`, anything else `feature`. `WorkItemRef` gains `url: string | null` with a default of `null` so existing `state.json` files still validate.
- Picker: Current sprint (everyone) is the default, Assigned to me is the toggle; results capped at 50, ordered by `System.ChangedDate` descending, states `Closed`, `Removed`, `Done`, `Resolved` excluded; an all-digit search text also matches the exact id; single quotes in search text are doubled in WIQL.
- Only `https://dev.azure.com/...` and `https://*.visualstudio.com/...` URLs may be opened externally.
- Nothing is written to Azure DevOps by the app in this slice (the seed script in Task 7 is a developer tool, not app code).
- Core services (`src/main/services/*`, `src/shared/*`) must not import `electron`. Sources stay pure ASCII (JSX entities / `String.fromCharCode` for glyphs). Run `npm run lint:fix` before each commit. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Develop on macOS; keep Windows in mind only through the existing `Platform` boundary (no new platform code in this slice).

## Review Focus

1. **Organization URL variants** (trailing slash, `https://<org>.visualstudio.com`, a pasted project URL like `https://dev.azure.com/org/Project/_workitems`): the connection must normalise to `https://dev.azure.com/<org>` or `https://<org>.visualstudio.com` and reject anything else with a readable message. Pinned in Task 2 (`normalizeOrganizationUrl` tests).
2. **A PAT with the wrong scopes or an expired PAT**: Azure DevOps answers 401 for some calls and 203 with an HTML sign-in page for others; both must become `unauthorized`, never a JSON parse error. Pinned in Task 3.
3. **A project with no current iteration**: the client returns null, the picker falls back to Assigned to me with a hint instead of an empty list. Pinned in Task 3 (client) and Task 6 (picker).
4. **Search text with a single quote or only digits** (`O'Brien`, `48231`): WIQL must stay valid and the id match must work. Pinned in Task 3 (`buildWiql` tests).
5. **Removing a connection that repos use**: repos are unlinked, the picker falls back to the typed form, nothing dangles. Pinned in Task 4 (handlers) and Task 6 (picker).

---

### Task 1: Shared types, IPC contract and fake API defaults

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/shared/naming.test.ts`, `src/shared/types.test.ts`, `src/renderer/test-helpers/fakeApi.ts`, `src/renderer/screens/NewTaskScreen.tsx` (type import only)

**Interfaces:**
- Produces: `WorkItemRefSchema` with `type: string` and `url: string | null` (default null); `ConnectionStatusSchema`, `ConnectionSchema`, `ConnectionsFileSchema`, types `Connection`, `ConnectionStatus`, `ConnectionInput`, `Iteration`, `WorkItemSummary`, `WorkItemSearch`; new `Channels` entries `connections:list|save|remove|verify`, `repos:setConnection`, `workItems:currentIteration|search`, `shell:openExternal`; new `Events` entry `connections:changed`.

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/types.test.ts`:
```ts
import { ConnectionsFileSchema, WorkItemRefSchema } from './types';

describe('WorkItemRefSchema', () => {
  it('accepts any type string and defaults url to null', () => {
    expect(WorkItemRefSchema.parse({ id: '7', type: 'Issue', title: 'x' })).toEqual({ id: '7', type: 'Issue', title: 'x', url: null });
  });
  it('keeps a url when given', () => {
    expect(WorkItemRefSchema.parse({ id: '7', type: 'Bug', title: 'x', url: 'https://dev.azure.com/o/p/_workitems/edit/7' }).url).toContain('/edit/7');
  });
});

describe('ConnectionsFileSchema', () => {
  it('accepts an empty file and a connection with ciphertext', () => {
    expect(ConnectionsFileSchema.parse({ version: 1, connections: [] }).connections).toEqual([]);
    const c = { id: 'c1', name: 'unreliablewitness', organizationUrl: 'https://dev.azure.com/unreliablewitness', project: 'MIAC', user: null, status: 'unknown', checkedAt: null, tokenCiphertext: 'AAAA' };
    expect(ConnectionsFileSchema.parse({ version: 1, connections: [c] }).connections[0].tokenCiphertext).toBe('AAAA');
  });
  it('rejects an unknown status', () => {
    expect(() => ConnectionsFileSchema.parse({ version: 1, connections: [{ id: 'c', name: 'n', organizationUrl: 'u', project: 'p', user: null, status: 'weird', checkedAt: null, tokenCiphertext: 'x' }] })).toThrow();
  });
});
```

Add to `src/shared/naming.test.ts` inside `describe('branchType')`:
```ts
  it('treats Basic-process types as features', () => {
    expect(branchType({ id: '1', type: 'Issue', title: 't', url: null })).toBe('feature');
    expect(branchType({ id: '1', type: 'Epic', title: 't', url: null })).toBe('feature');
  });
```
The existing fixtures in `naming.test.ts` (`story`, `bug`, `task`) need `url: null` added where they are typed as `WorkItemRef`/`Task`; add it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project main src/shared`
Expected: FAIL (`ConnectionsFileSchema` not exported; `url` missing).

- [ ] **Step 3: Change the shared types**

In `src/shared/types.ts`, replace the first eleven lines with:
```ts
import { z } from 'zod';

/** Work item type names come from the project's process (Agile, Scrum, Basic, custom); any string is valid. */
export type WorkItemType = string;

export const WorkItemRefSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  url: z.string().nullable().default(null),
});
export type WorkItemRef = z.infer<typeof WorkItemRefSchema>;
```
Remove `WorkItemTypeSchema`. Append at the end of the file:
```ts
export const ConnectionStatusSchema = z.enum(['unknown', 'ok', 'unauthorized', 'unreachable']);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export const ConnectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  organizationUrl: z.string().min(1),
  project: z.string().min(1),
  user: z.string().nullable(),
  status: ConnectionStatusSchema,
  checkedAt: z.string().nullable(),
});
export type Connection = z.infer<typeof ConnectionSchema>;

export const ConnectionsFileSchema = z.object({
  version: z.literal(1),
  connections: z.array(ConnectionSchema.extend({ tokenCiphertext: z.string() })),
});
export type ConnectionsFile = z.infer<typeof ConnectionsFileSchema>;

/** What the renderer sends to save a connection. The PAT travels only in this direction. */
export type ConnectionInput = {
  id?: string;
  name?: string;
  organizationUrl: string;
  project: string;
  pat: string;
};

export type Iteration = { path: string; name: string };

export type WorkItemSummary = {
  id: string;
  type: string;
  title: string;
  state: string;
  areaPath: string;
  iterationPath: string;
  assignedTo: string | null;
  url: string;
};

export type WorkItemSearch = { scope: 'sprint' | 'mine'; text: string };
```

In `src/shared/ipc.ts`, extend the imports with `Connection, ConnectionInput, Iteration, WorkItemSearch, WorkItemSummary` and add to `Channels`:
```ts
  'connections:list': { args: []; result: Connection[] };
  'connections:save': { args: [input: ConnectionInput]; result: Connection };
  'connections:remove': { args: [id: string]; result: void };
  'connections:verify': { args: [id: string]; result: Connection };
  'repos:setConnection': { args: [repoId: string, connectionId: string | null]; result: Repo };
  'workItems:currentIteration': { args: [connectionId: string]; result: Iteration | null };
  'workItems:search': { args: [connectionId: string, search: WorkItemSearch]; result: WorkItemSummary[] };
  'shell:openExternal': { args: [url: string]; result: void };
```
and to `Events`: `'connections:changed': Connection[];`.

In `src/renderer/test-helpers/fakeApi.ts` add to `defaults`: `'connections:list': () => []`.

In `src/renderer/screens/NewTaskScreen.tsx` the `TYPES` constant keeps working because `WorkItemType` is now `string`; no change needed yet (Task 6 rewrites the screen).

- [ ] **Step 4: Run the whole suite, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass. If a handler or renderer test constructs a `WorkItemRef` literal that TypeScript now flags for the missing `url`, add `url: null` there (the zod default only applies to parsed data, not to TypeScript literals typed as `WorkItemRef`).

- [ ] **Step 5: Commit**

```bash
git add src/shared src/renderer/test-helpers/fakeApi.ts src/renderer/screens/NewTaskScreen.tsx
git commit -m "feat: connection and work item types, IPC channels for Azure DevOps"
```

---

### Task 2: ConnectionStore with encrypted tokens

**Files:**
- Create: `src/main/services/ConnectionStore.ts`
- Test: `src/main/services/ConnectionStore.test.ts`

**Interfaces:**
- Consumes: `ConnectionsFileSchema`, `Connection`, `ConnectionInput`, `ConnectionStatus` (Task 1).
- Produces: `interface TokenCrypto { available(): boolean; encrypt(plain: string): Buffer; decrypt(cipher: Buffer): string }`; `normalizeOrganizationUrl(input: string): string` (throws `Error` on an unsupported host); `organizationSlug(url: string): string`; `class ConnectionStore { constructor(filePath: string, crypto: TokenCrypto); load(): Promise<{ recovered: boolean; backup?: string }>; list(): Connection[]; get(id: string): Connection; save(input: ConnectionInput): Promise<Connection>; remove(id: string): Promise<void>; setStatus(id: string, status: ConnectionStatus, user?: string | null): Promise<Connection>; token(id: string): Promise<string> }`; `class TokenUnavailableError extends Error`.

- [ ] **Step 1: Write the failing tests**

`src/main/services/ConnectionStore.test.ts`:
```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionStore, normalizeOrganizationUrl, organizationSlug, type TokenCrypto } from './ConnectionStore';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const file = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'miac-conn-')); dirs.push(d); return path.join(d, 'connections.json'); };

/** Reversible fake: "encrypted" is the reversed string, so the file visibly never holds the PAT. */
const fakeCrypto = (available = true): TokenCrypto => ({
  available: () => available,
  encrypt: (s) => Buffer.from([...s].reverse().join(''), 'utf8'),
  decrypt: (b) => [...b.toString('utf8')].reverse().join(''),
});

describe('normalizeOrganizationUrl', () => {
  it('accepts dev.azure.com org URLs with extra path or slash', () => {
    expect(normalizeOrganizationUrl('https://dev.azure.com/unreliablewitness/')).toBe('https://dev.azure.com/unreliablewitness');
    expect(normalizeOrganizationUrl('https://dev.azure.com/unreliablewitness/MIAC/_workitems')).toBe('https://dev.azure.com/unreliablewitness');
    expect(normalizeOrganizationUrl('  dev.azure.com/Contoso ')).toBe('https://dev.azure.com/Contoso');
  });
  it('accepts visualstudio.com org URLs', () => {
    expect(normalizeOrganizationUrl('https://contoso.visualstudio.com/Project')).toBe('https://contoso.visualstudio.com');
  });
  it('rejects other hosts and a missing org', () => {
    expect(() => normalizeOrganizationUrl('https://github.com/x')).toThrow(/dev\.azure\.com/);
    expect(() => normalizeOrganizationUrl('https://dev.azure.com/')).toThrow(/organization/);
  });
  it('derives the slug', () => {
    expect(organizationSlug('https://dev.azure.com/unreliablewitness')).toBe('unreliablewitness');
    expect(organizationSlug('https://contoso.visualstudio.com')).toBe('contoso');
  });
});

describe('ConnectionStore', () => {
  it('saves a connection with an encrypted token and lists it without the token', async () => {
    const f = file();
    const store = new ConnectionStore(f, fakeCrypto());
    await store.load();
    const c = await store.save({ organizationUrl: 'https://dev.azure.com/unreliablewitness/', project: 'MIAC', pat: 'secret-pat' });
    expect(c).toMatchObject({ name: 'unreliablewitness', organizationUrl: 'https://dev.azure.com/unreliablewitness', project: 'MIAC', user: null, status: 'unknown', checkedAt: null });
    expect(store.list()).toEqual([c]);
    expect(JSON.stringify(store.list())).not.toContain('secret-pat');
    expect(readFileSync(f, 'utf8')).not.toContain('secret-pat');
    expect(await store.token(c.id)).toBe('secret-pat');
  });

  it('reloads from disk and still decrypts', async () => {
    const f = file();
    const a = new ConnectionStore(f, fakeCrypto());
    await a.load();
    const c = await a.save({ organizationUrl: 'https://dev.azure.com/o', project: 'P', pat: 'tok' });
    const b = new ConnectionStore(f, fakeCrypto());
    await b.load();
    expect(b.list()).toEqual([c]);
    expect(await b.token(c.id)).toBe('tok');
  });

  it('updates an existing connection by id and keeps its status when the pat is unchanged', async () => {
    const store = new ConnectionStore(file(), fakeCrypto());
    await store.load();
    const c = await store.save({ organizationUrl: 'https://dev.azure.com/o', project: 'P', pat: 'tok' });
    await store.setStatus(c.id, 'ok', 'Dries');
    const updated = await store.save({ id: c.id, name: 'Client', organizationUrl: 'https://dev.azure.com/o', project: 'Q', pat: 'tok2' });
    expect(updated).toMatchObject({ id: c.id, name: 'Client', project: 'Q', status: 'unknown', user: null });
    expect(store.list()).toHaveLength(1);
    expect(await store.token(c.id)).toBe('tok2');
  });

  it('refuses to save when encryption is unavailable', async () => {
    const store = new ConnectionStore(file(), fakeCrypto(false));
    await store.load();
    await expect(store.save({ organizationUrl: 'https://dev.azure.com/o', project: 'P', pat: 'tok' })).rejects.toThrow(/encryption/i);
    expect(store.list()).toEqual([]);
  });

  it('rejects an empty pat or project', async () => {
    const store = new ConnectionStore(file(), fakeCrypto());
    await store.load();
    await expect(store.save({ organizationUrl: 'https://dev.azure.com/o', project: '', pat: 'tok' })).rejects.toThrow(/project/i);
    await expect(store.save({ organizationUrl: 'https://dev.azure.com/o', project: 'P', pat: '  ' })).rejects.toThrow(/token/i);
  });

  it('removes and reports unknown ids', async () => {
    const store = new ConnectionStore(file(), fakeCrypto());
    await store.load();
    const c = await store.save({ organizationUrl: 'https://dev.azure.com/o', project: 'P', pat: 'tok' });
    await store.remove(c.id);
    expect(store.list()).toEqual([]);
    expect(() => store.get(c.id)).toThrow(/Unknown connection/);
    await expect(store.token(c.id)).rejects.toThrow(/Unknown connection/);
  });

  it('turns a decrypt failure into a readable error', async () => {
    const f = file();
    const store = new ConnectionStore(f, fakeCrypto());
    await store.load();
    const c = await store.save({ organizationUrl: 'https://dev.azure.com/o', project: 'P', pat: 'tok' });
    const broken = new ConnectionStore(f, { ...fakeCrypto(), decrypt: () => { throw new Error('bad key'); } });
    await broken.load();
    await expect(broken.token(c.id)).rejects.toThrow(/could not be decrypted/);
  });

  it('backs up a corrupt file and starts empty', async () => {
    const f = file();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(f, '{ nope');
    const store = new ConnectionStore(f, fakeCrypto());
    const r = await store.load();
    expect(r.recovered).toBe(true);
    expect(store.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/services/ConnectionStore.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/main/services/ConnectionStore.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ConnectionsFileSchema, type Connection, type ConnectionInput, type ConnectionStatus, type ConnectionsFile } from '../../shared/types';

/** Encrypts tokens at rest. main.ts adapts Electron safeStorage; tests pass a fake. */
export interface TokenCrypto {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}

export class TokenUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenUnavailableError';
  }
}

/** `https://dev.azure.com/<org>` or `https://<org>.visualstudio.com`, from anything a user is likely to paste. */
export function normalizeOrganizationUrl(input: string): string {
  let text = input.trim();
  if (text.length === 0) throw new Error('Enter the organization URL, e.g. https://dev.azure.com/<organization>');
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`"${input.trim()}" is not a valid URL`);
  }
  const host = url.hostname.toLowerCase();
  if (host === 'dev.azure.com') {
    const org = url.pathname.split('/').filter(Boolean)[0];
    if (!org) throw new Error('The URL needs the organization: https://dev.azure.com/<organization>');
    return `https://dev.azure.com/${org}`;
  }
  if (host.endsWith('.visualstudio.com') && host.split('.').length === 3) {
    return `https://${host}`;
  }
  throw new Error('Use a dev.azure.com or visualstudio.com organization URL');
}

export function organizationSlug(organizationUrl: string): string {
  const url = new URL(organizationUrl);
  if (url.hostname === 'dev.azure.com') return url.pathname.split('/').filter(Boolean)[0] ?? organizationUrl;
  return url.hostname.split('.')[0];
}

type Stored = ConnectionsFile['connections'][number];

const empty = (): ConnectionsFile => ({ version: 1, connections: [] });

/** Connections to Azure DevOps organizations, tokens encrypted at rest. Same atomic-write pattern as TaskStore. */
export class ConnectionStore {
  private current: ConnectionsFile = empty();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly crypto: TokenCrypto,
  ) {}

  async load(): Promise<{ recovered: boolean; backup?: string }> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.current = empty();
        return { recovered: false };
      }
      throw e;
    }
    try {
      this.current = ConnectionsFileSchema.parse(JSON.parse(raw));
      return { recovered: false };
    } catch {
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      await fs.rename(this.filePath, backup);
      this.current = empty();
      return { recovered: true, backup };
    }
  }

  list(): Connection[] {
    return this.current.connections.map(strip);
  }

  get(id: string): Connection {
    return strip(this.stored(id));
  }

  async save(input: ConnectionInput): Promise<Connection> {
    const organizationUrl = normalizeOrganizationUrl(input.organizationUrl);
    const project = input.project.trim();
    if (project.length === 0) throw new Error('Enter the project name');
    const pat = input.pat.trim();
    if (pat.length === 0) throw new Error('Enter a personal access token');
    if (!this.crypto.available()) throw new TokenUnavailableError('Token encryption is not available on this machine; the connection was not saved');
    const tokenCiphertext = this.crypto.encrypt(pat).toString('base64');
    const existing = input.id ? this.current.connections.find((c) => c.id === input.id) : undefined;
    const record: Stored = {
      id: existing?.id ?? input.id ?? randomUUID(),
      name: (input.name ?? existing?.name ?? organizationSlug(organizationUrl)).trim() || organizationSlug(organizationUrl),
      organizationUrl,
      project,
      user: null,
      status: 'unknown',
      checkedAt: null,
      tokenCiphertext,
    };
    await this.update((f) => {
      const i = f.connections.findIndex((c) => c.id === record.id);
      if (i >= 0) f.connections[i] = record;
      else f.connections.push(record);
    });
    return strip(record);
  }

  async remove(id: string): Promise<void> {
    this.stored(id);
    await this.update((f) => {
      f.connections = f.connections.filter((c) => c.id !== id);
    });
  }

  async setStatus(id: string, status: ConnectionStatus, user?: string | null): Promise<Connection> {
    await this.update((f) => {
      const c = f.connections.find((x) => x.id === id);
      if (!c) throw new Error(`Unknown connection ${id}`);
      c.status = status;
      c.checkedAt = new Date().toISOString();
      if (user !== undefined) c.user = user;
    });
    return this.get(id);
  }

  async token(id: string): Promise<string> {
    const c = this.stored(id);
    try {
      return this.crypto.decrypt(Buffer.from(c.tokenCiphertext, 'base64'));
    } catch {
      throw new TokenUnavailableError('Stored token could not be decrypted; enter it again');
    }
  }

  private stored(id: string): Stored {
    const c = this.current.connections.find((x) => x.id === id);
    if (!c) throw new Error(`Unknown connection ${id}`);
    return c;
  }

  private update(mutate: (f: ConnectionsFile) => void): Promise<void> {
    const run = async () => {
      const next = structuredClone(this.current);
      mutate(next);
      const valid = ConnectionsFileSchema.parse(next);
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(valid, null, 2), 'utf8');
      await fs.rename(tmp, this.filePath);
      this.current = valid;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

function strip(c: Stored): Connection {
  const { tokenCiphertext: _omit, ...rest } = c;
  return rest;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project main src/main/services/ConnectionStore.test.ts`
Expected: PASS (12 tests). If oxlint flags the unused `_omit` destructure, replace `strip` with an explicit object literal of the seven fields.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/ConnectionStore.ts src/main/services/ConnectionStore.test.ts
git commit -m "feat: ConnectionStore with encrypted tokens and URL normalisation"
```

---

### Task 3: AdoClient over fetch, tested against a local fake server

**Files:**
- Create: `src/main/services/AdoClient.ts`, `src/main/test-helpers/adoServer.ts`
- Test: `src/main/services/AdoClient.test.ts`

**Interfaces:**
- Consumes: `Iteration`, `WorkItemSummary`, `WorkItemSearch` (Task 1).
- Produces: `type AdoErrorKind = 'unauthorized' | 'not-found' | 'unreachable' | 'http'`; `class AdoError extends Error { kind; status?: number; path: string }`; `buildWiql(opts: { scope: 'sprint' | 'mine'; text: string; iterationPath: string | null }): string`; `class AdoClient { constructor(organizationUrl: string, token: () => Promise<string>, fetchImpl?: typeof fetch); verify(project): Promise<{ user: string }>; workItemTypes(project): Promise<string[]>; currentIteration(project): Promise<Iteration | null>; searchWorkItems(opts: { project: string; scope: 'sprint' | 'mine'; text: string; iterationPath: string | null }): Promise<WorkItemSummary[]> }`; test helper `startAdoServer(): Promise<AdoServer>` with `AdoServer = { url: string; requests: { method: string; path: string; auth: string | null; body: string }[]; route(method, pathPrefix, reply: Reply | ((req) => Reply)): void; close(): Promise<void> }`, `Reply = { status?: number; body?: unknown; headers?: Record<string, string>; raw?: string }`.

- [ ] **Step 1: Write the fake server helper**

`src/main/test-helpers/adoServer.ts`:
```ts
import { createServer, type IncomingMessage, type Server } from 'node:http';

export type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; raw?: string };
export type Recorded = { method: string; path: string; auth: string | null; body: string };
type Handler = (req: Recorded) => Reply;

export type AdoServer = {
  url: string;
  requests: Recorded[];
  route(method: string, pathPrefix: string, reply: Reply | Handler): void;
  close(): Promise<void>;
};

/** A tiny HTTP server that answers Azure DevOps REST paths with canned JSON. Routes match by method and path prefix, last registered wins. */
export async function startAdoServer(): Promise<AdoServer> {
  const routes: { method: string; prefix: string; reply: Reply | Handler }[] = [];
  const requests: Recorded[] = [];
  const server: Server = createServer((req: IncomingMessage, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      const rec: Recorded = { method: req.method ?? 'GET', path: req.url ?? '/', auth: req.headers.authorization ?? null, body };
      requests.push(rec);
      const route = [...routes].reverse().find((r) => r.method === rec.method && rec.path.startsWith(r.prefix));
      const reply: Reply = route ? (typeof route.reply === 'function' ? route.reply(rec) : route.reply) : { status: 404, body: { message: `no route for ${rec.method} ${rec.path}` } };
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...(reply.headers ?? {}) });
      res.end(reply.raw ?? JSON.stringify(reply.body ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    route: (method, prefix, reply) => { routes.push({ method, prefix, reply }); },
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
```

- [ ] **Step 2: Write the failing tests**

`src/main/services/AdoClient.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startAdoServer, type AdoServer } from '../test-helpers/adoServer';
import { AdoClient, AdoError, buildWiql } from './AdoClient';

let server: AdoServer;
let client: AdoClient;
beforeEach(async () => {
  server = await startAdoServer();
  client = new AdoClient(`${server.url}/unreliablewitness`, async () => 'secret-pat');
});
afterEach(() => server.close());

const authFor = (pat: string) => `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;

describe('buildWiql', () => {
  it('scopes to the sprint and excludes closed states', () => {
    const q = buildWiql({ scope: 'sprint', text: '', iterationPath: 'MIAC\\Sprint 1' });
    expect(q).toContain("[System.IterationPath] = 'MIAC\\Sprint 1'");
    expect(q).toContain("[System.State] NOT IN ('Closed', 'Removed', 'Done', 'Resolved')");
    expect(q).toContain('ORDER BY [System.ChangedDate] DESC');
    expect(q).not.toContain('@Me');
  });
  it('scopes to me', () => {
    expect(buildWiql({ scope: 'mine', text: '', iterationPath: null })).toContain('[System.AssignedTo] = @Me');
  });
  it('matches an all-digit text as id or title', () => {
    const q = buildWiql({ scope: 'mine', text: '48231', iterationPath: null });
    expect(q).toContain("([System.Id] = 48231 OR [System.Title] CONTAINS '48231')");
  });
  it("doubles single quotes in the text", () => {
    expect(buildWiql({ scope: 'mine', text: "O'Brien", iterationPath: null })).toContain("[System.Title] CONTAINS 'O''Brien'");
  });
});

describe('AdoClient.verify', () => {
  it('returns the user and sends basic auth with the pat', async () => {
    server.route('GET', '/unreliablewitness/_apis/connectionData', { body: { authenticatedUser: { providerDisplayName: 'Dries Hoebeke' } } });
    server.route('GET', '/unreliablewitness/_apis/projects/MIAC', { body: { id: 'p', name: 'MIAC' } });
    expect(await client.verify('MIAC')).toEqual({ user: 'Dries Hoebeke' });
    expect(server.requests[0].auth).toBe(authFor('secret-pat'));
    expect(server.requests[0].path).toContain('api-version=7.1-preview');
  });
  it('maps 401 to unauthorized', async () => {
    server.route('GET', '/unreliablewitness/_apis/connectionData', { status: 401, body: { message: 'nope' } });
    const err = await client.verify('MIAC').catch((e) => e);
    expect(err).toBeInstanceOf(AdoError);
    expect(err.kind).toBe('unauthorized');
    expect(err.message).not.toContain('secret-pat');
  });
  it('maps 203 with an html sign-in page to unauthorized', async () => {
    server.route('GET', '/unreliablewitness/_apis/connectionData', { status: 203, headers: { 'content-type': 'text/html' }, raw: '﻿<!DOCTYPE html><html><title>Sign in</title></html>' });
    const err = await client.verify('MIAC').catch((e) => e);
    expect(err.kind).toBe('unauthorized');
  });
  it('maps a missing project to not-found', async () => {
    server.route('GET', '/unreliablewitness/_apis/connectionData', { body: { authenticatedUser: { providerDisplayName: 'D' } } });
    server.route('GET', '/unreliablewitness/_apis/projects/Nope', { status: 404, body: { message: 'TF200016' } });
    const err = await client.verify('Nope').catch((e) => e);
    expect(err.kind).toBe('not-found');
    expect(err.path).toContain('/_apis/projects/Nope');
  });
  it('maps a connection failure to unreachable', async () => {
    const dead = new AdoClient('http://127.0.0.1:1/org', async () => 'x');
    const err = await dead.verify('P').catch((e) => e);
    expect(err).toBeInstanceOf(AdoError);
    expect(err.kind).toBe('unreachable');
  });
  it('retries once on 429 after Retry-After', async () => {
    let calls = 0;
    server.route('GET', '/unreliablewitness/_apis/connectionData', () => (++calls === 1 ? { status: 429, headers: { 'retry-after': '0' }, body: {} } : { body: { authenticatedUser: { providerDisplayName: 'D' } } }));
    server.route('GET', '/unreliablewitness/_apis/projects/MIAC', { body: { name: 'MIAC' } });
    expect(await client.verify('MIAC')).toEqual({ user: 'D' });
    expect(calls).toBe(2);
  });
  it('strips a BOM before parsing JSON', async () => {
    server.route('GET', '/unreliablewitness/_apis/connectionData', { raw: '﻿{"authenticatedUser":{"providerDisplayName":"D"}}' });
    server.route('GET', '/unreliablewitness/_apis/projects/MIAC', { body: {} });
    expect(await client.verify('MIAC')).toEqual({ user: 'D' });
  });
});

describe('AdoClient reads', () => {
  it('lists work item type names', async () => {
    server.route('GET', '/unreliablewitness/MIAC/_apis/wit/workitemtypes', { body: { value: [{ name: 'Issue' }, { name: 'Epic' }, { name: 'Task' }] } });
    expect(await client.workItemTypes('MIAC')).toEqual(['Issue', 'Epic', 'Task']);
  });
  it('returns the current iteration or null', async () => {
    server.route('GET', '/unreliablewitness/MIAC/_apis/work/teamsettings/iterations', { body: { value: [{ name: 'Sprint 1', path: 'MIAC\\Sprint 1', attributes: { timeFrame: 'current' } }] } });
    expect(await client.currentIteration('MIAC')).toEqual({ path: 'MIAC\\Sprint 1', name: 'Sprint 1' });
    expect(server.requests.at(-1)?.path).toContain('$timeframe=current');
    server.route('GET', '/unreliablewitness/MIAC/_apis/work/teamsettings/iterations', { body: { value: [] } });
    expect(await client.currentIteration('MIAC')).toBeNull();
  });
  it('encodes a project name with spaces', async () => {
    server.route('GET', '/unreliablewitness/My%20Project/_apis/wit/workitemtypes', { body: { value: [] } });
    expect(await client.workItemTypes('My Project')).toEqual([]);
  });
  it('searches: wiql then batch get, mapping fields and url', async () => {
    server.route('POST', '/unreliablewitness/MIAC/_apis/wit/wiql', { body: { workItems: [{ id: 12 }, { id: 7 }] } });
    server.route('GET', '/unreliablewitness/_apis/wit/workitems', {
      body: { value: [
        { id: 12, fields: { 'System.WorkItemType': 'Issue', 'System.Title': 'Save address', 'System.State': 'To Do', 'System.AreaPath': 'MIAC', 'System.IterationPath': 'MIAC\\Sprint 1', 'System.AssignedTo': { displayName: 'Dries Hoebeke' } }, _links: { html: { href: 'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/12' } } },
        { id: 7, fields: { 'System.WorkItemType': 'Task', 'System.Title': 'Tidy', 'System.State': 'Doing', 'System.AreaPath': 'MIAC', 'System.IterationPath': 'MIAC\\Sprint 1' } },
      ] },
    });
    const items = await client.searchWorkItems({ project: 'MIAC', scope: 'sprint', text: '', iterationPath: 'MIAC\\Sprint 1' });
    expect(items).toEqual([
      { id: '12', type: 'Issue', title: 'Save address', state: 'To Do', areaPath: 'MIAC', iterationPath: 'MIAC\\Sprint 1', assignedTo: 'Dries Hoebeke', url: 'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/12' },
      { id: '7', type: 'Task', title: 'Tidy', state: 'Doing', areaPath: 'MIAC', iterationPath: 'MIAC\\Sprint 1', assignedTo: null, url: `${server.url}/unreliablewitness/MIAC/_workitems/edit/7` },
    ]);
    const wiql = server.requests.find((r) => r.method === 'POST');
    expect(JSON.parse(wiql!.body).query).toContain("[System.IterationPath] = 'MIAC\\Sprint 1'");
    const batch = server.requests.find((r) => r.path.includes('/_apis/wit/workitems?'));
    expect(batch!.path).toContain('ids=12,7');
    expect(batch!.path).toContain('System.AssignedTo');
  });
  it('returns [] without a batch call when wiql finds nothing', async () => {
    server.route('POST', '/unreliablewitness/MIAC/_apis/wit/wiql', { body: { workItems: [] } });
    expect(await client.searchWorkItems({ project: 'MIAC', scope: 'mine', text: '', iterationPath: null })).toEqual([]);
    expect(server.requests.some((r) => r.path.includes('/_apis/wit/workitems?'))).toBe(false);
  });
  it('caps the batch at 50 ids', async () => {
    server.route('POST', '/unreliablewitness/MIAC/_apis/wit/wiql', { body: { workItems: Array.from({ length: 80 }, (_, i) => ({ id: i + 1 })) } });
    server.route('GET', '/unreliablewitness/_apis/wit/workitems', (req) => ({ body: { value: [] , echoed: req.path } }));
    await client.searchWorkItems({ project: 'MIAC', scope: 'mine', text: '', iterationPath: null });
    const batch = server.requests.find((r) => r.path.includes('/_apis/wit/workitems?'));
    expect(batch!.path.match(/ids=([^&]+)/)![1].split(',')).toHaveLength(50);
  });
  it('surfaces a malformed body as an http error, not a crash', async () => {
    server.route('GET', '/unreliablewitness/MIAC/_apis/wit/workitemtypes', { raw: 'not json' });
    const err = await client.workItemTypes('MIAC').catch((e) => e);
    expect(err).toBeInstanceOf(AdoError);
    expect(err.kind).toBe('http');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/services/AdoClient.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`src/main/services/AdoClient.ts`:
```ts
import type { Iteration, WorkItemSummary } from '../../shared/types';

export type AdoErrorKind = 'unauthorized' | 'not-found' | 'unreachable' | 'http';

export class AdoError extends Error {
  constructor(
    public readonly kind: AdoErrorKind,
    public readonly path: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AdoError';
  }
}

const API = 'api-version=7.1';
const EXCLUDED_STATES = ['Closed', 'Removed', 'Done', 'Resolved'];
const FIELDS = ['System.Id', 'System.WorkItemType', 'System.Title', 'System.State', 'System.AreaPath', 'System.IterationPath', 'System.AssignedTo'];
const MAX_RESULTS = 50;

const wiqlString = (s: string) => `'${s.replaceAll("'", "''")}'`;

export function buildWiql(opts: { scope: 'sprint' | 'mine'; text: string; iterationPath: string | null }): string {
  const where = [
    '[System.TeamProject] = @project',
    `[System.State] NOT IN (${EXCLUDED_STATES.map(wiqlString).join(', ')})`,
  ];
  if (opts.scope === 'mine') where.push('[System.AssignedTo] = @Me');
  else if (opts.iterationPath) where.push(`[System.IterationPath] = ${wiqlString(opts.iterationPath)}`);
  const text = opts.text.trim();
  if (text.length > 0) {
    const title = `[System.Title] CONTAINS ${wiqlString(text)}`;
    where.push(/^\d+$/.test(text) ? `([System.Id] = ${Number(text)} OR ${title})` : title);
  }
  return `SELECT [System.Id] FROM WorkItems WHERE ${where.join(' AND ')} ORDER BY [System.ChangedDate] DESC`;
}

type Json = Record<string, unknown>;

/** Four read-only calls against one Azure DevOps organization. The token provider is called per request so a re-entered PAT takes effect immediately. */
export class AdoClient {
  constructor(
    private readonly organizationUrl: string,
    private readonly token: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async verify(project: string): Promise<{ user: string }> {
    const data = await this.request<Json>('/_apis/connectionData?api-version=7.1-preview');
    const user = ((data.authenticatedUser as Json | undefined)?.providerDisplayName as string | undefined) ?? 'unknown user';
    await this.request<Json>(`/_apis/projects/${encodeURIComponent(project)}?${API}`);
    return { user };
  }

  async workItemTypes(project: string): Promise<string[]> {
    const data = await this.request<{ value?: { name: string }[] }>(`/${encodeURIComponent(project)}/_apis/wit/workitemtypes?${API}`);
    return (data.value ?? []).map((t) => t.name);
  }

  async currentIteration(project: string): Promise<Iteration | null> {
    const data = await this.request<{ value?: { name: string; path: string }[] }>(`/${encodeURIComponent(project)}/_apis/work/teamsettings/iterations?$timeframe=current&${API}`);
    const first = (data.value ?? [])[0];
    return first ? { path: first.path, name: first.name } : null;
  }

  async searchWorkItems(opts: { project: string; scope: 'sprint' | 'mine'; text: string; iterationPath: string | null }): Promise<WorkItemSummary[]> {
    const query = buildWiql(opts);
    const result = await this.request<{ workItems?: { id: number }[] }>(`/${encodeURIComponent(opts.project)}/_apis/wit/wiql?${API}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const ids = (result.workItems ?? []).slice(0, MAX_RESULTS).map((w) => w.id);
    if (ids.length === 0) return [];
    const batch = await this.request<{ value?: { id: number; fields: Json; _links?: Json }[] }>(`/_apis/wit/workitems?ids=${ids.join(',')}&fields=${FIELDS.join(',')}&${API}`);
    const byId = new Map((batch.value ?? []).map((w) => [w.id, w]));
    return ids.flatMap((id) => {
      const w = byId.get(id);
      if (!w) return [];
      const f = w.fields;
      const assigned = f['System.AssignedTo'] as Json | string | undefined;
      const html = ((w._links as Json | undefined)?.html as Json | undefined)?.href as string | undefined;
      return [{
        id: String(w.id),
        type: String(f['System.WorkItemType'] ?? ''),
        title: String(f['System.Title'] ?? ''),
        state: String(f['System.State'] ?? ''),
        areaPath: String(f['System.AreaPath'] ?? ''),
        iterationPath: String(f['System.IterationPath'] ?? ''),
        assignedTo: typeof assigned === 'string' ? assigned : ((assigned?.displayName as string | undefined) ?? null),
        url: html ?? `${this.organizationUrl}/${encodeURIComponent(opts.project)}/_workitems/edit/${w.id}`,
      }];
    });
  }

  private async request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
    const url = `${this.organizationUrl}${path}`;
    const pat = await this.token();
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: { accept: 'application/json', ...(init.headers ?? {}), authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}` },
      });
    } catch (e) {
      throw new AdoError('unreachable', path, `Could not reach ${this.organizationUrl}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status === 429 && !retried) {
      const wait = Math.min(10, Number(res.headers.get('retry-after') ?? '1') || 1);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.request<T>(path, init, true);
    }
    if (res.status === 401 || res.status === 203) {
      throw new AdoError('unauthorized', path, 'Azure DevOps rejected the token (check that it is valid and has Work Items read scope)', res.status);
    }
    if (res.status === 404) throw new AdoError('not-found', path, `Not found: ${path.split('?')[0]}`, 404);
    const text = (await res.text()).replace(/^﻿/, '');
    if (!res.ok) throw new AdoError('http', path, `Azure DevOps returned ${res.status} for ${path.split('?')[0]}`, res.status);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AdoError('http', path, `Azure DevOps returned an unreadable response for ${path.split('?')[0]}`, res.status);
    }
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project main src/main/services/AdoClient.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/services/AdoClient.ts src/main/services/AdoClient.test.ts src/main/test-helpers/adoServer.ts
git commit -m "feat: AdoClient for verify, types, current iteration and work item search"
```

---

### Task 4: AdoRegistry, repo linking, handlers and main-process wiring

**Files:**
- Create: `src/main/services/AdoRegistry.ts`
- Modify: `src/main/services/RepoRegistry.ts` (add `setConnection`), `src/main/ipc/handlers.ts` (Services and new channels), `src/main.ts` (ConnectionStore with safeStorage, AdoRegistry, openExternal)
- Test: `src/main/services/RepoRegistry.test.ts` (one test), `src/main/ipc/handlers.test.ts` (new describe blocks)

**Interfaces:**
- Consumes: `ConnectionStore` (Task 2), `AdoClient`, `AdoError` (Task 3), the fake server (Task 3), existing `Services`.
- Produces: `class AdoRegistry { constructor(connections: ConnectionStore, fetchImpl?: typeof fetch); client(connectionId: string): AdoClient; invalidate(connectionId?: string): void }`; `RepoRegistry.setConnection(repoId: string, connectionId: string | null): Promise<Repo>`; `Services` gains `connections: ConnectionStore`, `ado: AdoRegistry`, `openExternal: (url: string) => Promise<void>`; handlers for every channel added in Task 1.

- [ ] **Step 1: Write the failing tests**

Add to `src/main/services/RepoRegistry.test.ts`:
```ts
  it('links and unlinks a connection', async () => {
    const reg = await registry();
    const repo = await reg.add(makeRepo('webshop'));
    expect((await reg.setConnection(repo.id, 'c1')).connectionId).toBe('c1');
    expect(reg.get(repo.id).connectionId).toBe('c1');
    expect((await reg.setConnection(repo.id, null)).connectionId).toBeNull();
    await expect(reg.setConnection('nope', 'c1')).rejects.toThrow(/Unknown repo/);
  });
```

Add to `src/main/ipc/handlers.test.ts`. Extend the harness: import `ConnectionStore` and `AdoRegistry`, `startAdoServer`, and build `connections` with a fake crypto (copy the reversible `fakeCrypto` from the ConnectionStore test into a small exported helper `src/main/test-helpers/fakeCrypto.ts` and import it in both tests). The harness gets `const connections = new ConnectionStore(path.join(dir, 'connections.json'), fakeCrypto()); await connections.load(); const server = await startAdoServer();` and passes `connections`, `ado: new AdoRegistry(connections)`, `openExternal: async (url) => { opened.push(url); }` in `services`; it returns `server`, `connections`, `opened`. Add `server.close()` to cleanup (collect servers in an array and close them in `afterAll`). Then:

```ts
function routeHealthyOrg(server: AdoServer, org = 'unreliablewitness') {
  server.route('GET', `/${org}/_apis/connectionData`, { body: { authenticatedUser: { providerDisplayName: 'Dries Hoebeke' } } });
  server.route('GET', `/${org}/_apis/projects/MIAC`, { body: { name: 'MIAC' } });
  server.route('GET', `/${org}/MIAC/_apis/work/teamsettings/iterations`, { body: { value: [{ name: 'Sprint 1', path: 'MIAC\\Sprint 1', attributes: { timeFrame: 'current' } }] } });
  server.route('POST', `/${org}/MIAC/_apis/wit/wiql`, { body: { workItems: [{ id: 5 }] } });
  server.route('GET', `/${org}/_apis/wit/workitems`, { body: { value: [{ id: 5, fields: { 'System.WorkItemType': 'Issue', 'System.Title': 'Five', 'System.State': 'To Do', 'System.AreaPath': 'MIAC', 'System.IterationPath': 'MIAC\\Sprint 1' } }] } });
}

describe('handlers: connections', () => {
  it('saves after verifying, lists without the token, and broadcasts', async () => {
    const { h, server, broadcasts } = await harness();
    routeHealthyOrg(server);
    const c = await h['connections:save']({ organizationUrl: `${server.url}/unreliablewitness`, project: 'MIAC', pat: 'secret-pat' });
    expect(c).toMatchObject({ project: 'MIAC', status: 'ok', user: 'Dries Hoebeke' });
    expect(JSON.stringify(await h['connections:list']())).not.toContain('secret-pat');
    expect(broadcasts.some((b) => b.event === 'connections:changed')).toBe(true);
  });
  it('does not save when verification fails', async () => {
    const { h, server } = await harness();
    server.route('GET', '/unreliablewitness/_apis/connectionData', { status: 401, body: {} });
    await expect(h['connections:save']({ organizationUrl: `${server.url}/unreliablewitness`, project: 'MIAC', pat: 'bad' })).rejects.toThrow(/rejected the token/);
    expect(await h['connections:list']()).toEqual([]);
  });
  it('verify flips status to unauthorized on 401 and back to ok', async () => {
    const { h, server } = await harness();
    routeHealthyOrg(server);
    const c = await h['connections:save']({ organizationUrl: `${server.url}/unreliablewitness`, project: 'MIAC', pat: 'p' });
    server.route('GET', '/unreliablewitness/_apis/connectionData', { status: 401, body: {} });
    await expect(h['connections:verify'](c.id)).rejects.toThrow();
    expect((await h['connections:list']())[0].status).toBe('unauthorized');
    routeHealthyOrg(server);
    expect((await h['connections:verify'](c.id)).status).toBe('ok');
  });
  it('removing a connection unlinks its repos', async () => {
    const { h, server, added } = await harness();
    routeHealthyOrg(server);
    const c = await h['connections:save']({ organizationUrl: `${server.url}/unreliablewitness`, project: 'MIAC', pat: 'p' });
    expect((await h['repos:setConnection'](added.id, c.id)).connectionId).toBe(c.id);
    await h['connections:remove'](c.id);
    expect((await h['repos:list']())[0].connectionId).toBeNull();
    await expect(h['repos:setConnection'](added.id, 'ghost')).rejects.toThrow(/Unknown connection/);
  });
});

describe('handlers: work items', () => {
  it('returns the current iteration and search results through the connection', async () => {
    const { h, server } = await harness();
    routeHealthyOrg(server);
    const c = await h['connections:save']({ organizationUrl: `${server.url}/unreliablewitness`, project: 'MIAC', pat: 'p' });
    expect(await h['workItems:currentIteration'](c.id)).toEqual({ path: 'MIAC\\Sprint 1', name: 'Sprint 1' });
    const items = await h['workItems:search'](c.id, { scope: 'sprint', text: '' });
    expect(items.map((i) => i.id)).toEqual(['5']);
    const wiql = server.requests.find((r) => r.method === 'POST');
    expect(JSON.parse(wiql!.body).query).toContain("[System.IterationPath] = 'MIAC\\Sprint 1'");
  });
  it('a 401 during search marks the connection unauthorized and broadcasts', async () => {
    const { h, server, broadcasts } = await harness();
    routeHealthyOrg(server);
    const c = await h['connections:save']({ organizationUrl: `${server.url}/unreliablewitness`, project: 'MIAC', pat: 'p' });
    broadcasts.length = 0;
    server.route('POST', '/unreliablewitness/MIAC/_apis/wit/wiql', { status: 401, body: {} });
    await expect(h['workItems:search'](c.id, { scope: 'mine', text: '' })).rejects.toThrow(/rejected the token/);
    expect((await h['connections:list']())[0].status).toBe('unauthorized');
    expect(broadcasts.some((b) => b.event === 'connections:changed')).toBe(true);
  });
});

describe('handlers: shell', () => {
  it('opens only Azure DevOps urls', async () => {
    const { h, opened } = await harness();
    await h['shell:openExternal']('https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/5');
    await h['shell:openExternal']('https://contoso.visualstudio.com/P/_workitems/edit/1');
    await expect(h['shell:openExternal']('https://evil.example/x')).rejects.toThrow(/not allowed/);
    await expect(h['shell:openExternal']('javascript:alert(1)')).rejects.toThrow(/not allowed/);
    expect(opened).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/services/RepoRegistry.test.ts src/main/ipc/handlers.test.ts`
Expected: FAIL (setConnection missing; Services shape rejects `connections`).

- [ ] **Step 3: Implement the registry and the repo link**

`src/main/test-helpers/fakeCrypto.ts`:
```ts
import type { TokenCrypto } from '../services/ConnectionStore';

/** Reversible fake: "encrypted" is the reversed string, so files visibly never hold the PAT. */
export const fakeCrypto = (available = true): TokenCrypto => ({
  available: () => available,
  encrypt: (s) => Buffer.from([...s].reverse().join(''), 'utf8'),
  decrypt: (b) => [...b.toString('utf8')].reverse().join(''),
});
```
(Replace the inline copy in `ConnectionStore.test.ts` with this import.)

`src/main/services/AdoRegistry.ts`:
```ts
import { AdoClient } from './AdoClient';
import type { ConnectionStore } from './ConnectionStore';

/** One AdoClient per connection id, created lazily; drop it when the connection changes. */
export class AdoRegistry {
  private readonly clients = new Map<string, AdoClient>();

  constructor(
    private readonly connections: ConnectionStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  client(connectionId: string): AdoClient {
    const hit = this.clients.get(connectionId);
    if (hit) return hit;
    const c = this.connections.get(connectionId);
    const client = new AdoClient(c.organizationUrl, () => this.connections.token(connectionId), this.fetchImpl);
    this.clients.set(connectionId, client);
    return client;
  }

  invalidate(connectionId?: string): void {
    if (connectionId) this.clients.delete(connectionId);
    else this.clients.clear();
  }
}
```

In `src/main/services/RepoRegistry.ts` add:
```ts
  async setConnection(repoId: string, connectionId: string | null): Promise<Repo> {
    this.get(repoId);
    await this.store.update((s) => {
      const r = s.repos.find((x) => x.id === repoId);
      if (r) r.connectionId = connectionId;
    });
    return this.get(repoId);
  }
```

- [ ] **Step 4: Implement the handlers**

In `src/main/ipc/handlers.ts`:
- Import `AdoClient` and `AdoError` from `../services/AdoClient`, `normalizeOrganizationUrl` and the type `ConnectionStore` from `../services/ConnectionStore`, the type `AdoRegistry`, and `Connection` from shared types. (The handler test injects a fake `fetch`-free server URL, so the probe client in `connections:save` must also accept the registry's `fetchImpl`; add `fetchImpl?: typeof fetch` to `Services` as an optional field defaulting to global `fetch`, and pass it to both the probe and `AdoRegistry` in `main.ts`/tests. The fake server speaks plain HTTP over loopback, so global `fetch` works in tests without any stub.)
- Extend `Services` with `connections: ConnectionStore; ado: AdoRegistry; openExternal: (url: string) => Promise<void>;`.
- Add helpers inside `createHandlers`:
```ts
  const connectionsChanged = () => s.broadcast('connections:changed', s.connections.list());

  /** Runs an Azure DevOps call for a connection; a rejected token flips the status so Settings and the footer turn red. */
  const withConnection = async <T>(connectionId: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (e) {
      if (e instanceof AdoError && e.kind === 'unauthorized') {
        await s.connections.setStatus(connectionId, 'unauthorized');
        connectionsChanged();
      } else if (e instanceof AdoError && e.kind === 'unreachable') {
        await s.connections.setStatus(connectionId, 'unreachable');
        connectionsChanged();
      }
      throw e;
    }
  };

  const verifyConnection = async (connectionId: string): Promise<Connection> => {
    const c = s.connections.get(connectionId);
    const { user } = await withConnection(connectionId, () => s.ado.client(connectionId).verify(c.project));
    const updated = await s.connections.setStatus(connectionId, 'ok', user);
    connectionsChanged();
    return updated;
  };

  const allowedExternal = (url: string): boolean => {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && (u.hostname === 'dev.azure.com' || u.hostname.endsWith('.visualstudio.com'));
    } catch {
      return false;
    }
  };
```
- Add handlers to the returned object:
```ts
    'connections:list': async () => s.connections.list(),
    'connections:save': async (input) => {
      // Verify with a throwaway client before anything is written, so a bad token never lands on disk.
      const organizationUrl = normalizeOrganizationUrl(input.organizationUrl);
      const probe = new AdoClient(organizationUrl, async () => input.pat.trim());
      const { user } = await probe.verify(input.project.trim());
      const saved = await s.connections.save(input);
      s.ado.invalidate(saved.id);
      const verified = await s.connections.setStatus(saved.id, 'ok', user);
      connectionsChanged();
      return verified;
    },
    'connections:remove': async (id) => {
      s.connections.get(id);
      for (const r of s.repos.list()) if (r.connectionId === id) await s.repos.setConnection(r.id, null);
      await s.connections.remove(id);
      s.ado.invalidate(id);
      connectionsChanged();
      s.broadcast('repos:changed', s.repos.list());
    },
    'connections:verify': async (id) => verifyConnection(id),
    'repos:setConnection': async (repoId, connectionId) => {
      if (connectionId !== null) s.connections.get(connectionId);
      const repo = await s.repos.setConnection(repoId, connectionId);
      s.broadcast('repos:changed', s.repos.list());
      return repo;
    },
    'workItems:currentIteration': async (connectionId) => {
      const c = s.connections.get(connectionId);
      return withConnection(connectionId, () => s.ado.client(connectionId).currentIteration(c.project));
    },
    'workItems:search': async (connectionId, search) => {
      const c = s.connections.get(connectionId);
      return withConnection(connectionId, async () => {
        const client = s.ado.client(connectionId);
        const iteration = search.scope === 'sprint' ? await client.currentIteration(c.project) : null;
        return client.searchWorkItems({ project: c.project, scope: search.scope, text: search.text, iterationPath: iteration?.path ?? null });
      });
    },
    'shell:openExternal': async (url) => {
      if (!allowedExternal(url)) throw new Error(`Opening ${url} is not allowed`);
      await s.openExternal(url);
    },
```

- [ ] **Step 5: Wire main.ts**

In `src/main.ts`: import `safeStorage` and `shell` from `electron`, `ConnectionStore` and `AdoRegistry`. In `boot()` before `createHandlers`:
```ts
  const connections = new ConnectionStore(path.join(app.getPath('userData'), 'connections.json'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (cipher) => safeStorage.decryptString(cipher),
  });
  const connectionsLoaded = await connections.load();
```
pass `connections, ado: new AdoRegistry(connections), openExternal: (url) => shell.openExternal(url)` into `createHandlers`, and in the `did-finish-load` block add a warn notice when `connectionsLoaded.recovered` (`connections.json was unreadable and was moved to <backup>; add your connections again.`).

- [ ] **Step 6: Run the suite, typecheck, lint, start**

Run: `npm test && npm run typecheck && npm run lint`, then `ELECTRON_ENABLE_LOGGING=1 npm start` and check the log for `Error`/`Unhandled` lines (none expected); quit.
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/main src/main.ts
git commit -m "feat: connection, repo-link and work item handlers with safeStorage wiring"
```

---

### Task 5: Renderer: connections in the store and Settings, repo linking

**Files:**
- Create: `src/renderer/components/ConnectionsSection.tsx`
- Modify: `src/renderer/store.ts` (connections), `src/renderer/App.tsx` (subscribe), `src/renderer/screens/SettingsScreen.tsx` (section + repo dropdown), `src/renderer/styles/screens.css`
- Test: `src/renderer/components/ConnectionsSection.test.tsx`, `src/renderer/screens/SettingsScreen.test.tsx` (one test)

**Interfaces:**
- Consumes: `connections:*`, `repos:setConnection` channels, `connections:changed` event (Tasks 1 and 4), `installFakeApi`.
- Produces: store fields `connections: Connection[]`, `setConnections(list)`; `load()` also fetches `connections:list`; `ConnectionsSection` component; `RepoRow` connection dropdown labelled `Connection for <repo name>`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/components/ConnectionsSection.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Connection } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { ConnectionsSection } from './ConnectionsSection';

const ok: Connection = { id: 'c1', name: 'unreliablewitness', organizationUrl: 'https://dev.azure.com/unreliablewitness', project: 'MIAC', user: 'Dries Hoebeke', status: 'ok', checkedAt: '2026-10-14T10:00:00.000Z' };

beforeEach(() => useStore.setState({ repos: [], tasks: [], notices: [], connections: [], screen: { kind: 'settings' } }));

describe('ConnectionsSection', () => {
  it('lists connections with their status', () => {
    installFakeApi();
    useStore.setState({ connections: [ok, { ...ok, id: 'c2', name: 'client', status: 'unauthorized', user: null }] });
    render(<ConnectionsSection />);
    expect(screen.getByText('Connected as Dries Hoebeke')).toBeInTheDocument();
    expect(screen.getByText(`https://dev.azure.com/unreliablewitness ${String.fromCharCode(0xb7)} MIAC`)).toBeInTheDocument();
    expect(screen.getByText('Token rejected, enter it again')).toBeInTheDocument();
  });

  it('adds a connection and never echoes the token', async () => {
    const { calls } = installFakeApi({ 'connections:save': () => ok, 'connections:list': () => [ok] });
    render(<ConnectionsSection />);
    await userEvent.click(screen.getByRole('button', { name: /Add connection/ }));
    await userEvent.type(screen.getByLabelText('Organization URL'), 'https://dev.azure.com/unreliablewitness/');
    await userEvent.type(screen.getByLabelText('Project'), 'MIAC');
    await userEvent.type(screen.getByLabelText('Personal access token'), 'secret-pat');
    expect(screen.getByLabelText('Personal access token')).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.channel === 'connections:save')?.args[0]).toEqual({ organizationUrl: 'https://dev.azure.com/unreliablewitness/', project: 'MIAC', pat: 'secret-pat' }));
    await waitFor(() => expect(useStore.getState().connections).toEqual([ok]));
    expect(screen.queryByLabelText('Personal access token')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('secret-pat');
  });

  it('keeps the form open with the message when saving fails', async () => {
    installFakeApi({ 'connections:save': () => { throw new Error('Azure DevOps rejected the token'); } });
    render(<ConnectionsSection />);
    await userEvent.click(screen.getByRole('button', { name: /Add connection/ }));
    await userEvent.type(screen.getByLabelText('Organization URL'), 'dev.azure.com/o');
    await userEvent.type(screen.getByLabelText('Project'), 'P');
    await userEvent.type(screen.getByLabelText('Personal access token'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/rejected the token/)).toBeInTheDocument();
    expect(screen.getByLabelText('Personal access token')).toBeInTheDocument();
  });

  it('verifies and removes', async () => {
    const { calls } = installFakeApi({ 'connections:verify': () => ({ ...ok, checkedAt: 'later' }), 'connections:remove': () => undefined, 'connections:list': () => [] });
    useStore.setState({ connections: [ok], repos: [{ id: 'r1', name: 'webshop', path: '/w', baseBranch: 'main', connectionId: 'c1', miacYmlFound: true }] });
    render(<ConnectionsSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(calls.some((c) => c.channel === 'connections:verify')).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText(/1 repository uses this connection/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove anyway' }));
    await waitFor(() => expect(calls.some((c) => c.channel === 'connections:remove' && c.args[0] === 'c1')).toBe(true));
  });
});
```

Add to `src/renderer/screens/SettingsScreen.test.tsx`:
```tsx
  it('links a repo to a connection', async () => {
    const { calls } = installFakeApi({ 'repos:setConnection': () => ({ ...webshop, connectionId: 'c1' }), 'repos:list': () => [{ ...webshop, connectionId: 'c1' }] });
    useStore.setState({ repos: [webshop], connections: [{ id: 'c1', name: 'unreliablewitness', organizationUrl: 'https://dev.azure.com/unreliablewitness', project: 'MIAC', user: null, status: 'ok', checkedAt: null }] });
    render(<SettingsScreen />);
    await userEvent.selectOptions(screen.getByLabelText('Connection for webshop'), 'c1');
    await waitFor(() => expect(calls.find((c) => c.channel === 'repos:setConnection')?.args).toEqual(['r1', 'c1']));
  });
```
The `beforeEach` in that file must now also set `connections: []`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project renderer src/renderer/components/ConnectionsSection.test.tsx src/renderer/screens/SettingsScreen.test.tsx`
Expected: FAIL, module not found / store field missing.

- [ ] **Step 3: Implement the store and App changes**

In `src/renderer/store.ts`: import `Connection`; add `connections: Connection[]` and `setConnections(connections: Connection[]): void` to `Store`; initial `connections: []`; `setConnections: (connections) => set({ connections })`; in `load()` fetch `connections:list` alongside the other two and call `setConnections`.

In `src/renderer/App.tsx`: `const setConnections = useStore((s) => s.setConnections);` and add `api().on('connections:changed', setConnections)` to `offs` (and to the effect deps).

- [ ] **Step 4: Implement the section**

Append to `src/renderer/styles/screens.css`:
```css
.conn-form { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 12px 16px; align-items: center; padding: 14px 16px; border-top: 1px solid var(--border); }
.conn-form label { color: var(--muted); }
.conn-form .actions { grid-column: 1 / -1; margin-top: 4px; }
.conn-status-ok { font-size: 12px; color: var(--green); }
.conn-status-bad { font-size: 12px; color: var(--red); }
.conn-confirm { display: flex; gap: 10px; align-items: center; padding: 10px 16px; background: var(--warn-bg); border-top: 1px solid var(--warn-border); color: var(--warn-text); font-size: 13px; }
```

`src/renderer/components/ConnectionsSection.tsx`:
```tsx
import { useState } from 'react';
import type { Connection } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';

export function statusText(c: Connection): { text: string; ok: boolean } {
  switch (c.status) {
    case 'ok':
      return { text: `Connected as ${c.user ?? 'unknown user'}`, ok: true };
    case 'unauthorized':
      return { text: 'Token rejected, enter it again', ok: false };
    case 'unreachable':
      return { text: 'Organization unreachable', ok: false };
    default:
      return { text: 'Not verified yet', ok: false };
  }
}

function ConnectionRow({ connection }: { connection: Connection }) {
  const notify = useStore((s) => s.notify);
  const setConnections = useStore((s) => s.setConnections);
  const repos = useStore((s) => s.repos);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const users = repos.filter((r) => r.connectionId === connection.id).length;
  const status = statusText(connection);

  const refresh = async () => setConnections(await api().invoke('connections:list'));
  const verify = async () => {
    setBusy(true);
    await tryInvoke(() => api().invoke('connections:verify', connection.id), notify);
    await refresh();
    setBusy(false);
  };
  const remove = async () => {
    if (users > 0 && !confirming) return setConfirming(true);
    setBusy(true);
    const ok = await tryInvoke(async () => { await api().invoke('connections:remove', connection.id); return true; }, notify);
    setBusy(false);
    setConfirming(false);
    if (ok) await refresh();
  };

  return (
    <>
      <div className="list-row">
        <div className="grow">
          <span style={{ fontWeight: 600 }}>{connection.name}</span>
          <span className="mono small muted">{connection.organizationUrl} &middot; {connection.project}</span>
          <span className={status.ok ? 'conn-status-ok' : 'conn-status-bad'}>{status.text}</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={verify} disabled={busy}>Verify</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={remove} disabled={busy}>Remove</button>
      </div>
      {confirming && (
        <div className="conn-confirm">
          <span>{`${users} ${users === 1 ? 'repository uses' : 'repositories use'} this connection; they will be unlinked.`}</span>
          <button type="button" className="btn btn-warn btn-sm" onClick={remove}>Remove anyway</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Keep</button>
        </div>
      )}
    </>
  );
}

function AddConnectionForm({ onDone }: { onDone: () => void }) {
  const notify = useStore((s) => s.notify);
  const setConnections = useStore((s) => s.setConnections);
  const [organizationUrl, setOrganizationUrl] = useState('');
  const [project, setProject] = useState('');
  const [pat, setPat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api().invoke('connections:save', { organizationUrl, project, pat });
      setConnections(await api().invoke('connections:list'));
      setPat('');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="conn-form">
      <label htmlFor="conn-url">Organization URL</label>
      <input id="conn-url" className="field mono" value={organizationUrl} onChange={(e) => setOrganizationUrl(e.target.value)} placeholder="https://dev.azure.com/your-org" />
      <label htmlFor="conn-project">Project</label>
      <input id="conn-project" className="field" value={project} onChange={(e) => setProject(e.target.value)} />
      <label htmlFor="conn-pat">Personal access token</label>
      <input id="conn-pat" className="field mono" type="password" autoComplete="off" value={pat} onChange={(e) => setPat(e.target.value)} />
      {error && <div className="conn-status-bad" style={{ gridColumn: '1 / -1' }}>{error}</div>}
      <div className="small muted" style={{ gridColumn: '1 / -1' }}>The token needs Work Items (read) and Code (read). It is encrypted with the OS keychain and never shown again.</div>
      <div className="actions">
        <button type="button" className="btn" onClick={onDone} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !organizationUrl.trim() || !project.trim() || !pat.trim()}>Save</button>
      </div>
    </div>
  );
}

export function ConnectionsSection() {
  const connections = useStore((s) => s.connections);
  const [adding, setAdding] = useState(false);
  return (
    <section id="ado" className="section">
      <div className="section-head">
        <h2>Azure DevOps</h2>
        <button type="button" className="btn" onClick={() => setAdding(true)} disabled={adding}>Add connection&hellip;</button>
      </div>
      <div className="list">
        {connections.length === 0 && !adding && (
          <div className="empty">No connections yet. Add your organization and project with a personal access token.</div>
        )}
        {connections.map((c) => <ConnectionRow key={c.id} connection={c} />)}
        {adding && <AddConnectionForm onDone={() => setAdding(false)} />}
      </div>
    </section>
  );
}
```

In `src/renderer/screens/SettingsScreen.tsx`:
- Replace the `#ado` placeholder section with `<ConnectionsSection />` and make the nav link `Azure DevOps` active-capable (remove `disabled`/`aria-disabled`).
- In `RepoRow`, read `connections` from the store and render after the `.miac.yml` tag:
```tsx
        <select
          className="field"
          aria-label={`Connection for ${repo.name}`}
          value={repo.connectionId ?? ''}
          onChange={async (e) => {
            const value = e.target.value || null;
            const ok = await tryInvoke(() => api().invoke('repos:setConnection', repo.id, value), notify);
            if (ok) setRepos(await api().invoke('repos:list'));
          }}
        >
          <option value="">No connection</option>
          {connections.map((c) => <option key={c.id} value={c.id}>{c.name} / {c.project}</option>)}
        </select>
```

- [ ] **Step 5: Run the renderer tests, suite, typecheck, lint**

Run: `npx vitest run --project renderer && npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat: Azure DevOps connections in Settings and repo linking"
```

---

### Task 6: Work item picker in New task

**Files:**
- Create: `src/renderer/components/WorkItemPicker.tsx`
- Modify: `src/renderer/screens/NewTaskScreen.tsx`, `src/renderer/styles/screens.css`
- Test: `src/renderer/components/WorkItemPicker.test.tsx`, `src/renderer/screens/NewTaskScreen.test.tsx` (adjust + one test)

**Interfaces:**
- Consumes: `workItems:currentIteration`, `workItems:search` (Task 4), store `connections` (Task 5), `WorkItemRef`, `WorkItemSummary`.
- Produces: `WorkItemPicker({ connectionId, selectedId, onPick(item: WorkItemRef) })`; New task tabs `Work item` / `Typed` / `Blank task` where `Work item` shows the picker only when the selected repo has a connection, otherwise the `Typed` form is shown and the `Work item` tab is hidden.

- [ ] **Step 1: Write the failing tests**

`src/renderer/components/WorkItemPicker.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkItemSummary } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { WorkItemPicker } from './WorkItemPicker';

const DOT = String.fromCharCode(0xb7);
const item = (id: string, title: string, type = 'Issue'): WorkItemSummary => ({ id, type, title, state: 'To Do', areaPath: 'MIAC', iterationPath: 'MIAC\\Sprint 1', assignedTo: null, url: `https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/${id}` });

beforeEach(() => useStore.setState({ notices: [] }));

describe('WorkItemPicker', () => {
  it('searches the current sprint on open and lists results', async () => {
    const { calls } = installFakeApi({ 'workItems:currentIteration': () => ({ path: 'MIAC\\Sprint 1', name: 'Sprint 1' }), 'workItems:search': () => [item('12', 'Save address'), item('7', 'Tidy', 'Task')] });
    render(<WorkItemPicker connectionId="c1" selectedId={null} onPick={() => {}} />);
    expect(await screen.findByText('Save address')).toBeInTheDocument();
    expect(screen.getByText(`12 ${DOT} To Do ${DOT} MIAC`)).toBeInTheDocument();
    expect(calls.find((c) => c.channel === 'workItems:search')?.args).toEqual(['c1', { scope: 'sprint', text: '' }]);
    expect(screen.getByRole('button', { name: 'Current sprint' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches to assigned to me', async () => {
    const { calls } = installFakeApi({ 'workItems:currentIteration': () => ({ path: 'p', name: 'Sprint 1' }), 'workItems:search': () => [] });
    render(<WorkItemPicker connectionId="c1" selectedId={null} onPick={() => {}} />);
    await waitFor(() => expect(calls.some((c) => c.channel === 'workItems:search')).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Assigned to me' }));
    await waitFor(() => expect(calls.filter((c) => c.channel === 'workItems:search').at(-1)?.args).toEqual(['c1', { scope: 'mine', text: '' }]));
  });

  it('falls back to assigned to me when there is no current sprint', async () => {
    const { calls } = installFakeApi({ 'workItems:currentIteration': () => null, 'workItems:search': () => [] });
    render(<WorkItemPicker connectionId="c1" selectedId={null} onPick={() => {}} />);
    expect(await screen.findByText(/No current sprint/)).toBeInTheDocument();
    await waitFor(() => expect(calls.find((c) => c.channel === 'workItems:search')?.args).toEqual(['c1', { scope: 'mine', text: '' }]));
    expect(screen.getByRole('button', { name: 'Current sprint' })).toBeDisabled();
  });

  it('debounces typed search text', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = installFakeApi({ 'workItems:currentIteration': () => ({ path: 'p', name: 'S' }), 'workItems:search': () => [] });
    render(<WorkItemPicker connectionId="c1" selectedId={null} onPick={() => {}} />);
    await userEvent.type(screen.getByLabelText('Search work items'), 'addr');
    await vi.advanceTimersByTimeAsync(350);
    await waitFor(() => expect(calls.filter((c) => c.channel === 'workItems:search').at(-1)?.args).toEqual(['c1', { scope: 'sprint', text: 'addr' }]));
    expect(calls.filter((c) => c.channel === 'workItems:search' && (c.args[1] as { text: string }).text === 'a')).toHaveLength(0);
    vi.useRealTimers();
  });

  it('picks an item', async () => {
    const onPick = vi.fn();
    installFakeApi({ 'workItems:currentIteration': () => ({ path: 'p', name: 'S' }), 'workItems:search': () => [item('12', 'Save address')] });
    render(<WorkItemPicker connectionId="c1" selectedId={null} onPick={onPick} />);
    await userEvent.click(await screen.findByRole('button', { name: /Save address/ }));
    expect(onPick).toHaveBeenCalledWith({ id: '12', type: 'Issue', title: 'Save address', url: 'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/12' });
  });

  it('shows the error and an empty list when search fails', async () => {
    installFakeApi({ 'workItems:currentIteration': () => ({ path: 'p', name: 'S' }), 'workItems:search': () => { throw new Error('Azure DevOps rejected the token'); } });
    render(<WorkItemPicker connectionId="c1" selectedId={null} onPick={() => {}} />);
    await waitFor(() => expect(useStore.getState().notices[0]?.message).toMatch(/rejected the token/));
    expect(screen.getByText(/Could not load work items/)).toBeInTheDocument();
  });
});
```

In `src/renderer/screens/NewTaskScreen.test.tsx`: the existing tests use the typed form; with no connections in the store the `Work item` tab is hidden and `Typed` is selected by default, so they keep passing once the default mode logic is in place. Keep their queries (`Work item id`, `Type`, `Title`). Change the `Type` select expectations: the select now lists `Issue`, `User Story`, `Bug`, `Task`, `Epic` (a fixed list of common types for typed entry); `selectOptions(..., 'Bug')` still works. Add:
```tsx
  it('creates a task from a picked work item when the repo has a connection', async () => {
    const { calls } = installFakeApi({
      'repos:config': () => config,
      'workItems:currentIteration': () => ({ path: 'MIAC\\Sprint 1', name: 'Sprint 1' }),
      'workItems:search': () => [{ id: '12', type: 'Issue', title: 'Save delivery address', state: 'To Do', areaPath: 'MIAC', iterationPath: 'MIAC\\Sprint 1', assignedTo: null, url: 'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/12' }],
      'tasks:create': () => ({ id: 't9' }) as never,
    });
    useStore.setState({ repos: [{ ...webshop, connectionId: 'c1' }], connections: [{ id: 'c1', name: 'uw', organizationUrl: 'https://dev.azure.com/unreliablewitness', project: 'MIAC', user: 'D', status: 'ok', checkedAt: null }] });
    render(<NewTaskScreen />);
    await userEvent.click(await screen.findByRole('button', { name: /Save delivery address/ }));
    await waitFor(() => expect(screen.getByLabelText('Branch')).toHaveValue('feature/12-save-delivery-address'));
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(calls.find((c) => c.channel === 'tasks:create')?.args[0]).toMatchObject({ workItem: { id: '12', type: 'Issue', title: 'Save delivery address', url: 'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/12' } }));
  });
```
The file's `beforeEach` must set `connections: []`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project renderer src/renderer/components/WorkItemPicker.test.tsx src/renderer/screens/NewTaskScreen.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the picker**

Append to `src/renderer/styles/screens.css`:
```css
.picker { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.picker-bar { display: flex; gap: 10px; flex-wrap: wrap; }
.picker-bar .field { flex: 1 1 240px; }
.picker-list { display: flex; flex-direction: column; gap: 6px; max-height: 460px; overflow: auto; }
.wi-row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--ground); color: var(--text); text-align: left; }
.wi-row[aria-pressed='true'] { border-color: var(--accent); background: #232017; }
.wi-type { flex: none; width: 82px; text-align: center; font-size: 12px; padding: 3px 0; border-radius: 6px; background: var(--accent-bg); color: var(--warn); }
.wi-type-bug { background: var(--red-bg); color: var(--red); }
.wi-type-story { background: var(--blue-bg); color: #8fb4ff; }
.wi-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.wi-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```
The `.segmented` control already exists in `app.css`; its buttons use `aria-pressed` for this picker (the New task tabs use `aria-selected`), so add `.segmented button[aria-pressed='true'] { background: #2c3038; color: var(--text); }` next to the existing `aria-selected` rule in `app.css`.

`src/renderer/components/WorkItemPicker.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import type { WorkItemRef, WorkItemSummary } from '../../shared/types';
import { api } from '../api';
import { useStore } from '../store';

const DEBOUNCE_MS = 300;

function typeClass(type: string): string {
  if (type === 'Bug') return 'wi-type wi-type-bug';
  if (type === 'User Story' || type === 'Product Backlog Item' || type === 'Issue') return 'wi-type wi-type-story';
  return 'wi-type';
}

export function WorkItemPicker({ connectionId, selectedId, onPick }: { connectionId: string; selectedId: string | null; onPick: (item: WorkItemRef) => void }) {
  const notify = useStore((s) => s.notify);
  const [sprint, setSprint] = useState<string | null | undefined>(undefined);
  const [scope, setScope] = useState<'sprint' | 'mine'>('sprint');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<WorkItemSummary[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    let live = true;
    setSprint(undefined);
    api().invoke('workItems:currentIteration', connectionId)
      .then((it) => {
        if (!live) return;
        setSprint(it ? it.name : null);
        if (!it) setScope('mine');
      })
      .catch((e: Error) => {
        if (!live) return;
        notify('error', e.message);
        setSprint(null);
        setScope('mine');
      });
    return () => { live = false; };
  }, [connectionId, notify]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    if (sprint === undefined) return;
    const mine = ++seq.current;
    setLoading(true);
    api().invoke('workItems:search', connectionId, { scope, text: query })
      .then((found) => {
        if (mine !== seq.current) return;
        setItems(found);
        setFailed(false);
      })
      .catch((e: Error) => {
        if (mine !== seq.current) return;
        notify('error', e.message);
        setItems([]);
        setFailed(true);
      })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, [connectionId, scope, query, sprint, notify]);

  return (
    <div className="picker">
      <div className="picker-bar">
        <input className="field" aria-label="Search work items" placeholder="Search by title or paste an ID" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="segmented">
          <button type="button" aria-pressed={scope === 'sprint'} disabled={sprint === null} onClick={() => setScope('sprint')}>Current sprint</button>
          <button type="button" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>Assigned to me</button>
        </div>
      </div>
      {sprint === null && <div className="small muted">No current sprint in this project; showing work assigned to you.</div>}
      {sprint && scope === 'sprint' && <div className="small muted">{sprint}</div>}
      <div className="picker-list" aria-busy={loading}>
        {failed && <div className="empty">Could not load work items. Check the connection in Settings.</div>}
        {!failed && !loading && items.length === 0 && <div className="empty">No open work items match.</div>}
        {items.map((w) => (
          <button key={w.id} type="button" className="wi-row" aria-pressed={selectedId === w.id} onClick={() => onPick({ id: w.id, type: w.type, title: w.title, url: w.url })}>
            <span className={typeClass(w.type)}>{w.type}</span>
            <span className="wi-text">
              <span className="wi-title">{w.title}</span>
              <span className="small muted">{w.id} &middot; {w.state} &middot; {w.areaPath}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rework the New task screen**

In `src/renderer/screens/NewTaskScreen.tsx`:
- `type Mode = 'pick' | 'typed' | 'blank';` and `const TYPES = ['Issue', 'User Story', 'Bug', 'Task', 'Epic'];`.
- Read `connections` from the store; `const connection = repo?.connectionId ? connections.find((c) => c.id === repo.connectionId) ?? null : null;`.
- Initial mode: `connection ? 'pick' : 'typed'`; when `repoId` changes, set mode to `pick` if the new repo has a connection, else (if mode was `pick`) to `typed`.
- New state `picked: WorkItemRef | null` (reset on repo change).
- Tabs: render `Work item` (mode `pick`) only when `connection` exists, then `Typed`, then `Blank task`.
- `workItem` memo: `mode === 'pick' ? picked : mode === 'typed' && (id.trim() || title.trim()) ? { id: id.trim(), type, title: title.trim(), url: null } : null`.
- `label`: `mode === 'blank' ? name : workItem?.title ?? (mode === 'typed' ? title : '')`.
- `canCreate`: `mode === 'pick' ? picked !== null : mode === 'typed' ? Boolean(id.trim() && title.trim()) : Boolean(name.trim())`.
- `tasks:create` payload: `name: mode === 'blank' ? name : ''`, `workItem: mode === 'blank' ? null : workItem && workItem.id ? workItem : null`.
- Left pane: `mode === 'pick' && connection ? <WorkItemPicker connectionId={connection.id} selectedId={picked?.id ?? null} onPick={setPicked} /> : mode === 'typed' ? (existing typed form, minus the "arrives in the next release" sentence) : (name form)`.
- The preview header shows `workItem ? `${workItem.type} ${workItem.id}` : 'Blank task'`.

- [ ] **Step 5: Run the renderer tests, suite, typecheck, lint**

Run: `npx vitest run --project renderer && npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat: work item picker in New task with sprint and assigned-to-me scopes"
```

---

### Task 7: Header link, connection status in the nav, test-data seed and live smoke

**Files:**
- Modify: `src/renderer/components/TaskHeader.tsx`, `src/renderer/components/TaskNav.tsx`
- Create: `tools/ado/seed-test-items.mjs`, `tools/ado/README.md`
- Test: `src/renderer/screens/WorkspaceScreen.test.tsx` (two tests), `src/renderer/components/TaskNav.test.tsx` (one test)

**Interfaces:**
- Consumes: `shell:openExternal` (Task 4), store `connections`, `repos`.
- Produces: header badge is a `<button>` "Open <type> <id> in Azure DevOps" when `workItem.url` is set; nav footer shows `<connection name>: <status>` for the selected task's repo; a developer seed script.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/screens/WorkspaceScreen.test.tsx` add:
```tsx
  it('opens the work item in Azure DevOps from the header badge', async () => {
    const { calls } = installFakeApi({ 'repos:config': () => config, 'tasks:gitSummary': () => ({ branch: 'x', ahead: 0, behind: 0, hasUpstream: false, files: [] }), 'shell:openExternal': () => undefined });
    useStore.setState({ tasks: [{ ...task, workItem: { ...task.workItem!, url: 'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/48213' } }] });
    render(<WorkspaceScreen />);
    await userEvent.click(screen.getByRole('button', { name: /Open User Story 48213 in Azure DevOps/ }));
    await waitFor(() => expect(calls.find((c) => c.channel === 'shell:openExternal')?.args).toEqual(['https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/48213']));
  });
  it('shows a plain badge for typed work items without a url', () => {
    installFakeApi({ 'repos:config': () => config, 'tasks:gitSummary': () => ({ branch: 'x', ahead: 0, behind: 0, hasUpstream: false, files: [] }) });
    render(<WorkspaceScreen />);
    expect(screen.queryByRole('button', { name: /in Azure DevOps/ })).not.toBeInTheDocument();
    expect(screen.getByText('User Story 48213')).toBeInTheDocument();
  });
```
(The existing `task` fixture gets `url: null` on its work item.)

In `src/renderer/components/TaskNav.test.tsx` add:
```tsx
  it('shows the selected task repo connection status in the footer', () => {
    installFakeApi();
    useStore.setState({ repos: [{ ...repos[0], connectionId: 'c1' }, repos[1]], connections: [{ id: 'c1', name: 'unreliablewitness', organizationUrl: 'https://dev.azure.com/unreliablewitness', project: 'MIAC', user: 'D', status: 'unauthorized', checkedAt: null }] });
    render(<TaskNav />);
    expect(screen.getByText('unreliablewitness: token rejected')).toBeInTheDocument();
  });
```
The file's `beforeEach` must set `connections: []`, and the existing footer expectation (if any) of `Azure DevOps: not connected` stays valid for repos without a connection.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project renderer src/renderer/screens/WorkspaceScreen.test.tsx src/renderer/components/TaskNav.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`TaskHeader.tsx`: replace the work item pill with
```tsx
          {task.workItem?.url ? (
            <button type="button" className="pill pill-accent" style={{ border: 'none', cursor: 'pointer' }} aria-label={`Open ${task.workItem.type} ${task.workItem.id} in Azure DevOps`} onClick={() => tryInvoke(() => api().invoke('shell:openExternal', task.workItem!.url!), notify)}>
              {task.workItem.type} {task.workItem.id}
            </button>
          ) : task.workItem ? (
            <span className="pill pill-accent">{task.workItem.type} {task.workItem.id}</span>
          ) : (
            <span className="pill pill-accent">Blank task</span>
          )}
```

`TaskNav.tsx`: read `connections` and `selectedTaskId`; compute the selected task's repo (or the first repo when nothing is selected) and its connection:
```tsx
  const selected = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const repo = repos.find((r) => r.id === selected?.repoId) ?? repos[0] ?? null;
  const connection = repo?.connectionId ? connections.find((c) => c.id === repo.connectionId) ?? null : null;
  const footer = !connection
    ? { color: 'var(--idle)', text: 'Azure DevOps: not connected' }
    : connection.status === 'ok'
      ? { color: 'var(--green)', text: `${connection.name}: ${connection.project}` }
      : { color: 'var(--red)', text: `${connection.name}: ${connection.status === 'unauthorized' ? 'token rejected' : connection.status === 'unreachable' ? 'unreachable' : 'not verified'}` };
```
and render `<span className="dot" style={{ background: footer.color }} />{footer.text}` in the footer.

- [ ] **Step 4: Developer seed script for the test org**

`tools/ado/seed-test-items.mjs` creates a handful of work items in the current sprint of a project, reading the PAT from the macOS Keychain (never printing it). It is a developer tool for the owner's test org, not app code:
```js
#!/usr/bin/env node
// node tools/ado/seed-test-items.mjs <organizationUrl> <project> <keychain-service>
// Creates three Issues and one Task in the project's current sprint. Idempotent: skips titles that already exist.
import { execFileSync } from 'node:child_process';

const [orgUrl, project, service] = process.argv.slice(2);
if (!orgUrl || !project || !service) {
  console.error('Usage: node tools/ado/seed-test-items.mjs <organizationUrl> <project> <keychain-service>');
  process.exit(64);
}
const pat = execFileSync('security', ['find-generic-password', '-a', 'miac', '-s', service, '-w'], { encoding: 'utf8' }).trim();
const auth = `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
const api = async (path, init = {}) => {
  const res = await fetch(`${orgUrl}${path}`, { ...init, headers: { authorization: auth, accept: 'application/json', ...(init.headers ?? {}) } });
  const text = (await res.text()).replace(/^﻿/, '');
  if (!res.ok) throw new Error(`${res.status} ${path.split('?')[0]}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
};
const p = encodeURIComponent(project);
const iterations = await api(`/${p}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1`);
const sprint = iterations.value?.[0]?.path ?? null;
const wanted = [
  ['Issue', 'Checkout: allow saving a delivery address'],
  ['Issue', 'Show estimated delivery date on product page'],
  ['Issue', "Coupon field ignores O'Brien style names"],
  ['Task', 'Upgrade payment SDK to v5'],
];
const existing = await api(`/${p}/_apis/wit/wiql?api-version=7.1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'SELECT [System.Title] FROM WorkItems WHERE [System.TeamProject] = @project' }) });
const ids = (existing.workItems ?? []).map((w) => w.id);
const titles = new Set();
if (ids.length) {
  const got = await api(`/_apis/wit/workitems?ids=${ids.slice(0, 200).join(',')}&fields=System.Title&api-version=7.1`);
  for (const w of got.value ?? []) titles.add(w.fields['System.Title']);
}
for (const [type, title] of wanted) {
  if (titles.has(title)) { console.log(`skip  ${type}: ${title}`); continue; }
  const ops = [{ op: 'add', path: '/fields/System.Title', value: title }];
  if (sprint) ops.push({ op: 'add', path: '/fields/System.IterationPath', value: sprint });
  const created = await api(`/${p}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=7.1`, { method: 'POST', headers: { 'content-type': 'application/json-patch+json' }, body: JSON.stringify(ops) });
  console.log(`made  ${type} ${created.id}: ${title}`);
}
```
`tools/ado/README.md`: one paragraph saying what the script does, the usage line, that the PAT is read from the Keychain entry and never printed, and that it writes to Azure DevOps (unlike the app).

Run it once against the test org:
```bash
node tools/ado/seed-test-items.mjs https://dev.azure.com/unreliablewitness MIAC miac-ado-unreliablewitness
```
Expected: four `made` lines on the first run, `skip` lines on a second run.

- [ ] **Step 5: Run the suite, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer tools/ado
git commit -m "feat: open work items in Azure DevOps, connection status in nav, test-data seed tool"
```

The live end-to-end smoke (add the connection in Settings with the Keychain PAT, link a repo, pick a seeded item, create the task) is run by the controller over CDP after this task, as in sub-project 1.

---

## Done criteria for the slice

- `npm test`, `npm run typecheck`, `npm run lint` are clean.
- Against `https://dev.azure.com/unreliablewitness/MIAC`: add the connection in Settings ("Connected as Dries Hoebeke"), link a repo, open New task, see the seeded Sprint 1 items, pick one, create the task; the header badge opens the item in the browser.
- `connections.json` holds no plain-text token; `state.json` holds no token at all.
- A revoked or wrong PAT turns the connection red in Settings and the nav footer after the next call, with a readable notice.
