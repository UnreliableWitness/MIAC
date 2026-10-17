# Home Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Home page, opened at launch, that shows across all Azure DevOps connections the developer's open tasks, Up next, PRs to review, their own PRs, their sprints and a compact stats band.

**Architecture:** A `HomeService` in main fans out to every connection in parallel (`AdoClient` calls), keeps a per-connection `HomeSnapshot` cached in `home.json`, and serves it over `home:get` / `home:refresh` with a `home:updated` event. Stats are a pure function over the local task, usage and time stores (`home:stats`). The renderer adds a `home` screen with four stacked bands; Up next is derived in the renderer.

**Tech Stack:** Electron, React, TypeScript, zustand, zod, Vitest + Testing Library, `@fluentui/react-icons`.

**Spec:** `docs/superpowers/specs/2026-10-17-home-dashboard-design.md`

## Global Constraints

- Nothing on Home writes to Azure DevOps.
- Home renders from the cached snapshot and local stores; no network call blocks the first paint.
- Home shows only the developer's own data; no other person's stats.
- One failing connection never blanks the page: its last data stays, marked stale.
- Each connection's rebuild has a 15 s budget (`HOME_TIMEOUT_MS = 15_000`).
- Rebuild when Home opens or the window regains focus and the snapshot is older than 60 s (`HOME_MAX_AGE_MS = 60_000`), every 5 minutes while Home is showing and the window has focus (`HOME_POLL_MS = 300_000`), and on the refresh button.
- Week starts Monday 00:00 local time; month starts on the 1st 00:00 local time.
- Amounts in EUR via `OFFICIAL_USD_TO_EUR` (0.92); only billable usage counts.
- Telemetry carries no names or IDs: `home.refreshed` (main), `home.clicked` with `band` (renderer), screen view `home`. Keep `docs/telemetry.md` in sync.
- Team review requests cover ADO teams only (`$mine=true`), not other security groups.
- Copy style: sentence case, no exclamation marks, matches existing UI strings ("Start", "Starting").
- Checks: `npm test`, `npm run typecheck`, `npm run lint` must pass before each commit.

## Review Focus

- A connection whose token is refused while others work: Home must keep showing the refused connection's last sprints and PRs greyed with "stale since HH:MM", and the other connections must still update (Task 2 test "keeps stale data").
- Two of my teams share one iteration: one sprint card, not two (Task 2 test "deduplicates iterations").
- A PR where I am a named reviewer and one of my teams is too: it must appear once, under Reviews, never under Team requests; a PR I created never appears in either (Task 2 test "splits named and team reviews").
- Starting a task from Up next: the item must leave Up next straight away, without waiting for a refresh (Task 6 test "drops an item once it has a task").
- A task finished last Sunday 23:30 and the week toggle on Monday: it must not count in this week (Task 3 test "week starts Monday").

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/shared/home.ts` (create) | zod schemas and types for the snapshot and stats, `periodRange`, `stateCategory`, constants |
| `src/main/services/AdoClient.ts` (modify) | `me`, `myTeams`, `currentIteration(project, team?)`, `assignedInIterations`, `activePullRequests` |
| `src/main/home/homePr.ts` (create) | Raw ADO PR JSON → `HomePr` |
| `src/main/home/HomeService.ts` (create) | Fan-out per connection, stale handling, cache file, joined rebuilds |
| `src/main/home/homeStats.ts` (create) | Pure stats over tasks, usage and time |
| `src/shared/ipc.ts`, `src/main/ipc/handlers.ts` (modify) | `home:get`, `home:refresh`, `home:stats`, event `home:updated` |
| `src/renderer/test-helpers/fakeApi.ts` (modify) | Defaults for the new channels |
| `src/renderer/store.ts`, `App.tsx`, `components/TaskNav.tsx`, `components/HeaderBar.tsx` (modify) | `home` screen, start page, fallback, nav item, breadcrumb |
| `src/renderer/taskStatus.ts` (create) | `TASK_STATUS` labels, moved out of `SprintScreen.tsx` |
| `src/renderer/components/ui/TimeBar.tsx` (create) | The spent/estimate bar, moved out of `SprintScreen.tsx` |
| `src/renderer/hooks/useHome.ts`, `useHomeStats.ts` (create) | Snapshot load, refresh policy, events; stats load |
| `src/renderer/homeView.ts` (create) | Pure renderer helpers: `upNext`, `sprintTotals`, `chipState` |
| `src/renderer/screens/HomeScreen.tsx` (create) | Page header, chips, band layout |
| `src/renderer/components/home/TasksBand.tsx`, `PrBand.tsx`, `SprintsBand.tsx`, `StatsBand.tsx` (create) | One band each |
| `src/renderer/styles/home.css` (create) | Band and card styles, imported where the other screen styles are |
| `docs/telemetry.md`, `CLAUDE.md` (modify) | Events and status |

---

### Task 1: Shared Home types and the AdoClient calls

**Files:**
- Create: `src/shared/home.ts`
- Modify: `src/main/services/AdoClient.ts` (add methods after `currentIteration`, change `currentIteration`)
- Test: `src/main/services/AdoClient.test.ts`, `src/shared/home.test.ts`

**Interfaces:**
- Produces (shared): `HomePr`, `HomeItem`, `HomeSprint`, `HomeConnection`, `HomeSnapshot`, `HomeSnapshotSchema`, `HomePeriod`, `HomeStats`, `periodRange(period, now: Date): { from: number; to: number }`, `stateCategory(categoryFromMeta: string | null | undefined, state: string): 'Proposed' | 'InProgress' | 'Completed' | 'Removed'`, constants `HOME_TIMEOUT_MS`, `HOME_MAX_AGE_MS`, `HOME_POLL_MS`.
- Produces (AdoClient): `me(): Promise<string>`, `myTeams(project): Promise<{ id: string; name: string }[]>`, `currentIteration(project, team?: string): Promise<SprintIteration | null>`, `assignedInIterations(project, paths: string[]): Promise<number[]>`, `activePullRequests(project, criteria: { reviewerId: string } | { creatorId: string }): Promise<RawHomePr[]>`, type `RawHomePr`.

- [ ] **Step 1: Write the shared module**

`src/shared/home.ts`:

```ts
import { z } from 'zod';
import type { UsageTool } from './usage';

/** Each connection's rebuild must finish within this, or it counts as unreachable. */
export const HOME_TIMEOUT_MS = 15_000;
/** Opening Home or focusing the window rebuilds a snapshot older than this. */
export const HOME_MAX_AGE_MS = 60_000;
/** While Home shows and the window has focus, it rebuilds this often. */
export const HOME_POLL_MS = 300_000;

export const HomePrSchema = z.object({
  id: z.number().int(),
  repo: z.string(),
  title: z.string(),
  author: z.string(),
  authorId: z.string(),
  createdAt: z.string(),
  isDraft: z.boolean(),
  conflicts: z.boolean(),
  /** 10 approved, 5 approved with suggestions, 0 no vote, -5 waiting for author, -10 rejected; null when I am not a named reviewer. */
  myVote: z.number().int().nullable(),
  votes: z.object({
    approved: z.number().int(),
    waiting: z.number().int(),
    rejected: z.number().int(),
  }),
  url: z.string(),
});
export type HomePr = z.infer<typeof HomePrSchema>;

export const HomeItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  state: z.string(),
  areaPath: z.string(),
  iterationPath: z.string(),
  assignedTo: z.string().nullable(),
  url: z.string(),
  remainingWork: z.number().nullable(),
  originalEstimate: z.number().nullable(),
  completedWork: z.number().nullable(),
});
export type HomeItem = z.infer<typeof HomeItemSchema>;

export const HomeSprintSchema = z.object({
  iterationId: z.string(),
  name: z.string(),
  path: z.string(),
  startDate: z.string().nullable(),
  finishDate: z.string().nullable(),
  items: z.array(HomeItemSchema),
});
export type HomeSprint = z.infer<typeof HomeSprintSchema>;

export const HomeConnectionSchema = z.object({
  connectionId: z.string(),
  name: z.string(),
  project: z.string(),
  /** stale: this build failed and the last data is kept; error: failed with no earlier data. */
  status: z.enum(['ok', 'stale', 'error']),
  error: z.string().nullable(),
  fetchedAt: z.string().nullable(),
  sprints: z.array(HomeSprintSchema),
  sprintsError: z.string().nullable(),
  reviews: z.array(HomePrSchema),
  teamReviews: z.array(HomePrSchema),
  myPrs: z.array(HomePrSchema),
  prsError: z.string().nullable(),
});
export type HomeConnection = z.infer<typeof HomeConnectionSchema>;

export const HomeSnapshotSchema = z.object({
  version: z.literal(1),
  builtAt: z.string(),
  connections: z.array(HomeConnectionSchema),
});
export type HomeSnapshot = z.infer<typeof HomeSnapshotSchema>;

export type HomePeriod = 'week' | 'month';

export type HomeStats = {
  period: HomePeriod;
  from: string;
  to: string;
  costEur: number;
  costByTool: Record<UsageTool, number>;
  /** connectionId null: tasks whose repo has no connection. Largest first. */
  costByConnection: { connectionId: string | null; costEur: number }[];
  activeSeconds: number;
  agentSeconds: number;
  /** Booked ÷ estimated over finished tasks with both; null when there are none. */
  accuracy: number | null;
  accuracyTasks: number;
  tasksFinished: number;
  prsOpened: number;
};

/** The period as epoch ms in local time: this week from Monday 00:00, or this month from the 1st, up to now. */
export function periodRange(
  period: HomePeriod,
  now: Date,
): { from: number; to: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  else start.setDate(1);
  return { from: start.getTime(), to: now.getTime() };
}

export type StateCategory = 'Proposed' | 'InProgress' | 'Completed' | 'Removed';
const CATEGORIES: StateCategory[] = ['Proposed', 'InProgress', 'Completed', 'Removed'];
const BY_NAME: Record<string, StateCategory> = {
  new: 'Proposed',
  'to do': 'Proposed',
  proposed: 'Proposed',
  approved: 'Proposed',
  done: 'Completed',
  closed: 'Completed',
  completed: 'Completed',
  removed: 'Removed',
};

/** The state's category from the type metadata, else a guess from common state names, else InProgress. ADO's `Resolved` category counts as InProgress. */
export function stateCategory(
  fromMeta: string | null | undefined,
  state: string,
): StateCategory {
  if (fromMeta && (CATEGORIES as string[]).includes(fromMeta))
    return fromMeta as StateCategory;
  return BY_NAME[state.toLowerCase()] ?? 'InProgress';
}
```

- [ ] **Step 2: Write the shared tests**

`src/shared/home.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { periodRange, stateCategory } from './home';

describe('periodRange', () => {
  it('week starts Monday 00:00 local time', () => {
    const now = new Date(2026, 9, 19, 10, 0); // Monday 19 Oct 2026
    expect(new Date(periodRange('week', now).from)).toEqual(
      new Date(2026, 9, 19, 0, 0),
    );
    const sunday = new Date(2026, 9, 18, 23, 30);
    expect(new Date(periodRange('week', sunday).from)).toEqual(
      new Date(2026, 9, 12, 0, 0),
    );
  });
  it('month starts on the 1st', () => {
    const now = new Date(2026, 9, 17, 8, 0);
    expect(new Date(periodRange('month', now).from)).toEqual(
      new Date(2026, 9, 1, 0, 0),
    );
    expect(periodRange('month', now).to).toBe(now.getTime());
  });
});

describe('stateCategory', () => {
  it('uses the metadata category when known', () => {
    expect(stateCategory('Completed', 'Shipped')).toBe('Completed');
  });
  it('guesses from the name without metadata', () => {
    expect(stateCategory(undefined, 'To Do')).toBe('Proposed');
    expect(stateCategory(null, 'Done')).toBe('Completed');
    expect(stateCategory(undefined, 'Doing')).toBe('InProgress');
  });
  it('treats Resolved as in progress', () => {
    expect(stateCategory('Resolved', 'Resolved')).toBe('InProgress');
  });
});
```

- [ ] **Step 3: Run the shared tests, verify they pass**

Run: `npx vitest run src/shared/home.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4: Write the failing AdoClient tests**

Append to `src/main/services/AdoClient.test.ts`:

```ts
describe('Home calls', () => {
  const org = '/unreliablewitness';
  it('me reads the authenticated user id', async () => {
    server.route('GET', `${org}/_apis/connectionData`, {
      body: { authenticatedUser: { id: 'me-1' } },
    });
    expect(await client.me()).toBe('me-1');
  });
  it('myTeams asks for my teams only', async () => {
    server.route('GET', `${org}/_apis/projects/MIAC/teams`, {
      body: { value: [{ id: 't1', name: 'MIAC Team' }] },
    });
    expect(await client.myTeams('MIAC')).toEqual([
      { id: 't1', name: 'MIAC Team' },
    ]);
    expect(server.requests.at(-1)?.path).toContain('$mine=true');
  });
  it('currentIteration takes a team', async () => {
    server.route('GET', `${org}/MIAC/Web%20Team/_apis/work/teamsettings/iterations`, {
      body: { value: [{ id: 'i1', name: 'Sprint 3', path: 'MIAC\\Sprint 3', attributes: { startDate: '2026-10-12T00:00:00Z', finishDate: '2026-10-23T00:00:00Z' } }] },
    });
    expect(await client.currentIteration('MIAC', 'Web Team')).toEqual({
      id: 'i1',
      name: 'Sprint 3',
      path: 'MIAC\\Sprint 3',
      startDate: '2026-10-12T00:00:00Z',
      finishDate: '2026-10-23T00:00:00Z',
    });
  });
  it('assignedInIterations queries my items in the given iterations', async () => {
    server.route('POST', `${org}/MIAC/_apis/wit/wiql`, {
      body: { workItems: [{ id: 4 }, { id: 9 }] },
    });
    expect(
      await client.assignedInIterations('MIAC', ["MIAC\\Sprint 1", "MIAC\\It's 2"]),
    ).toEqual([4, 9]);
    const q = JSON.parse(server.requests.at(-1)!.body).query as string;
    expect(q).toContain('[System.AssignedTo] = @Me');
    expect(q).toContain("[System.IterationPath] IN ('MIAC\\Sprint 1', 'MIAC\\It''s 2')");
  });
  it('assignedInIterations without paths makes no call', async () => {
    expect(await client.assignedInIterations('MIAC', [])).toEqual([]);
    expect(server.requests).toHaveLength(0);
  });
  it('activePullRequests filters by reviewer or creator', async () => {
    server.route('GET', `${org}/MIAC/_apis/git/pullrequests`, {
      body: { value: [{ pullRequestId: 7 }] },
    });
    expect(await client.activePullRequests('MIAC', { reviewerId: 'me-1' })).toEqual([
      { pullRequestId: 7 },
    ]);
    expect(server.requests.at(-1)?.path).toContain('searchCriteria.reviewerId=me-1');
    expect(server.requests.at(-1)?.path).toContain('searchCriteria.status=active');
    await client.activePullRequests('MIAC', { creatorId: 'me-1' });
    expect(server.requests.at(-1)?.path).toContain('searchCriteria.creatorId=me-1');
  });
  it('activePullRequests reports a missing Code scope', async () => {
    server.route('GET', `${org}/MIAC/_apis/git/pullrequests`, { status: 401 });
    await expect(
      client.activePullRequests('MIAC', { reviewerId: 'me-1' }),
    ).rejects.toThrow(CODE_READ_DENIED);
  });
});
```

- [ ] **Step 5: Run them, verify they fail**

Run: `npx vitest run src/main/services/AdoClient.test.ts -t "Home calls"`
Expected: FAIL (`client.me is not a function`, etc.).

- [ ] **Step 6: Implement the AdoClient methods**

In `src/main/services/AdoClient.ts`, export the raw PR type next to `RawPr`:

```ts
/** An active pull request as the list API returns it; only the fields Home reads. */
export type RawHomePr = {
  pullRequestId?: number;
  title?: string;
  creationDate?: string;
  isDraft?: boolean;
  mergeStatus?: string;
  repository?: { name?: string };
  createdBy?: { id?: string; displayName?: string };
  reviewers?: { id?: string; vote?: number; isContainer?: boolean }[];
};
```

Replace `currentIteration` so it takes an optional team (the existing callers pass none and keep the default team):

```ts
  async currentIteration(
    project: string,
    team?: string,
  ): Promise<SprintIteration | null> {
    const scope = team
      ? `${encodeURIComponent(project)}/${encodeURIComponent(team)}`
      : encodeURIComponent(project);
    const data = await this.request<{
      value?: {
        id: string;
        name: string;
        path: string;
        attributes?: { startDate?: string | null; finishDate?: string | null };
      }[];
    }>(`/${scope}/_apis/work/teamsettings/iterations?$timeframe=current&${API}`);
    const first = (data.value ?? [])[0];
    return first
      ? {
          id: first.id,
          path: first.path,
          name: first.name,
          startDate: first.attributes?.startDate ?? null,
          finishDate: first.attributes?.finishDate ?? null,
        }
      : null;
  }

  /** The id of the user the token belongs to. */
  async me(): Promise<string> {
    const data = await this.request<Json>(
      '/_apis/connectionData?api-version=7.1-preview',
    );
    const id = (data.authenticatedUser as Json | undefined)?.id;
    if (typeof id !== 'string' || !id)
      throw new AdoError('http', '/_apis/connectionData', 'Azure DevOps did not say who the token belongs to');
    return id;
  }

  /** The project's teams the token's user is a member of. */
  async myTeams(project: string): Promise<{ id: string; name: string }[]> {
    const data = await this.request<{ value?: { id?: string; name?: string }[] }>(
      `/_apis/projects/${encodeURIComponent(project)}/teams?$mine=true&${API}`,
    );
    return (data.value ?? []).flatMap((t) =>
      t.id && t.name ? [{ id: t.id, name: t.name }] : [],
    );
  }

  /** Ids of open and closed work items assigned to me in any of the iteration paths, at most 200. */
  async assignedInIterations(project: string, paths: string[]): Promise<number[]> {
    if (paths.length === 0) return [];
    const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] = @Me AND [System.IterationPath] IN (${paths.map(wiqlString).join(', ')}) ORDER BY [System.Id]`;
    const result = await this.request<{ workItems?: { id: number }[] }>(
      `/${encodeURIComponent(project)}/_apis/wit/wiql?${API}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      },
    );
    return (result.workItems ?? []).slice(0, BATCH).map((w) => w.id);
  }

  /** Active pull requests in the project where the identity is a reviewer, or that it created. */
  async activePullRequests(
    project: string,
    criteria: { reviewerId: string } | { creatorId: string },
  ): Promise<RawHomePr[]> {
    const filter =
      'reviewerId' in criteria
        ? `searchCriteria.reviewerId=${encodeURIComponent(criteria.reviewerId)}`
        : `searchCriteria.creatorId=${encodeURIComponent(criteria.creatorId)}`;
    const data = await this.request<{ value?: RawHomePr[] }>(
      `/${encodeURIComponent(project)}/_apis/git/pullrequests?${filter}&searchCriteria.status=active&$top=100&${API}`,
      {},
      { code: true },
    );
    return data.value ?? [];
  }
```

- [ ] **Step 7: Run the AdoClient tests, verify they pass**

Run: `npx vitest run src/main/services/AdoClient.test.ts`
Expected: PASS, including the existing sprint tests (default-team path unchanged).

- [ ] **Step 8: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/shared/home.ts src/shared/home.test.ts src/main/services/AdoClient.ts src/main/services/AdoClient.test.ts
git commit -m "feat: Home types and Azure DevOps calls for teams, my items and PRs"
```

---

### Task 2: HomeService (fan-out, stale data, cache)

**Files:**
- Create: `src/main/home/homePr.ts`, `src/main/home/HomeService.ts`
- Test: `src/main/home/homePr.test.ts`, `src/main/home/HomeService.test.ts`

**Interfaces:**
- Consumes: Task 1's `AdoClient` methods and `RawHomePr`; `AdoClient.workItems(project, ids): Promise<SprintItem[]>` (existing); `JsonFileStore` (`src/main/usage/JsonFileStore.ts`); `prWebUrl(orgUrl, project, repo, id)` (`src/main/services/azureRepos.ts`).
- Produces: `toHomePr(raw: RawHomePr, ctx: { organizationUrl: string; project: string; me: string }): HomePr | null`; `class HomeService` with `get(): Promise<HomeSnapshot | null>` and `refresh(): Promise<HomeSnapshot>`; type `HomeDeps`.

- [ ] **Step 1: Write the failing homePr test**

`src/main/home/homePr.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toHomePr } from './homePr';

const ctx = { organizationUrl: 'https://dev.azure.com/uw', project: 'MIAC', me: 'me-1' };

describe('toHomePr', () => {
  it('maps the fields, my vote and the vote summary', () => {
    expect(
      toHomePr(
        {
          pullRequestId: 12,
          title: 'Add audit log',
          creationDate: '2026-10-15T08:00:00Z',
          isDraft: true,
          mergeStatus: 'conflicts',
          repository: { name: 'web' },
          createdBy: { id: 'anna', displayName: 'Anna' },
          reviewers: [
            { id: 'me-1', vote: 0 },
            { id: 'tom', vote: 10 },
            { id: 'eve', vote: 5 },
            { id: 'bob', vote: -5 },
            { id: 'team', vote: -10, isContainer: true },
          ],
        },
        ctx,
      ),
    ).toEqual({
      id: 12,
      repo: 'web',
      title: 'Add audit log',
      author: 'Anna',
      authorId: 'anna',
      createdAt: '2026-10-15T08:00:00Z',
      isDraft: true,
      conflicts: true,
      myVote: 0,
      votes: { approved: 2, waiting: 1, rejected: 1 },
      url: 'https://dev.azure.com/uw/MIAC/_git/web/pullrequest/12',
    });
  });
  it('has no vote of mine when I am not a named reviewer', () => {
    expect(
      toHomePr({ pullRequestId: 3, repository: { name: 'web' }, reviewers: [] }, ctx)
        ?.myVote,
    ).toBeNull();
  });
  it('drops a PR without an id or repo', () => {
    expect(toHomePr({ title: 'x' }, ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/main/home/homePr.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `homePr.ts`**

```ts
import type { HomePr } from '../../shared/home';
import type { RawHomePr } from '../services/AdoClient';
import { prWebUrl } from '../services/azureRepos';

/** An active PR as Home shows it, or null when ADO left out the id or repo. Votes of 5 and 10 count as approved. */
export function toHomePr(
  raw: RawHomePr,
  ctx: { organizationUrl: string; project: string; me: string },
): HomePr | null {
  const id = raw.pullRequestId;
  const repo = raw.repository?.name;
  if (typeof id !== 'number' || !repo) return null;
  const reviewers = raw.reviewers ?? [];
  const mine = reviewers.find((r) => r.id === ctx.me);
  const count = (test: (v: number) => boolean) =>
    reviewers.filter((r) => typeof r.vote === 'number' && test(r.vote)).length;
  return {
    id,
    repo,
    title: raw.title ?? '',
    author: raw.createdBy?.displayName ?? '',
    authorId: raw.createdBy?.id ?? '',
    createdAt: raw.creationDate ?? '',
    isDraft: raw.isDraft === true,
    conflicts: raw.mergeStatus === 'conflicts',
    myVote: mine ? (mine.vote ?? 0) : null,
    votes: {
      approved: count((v) => v >= 5),
      waiting: count((v) => v === -5),
      rejected: count((v) => v === -10),
    },
    url: prWebUrl(ctx.organizationUrl, ctx.project, repo, id),
  };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/main/home/homePr.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing HomeService tests**

`src/main/home/HomeService.test.ts`. The tests use a fake client object, not the HTTP server, so each step's failure can be set precisely:

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Connection, SprintItem } from '../../shared/types';
import { AdoError, type RawHomePr } from '../services/AdoClient';
import { HomeService, type HomeClient } from './HomeService';

const conn = (id: string): Connection => ({
  id,
  name: id,
  organizationUrl: `https://dev.azure.com/${id}`,
  project: 'P',
  user: null,
  status: 'ok',
  checkedAt: null,
  userUniqueName: null,
});

const item = (id: number, iterationPath: string, state = 'To Do'): SprintItem => ({
  id: String(id),
  type: 'Issue',
  title: `Item ${id}`,
  state,
  areaPath: 'P',
  iterationPath,
  assignedTo: 'Me',
  url: `https://x/${id}`,
  remainingWork: null,
  originalEstimate: null,
  completedWork: null,
});

const pr = (id: number, over: Partial<RawHomePr> = {}): RawHomePr => ({
  pullRequestId: id,
  title: `PR ${id}`,
  creationDate: `2026-10-${10 + id}T00:00:00Z`,
  repository: { name: 'web' },
  createdBy: { id: 'anna', displayName: 'Anna' },
  reviewers: [],
  ...over,
});

/** A client where every call works; tests override single methods. */
function fakeClient(over: Partial<HomeClient> = {}): HomeClient {
  return {
    me: async () => 'me',
    myTeams: async () => [{ id: 't1', name: 'Team 1' }],
    currentIteration: async () => ({
      id: 'i1',
      name: 'Sprint 1',
      path: 'P\\Sprint 1',
      startDate: null,
      finishDate: '2026-10-23T00:00:00Z',
    }),
    assignedInIterations: async () => [1, 2],
    workItems: async (_p, ids) => ids.map((id) => item(id, 'P\\Sprint 1')),
    activePullRequests: async () => [],
    ...over,
  };
}

function service(
  connections: Connection[],
  clients: Record<string, HomeClient>,
  file = path.join(mkdtempSync(path.join(os.tmpdir(), 'miac-home-')), 'home.json'),
) {
  const built: { connections: number; failed: number }[] = [];
  const home = new HomeService({
    file,
    connections: () => connections,
    client: (id) => clients[id],
    now: () => new Date('2026-10-17T09:12:00Z'),
    timeoutMs: 200,
    onBuilt: (_s, info) => built.push(info),
  });
  return { home, file, built };
}

describe('HomeService', () => {
  it('builds a sprint card per iteration holding my items', async () => {
    const { home } = service([conn('a')], { a: fakeClient() });
    const s = await home.refresh();
    expect(s.connections[0]).toMatchObject({
      connectionId: 'a',
      status: 'ok',
      error: null,
      fetchedAt: '2026-10-17T09:12:00.000Z',
      sprintsError: null,
    });
    expect(s.connections[0].sprints).toHaveLength(1);
    expect(s.connections[0].sprints[0].items.map((i) => i.id)).toEqual(['1', '2']);
  });

  it('deduplicates iterations shared by two of my teams', async () => {
    const calls: string[] = [];
    const { home } = service([conn('a')], {
      a: fakeClient({
        myTeams: async () => [
          { id: 't1', name: 'Team 1' },
          { id: 't2', name: 'Team 2' },
        ],
        assignedInIterations: async (_p, paths) => {
          calls.push(...paths);
          return [1];
        },
      }),
    });
    const s = await home.refresh();
    expect(calls).toEqual(['P\\Sprint 1']);
    expect(s.connections[0].sprints).toHaveLength(1);
  });

  it('leaves out iterations with nothing of mine', async () => {
    const { home } = service([conn('a')], {
      a: fakeClient({ assignedInIterations: async () => [] }),
    });
    expect((await home.refresh()).connections[0].sprints).toEqual([]);
  });

  it('splits named and team reviews and skips my own PRs', async () => {
    const { home } = service([conn('a')], {
      a: fakeClient({
        activePullRequests: async (_p, c) => {
          if ('creatorId' in c) return [pr(9, { createdBy: { id: 'me', displayName: 'Me' } })];
          if (c.reviewerId === 'me')
            return [
              pr(1, { reviewers: [{ id: 'me', vote: 0 }] }),
              pr(2, { reviewers: [{ id: 'me', vote: 10 }] }),
            ];
          return [
            pr(1, { reviewers: [{ id: 'me', vote: 0 }, { id: 't1', vote: 0 }] }),
            pr(3, { reviewers: [{ id: 't1', vote: 0 }] }),
            pr(9, { createdBy: { id: 'me', displayName: 'Me' }, reviewers: [{ id: 't1', vote: 0 }] }),
          ];
        },
      }),
    });
    const c = (await home.refresh()).connections[0];
    expect(c.reviews.map((p) => p.id)).toEqual([1]);
    expect(c.teamReviews.map((p) => p.id)).toEqual([3]);
    expect(c.myPrs.map((p) => p.id)).toEqual([9]);
  });

  it('keeps stale data for a refused connection while another updates', async () => {
    let refuse = false;
    const a = fakeClient({
      me: async () => {
        if (refuse) throw new AdoError('unauthorized', '/x', 'Azure DevOps rejected the token');
        return 'me';
      },
    });
    let bItems = [1];
    const b = fakeClient({ assignedInIterations: async () => bItems });
    const { home } = service([conn('a'), conn('b')], { a, b });
    await home.refresh();
    refuse = true;
    bItems = [1, 2];
    const s = await home.refresh();
    expect(s.connections[0]).toMatchObject({
      status: 'stale',
      error: 'Azure DevOps rejected the token',
      fetchedAt: '2026-10-17T09:12:00.000Z',
    });
    expect(s.connections[0].sprints[0].items).toHaveLength(2);
    expect(s.connections[1].status).toBe('ok');
    expect(s.connections[1].sprints[0].items).toHaveLength(2);
  });

  it('marks a connection that never worked as error', async () => {
    const { home } = service([conn('a')], {
      a: fakeClient({ me: async () => { throw new AdoError('unreachable', '/x', 'Could not reach'); } }),
    });
    expect((await home.refresh()).connections[0]).toMatchObject({
      status: 'error',
      error: 'Could not reach',
      fetchedAt: null,
      sprints: [],
    });
  });

  it('a failing PR call keeps the sprints and the earlier PRs', async () => {
    let fail = false;
    const { home } = service([conn('a')], {
      a: fakeClient({
        activePullRequests: async (_p, c) => {
          if (fail) throw new AdoError('unauthorized', '/x', 'no code scope');
          return 'creatorId' in c ? [pr(5, { createdBy: { id: 'me', displayName: 'Me' } })] : [];
        },
      }),
    });
    await home.refresh();
    fail = true;
    const c = (await home.refresh()).connections[0];
    expect(c.status).toBe('ok');
    expect(c.prsError).toBe('no code scope');
    expect(c.myPrs.map((p) => p.id)).toEqual([5]);
    expect(c.sprints).toHaveLength(1);
  });

  it('times out a connection that hangs', async () => {
    const { home } = service([conn('a')], {
      a: fakeClient({ me: () => new Promise<string>(() => undefined) }),
    });
    const c = (await home.refresh()).connections[0];
    expect(c.status).toBe('error');
    expect(c.error).toMatch(/did not answer within/);
  });

  it('joins a refresh requested during a rebuild', async () => {
    let calls = 0;
    const { home } = service([conn('a')], {
      a: fakeClient({ me: async () => { calls++; return 'me'; } }),
    });
    const [x, y] = await Promise.all([home.refresh(), home.refresh()]);
    expect(x).toBe(y);
    expect(calls).toBe(1);
  });

  it('drops a removed connection and writes the snapshot to disk', async () => {
    const list = [conn('a'), conn('b')];
    const { home, file, built } = service(list, { a: fakeClient(), b: fakeClient() });
    await home.refresh();
    list.pop();
    const s = await home.refresh();
    expect(s.connections.map((c) => c.connectionId)).toEqual(['a']);
    expect(JSON.parse(readFileSync(file, 'utf8')).connections).toHaveLength(1);
    expect(built.at(-1)).toEqual({ connections: 1, failed: 0, durationMs: expect.any(Number) });
  });

  it('serves the snapshot from disk after a restart', async () => {
    const first = service([conn('a')], { a: fakeClient() });
    await first.home.refresh();
    const again = service([conn('a')], { a: fakeClient() }, first.file);
    expect((await again.home.get())?.connections[0].sprints).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run them, verify they fail**

Run: `npx vitest run src/main/home/HomeService.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 7: Implement `HomeService.ts`**

```ts
import {
  HOME_TIMEOUT_MS,
  HomeSnapshotSchema,
  type HomeConnection,
  type HomePr,
  type HomeSnapshot,
  type HomeSprint,
} from '../../shared/home';
import type { Connection, SprintIteration } from '../../shared/types';
import type { AdoClient } from '../services/AdoClient';
import { JsonFileStore } from '../usage/JsonFileStore';
import { toHomePr } from './homePr';

export type HomeClient = Pick<
  AdoClient,
  'me' | 'myTeams' | 'currentIteration' | 'assignedInIterations' | 'workItems' | 'activePullRequests'
>;

export type HomeDeps = {
  file: string;
  connections: () => Connection[];
  client: (connectionId: string) => HomeClient;
  /** Runs one connection's call so its status in Settings follows (handlers pass `withConnection`). */
  withConnection?: <T>(connectionId: string, run: () => Promise<T>) => Promise<T>;
  now?: () => Date;
  timeoutMs?: number;
  onBuilt?: (
    snapshot: HomeSnapshot,
    info: { connections: number; failed: number; durationMs: number },
  ) => void;
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const byCreated = (a: HomePr, b: HomePr) => a.createdAt.localeCompare(b.createdAt);

/** Builds Home's cross-connection snapshot; one rebuild at a time, the last one cached on disk. */
export class HomeService {
  private readonly store: JsonFileStore<HomeSnapshot | null>;
  private loaded: Promise<unknown> | null = null;
  private running: Promise<HomeSnapshot> | null = null;
  private readonly meIds = new Map<string, string>();

  constructor(private readonly d: HomeDeps) {
    this.store = new JsonFileStore<HomeSnapshot | null>(
      d.file,
      HomeSnapshotSchema.nullable(),
      () => null,
    );
  }

  private load(): Promise<unknown> {
    this.loaded ??= this.store.load().catch(() => undefined);
    return this.loaded;
  }

  async get(): Promise<HomeSnapshot | null> {
    await this.load();
    return this.store.value;
  }

  refresh(): Promise<HomeSnapshot> {
    this.running ??= this.build().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async build(): Promise<HomeSnapshot> {
    await this.load();
    const started = Date.now();
    const prev = new Map(
      (this.store.value?.connections ?? []).map((c) => [c.connectionId, c]),
    );
    const connections = await Promise.all(
      this.d.connections().map((c) => this.connection(c, prev.get(c.id) ?? null)),
    );
    const snapshot: HomeSnapshot = {
      version: 1,
      builtAt: this.now().toISOString(),
      connections,
    };
    await this.store.update(() => snapshot).catch((e: unknown) =>
      console.error('[home] could not save the snapshot', e),
    );
    this.d.onBuilt?.(snapshot, {
      connections: connections.length,
      failed: connections.filter((c) => c.status !== 'ok').length,
      durationMs: Date.now() - started,
    });
    return snapshot;
  }

  private now(): Date {
    return this.d.now?.() ?? new Date();
  }

  private connection(c: Connection, prev: HomeConnection | null): Promise<HomeConnection> {
    const ms = this.d.timeoutMs ?? HOME_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Azure DevOps did not answer within ${ms / 1000} s`)),
        ms,
      );
    });
    return Promise.race([this.fetch(c, prev), timeout])
      .catch((e: unknown) => this.failed(c, prev, message(e)))
      .finally(() => clearTimeout(timer));
  }

  private failed(c: Connection, prev: HomeConnection | null, error: string): HomeConnection {
    const base = { connectionId: c.id, name: c.name, project: c.project };
    return prev
      ? { ...prev, ...base, status: 'stale', error }
      : {
          ...base,
          status: 'error',
          error,
          fetchedAt: null,
          sprints: [],
          sprintsError: null,
          reviews: [],
          teamReviews: [],
          myPrs: [],
          prsError: null,
        };
  }

  private async fetch(c: Connection, prev: HomeConnection | null): Promise<HomeConnection> {
    const client = this.d.client(c.id);
    const call = <T>(run: () => Promise<T>) =>
      this.d.withConnection ? this.d.withConnection(c.id, run) : run();
    const me =
      this.meIds.get(c.id) ??
      (await call(() => client.me()).then((id) => {
        this.meIds.set(c.id, id);
        return id;
      }));
    const teams = await call(() => client.myTeams(c.project));
    const found = await Promise.all(
      teams.map((t) => call(() => client.currentIteration(c.project, t.name))),
    );
    const iterations = [
      ...new Map(
        found.filter((i): i is SprintIteration => i !== null).map((i) => [i.path, i]),
      ).values(),
    ];
    const [sprints, prs] = await Promise.allSettled([
      this.sprints(c, client, call, iterations),
      this.prs(c, client, call, me, teams.map((t) => t.id)),
    ]);
    return {
      connectionId: c.id,
      name: c.name,
      project: c.project,
      status: 'ok',
      error: null,
      fetchedAt: this.now().toISOString(),
      sprints: sprints.status === 'fulfilled' ? sprints.value : (prev?.sprints ?? []),
      sprintsError: sprints.status === 'rejected' ? message(sprints.reason) : null,
      reviews: prs.status === 'fulfilled' ? prs.value.reviews : (prev?.reviews ?? []),
      teamReviews: prs.status === 'fulfilled' ? prs.value.teamReviews : (prev?.teamReviews ?? []),
      myPrs: prs.status === 'fulfilled' ? prs.value.myPrs : (prev?.myPrs ?? []),
      prsError: prs.status === 'rejected' ? message(prs.reason) : null,
    };
  }

  private async sprints(
    c: Connection,
    client: HomeClient,
    call: <T>(run: () => Promise<T>) => Promise<T>,
    iterations: SprintIteration[],
  ): Promise<HomeSprint[]> {
    const ids = await call(() =>
      client.assignedInIterations(c.project, iterations.map((i) => i.path)),
    );
    const items = ids.length ? await call(() => client.workItems(c.project, ids)) : [];
    return iterations
      .map((i) => ({
        iterationId: i.id,
        name: i.name,
        path: i.path,
        startDate: i.startDate,
        finishDate: i.finishDate,
        items: items.filter((w) => w.iterationPath === i.path),
      }))
      .filter((s) => s.items.length > 0)
      .sort((a, b) => (a.finishDate ?? '9').localeCompare(b.finishDate ?? '9'));
  }

  private async prs(
    c: Connection,
    client: HomeClient,
    call: <T>(run: () => Promise<T>) => Promise<T>,
    me: string,
    teamIds: string[],
  ): Promise<{ reviews: HomePr[]; teamReviews: HomePr[]; myPrs: HomePr[] }> {
    const ctx = { organizationUrl: c.organizationUrl, project: c.project, me };
    const map = (raw: Awaited<ReturnType<HomeClient['activePullRequests']>>) =>
      raw.flatMap((r) => {
        const p = toHomePr(r, ctx);
        return p ? [p] : [];
      });
    const [named, mine, ...byTeam] = await Promise.all([
      call(() => client.activePullRequests(c.project, { reviewerId: me })).then(map),
      call(() => client.activePullRequests(c.project, { creatorId: me })).then(map),
      ...teamIds.map((id) =>
        call(() => client.activePullRequests(c.project, { reviewerId: id })).then(map),
      ),
    ]);
    const team = new Map<number, HomePr>();
    for (const p of byTeam.flat())
      if (p.myVote === null && p.authorId !== me) team.set(p.id, p);
    return {
      reviews: named.filter((p) => p.myVote === 0 && p.authorId !== me).sort(byCreated),
      teamReviews: [...team.values()].sort(byCreated),
      myPrs: mine.sort((a, b) => byCreated(b, a)),
    };
  }
}
```

- [ ] **Step 8: Run the tests, verify they pass**

Run: `npx vitest run src/main/home`
Expected: PASS (all HomeService and homePr tests).

- [ ] **Step 9: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/main/home
git commit -m "feat: HomeService builds a per-connection Home snapshot with stale fallback"
```

---

### Task 3: Home stats

**Files:**
- Create: `src/main/home/homeStats.ts`
- Test: `src/main/home/homeStats.test.ts`

**Interfaces:**
- Consumes: `periodRange`, `HomeStats`, `HomePeriod` (Task 1); `clip`, `totalMs`, `unionMs`, `AGENT_TOOLS` (`src/shared/time.ts`); `OFFICIAL_USD_TO_EUR` (`src/shared/usage.ts`); `baselineKey` (`src/main/time/timeHandlers.ts`); `taskConnectionId` (`src/shared/workspaces.ts`).
- Produces: `homeStats(input: HomeStatsInput): HomeStats` with
  `HomeStatsInput = { period: HomePeriod; now: Date; tasks: Task[]; repos: Pick<Repo, 'id' | 'connectionId'>[]; usage: { records(taskId: string): UsageRecord[]; isBillable(taskId: string, sessionId: string): boolean }; time: { activeIntervals(taskId: string): Interval[]; agentIntervals(taskId: string): Record<AgentTool, Interval[]>; baseline(key: string): number | null } }`.

- [ ] **Step 1: Write the failing test**

`src/main/home/homeStats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Interval } from '../../shared/time';
import type { Task } from '../../shared/types';
import type { UsageRecord } from '../../shared/usage';
import { homeStats, type HomeStatsInput } from './homeStats';

const MON = new Date(2026, 9, 19, 12, 0); // Monday 19 Oct 2026, 12:00 local
const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).getTime();

const task = (id: string, over: Partial<Task> = {}): Task =>
  ({
    id,
    repoId: 'r1',
    connectionId: null,
    workItem: { id: id.replace('t', ''), type: 'Issue', title: id, url: null },
    status: 'ready',
    finishedAt: null,
    pullRequest: null,
    extraWorkspaces: [],
    time: null,
    ...over,
  }) as Task;

const record = (taskId: string, iso: string, costUsd: number, tool: UsageRecord['tool'] = 'claude-code'): UsageRecord =>
  ({ id: `${taskId}${iso}`, taskId, tool, sessionId: 's', at: iso, costUsd }) as UsageRecord;

function input(over: Partial<HomeStatsInput> = {}): HomeStatsInput {
  const active: Record<string, Interval[]> = {};
  return {
    period: 'week',
    now: MON,
    tasks: [],
    repos: [{ id: 'r1', connectionId: 'c1' }],
    usage: { records: () => [], isBillable: () => true },
    time: {
      activeIntervals: (id) => active[id] ?? [],
      agentIntervals: () => ({ 'claude-code': [], 'copilot-cli': [], opencode: [] }),
      baseline: () => null,
    },
    ...over,
  };
}

describe('homeStats', () => {
  it('week starts Monday: a task finished Sunday 23:30 does not count', () => {
    const s = homeStats(
      input({
        tasks: [
          task('t1', { status: 'done', finishedAt: new Date(2026, 9, 18, 23, 30).toISOString() }),
          task('t2', { status: 'done', finishedAt: new Date(2026, 9, 19, 9, 0).toISOString() }),
        ],
      }),
    );
    expect(s.tasksFinished).toBe(1);
  });

  it('sums billable cost in EUR by tool and by connection', () => {
    const records: Record<string, UsageRecord[]> = {
      t1: [
        record('t1', new Date(2026, 9, 19, 9).toISOString(), 10),
        record('t1', new Date(2026, 9, 19, 10).toISOString(), 5, 'copilot-cli'),
        record('t1', new Date(2026, 9, 17, 10).toISOString(), 100), // last week
      ],
      t2: [record('t2', new Date(2026, 9, 19, 9).toISOString(), 1)],
    };
    const s = homeStats(
      input({
        tasks: [task('t1'), task('t2', { repoId: 'gone' })],
        usage: { records: (id) => records[id] ?? [], isBillable: () => true },
      }),
    );
    expect(s.costEur).toBeCloseTo(16 * 0.92);
    expect(s.costByTool['claude-code']).toBeCloseTo(11 * 0.92);
    expect(s.costByTool['copilot-cli']).toBeCloseTo(5 * 0.92);
    expect(s.costByConnection).toEqual([
      { connectionId: 'c1', costEur: expect.closeTo(15 * 0.92) },
      { connectionId: null, costEur: expect.closeTo(0.92) },
    ]);
  });

  it('skips unbillable sessions and unpriced records', () => {
    const s = homeStats(
      input({
        tasks: [task('t1')],
        usage: {
          records: () => [
            record('t1', new Date(2026, 9, 19, 9).toISOString(), 10),
            { ...record('t1', new Date(2026, 9, 19, 9).toISOString(), 0), costUsd: null },
          ],
          isBillable: () => false,
        },
      }),
    );
    expect(s.costEur).toBe(0);
  });

  it('clips active and agent time to the period', () => {
    const s = homeStats(
      input({
        tasks: [task('t1')],
        time: {
          activeIntervals: () => [[at(18, 23), at(19, 1)]],
          agentIntervals: () => ({
            'claude-code': [[at(19, 9), at(19, 10)]],
            'copilot-cli': [[at(19, 9), at(19, 11)]],
            opencode: [],
          }),
          baseline: () => null,
        },
      }),
    );
    expect(s.activeSeconds).toBe(3600);
    expect(s.agentSeconds).toBe(7200);
  });

  it('accuracy is booked over estimate for finished tasks with both', () => {
    const done = (id: string, booked: number) =>
      task(id, {
        status: 'done',
        finishedAt: new Date(2026, 9, 19, 9).toISOString(),
        time: { bookedSeconds: booked } as Task['time'],
      });
    const s = homeStats(
      input({
        tasks: [done('t1', 3 * 3600), done('t2', 3600), done('t3', 3600)],
        time: {
          activeIntervals: () => [],
          agentIntervals: () => ({ 'claude-code': [], 'copilot-cli': [], opencode: [] }),
          baseline: (key) => (key === 'c1:1' ? 2 : key === 'c1:2' ? 2 : null),
        },
      }),
    );
    expect(s.accuracy).toBeCloseTo(4 / 4);
    expect(s.accuracyTasks).toBe(2);
  });

  it('counts PRs of tasks finished in the period, extra workspaces too', () => {
    const s = homeStats(
      input({
        tasks: [
          task('t1', {
            status: 'done',
            finishedAt: new Date(2026, 9, 19, 9).toISOString(),
            pullRequest: { id: 1 } as Task['pullRequest'],
            extraWorkspaces: [{ pullRequest: { id: 2 } }, { pullRequest: null }] as Task['extraWorkspaces'],
          }),
        ],
      }),
    );
    expect(s.prsOpened).toBe(2);
  });

  it('empty stores give zeros and no accuracy', () => {
    expect(homeStats(input())).toMatchObject({
      costEur: 0,
      activeSeconds: 0,
      agentSeconds: 0,
      accuracy: null,
      tasksFinished: 0,
      prsOpened: 0,
    });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/main/home/homeStats.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `homeStats.ts`**

```ts
import { periodRange, type HomePeriod, type HomeStats } from '../../shared/home';
import { AGENT_TOOLS, clip, totalMs, unionMs, type AgentTool, type Interval } from '../../shared/time';
import type { Repo, Task } from '../../shared/types';
import { OFFICIAL_USD_TO_EUR, type UsageRecord, type UsageTool } from '../../shared/usage';
import { taskConnectionId } from '../../shared/workspaces';
import { baselineKey } from '../time/timeHandlers';

export type HomeStatsInput = {
  period: HomePeriod;
  now: Date;
  tasks: Task[];
  repos: Pick<Repo, 'id' | 'connectionId'>[];
  usage: {
    records(taskId: string): UsageRecord[];
    isBillable(taskId: string, sessionId: string): boolean;
  };
  time: {
    activeIntervals(taskId: string): Interval[];
    agentIntervals(taskId: string): Record<AgentTool, Interval[]>;
    baseline(key: string): number | null;
  };
};

/** The developer's own totals for this week or month, from local data only. */
export function homeStats(d: HomeStatsInput): HomeStats {
  const { from, to } = periodRange(d.period, d.now);
  const inPeriod = (iso: string | null) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return t >= from && t <= to;
  };
  const costByTool: Record<UsageTool, number> = { 'claude-code': 0, 'copilot-cli': 0 };
  const byConnection = new Map<string | null, number>();
  let activeMs = 0;
  let agentMs = 0;
  let booked = 0;
  let estimated = 0;
  let accuracyTasks = 0;
  let tasksFinished = 0;
  let prsOpened = 0;

  for (const task of d.tasks) {
    const connectionId = taskConnectionId(task, d.repos);
    for (const r of d.usage.records(task.id)) {
      if (r.costUsd === null || !inPeriod(r.at) || !d.usage.isBillable(task.id, r.sessionId))
        continue;
      const eur = r.costUsd * OFFICIAL_USD_TO_EUR;
      costByTool[r.tool] += eur;
      byConnection.set(connectionId, (byConnection.get(connectionId) ?? 0) + eur);
    }
    activeMs += totalMs(clip(d.time.activeIntervals(task.id), from, to));
    const agent = d.time.agentIntervals(task.id);
    agentMs += unionMs(...AGENT_TOOLS.map((t) => clip(agent[t], from, to)));

    if (task.status !== 'done' || !inPeriod(task.finishedAt)) continue;
    tasksFinished++;
    prsOpened +=
      (task.pullRequest ? 1 : 0) +
      task.extraWorkspaces.filter((w) => w.pullRequest).length;
    const hours =
      connectionId && task.workItem
        ? d.time.baseline(baselineKey(connectionId, task.workItem.id))
        : null;
    if (task.time && hours !== null && hours > 0) {
      booked += task.time.bookedSeconds;
      estimated += hours * 3600;
      accuracyTasks++;
    }
  }

  return {
    period: d.period,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    costEur: costByTool['claude-code'] + costByTool['copilot-cli'],
    costByTool,
    costByConnection: [...byConnection.entries()]
      .map(([connectionId, costEur]) => ({ connectionId, costEur }))
      .sort((a, b) => b.costEur - a.costEur),
    activeSeconds: Math.round(activeMs / 1000),
    agentSeconds: Math.round(agentMs / 1000),
    accuracy: accuracyTasks > 0 ? booked / estimated : null,
    accuracyTasks,
    tasksFinished,
    prsOpened,
  };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/main/home/homeStats.test.ts`
Expected: PASS.

If `unionMs` does not merge across lists the way the agent test expects (9-10 and 9-11 → 2 h), read `src/shared/time.ts:88` and adapt the call, not the test.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/main/home/homeStats.ts src/main/home/homeStats.test.ts
git commit -m "feat: Home stats for this week or month from local data"
```

---

### Task 4: IPC channels and handlers

**Files:**
- Modify: `src/shared/ipc.ts` (Channels, Events), `src/main/ipc/handlers.ts` (Services, handler bundle), `src/renderer/test-helpers/fakeApi.ts` (defaults), `docs/telemetry.md`
- Test: `src/main/ipc/handlers.test.ts`

**Interfaces:**
- Consumes: `HomeService`, `homeStats` (Tasks 2, 3).
- Produces: channels `'home:get': { args: []; result: HomeSnapshot | null }`, `'home:refresh': { args: []; result: HomeSnapshot }`, `'home:stats': { args: [period: HomePeriod]; result: HomeStats }`; event `'home:updated': HomeSnapshot`; optional service `home?: HomeService` on `Services`.

- [ ] **Step 1: Write the failing handler test**

Append to `src/main/ipc/handlers.test.ts` (it reuses `harness` and `routeHealthyOrg` from the same file):

```ts
describe('home', () => {
  it('builds the snapshot over the connections and broadcasts it', async () => {
    const hx = await harness();
    routeHealthyOrg(hx.server);
    hx.server.route('GET', '/unreliablewitness/_apis/connectionData', {
      body: { authenticatedUser: { id: 'me-1', providerDisplayName: 'Dries' } },
    });
    hx.server.route('GET', '/unreliablewitness/_apis/projects/MIAC/teams', {
      body: { value: [{ id: 't1', name: 'MIAC Team' }] },
    });
    hx.server.route('GET', '/unreliablewitness/MIAC/MIAC%20Team/_apis/work/teamsettings/iterations', {
      body: { value: [{ id: 'it-1', name: 'Sprint 1', path: 'MIAC\\Sprint 1' }] },
    });
    hx.server.route('GET', '/unreliablewitness/MIAC/_apis/git/pullrequests', {
      body: { value: [] },
    });
    await hx.h['connections:save']({
      organizationUrl: `${hx.server.url}/unreliablewitness`,
      project: 'MIAC',
      pat: 'secret-pat',
    });
    expect(await hx.h['home:get']()).toBeNull();
    const s = await hx.h['home:refresh']();
    expect(s.connections).toHaveLength(1);
    expect(s.connections[0].status).toBe('ok');
    expect(s.connections[0].sprints[0].items.map((i) => i.id)).toEqual(['5']);
    expect(hx.broadcasts.some((b) => b.event === 'home:updated')).toBe(true);
    expect(await hx.h['home:get']()).toEqual(s);
  });

  it('stats come from the local stores', async () => {
    const hx = await harness();
    expect(await hx.h['home:stats']('week')).toMatchObject({
      period: 'week',
      costEur: 0,
      tasksFinished: 0,
    });
  });
});
```

Check how `broadcasts` records events in `harness` (search `broadcasts.push`) and match its shape (`{ event, payload }` or a tuple) before running.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/main/ipc/handlers.test.ts -t "home"`
Expected: FAIL (typecheck error or `h['home:get'] is not a function`).

- [ ] **Step 3: Add the channels and event**

In `src/shared/ipc.ts`, import `HomePeriod`, `HomeSnapshot`, `HomeStats` from `./home`, and add to `Channels`:

```ts
  /** The last Home snapshot (from disk at launch), null before the first build. */
  'home:get': { args: []; result: HomeSnapshot | null };
  /** Rebuilds the Home snapshot over every connection, or joins the rebuild already running. */
  'home:refresh': { args: []; result: HomeSnapshot };
  /** The developer's own totals for this week or month, from local data. */
  'home:stats': { args: [period: HomePeriod]; result: HomeStats };
```

and to `Events`:

```ts
  /** A Home rebuild finished. */
  'home:updated': HomeSnapshot;
```

- [ ] **Step 4: Wire the handlers**

In `src/main/ipc/handlers.ts`:
- import `HomeService` from `../home/HomeService` and `homeStats` from `../home/homeStats`;
- add to `Services`: `/** Home's snapshot builder; handlers build one in usageDir when absent (tests). */ home?: HomeService;`
- after `withConnection` is defined, create the service:

```ts
  const home =
    s.home ??
    new HomeService({
      file: path.join(s.usageDir, 'home.json'),
      connections: () => s.connections.list(),
      client: (id) => s.ado.client(id),
      withConnection,
      onBuilt: (snapshot, info) => {
        s.broadcast('home:updated', snapshot);
        tel.event('home.refreshed', {
          connections: info.connections,
          failed: info.failed,
        }, { durationMs: info.durationMs });
      },
    });
```

Check `tel.event`'s third parameter (`Measurements`, `src/main/telemetry/AppInsightsClient.ts:155`) and pass `durationMs` there.
- in the returned bundle add:

```ts
    'home:get': () => home.get(),
    'home:refresh': () => home.refresh(),
    'home:stats': async (period) =>
      homeStats({
        period,
        now: new Date(),
        tasks: s.store.state.tasks,
        repos: s.repos.list(),
        usage: s.usage,
        time: s.time,
      }),
```

When a connection is removed or saved (`connections:remove`, `connections:save`), nothing extra is needed: the next build reads `s.connections.list()`.

- [ ] **Step 5: Add fake defaults for renderer tests**

In `src/renderer/test-helpers/fakeApi.ts` `defaults`:

```ts
  'home:get': () => null,
  'home:refresh': () => ({ version: 1, builtAt: '2026-10-17T09:00:00.000Z', connections: [] }),
  'home:stats': (period) => ({
    period,
    from: '2026-10-12T00:00:00.000Z',
    to: '2026-10-17T09:00:00.000Z',
    costEur: 0,
    costByTool: { 'claude-code': 0, 'copilot-cli': 0 },
    costByConnection: [],
    activeSeconds: 0,
    agentSeconds: 0,
    accuracy: null,
    accuracyTasks: 0,
    tasksFinished: 0,
    prsOpened: 0,
  }),
```

- [ ] **Step 6: Document the telemetry**

In `docs/telemetry.md`, add `home` to the screen views row, and two rows under Usage events:

```markdown
| `home.refreshed` | the Home page's data was rebuilt; number of connections, number that failed; duration in ms |
| `home.clicked` | a click on Home; `band` (`task`, `up-next`, `review`, `team-review`, `my-pr`, `sprint`, `stats-period`) |
```

- [ ] **Step 7: Run tests, typecheck, lint, commit**

Run: `npx vitest run src/main/ipc/handlers.test.ts -t "home"` → PASS, then `npm test && npm run typecheck && npm run lint`.

```bash
git add src/shared/ipc.ts src/main/ipc/handlers.ts src/main/ipc/handlers.test.ts src/renderer/test-helpers/fakeApi.ts docs/telemetry.md
git commit -m "feat: home:get, home:refresh and home:stats over IPC"
```

---

### Task 5: Home screen shell, navigation and start page

**Files:**
- Create: `src/renderer/screens/HomeScreen.tsx`, `src/renderer/hooks/useHome.ts`, `src/renderer/homeView.ts`, `src/renderer/styles/home.css`
- Modify: `src/renderer/store.ts` (Screen, initial screen, `back` fallback), `src/renderer/App.tsx` (switch), `src/renderer/components/TaskNav.tsx` (Home item), `src/renderer/components/HeaderBar.tsx` (home crumb, breadcrumb), the file that imports `screens.css` (add `home.css` next to it)
- Test: `src/renderer/screens/HomeScreen.test.tsx`, `src/renderer/homeView.test.ts`, existing `App.test.tsx`, `store.test.tsx`, `HeaderBar.test.tsx`, `TaskNav.test.tsx`

**Interfaces:**
- Consumes: channels from Task 4; `HOME_MAX_AGE_MS`, `HOME_POLL_MS` (Task 1).
- Produces: `Screen` member `{ kind: 'home' }`; `useHome(): { snapshot: HomeSnapshot | null; refreshing: boolean; refresh: () => void }`; `chipState(home: HomeConnection | undefined, connection: Connection): 'ok' | 'stale' | 'error'`; `HomeScreen` rendering `<section aria-label="…">` per band, with band components from Tasks 6–9 slotted in (until then each band is a titled placeholder section with its empty line).

- [ ] **Step 1: Write the failing tests**

`src/renderer/homeView.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { HomeConnection } from '../shared/home';
import type { Connection } from '../shared/types';
import { chipState } from './homeView';

const connection = { id: 'c1', status: 'ok' } as Connection;
const home = (status: HomeConnection['status']) => ({ status }) as HomeConnection;

describe('chipState', () => {
  it('is error when the connection or the build says so', () => {
    expect(chipState(home('ok'), { ...connection, status: 'unauthorized' })).toBe('error');
    expect(chipState(home('error'), connection)).toBe('error');
  });
  it('is stale when the last build failed but data is kept', () => {
    expect(chipState(home('stale'), connection)).toBe('stale');
  });
  it('is ok otherwise, also before the first build', () => {
    expect(chipState(home('ok'), connection)).toBe('ok');
    expect(chipState(undefined, connection)).toBe('ok');
  });
});
```

`src/renderer/screens/HomeScreen.test.tsx`:

```ts
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeSnapshot } from '../../shared/home';
import type { Connection } from '../../shared/types';
import { Shell } from '../App';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';

vi.mock('../components/TerminalView', () => ({ TerminalView: () => null }));

export const connection: Connection = {
  id: 'c1',
  name: 'uw',
  organizationUrl: 'https://dev.azure.com/uw',
  project: 'MIAC',
  user: 'D',
  status: 'ok',
  checkedAt: null,
  userUniqueName: null,
};

export const snapshot = (over: Partial<HomeSnapshot> = {}): HomeSnapshot => ({
  version: 1,
  builtAt: new Date().toISOString(),
  connections: [
    {
      connectionId: 'c1',
      name: 'uw',
      project: 'MIAC',
      status: 'ok',
      error: null,
      fetchedAt: new Date().toISOString(),
      sprints: [],
      sprintsError: null,
      reviews: [],
      teamReviews: [],
      myPrs: [],
      prsError: null,
    },
  ],
  ...over,
});

beforeEach(() =>
  useStore.setState({
    repos: [],
    tasks: [],
    connections: [connection],
    connectionId: null,
    notices: [],
    selectedTaskId: null,
    previous: null,
    screen: { kind: 'home' },
  }),
);

describe('Home page', () => {
  it('shows the cached snapshot without waiting for a rebuild', async () => {
    const { calls } = installFakeApi({ 'home:get': () => snapshot() });
    render(<Shell />);
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'uw: MIAC, connected' })).toBeTruthy();
    // Fresh snapshot: no rebuild on open.
    expect(calls.some((c) => c.channel === 'home:refresh')).toBe(false);
  });

  it('rebuilds a snapshot older than a minute, and with none', async () => {
    const old = snapshot({ builtAt: new Date(Date.now() - 120_000).toISOString() });
    const { calls } = installFakeApi({ 'home:get': () => old });
    render(<Shell />);
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'home:refresh')).toBe(true),
    );
  });

  it('the refresh button rebuilds', async () => {
    const { calls } = installFakeApi({ 'home:get': () => snapshot() });
    render(<Shell />);
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
    expect(calls.filter((c) => c.channel === 'home:refresh')).toHaveLength(1);
  });

  it('takes the snapshot from home:updated', async () => {
    const { emit } = installFakeApi({ 'home:get': () => snapshot() });
    render(<Shell />);
    await screen.findByRole('heading', { name: 'Home' });
    act(() =>
      emit('home:updated', snapshot({
        connections: [{ ...snapshot().connections[0], status: 'stale', error: 'refused' }],
      })),
    );
    expect(await screen.findByRole('button', { name: 'uw: MIAC, stale: refused' })).toBeTruthy();
  });

  it('a chip opens Settings', async () => {
    installFakeApi({ 'home:get': () => snapshot() });
    render(<Shell />);
    await userEvent.click(await screen.findByRole('button', { name: 'uw: MIAC, connected' }));
    expect(useStore.getState().screen.kind).toBe('settings');
  });

  it('without connections it asks for one', async () => {
    useStore.setState({ connections: [] });
    installFakeApi();
    render(<Shell />);
    expect(await screen.findByRole('button', { name: 'Add an Azure DevOps connection' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'My tasks' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Stats' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'My sprints' })).toBeNull();
  });

  it('the nav has Home above Sprint and the app header goes Home', async () => {
    installFakeApi();
    useStore.setState({ screen: { kind: 'settings' } });
    render(<Shell />);
    await userEvent.click(screen.getByRole('button', { name: 'MIAC, go to Home' }));
    expect(useStore.getState().screen.kind).toBe('home');
    await userEvent.click(screen.getByRole('button', { name: 'Sprint' }));
    expect(useStore.getState().screen.kind).toBe('sprint');
  });
});
```

In `src/renderer/store.test.tsx` add:

```ts
it('starts on Home and Back falls back to Home', () => {
  expect(useStore.getInitialState().screen).toEqual({ kind: 'home' });
  useStore.setState({ previous: null, screen: { kind: 'settings' } });
  useStore.getState().back();
  expect(useStore.getState().screen).toEqual({ kind: 'home' });
});
```

- [ ] **Step 2: Run them, verify they fail**

Run: `npx vitest run src/renderer/homeView.test.ts src/renderer/screens/HomeScreen.test.tsx src/renderer/store.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Store, App, nav and header**

`src/renderer/store.ts`:
- add `| { kind: 'home' }` as the first member of `Screen`;
- `screen: { kind: 'home' }` in the initial state;
- in `back`, fall back to `{ kind: 'home' }` instead of `{ kind: 'sprint' }`;
- update the `setTasks` comment to "the app opens on Home".

`src/renderer/App.tsx`: import `HomeScreen` and add `case 'home': return <HomeScreen />;` before `case 'sprint'`.

`src/renderer/components/TaskNav.tsx`: import `Home20Regular` and add before the Sprint `NavItem`:

```tsx
      <NavItem
        icon={<Home20Regular aria-hidden="true" />}
        label="Home"
        rail={rail}
        current={screenKind === 'home'}
        onClick={() => go({ kind: 'home' })}
      />
```

The project switcher's menu keeps going to Sprint (choosing a project means its sprint).

`src/renderer/components/HeaderBar.tsx`:
- the MIAC crumb button: `aria-label="MIAC, go to Home"`, `onClick={() => go({ kind: 'home' })}`;
- the project crumb keeps going to Sprint (`go({ kind: 'sprint' })`), and is not shown on Home: change the condition to `connection && screen.kind !== 'settings' && screen.kind !== 'home'`;
- add `screen.kind === 'home' ? 'Home'` to the `page` chain.

Search the renderer tests for `'MIAC, go to Sprint'` and change them to the new label and expectation (`home`).

- [ ] **Step 4: `homeView.ts` with `chipState`**

```ts
import type { HomeConnection } from '../shared/home';
import type { Connection } from '../shared/types';

/** The health chip of a connection: red when its token was refused or it never loaded, amber when Home shows old data. */
export function chipState(
  home: HomeConnection | undefined,
  connection: Connection,
): 'ok' | 'stale' | 'error' {
  if (connection.status !== 'ok' || home?.status === 'error') return 'error';
  if (home?.status === 'stale') return 'stale';
  return 'ok';
}
```

- [ ] **Step 5: `useHome` hook**

`src/renderer/hooks/useHome.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { HOME_MAX_AGE_MS, HOME_POLL_MS, type HomeSnapshot } from '../../shared/home';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';

const old = (s: HomeSnapshot | null) =>
  !s || Date.now() - Date.parse(s.builtAt) > HOME_MAX_AGE_MS;

/** Home's snapshot: the cached one at once, rebuilt when old, every 5 minutes while the window has focus, and on demand. */
export function useHome(): {
  snapshot: HomeSnapshot | null;
  refreshing: boolean;
  refresh: () => void;
} {
  const notify = useStore((s) => s.notify);
  const [snapshot, setSnapshot] = useState<HomeSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const current = useRef<HomeSnapshot | null>(null);
  const keep = (s: HomeSnapshot) => {
    current.current = s;
    setSnapshot(s);
  };

  const refresh = useCallback(() => {
    setRefreshing(true);
    void tryInvoke(() => api().invoke('home:refresh'), notify).then((s) => {
      setRefreshing(false);
      if (s) keep(s);
    });
  }, [notify]);

  useEffect(() => {
    let live = true;
    void api()
      .invoke('home:get')
      .then((s) => {
        if (!live) return;
        if (s) keep(s);
        if (old(s)) refresh();
      })
      .catch(() => live && refresh());
    const off = api().on('home:updated', (s) => keep(s));
    const onFocus = () => {
      if (old(current.current)) refresh();
    };
    window.addEventListener('focus', onFocus);
    const poll = setInterval(() => {
      if (document.hasFocus()) refresh();
    }, HOME_POLL_MS);
    return () => {
      live = false;
      off();
      window.removeEventListener('focus', onFocus);
      clearInterval(poll);
    };
  }, [refresh]);

  return { snapshot, refreshing, refresh };
}
```

- [ ] **Step 6: `HomeScreen.tsx` with header, chips and band slots**

```tsx
import { ArrowClockwise16Regular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { PageHeader } from '../components/ui';
import { ago } from '../format';
import { useHome } from '../hooks/useHome';
import { chipState } from '../homeView';
import { useStore } from '../store';

const CHIP_TEXT = { ok: 'connected', stale: 'stale', error: 'not connected' } as const;

export function Band({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="home-band">
      <h2 className="home-band-title">{title}</h2>
      {children}
    </section>
  );
}

export function HomeScreen() {
  const { snapshot, refreshing, refresh } = useHome();
  const connections = useStore((s) => s.connections);
  const go = useStore((s) => s.go);
  const byId = new Map(snapshot?.connections.map((c) => [c.connectionId, c]));
  const refused = connections.filter((c) => c.status === 'unauthorized');
  return (
    <div className="page home">
      <PageHeader
        title="Home"
        after={
          snapshot && (
            <span className="muted small home-updated">
              {refreshing ? 'Updating' : `Updated ${ago(snapshot.builtAt)}`}
            </span>
          )
        }
        commands={
          <>
            <div className="home-chips">
              {connections.map((c) => {
                const h = byId.get(c.id);
                const state = chipState(h, c);
                const detail = state === 'ok' ? CHIP_TEXT.ok : `${CHIP_TEXT[state]}${h?.error ? `: ${h.error}` : ''}`;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`home-chip is-${state}`}
                    aria-label={`${c.name}: ${c.project}, ${detail}`}
                    title={detail}
                    onClick={() => go({ kind: 'settings' })}
                  >
                    <span className="dot" />
                    {c.name}/{c.project}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="btn"
              aria-label="Refresh"
              disabled={refreshing}
              onClick={refresh}
            >
              <ArrowClockwise16Regular aria-hidden="true" />
            </button>
          </>
        }
      />
      {refused.map((c) => (
        <p key={c.id} className="home-warning" role="status">
          Azure DevOps refused the token for {c.name}/{c.project}. Update it in Settings.
        </p>
      ))}
      <div className="home-bands">
        <Band title="My tasks">
          <p className="muted">No open tasks.</p>
        </Band>
        {connections.length === 0 ? (
          <button type="button" className="btn btn-primary home-connect" onClick={() => go({ kind: 'settings' })}>
            Add an Azure DevOps connection
          </button>
        ) : (
          <>
            <div className="home-split">
              <Band title="Reviews for me">
                <p className="muted">No reviews waiting.</p>
              </Band>
              <Band title="My pull requests">
                <p className="muted">No open pull requests.</p>
              </Band>
            </div>
            <Band title="My sprints">
              <p className="muted">Nothing assigned to you in a current sprint.</p>
            </Band>
          </>
        )}
        <Band title="Stats">
          <p className="muted">No activity yet.</p>
        </Band>
      </div>
    </div>
  );
}
```

If the existing button styles have an icon-button class used by the Sprint page's refresh (`SprintScreen.tsx`, search `ArrowClockwise16Regular`), use the same markup instead of `btn`. Check `ago`'s output (`format.ts:15`) and adjust the test's expectations only if the visible text is asserted.

`src/renderer/styles/home.css` (use only tokens that exist in `tokens.css`; check names before using them):

```css
.home-bands { display: flex; flex-direction: column; gap: 16px; padding: 0 24px 24px; }
.home-band { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 12px 16px; }
.home-band-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 8px; }
.home-split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.home-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.home-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 12px; padding: 1px 10px; background: none; color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.home-chip .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); }
.home-chip.is-stale .dot { background: var(--amber); }
.home-chip.is-error .dot { background: var(--red); }
.home-warning { margin: 0 24px 8px; color: var(--red); }
.home-connect { align-self: flex-start; }
.is-stale-data { opacity: .55; }
```

Import `home.css` where `screens.css` is imported.

- [ ] **Step 7: Run tests, fix the old start-page tests**

Run: `npm test`
Expected: the new tests pass. Tests that relied on the app opening on Sprint without setting `screen` (in `App.test.tsx`, `HeaderBar.test.tsx`, `TaskNav.test.tsx`) fail; set `screen: { kind: 'sprint' }` in their setup where they are about the Sprint page, or change the expectation to Home where they are about the start page.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add -A src/renderer
git commit -m "feat: Home page shell, opened at launch, with connection chips and refresh"
```

---

### Task 6: My tasks band with Up next

**Files:**
- Create: `src/renderer/taskStatus.ts`, `src/renderer/components/home/TasksBand.tsx`
- Modify: `src/renderer/screens/SprintScreen.tsx` (import `TASK_STATUS` from `taskStatus.ts`), `src/renderer/homeView.ts` (add `upNext`, `taskForItem`), `src/renderer/screens/HomeScreen.tsx` (slot the band)
- Test: `src/renderer/homeView.test.ts`, `src/renderer/components/home/TasksBand.test.tsx`

**Interfaces:**
- Consumes: `HomeSnapshot`, `stateCategory` (Task 1); `useTaskUsage(taskId)` (`hooks/useTaskUsage.ts`), `useTaskTime(taskId)` (`hooks/useTaskTime.ts`); `startTaskFor` (`startTask.ts`); `useWorkItemTypes` + `stateMeta` (`workItemTypes.ts`); `taskConnectionId` (`shared/workspaces.ts`); `track` (`telemetry.ts`).
- Produces: `TASK_STATUS: Record<TaskStatus, { label: string; color: string }>`; `upNext(snapshot, tasks, repos, categoryOf, limit = 3): { connectionId: string; item: HomeItem }[]` where `categoryOf(connectionId, type, state): string | null | undefined`; `TasksBand({ snapshot }: { snapshot: HomeSnapshot | null })`.

- [ ] **Step 1: Write the failing `upNext` tests**

Append to `src/renderer/homeView.test.ts`:

```ts
import type { HomeItem, HomeSnapshot } from '../shared/home';
import type { Repo, TaskView } from '../shared/types';
import { upNext } from './homeView';

const hi = (id: string, state = 'To Do'): HomeItem => ({
  id, type: 'Issue', title: `Item ${id}`, state, areaPath: 'P', iterationPath: 'P\\S1',
  assignedTo: 'Me', url: `https://x/${id}`, remainingWork: null, originalEstimate: null, completedWork: null,
});
const snap = (items: HomeItem[]): HomeSnapshot => ({
  version: 1,
  builtAt: '',
  connections: [{
    connectionId: 'c1', name: 'uw', project: 'P', status: 'ok', error: null, fetchedAt: '',
    sprints: [{ iterationId: 'i', name: 'S1', path: 'P\\S1', startDate: null, finishDate: null, items }],
    sprintsError: null, reviews: [], teamReviews: [], myPrs: [], prsError: null,
  }],
});
const repos = [{ id: 'r1', connectionId: 'c1' }] as Repo[];
const noMeta = () => undefined;

describe('upNext', () => {
  it('takes not-started items, at most three', () => {
    const s = snap([hi('1'), hi('2', 'Doing'), hi('3'), hi('4'), hi('5')]);
    expect(upNext(s, [], repos, noMeta).map((u) => u.item.id)).toEqual(['1', '3', '4']);
  });
  it('drops an item once it has a task', () => {
    const s = snap([hi('1'), hi('3')]);
    const tasks = [{ id: 't', repoId: 'r1', connectionId: null, workItem: { id: '1' }, status: 'setting-up' }] as TaskView[];
    expect(upNext(s, tasks, repos, noMeta).map((u) => u.item.id)).toEqual(['3']);
  });
  it('an item with the same id on another connection still counts', () => {
    const s = snap([hi('1')]);
    const tasks = [{ id: 't', repoId: 'r2', connectionId: 'c2', workItem: { id: '1' }, status: 'ready' }] as TaskView[];
    expect(upNext(s, tasks, repos, noMeta)).toHaveLength(1);
  });
  it('uses the type metadata category', () => {
    const s = snap([hi('1', 'Approved by PO')]);
    expect(upNext(s, [], repos, () => 'Proposed')).toHaveLength(1);
    expect(upNext(s, [], repos, () => 'InProgress')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/renderer/homeView.test.ts`
Expected: FAIL (`upNext` not exported).

- [ ] **Step 3: Implement `upNext` and `taskForItem`**

Add to `src/renderer/homeView.ts`:

```ts
import { stateCategory, type HomeItem, type HomeSnapshot } from '../shared/home';
import type { Repo, TaskView } from '../shared/types';
import { taskConnectionId } from '../shared/workspaces';

export type CategoryOf = (connectionId: string, type: string, state: string) => string | null | undefined;

/** The task of a work item on a connection, open ones first (the same rule as the Sprint page). */
export function taskForItem(
  id: string,
  connectionId: string,
  tasks: TaskView[],
  repos: Pick<Repo, 'id' | 'connectionId'>[],
): TaskView | null {
  const matches = tasks.filter(
    (t) => t.workItem?.id === id && taskConnectionId(t, repos) === connectionId,
  );
  return matches.find((t) => t.status !== 'done') ?? matches[0] ?? null;
}

/** My not-started items in current sprints without a MIAC task, soonest sprint end first. */
export function upNext(
  snapshot: HomeSnapshot | null,
  tasks: TaskView[],
  repos: Pick<Repo, 'id' | 'connectionId'>[],
  categoryOf: CategoryOf,
  limit = 3,
): { connectionId: string; item: HomeItem }[] {
  const out: { connectionId: string; item: HomeItem; end: string }[] = [];
  for (const c of snapshot?.connections ?? [])
    for (const s of c.sprints)
      for (const item of s.items)
        if (
          stateCategory(categoryOf(c.connectionId, item.type, item.state), item.state) === 'Proposed' &&
          !taskForItem(item.id, c.connectionId, tasks, repos)
        )
          out.push({ connectionId: c.connectionId, item, end: s.finishDate ?? '9' });
  return out
    .sort((a, b) => a.end.localeCompare(b.end))
    .slice(0, limit)
    .map(({ connectionId, item }) => ({ connectionId, item }));
}
```

(`Array.prototype.sort` is stable, so items keep backlog order within a sprint.)

Run: `npx vitest run src/renderer/homeView.test.ts` → PASS.

- [ ] **Step 4: Move `TASK_STATUS`**

Create `src/renderer/taskStatus.ts` with the `TASK_STATUS` constant exactly as it is in `SprintScreen.tsx` (exported), delete it from `SprintScreen.tsx` and import it there. Run `npx vitest run src/renderer/screens/SprintScreen.test.tsx` → PASS.

- [ ] **Step 5: Write the failing band test**

`src/renderer/components/home/TasksBand.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { HomeSnapshot } from '../../../shared/home';
import type { Repo, TaskView } from '../../../shared/types';
import { useStore } from '../../store';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { TasksBand } from './TasksBand';

const repo = { id: 'r1', name: 'web', connectionId: 'c1', discovered: false } as Repo;
const task = (over: Partial<TaskView>): TaskView =>
  ({
    id: 't1', repoId: 'r1', connectionId: 'c1', name: '', status: 'ready', worktreeMissing: false,
    workItem: { id: '42', type: 'Issue', title: 'Login loop', url: null },
    createdAt: '2026-10-17T08:00:00Z', terminals: [], ...over,
  }) as TaskView;
const snapshot: HomeSnapshot = {
  version: 1, builtAt: '',
  connections: [{
    connectionId: 'c1', name: 'uw', project: 'MIAC', status: 'ok', error: null, fetchedAt: '',
    sprints: [{ iterationId: 'i', name: 'S1', path: 'MIAC\\S1', startDate: null, finishDate: null, items: [
      { id: '7', type: 'Issue', title: 'Reset mail', state: 'To Do', areaPath: 'MIAC', iterationPath: 'MIAC\\S1', assignedTo: 'Me', url: 'u', remainingWork: null, originalEstimate: null, completedWork: null },
    ] }],
    sprintsError: null, reviews: [], teamReviews: [], myPrs: [], prsError: null,
  }],
};

beforeEach(() =>
  useStore.setState({
    repos: [repo],
    tasks: [],
    connections: [{ id: 'c1', name: 'uw', project: 'MIAC' } as never],
    screen: { kind: 'home' },
  }),
);

describe('TasksBand', () => {
  it('shows open tasks, not done ones, and opens a task on click', async () => {
    installFakeApi();
    useStore.setState({ tasks: [task({}), task({ id: 't2', status: 'done' })] });
    render(<TasksBand snapshot={null} />);
    const card = await screen.findByRole('button', { name: /Issue 42 Login loop/ });
    expect(screen.queryAllByRole('button', { name: /Issue 42/ })).toHaveLength(1);
    await userEvent.click(card);
    expect(useStore.getState().screen.kind).toBe('task');
    expect(useStore.getState().selectedTaskId).toBe('t1');
  });

  it('marks a failed setup and lands on Setup', async () => {
    installFakeApi();
    useStore.setState({ tasks: [task({ status: 'setup-failed' })] });
    render(<TasksBand snapshot={null} />);
    const card = await screen.findByRole('button', { name: /needs attention/ });
    await userEvent.click(card);
    expect(useStore.getState().screen).toEqual({ kind: 'setup', taskId: 't1' });
  });

  it('Up next starts a task with the repo defaults', async () => {
    const { calls } = installFakeApi({
      'repos:config': () => ({ worktreeRoot: '/w', config: { base: 'main', branch: '{type}/{id}-{slug}', copy: [], setup: [], run: {}, found: true } }),
      'tasks:create': (input) => ({ id: 'new', ...input }) as never,
    });
    render(<TasksBand snapshot={snapshot} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Start a task for Issue 7 Reset mail' }));
    expect(calls.some((c) => c.channel === 'tasks:create')).toBe(true);
    expect(useStore.getState().screen).toEqual({ kind: 'setup', taskId: 'new' });
  });

  it('Up next without a linked repo explains why it cannot start', async () => {
    installFakeApi();
    useStore.setState({ repos: [] });
    render(<TasksBand snapshot={snapshot} />);
    const start = await screen.findByRole('button', { name: 'Start a task for Issue 7 Reset mail' });
    expect(start.getAttribute('aria-disabled')).toBe('true');
  });

  it('empty state', async () => {
    installFakeApi();
    render(<TasksBand snapshot={null} />);
    expect(await screen.findByText('No open tasks.')).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run, verify fail**

Run: `npx vitest run src/renderer/components/home/TasksBand.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 7: Implement `TasksBand.tsx`**

```tsx
import { useState } from 'react';
import type { HomeItem, HomeSnapshot } from '../../../shared/home';
import type { TaskView } from '../../../shared/types';
import { taskConnectionId } from '../../../shared/workspaces';
import { eur, formatDuration } from '../../format';
import { useTaskTime } from '../../hooks/useTaskTime';
import { useTaskUsage } from '../../hooks/useTaskUsage';
import { upNext } from '../../homeView';
import { Band } from '../../screens/HomeScreen';
import { startTaskFor } from '../../startTask';
import { useStore } from '../../store';
import { TASK_STATUS } from '../../taskStatus';
import { track } from '../../telemetry';
import { stateMeta, useWorkItemTypes } from '../../workItemTypes';
import { WorkItemTypeIcon } from '../ui';

const NO_REPO = 'Link a repo to this project in Settings to start a task';

function TaskCard({ task }: { task: TaskView }) {
  const openTask = useStore((s) => s.openTask);
  const repos = useStore((s) => s.repos);
  const connections = useStore((s) => s.connections);
  const usage = useTaskUsage(task.id);
  const { time } = useTaskTime(task.id);
  const attention = task.status === 'setup-failed' || task.worktreeMissing;
  const status = task.worktreeMissing
    ? { label: 'Folder missing', color: 'var(--red)' }
    : TASK_STATUS[task.status];
  const connection = connections.find((c) => c.id === taskConnectionId(task, repos));
  const label = task.workItem
    ? `${task.workItem.type} ${task.workItem.id} ${task.workItem.title}`
    : task.name || task.branch;
  return (
    <button
      type="button"
      className={attention ? 'home-card is-attention' : 'home-card'}
      aria-label={`${label}, ${attention ? 'needs attention' : status.label}`}
      onClick={() => {
        track('home.clicked', { band: 'task' });
        openTask(task.id);
      }}
    >
      <span className="home-card-title">
        {task.workItem && <WorkItemTypeIcon type={task.workItem.type} connectionId={connection?.id} />}
        {label}
      </span>
      <span className="muted small">
        <span className="dot" style={{ background: status.color }} /> {status.label}
        {connection && ` · ${connection.name}/${connection.project}`}
        {usage && usage.billable.costEur > 0 && ` · ${eur(usage.billable.costEur)}`}
        {time && time.activeSeconds > 0 && ` · ${formatDuration(time.activeSeconds)}`}
      </span>
    </button>
  );
}

function UpNextRow({ connectionId, item }: { connectionId: string; item: HomeItem }) {
  const repos = useStore((s) => s.repos);
  const notify = useStore((s) => s.notify);
  const select = useStore((s) => s.select);
  const go = useStore((s) => s.go);
  const [starting, setStarting] = useState(false);
  const repoId = repos.find((r) => r.connectionId === connectionId && !r.discovered)?.id ?? null;
  const label = `${item.type} ${item.id} ${item.title}`;
  return (
    <div className="home-upnext-row">
      <span>
        <WorkItemTypeIcon type={item.type} connectionId={connectionId} /> {item.id} {item.title}
      </span>
      <button
        type="button"
        className="btn btn-primary"
        aria-label={`Start a task for ${label}`}
        aria-disabled={!repoId || undefined}
        title={repoId ? undefined : NO_REPO}
        disabled={starting}
        onClick={async () => {
          if (!repoId || starting) return;
          track('home.clicked', { band: 'up-next' });
          setStarting(true);
          const created = await startTaskFor(
            repoId,
            { id: item.id, type: item.type, title: item.title, url: item.url },
            notify,
          );
          setStarting(false);
          if (created) {
            select(created.id);
            go({ kind: 'setup', taskId: created.id });
          }
        }}
      >
        {starting ? 'Starting' : 'Start'}
      </button>
    </div>
  );
}

export function TasksBand({ snapshot }: { snapshot: HomeSnapshot | null }) {
  const tasks = useStore((s) => s.tasks);
  const repos = useStore((s) => s.repos);
  const types = useWorkItemTypes((s) => s.byConnection);
  const open = tasks
    .filter((t) => t.status !== 'done')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const next = upNext(snapshot, tasks, repos, (connectionId, type, state) => {
    const e = types[connectionId];
    return e?.status === 'ok'
      ? stateMeta(e.types.get(type.toLowerCase()), state)?.category
      : undefined;
  });
  return (
    <Band title="My tasks">
      <div className="home-cards">
        {open.map((t) => (
          <TaskCard key={t.id} task={t} />
        ))}
        {open.length === 0 && <p className="muted">No open tasks.</p>}
        {next.length > 0 && (
          <div className="home-card home-upnext" role="group" aria-label="Up next">
            <span className="home-card-title">Up next</span>
            {next.map((n) => (
              <UpNextRow key={`${n.connectionId}:${n.item.id}`} {...n} />
            ))}
          </div>
        )}
      </div>
    </Band>
  );
}
```

`useWorkItemTypes` only holds connections something asked to load. In `HomeScreen`, load the types for each connection in the snapshot once:

```tsx
const loadTypes = useWorkItemTypes((s) => s.load);
useEffect(() => {
  for (const c of snapshot?.connections ?? []) loadTypes(c.connectionId);
}, [snapshot, loadTypes]);
```

Check the `Entry` type in `workItemTypes.ts` (line 15) for the exact `status` and `types` names before relying on them.

Add to `home.css`:

```css
.home-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
.home-card { display: flex; flex-direction: column; gap: 4px; text-align: left; background: var(--surface-2, transparent); border: 1px solid var(--border); border-radius: 4px; padding: 8px 10px; color: inherit; font: inherit; cursor: pointer; }
.home-card.is-attention { border-color: var(--red); }
.home-card-title { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.home-upnext { cursor: default; }
.home-upnext-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
```

In `HomeScreen.tsx`, replace the "My tasks" placeholder with `<TasksBand snapshot={snapshot} />`.

- [ ] **Step 8: Run tests, typecheck, lint, commit**

Run: `npm test && npm run typecheck && npm run lint` → PASS.

```bash
git add -A src/renderer
git commit -m "feat: Home My tasks band with Up next and Start"
```

---

### Task 7: Reviews and My pull requests band

**Files:**
- Create: `src/renderer/components/home/PrBand.tsx`
- Modify: `src/renderer/screens/HomeScreen.tsx` (slot the band)
- Test: `src/renderer/components/home/PrBand.test.tsx`

**Interfaces:**
- Consumes: `HomeSnapshot`, `HomePr` (Task 1); `Band` (Task 5); `ago` (`format.ts`); `tryInvoke`, `api` (`api.ts`).
- Produces: `PrBand({ snapshot }: { snapshot: HomeSnapshot | null })` rendering two `Band`s inside `.home-split`.

- [ ] **Step 1: Write the failing test**

`src/renderer/components/home/PrBand.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { HomeConnection, HomePr, HomeSnapshot } from '../../../shared/home';
import { useStore } from '../../store';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { PrBand } from './PrBand';

const pr = (id: number, over: Partial<HomePr> = {}): HomePr => ({
  id, repo: 'web', title: `PR ${id}`, author: 'Anna', authorId: 'anna',
  createdAt: `2026-10-1${id}T08:00:00Z`, isDraft: false, conflicts: false, myVote: 0,
  votes: { approved: 0, waiting: 0, rejected: 0 }, url: `https://x/pr/${id}`, ...over,
});
const conn = (over: Partial<HomeConnection>): HomeConnection => ({
  connectionId: 'c1', name: 'uw', project: 'MIAC', status: 'ok', error: null,
  fetchedAt: '2026-10-17T09:12:00Z', sprints: [], sprintsError: null,
  reviews: [], teamReviews: [], myPrs: [], prsError: null, ...over,
});
const snap = (...connections: HomeConnection[]): HomeSnapshot => ({ version: 1, builtAt: '', connections });

beforeEach(() => useStore.setState({ notices: [] }));

describe('PrBand', () => {
  it('lists named reviews oldest first over all connections', () => {
    installFakeApi();
    render(<PrBand snapshot={snap(conn({ reviews: [pr(3)] }), conn({ connectionId: 'c2', name: 'fab', reviews: [pr(1, { isDraft: true, conflicts: true })] }))} />);
    const list = screen.getByRole('region', { name: 'Reviews for me' });
    const rows = within(list).getAllByRole('button', { name: /^!/ });
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^!1 PR 1/),
      expect.stringMatching(/^!3 PR 3/),
    ]);
    expect(within(rows[0]).getByText('Draft')).toBeTruthy();
    expect(within(rows[0]).getByText('Conflicts')).toBeTruthy();
  });

  it('team requests are collapsed until opened', async () => {
    installFakeApi();
    render(<PrBand snapshot={snap(conn({ teamReviews: [pr(4), pr(5)] }))} />);
    const toggle = screen.getByRole('button', { name: 'Team requests (2)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: /^!4/ })).toBeNull();
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: /^!4/ })).toBeTruthy();
  });

  it('a row opens the PR in the browser', async () => {
    const { calls } = installFakeApi({ 'shell:openExternal': () => undefined });
    render(<PrBand snapshot={snap(conn({ myPrs: [pr(9, { votes: { approved: 2, waiting: 1, rejected: 0 } })] }))} />);
    const mine = screen.getByRole('region', { name: 'My pull requests' });
    const row = within(mine).getByRole('button', { name: /^!9/ });
    expect(row.textContent).toContain('2 approved, 1 waiting');
    await userEvent.click(row);
    expect(calls.find((c) => c.channel === 'shell:openExternal')?.args).toEqual(['https://x/pr/9']);
  });

  it('greys rows of a stale connection and names a failed PR load', () => {
    installFakeApi();
    render(<PrBand snapshot={snap(conn({ status: 'stale', reviews: [pr(1)] }), conn({ connectionId: 'c2', name: 'fab', project: 'Api', prsError: 'no code scope' }))} />);
    expect(screen.getByRole('button', { name: /^!1/ }).className).toContain('is-stale-data');
    expect(screen.getByText("Couldn't load pull requests for fab/Api")).toBeTruthy();
  });

  it('empty states', () => {
    installFakeApi();
    render(<PrBand snapshot={snap(conn({}))} />);
    expect(screen.getByText('No reviews waiting.')).toBeTruthy();
    expect(screen.getByText('No open pull requests.')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/renderer/components/home/PrBand.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `PrBand.tsx`**

```tsx
import { useState } from 'react';
import type { HomeConnection, HomePr, HomeSnapshot } from '../../../shared/home';
import { api, tryInvoke } from '../../api';
import { ago, dateTime } from '../../format';
import { Band } from '../../screens/HomeScreen';
import { useStore } from '../../store';
import { track } from '../../telemetry';

type Row = { pr: HomePr; connection: HomeConnection };
type Kind = 'review' | 'team-review' | 'my-pr';

const VOTE: Record<string, string> = { '10': 'Approved', '5': 'Approved with suggestions', '-5': 'Waiting for author', '-10': 'Rejected' };

function votesText(v: HomePr['votes']): string {
  const parts = [
    v.approved && `${v.approved} approved`,
    v.waiting && `${v.waiting} waiting`,
    v.rejected && `${v.rejected} rejected`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No votes yet';
}

function PrRow({ row, kind }: { row: Row; kind: Kind }) {
  const notify = useStore((s) => s.notify);
  const { pr, connection } = row;
  const stale = connection.status !== 'ok';
  return (
    <button
      type="button"
      className={stale ? 'home-pr is-stale-data' : 'home-pr'}
      aria-label={`!${pr.id} ${pr.title}, ${pr.repo}, ${pr.author}`}
      title={stale && connection.fetchedAt ? `Stale since ${dateTime(connection.fetchedAt)}` : undefined}
      onClick={() => {
        track('home.clicked', { band: kind });
        void tryInvoke(() => api().invoke('shell:openExternal', pr.url), notify);
      }}
    >
      <span className="home-pr-title">!{pr.id} {pr.title}</span>
      <span className="muted small">
        {pr.repo} · {kind === 'my-pr' ? votesText(pr.votes) : pr.author} · {ago(pr.createdAt)}
        {pr.myVote !== null && pr.myVote !== 0 && ` · ${VOTE[String(pr.myVote)] ?? ''}`}
      </span>
      {pr.isDraft && <span className="badge">Draft</span>}
      {pr.conflicts && <span className="badge is-red">Conflicts</span>}
    </button>
  );
}

const rowsOf = (snapshot: HomeSnapshot | null, pick: (c: HomeConnection) => HomePr[]): Row[] =>
  (snapshot?.connections ?? []).flatMap((connection) => pick(connection).map((pr) => ({ pr, connection })));

const oldest = (a: Row, b: Row) => a.pr.createdAt.localeCompare(b.pr.createdAt);

export function PrBand({ snapshot }: { snapshot: HomeSnapshot | null }) {
  const [teamOpen, setTeamOpen] = useState(false);
  const reviews = rowsOf(snapshot, (c) => c.reviews).sort(oldest);
  const team = rowsOf(snapshot, (c) => c.teamReviews).sort(oldest);
  const mine = rowsOf(snapshot, (c) => c.myPrs).sort((a, b) => oldest(b, a));
  const failed = (snapshot?.connections ?? []).filter((c) => c.prsError);
  const errors = failed.map((c) => (
    <p key={c.connectionId} className="muted small">
      Couldn't load pull requests for {c.name}/{c.project}
    </p>
  ));
  return (
    <div className="home-split">
      <Band title="Reviews for me">
        {reviews.map((r) => (
          <PrRow key={`${r.connection.connectionId}:${r.pr.id}`} row={r} kind="review" />
        ))}
        {reviews.length === 0 && <p className="muted">No reviews waiting.</p>}
        {team.length > 0 && (
          <>
            <button
              type="button"
              className="home-toggle"
              aria-expanded={teamOpen}
              onClick={() => setTeamOpen(!teamOpen)}
            >
              Team requests ({team.length})
            </button>
            {teamOpen &&
              team.map((r) => (
                <PrRow key={`${r.connection.connectionId}:${r.pr.id}`} row={r} kind="team-review" />
              ))}
          </>
        )}
        {errors}
      </Band>
      <Band title="My pull requests">
        {mine.map((r) => (
          <PrRow key={`${r.connection.connectionId}:${r.pr.id}`} row={r} kind="my-pr" />
        ))}
        {mine.length === 0 && <p className="muted">No open pull requests.</p>}
        {errors}
      </Band>
    </div>
  );
}
```

The test looks for the error text once; it appears in both bands. Change the test to `getAllByText(...)` with length 2 if you keep it in both, or render it only under Reviews. Keep it in both and use `getAllByText` (the user sees it wherever they look).

Check that `badge` and `is-red` exist in the styles (`grep -n "\.badge" src/renderer/styles/*.css`); otherwise add them to `home.css`:

```css
.home-pr { display: grid; grid-template-columns: 1fr auto auto; align-items: center; column-gap: 6px; width: 100%; text-align: left; background: none; border: 0; border-bottom: 1px solid var(--border); padding: 6px 0; color: inherit; font: inherit; cursor: pointer; }
.home-pr .muted { grid-column: 1; }
.home-toggle { background: none; border: 0; color: var(--muted); font: inherit; padding: 6px 0; cursor: pointer; }
```

In `HomeScreen.tsx`, replace the `.home-split` placeholder with `{snapshot ? <PrBand snapshot={snapshot} /> : <Band title="Reviews for me"><p className="muted">Loading</p></Band>}`, so the first launch without a cached snapshot shows Loading, not "No reviews waiting." Add a HomeScreen test: `'home:get': () => null` and a `home:refresh` that never resolves → `getByText('Loading')`.

- [ ] **Step 4: Run tests, typecheck, lint, commit**

Run: `npm test && npm run typecheck && npm run lint` → PASS.

```bash
git add -A src/renderer
git commit -m "feat: Home reviews and my pull requests band"
```

---

### Task 8: My sprints band

**Files:**
- Create: `src/renderer/components/ui/TimeBar.tsx`, `src/renderer/components/home/SprintsBand.tsx`
- Modify: `src/renderer/components/ui/index.ts` (export `TimeBar`), `src/renderer/screens/SprintScreen.tsx` (`TimeCell` uses `TimeBar`), `src/renderer/homeView.ts` (add `sprintTotals`), `src/renderer/screens/HomeScreen.tsx`
- Test: `src/renderer/homeView.test.ts`, `src/renderer/components/home/SprintsBand.test.tsx`

**Interfaces:**
- Consumes: `sprintTime(rows, local)` (`shared/sprintTime.ts`), channel `time:sprint` (existing), `stateCategory` (Task 1), `sprintDates` or `ago` (`format.ts`).
- Produces: `TimeBar({ pct, over }: { pct: number; over: boolean })`; `sprintTotals(sprint: HomeSprint, local: Record<string, LocalItemTime>, categoryOf: (type: string, state: string) => string | null | undefined): { todo: number; doing: number; done: number; spentSeconds: number; estimateHours: number | null }`; `SprintsBand({ snapshot })`.

- [ ] **Step 1: Write the failing `sprintTotals` test**

Append to `src/renderer/homeView.test.ts`:

```ts
import { sprintTotals } from './homeView';

describe('sprintTotals', () => {
  const sprint = {
    iterationId: 'i', name: 'S1', path: 'P\\S1', startDate: null, finishDate: null,
    items: [
      { ...hi('1'), originalEstimate: 4 },
      { ...hi('2', 'Doing'), originalEstimate: 2, completedWork: 1 },
      { ...hi('3', 'Done') },
      { ...hi('4', 'Removed') },
    ],
  };
  it('counts my items by state category, without removed ones', () => {
    expect(sprintTotals(sprint, {}, () => undefined)).toMatchObject({ todo: 1, doing: 1, done: 1 });
  });
  it('adds spent and estimate as the Sprint page does', () => {
    const local = { '1': { spentSeconds: 3600, measuredSeconds: 3600, agentSeconds: 0, booked: false, baselineHours: null } };
    expect(sprintTotals(sprint, local, () => undefined)).toMatchObject({
      spentSeconds: 3600 + 3600,
      estimateHours: 6,
    });
  });
  it('has no estimate when no item has one', () => {
    const bare = { ...sprint, items: [hi('9')] };
    expect(sprintTotals(bare, {}, () => undefined).estimateHours).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail; implement `sprintTotals`**

Run: `npx vitest run src/renderer/homeView.test.ts` → FAIL. Then add to `homeView.ts`:

```ts
import { sprintTime } from '../shared/sprintTime';
import type { LocalItemTime } from '../shared/time';
import type { HomeSprint } from '../shared/home';

/** My items of a sprint by state category, and their spent and estimated time (the Sprint page's rules per item). */
export function sprintTotals(
  sprint: HomeSprint,
  local: Record<string, LocalItemTime>,
  categoryOf: (type: string, state: string) => string | null | undefined,
): { todo: number; doing: number; done: number; spentSeconds: number; estimateHours: number | null } {
  const items = sprint.items.filter(
    (i) => stateCategory(categoryOf(i.type, i.state), i.state) !== 'Removed',
  );
  const cells = sprintTime(
    items.map((item) => ({ item, depth: 0, parentId: null, hasChildren: false })),
    local,
  );
  let todo = 0, doing = 0, done = 0, spent = 0, estimate = 0, anyEstimate = false;
  for (const i of items) {
    const c = stateCategory(categoryOf(i.type, i.state), i.state);
    if (c === 'Proposed') todo++;
    else if (c === 'Completed') done++;
    else doing++;
    const cell = cells.get(i.id);
    spent += cell?.spentSeconds ?? 0;
    if (cell?.estimateHours != null) {
      estimate += cell.estimateHours;
      anyEstimate = true;
    }
  }
  return { todo, doing, done, spentSeconds: spent, estimateHours: anyEstimate ? estimate : null };
}
```

Run again → PASS.

- [ ] **Step 3: Extract `TimeBar`**

`src/renderer/components/ui/TimeBar.tsx`:

```tsx
/** The thin spent/estimate bar; amber past the estimate. */
export function TimeBar({ pct, over }: { pct: number; over: boolean }) {
  return (
    <span className={over ? 'time-bar over' : 'time-bar'}>
      <i style={{ width: `${Math.min(100, pct)}%` }} />
    </span>
  );
}
```

Export it from `components/ui/index.ts`, and in `SprintScreen.tsx`'s `TimeCell` replace the inline `<span className=... time-bar>` with `<TimeBar pct={pct} over={over} />`. Run `npx vitest run src/renderer/screens/SprintScreen.test.tsx` → PASS.

- [ ] **Step 4: Write the failing band test**

`src/renderer/components/home/SprintsBand.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { HomeConnection, HomeSnapshot } from '../../../shared/home';
import type { Repo } from '../../../shared/types';
import { useStore } from '../../store';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { SprintsBand } from './SprintsBand';

const item = (id: string, state: string) => ({
  id, type: 'Issue', title: id, state, areaPath: 'MIAC', iterationPath: 'MIAC\\Sprint 1',
  assignedTo: 'Me', url: 'u', remainingWork: null, originalEstimate: 2, completedWork: null,
});
const conn = (over: Partial<HomeConnection>): HomeConnection => ({
  connectionId: 'c1', name: 'uw', project: 'MIAC', status: 'ok', error: null, fetchedAt: '',
  sprints: [], sprintsError: null, reviews: [], teamReviews: [], myPrs: [], prsError: null, ...over,
});
const snap = (...connections: HomeConnection[]): HomeSnapshot => ({ version: 1, builtAt: '', connections });
const finish = new Date(Date.now() + 4 * 86_400_000).toISOString();

beforeEach(() =>
  useStore.setState({
    repos: [
      { id: 'r1', connectionId: 'c1', discovered: false },
      { id: 'r2', connectionId: 'c2', discovered: false },
    ] as Repo[],
    connectionId: null,
    screen: { kind: 'home' },
  }),
);

describe('SprintsBand', () => {
  it('a card per sprint with my items by state and days left', async () => {
    installFakeApi();
    render(
      <SprintsBand
        snapshot={snap(conn({ sprints: [{ iterationId: 'i', name: 'Sprint 1', path: 'MIAC\\Sprint 1', startDate: null, finishDate: finish, items: [item('1', 'To Do'), item('2', 'Doing'), item('3', 'Done')] }] }))}
      />,
    );
    const card = await screen.findByRole('button', { name: /uw\/MIAC, Sprint 1/ });
    expect(card.textContent).toContain('1 to do · 1 in progress · 1 done');
    expect(card.textContent).toMatch(/4 days left/);
    expect(card.textContent).toContain('/ 6h');
  });

  it('a click opens that project on the Sprint page', async () => {
    installFakeApi();
    render(<SprintsBand snapshot={snap(conn({ sprints: [{ iterationId: 'i', name: 'Sprint 1', path: 'p', startDate: null, finishDate: null, items: [item('1', 'To Do')] }] }))} />);
    await userEvent.click(await screen.findByRole('button', { name: /Sprint 1/ }));
    expect(useStore.getState().connectionId).toBe('c1');
    expect(useStore.getState().screen.kind).toBe('sprint');
  });

  it('a linked project without my items gets a slim card', () => {
    installFakeApi();
    render(<SprintsBand snapshot={snap(conn({ connectionId: 'c2', name: 'fab', project: 'Api' }))} />);
    expect(screen.getByText('fab/Api: nothing assigned')).toBeTruthy();
  });

  it('names a failed sprint load', () => {
    installFakeApi();
    render(<SprintsBand snapshot={snap(conn({ sprintsError: 'boom' }))} />);
    expect(screen.getByText("Couldn't load sprints for uw/MIAC")).toBeTruthy();
  });

  it('empty state', () => {
    installFakeApi();
    useStore.setState({ repos: [] });
    render(<SprintsBand snapshot={snap(conn({}))} />);
    expect(screen.getByText('Nothing assigned to you in a current sprint.')).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run, verify fail; implement `SprintsBand.tsx`**

Run: `npx vitest run src/renderer/components/home/SprintsBand.test.tsx` → FAIL. Then:

```tsx
import { useEffect, useState } from 'react';
import type { HomeConnection, HomeSnapshot, HomeSprint } from '../../../shared/home';
import { formatDuration, type LocalItemTime } from '../../../shared/time';
import { api } from '../../api';
import { sprintTotals } from '../../homeView';
import { Band } from '../../screens/HomeScreen';
import { useStore } from '../../store';
import { track } from '../../telemetry';
import { stateMeta, useWorkItemTypes } from '../../workItemTypes';
import { TimeBar } from '../ui';

const daysLeft = (finish: string | null): string | null => {
  if (!finish) return null;
  const days = Math.ceil((Date.parse(finish) - Date.now()) / 86_400_000);
  return days <= 0 ? 'Ends today' : days === 1 ? '1 day left' : `${days} days left`;
};

function SprintCard({ connection, sprint, local }: { connection: HomeConnection; sprint: HomeSprint; local: Record<string, LocalItemTime> }) {
  const setConnectionId = useStore((s) => s.setConnectionId);
  const go = useStore((s) => s.go);
  const types = useWorkItemTypes((s) => s.byConnection[connection.connectionId]);
  const t = sprintTotals(sprint, local, (type, state) =>
    types?.status === 'ok' ? stateMeta(types.types.get(type.toLowerCase()), state)?.category : undefined,
  );
  const over = t.estimateHours !== null && t.estimateHours > 0 && t.spentSeconds > t.estimateHours * 3600;
  const pct = t.estimateHours ? Math.round((t.spentSeconds / (t.estimateHours * 3600)) * 100) : null;
  const left = daysLeft(sprint.finishDate);
  return (
    <button
      type="button"
      className={connection.status === 'ok' ? 'home-card' : 'home-card is-stale-data'}
      aria-label={`${connection.name}/${connection.project}, ${sprint.name}`}
      onClick={() => {
        track('home.clicked', { band: 'sprint' });
        setConnectionId(connection.connectionId);
        go({ kind: 'sprint' });
      }}
    >
      <span className="home-card-title">{connection.name}/{connection.project} · {sprint.name}</span>
      <span className="muted small">
        {left && `${left} · `}{t.todo} to do · {t.doing} in progress · {t.done} done
      </span>
      <span className="small">
        {formatDuration(t.spentSeconds)}
        {t.estimateHours !== null && ` / ${formatDuration(t.estimateHours * 3600)}`}
      </span>
      {pct !== null && <TimeBar pct={pct} over={over} />}
    </button>
  );
}

export function SprintsBand({ snapshot }: { snapshot: HomeSnapshot | null }) {
  const repos = useStore((s) => s.repos);
  const connections = snapshot?.connections ?? [];
  const [local, setLocal] = useState<Record<string, Record<string, LocalItemTime>>>({});
  const ids = connections.filter((c) => c.sprints.length > 0).map((c) => c.connectionId).join(',');
  useEffect(() => {
    let live = true;
    for (const id of ids ? ids.split(',') : [])
      api()
        .invoke('time:sprint', id)
        .then((t) => live && setLocal((l) => ({ ...l, [id]: t })))
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ids]);
  const linked = new Set(repos.filter((r) => !r.discovered).map((r) => r.connectionId));
  const cards = connections.flatMap((c) =>
    c.sprints.map((s) => (
      <SprintCard key={`${c.connectionId}:${s.iterationId}`} connection={c} sprint={s} local={local[c.connectionId] ?? {}} />
    )),
  );
  const empty = connections.filter(
    (c) => c.status === 'ok' && c.sprints.length === 0 && !c.sprintsError && linked.has(c.connectionId),
  );
  return (
    <Band title="My sprints">
      <div className="home-cards">
        {cards}
        {empty.map((c) => (
          <div key={c.connectionId} className="home-card is-slim muted">
            {c.name}/{c.project}: nothing assigned
          </div>
        ))}
      </div>
      {cards.length === 0 && empty.length === 0 && (
        <p className="muted">Nothing assigned to you in a current sprint.</p>
      )}
      {connections.filter((c) => c.sprintsError).map((c) => (
        <p key={c.connectionId} className="muted small">
          Couldn't load sprints for {c.name}/{c.project}
        </p>
      ))}
    </Band>
  );
}
```

Add `.home-card.is-slim { cursor: default; padding: 4px 10px; }` to `home.css`. In `HomeScreen.tsx`, replace the "My sprints" placeholder with `{snapshot ? <SprintsBand snapshot={snapshot} /> : <Band title="My sprints"><p className="muted">Loading</p></Band>}`.

Check `formatDuration(6 * 3600)` renders `6h` (`shared/time.ts:178`); adjust the test's `'/ 6h'` to its real output if it differs.

- [ ] **Step 6: Run tests, typecheck, lint, commit**

Run: `npm test && npm run typecheck && npm run lint` → PASS.

```bash
git add -A src/renderer
git commit -m "feat: Home My sprints band with state counts and spent/estimate"
```

---

### Task 9: Stats band

**Files:**
- Create: `src/renderer/hooks/useHomeStats.ts`, `src/renderer/components/home/StatsBand.tsx`
- Modify: `src/renderer/screens/HomeScreen.tsx`
- Test: `src/renderer/components/home/StatsBand.test.tsx`

**Interfaces:**
- Consumes: `home:stats` (Task 4); events `usage:changed`, `time:changed`, `tasks:changed`; `eur`, `formatDuration` (`format.ts`).
- Produces: `useHomeStats(period: HomePeriod): HomeStats | null`; `StatsBand()`.

- [ ] **Step 1: Write the failing test**

`src/renderer/components/home/StatsBand.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { HomeStats } from '../../../shared/home';
import { useStore } from '../../store';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { StatsBand } from './StatsBand';

const stats = (over: Partial<HomeStats> = {}): HomeStats => ({
  period: 'week', from: '', to: '', costEur: 41.2,
  costByTool: { 'claude-code': 30, 'copilot-cli': 11.2 },
  costByConnection: [{ connectionId: 'c1', costEur: 41.2 }],
  activeSeconds: 18 * 3600, agentSeconds: 11 * 3600,
  accuracy: 1.12, accuracyTasks: 3, tasksFinished: 6, prsOpened: 4, ...over,
});

beforeEach(() => useStore.setState({ connections: [{ id: 'c1', name: 'uw', project: 'MIAC' } as never] }));

describe('StatsBand', () => {
  it('shows the week tiles', async () => {
    installFakeApi({ 'home:stats': (period) => stats({ period }) });
    render(<StatsBand />);
    expect(await screen.findByText('€41.20')).toBeTruthy();
    expect(screen.getByText('112%')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByTitle(/Claude Code €30.00.*Copilot CLI €11.20.*uw\/MIAC €41.20/s)).toBeTruthy();
  });

  it('the month toggle asks for the month', async () => {
    const { calls } = installFakeApi({ 'home:stats': (period) => stats({ period }) });
    render(<StatsBand />);
    await userEvent.click(await screen.findByRole('button', { name: 'This month' }));
    expect(calls.filter((c) => c.channel === 'home:stats').map((c) => c.args[0])).toEqual(['week', 'month']);
    expect(screen.getByRole('button', { name: 'This month' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows a dash without accuracy', async () => {
    installFakeApi({ 'home:stats': () => stats({ accuracy: null, accuracyTasks: 0 }) });
    render(<StatsBand />);
    expect(await screen.findByText('–')).toBeTruthy();
  });
});
```

Check how `eur()` formats (`format.ts:5`); if it renders `€ 41,20` or similar, change the expected strings to match its real output.

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/renderer/components/home/StatsBand.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hook and the band**

`src/renderer/hooks/useHomeStats.ts`:

```ts
import { useEffect, useState } from 'react';
import type { HomePeriod, HomeStats } from '../../shared/home';
import { api } from '../api';

/** Changes arrive every few seconds while an agent runs; stats refetch at most this often. */
const REFETCH_MS = 5_000;

/** The developer's stats for the period, refetched (throttled) when usage, time or tasks change. */
export function useHomeStats(period: HomePeriod): HomeStats | null {
  const [stats, setStats] = useState<HomeStats | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () =>
      api()
        .invoke('home:stats', period)
        .then((s) => live && setStats(s))
        .catch(() => undefined);
    const later = () => {
      timer ??= setTimeout(() => {
        timer = null;
        void load();
      }, REFETCH_MS);
    };
    void load();
    const offs = [
      api().on('usage:changed', later),
      api().on('time:changed', later),
      api().on('tasks:changed', later),
    ];
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      offs.forEach((off) => off());
    };
  }, [period]);
  return stats;
}
```

`src/renderer/components/home/StatsBand.tsx`:

```tsx
import { useState } from 'react';
import type { HomePeriod } from '../../../shared/home';
import { eur, formatDuration } from '../../format';
import { useHomeStats } from '../../hooks/useHomeStats';
import { Band } from '../../screens/HomeScreen';
import { useStore } from '../../store';
import { track } from '../../telemetry';

function Tile({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="home-tile" title={title}>
      <span className="muted small">{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function StatsBand() {
  const [period, setPeriod] = useState<HomePeriod>('week');
  const stats = useHomeStats(period);
  const connections = useStore((s) => s.connections);
  const nameOf = (id: string | null) => {
    const c = connections.find((x) => x.id === id);
    return c ? `${c.name}/${c.project}` : 'No connection';
  };
  const choose = (p: HomePeriod) => {
    track('home.clicked', { band: 'stats-period' });
    setPeriod(p);
  };
  return (
    <Band title="Stats">
      <div className="home-period" role="group" aria-label="Period">
        <button type="button" aria-pressed={period === 'week'} onClick={() => choose('week')}>This week</button>
        <button type="button" aria-pressed={period === 'month'} onClick={() => choose('month')}>This month</button>
      </div>
      {stats && (
        <div className="home-tiles">
          <Tile
            label="AI cost"
            value={eur(stats.costEur)}
            title={[
              `Claude Code ${eur(stats.costByTool['claude-code'])}`,
              `Copilot CLI ${eur(stats.costByTool['copilot-cli'])}`,
              ...stats.costByConnection.map((c) => `${nameOf(c.connectionId)} ${eur(c.costEur)}`),
            ].join('\n')}
          />
          <Tile label="Active time" value={formatDuration(stats.activeSeconds)} />
          <Tile label="Agent time" value={formatDuration(stats.agentSeconds)} />
          <Tile
            label="Estimate accuracy"
            value={stats.accuracy === null ? '–' : `${Math.round(stats.accuracy * 100)}%`}
            title={stats.accuracyTasks ? `Booked over estimate, ${stats.accuracyTasks} finished tasks` : 'No finished task with an estimate'}
          />
          <Tile label="Tasks finished" value={String(stats.tasksFinished)} />
          <Tile label="PRs opened" value={String(stats.prsOpened)} />
        </div>
      )}
    </Band>
  );
}
```

Add to `home.css`:

```css
.home-period { display: inline-flex; gap: 4px; margin-bottom: 8px; }
.home-period button { background: none; border: 1px solid var(--border); border-radius: 2px; color: inherit; font: inherit; padding: 2px 10px; cursor: pointer; }
.home-period button[aria-pressed='true'] { background: var(--accent); border-color: var(--accent); color: #fff; }
.home-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
.home-tile { display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--border); border-radius: 4px; padding: 8px 10px; }
.home-tile b { font-size: 18px; }
```

In `HomeScreen.tsx`, replace the "Stats" placeholder with `<StatsBand />`. Update the `HomeScreen` empty-state test if it asserted the placeholder text "No activity yet.".

- [ ] **Step 4: Run tests, typecheck, lint, commit**

Run: `npm test && npm run typecheck && npm run lint` → PASS.

```bash
git add -A src/renderer
git commit -m "feat: Home stats band for this week or month"
```

---

### Task 10: Docs and the live check

**Files:**
- Modify: `CLAUDE.md` (Status), `docs/superpowers/specs/2026-10-17-home-dashboard-design.md` (live-check result line)

- [ ] **Step 1: Seed the test org for the check**

With the test org PAT read in-process (never on a command line), create in `unreliablewitness/MIAC`: one active PR with the token's user as a named reviewer, and one with `MIAC Team` as reviewer and the user not named. Assign one Sprint 1 item in `To Do` to the user. Use a small Node script in the scratchpad that reads the PAT with `security find-generic-password -a miac -s miac-ado-unreliablewitness -w` via `execFileSync` and calls the REST API with `fetch`; print only status codes.

- [ ] **Step 2: Click through the packaged app**

Run `npm run package` (or `npm start` if packaging is not needed for the check) and assert, in order:
1. The app opens on Home; the breadcrumb reads MIAC › Home.
2. Reviews for me lists the named PR; Team requests (1) expands to the team PR.
3. My sprints shows `uw/MIAC · Sprint 1` with the item counted under to do.
4. Up next lists the item; Start creates the task and opens Setup; back on Home the item is gone from Up next and the task is in My tasks.
5. Refresh updates "Updated just now".
6. A second connection with a revoked or wrong PAT turns its chip red, shows the refused-token line, and the first connection still updates.
7. Stats: the week toggle and month toggle both load.

Record the results (pass or the failure) in the spec under "Testing", as "Live check 2026-10-xx: …".

- [ ] **Step 3: Update `CLAUDE.md` status**

Add one sentence to the Status section: Home (spec `docs/superpowers/specs/2026-10-17-home-dashboard-design.md`) implemented on `feature/home-dashboard`: the app opens on a cross-connection Home page (my tasks with Up next, reviews and team requests, my PRs, my sprints, week/month stats), backed by `HomeService` in main with a cached `home.json`; and add the known gaps (team requests cover ADO teams only, Up next reads current sprints only).

- [ ] **Step 4: Full checks and commit**

```bash
npm test && npm run typecheck && npm run lint
git add CLAUDE.md docs/superpowers/specs/2026-10-17-home-dashboard-design.md
git commit -m "docs: Home dashboard status and live check"
```
