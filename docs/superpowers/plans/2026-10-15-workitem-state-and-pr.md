# Work item state on start and draft PR on Finish: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- **Start:** a task's setup moves its Azure DevOps work item to In Progress, and assigns it to the user if nobody has it.
- **Finish:** Finish can push the branch and create a draft Azure Repos pull request linked to the work item. Finish opens the pull request in the browser, and the Done page shows it.

**Architecture:**
- **Pure logic:** two modules. `azureRepos.ts` covers remote parsing, PR availability, the target branch and the PR description. `workItemStart.ts` plans the start update.
- **Azure DevOps and git calls:** new methods on `AdoClient` (REST, PAT) and `GitClient` (remote URL, push).
- **Wiring:** in `src/main/ipc/handlers.ts`:
  - a new setup step `work-item`, with a non-fatal `warn` status;
  - an extended `tasks:finish`;
  - two new IPC channels.
- **Renderer:** a checkbox and an error state on the Finish page, a PR fact on the Done page, and repo toggles in Settings.

**Tech stack:** Electron, TypeScript, React, zustand, zod, Vitest and Testing Library, Azure DevOps REST api-version 7.1.

**Spec:** `docs/superpowers/specs/2026-10-15-workitem-state-and-pr-design.md`. Read it before starting any task.

## Global constraints

- Azure DevOps REST calls use `api-version=7.1` and go through `AdoClient.request`, which handles the PAT, timeouts, 429 and redirect refusal. Writes pass `{ write: true }`.
- The PAT is never logged, printed or sent anywhere but the connection's organization URL.
- **State is only ever moved forward from category `Proposed`.** Finish never changes the work item state.
- **PRs are always created with `isDraft: true`.** MIAC never force-pushes.
- **A failed start update never fails the setup.** The step ends with status `warn`.
- **A failed push or PR call stops Finish before any cleanup.** The task goes back to `ready`.
- **Error messages:**
  - Work item write denied: `The token cannot update work items (needs Work Items: Read & write)`. This is the existing `WRITE_DENIED`.
  - Code write denied: `The token cannot create pull requests (needs Code: Read & write)`.
- **PR description:** at most 4000 characters.
- **Schema changes:** all optional or defaulted, so existing `state.json` and `connections.json` files load unchanged.
- **Telemetry:** event names and properties only. No titles, names, ids or URLs. Update `docs/telemetry.md`.
- **Checks:** `npm test`, `npm run typecheck` and `npm run lint` (oxlint plus `oxfmt --check`) pass after every task. Format with `npx oxfmt <files>`, never prettier.
- **Commits:** end with these trailers:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015KciGjTpgSkbzuCQD9ChUq
  ```

## Review focus

1. **An `origin` URL with a user part, `.git` suffix or `DefaultCollection` segment** (`https://org@dev.azure.com/org/P/_git/R`, `https://org.visualstudio.com/DefaultCollection/P/_git/R.git`) must parse as Azure Repos. Pinned in the Task 1 tests.
2. **A work item already in progress, or resolved, when its task starts** must not be moved, and the setup step reads "Already in progress", or "No change (Resolved)" for later categories. Pinned in the Task 2 tests.
3. **A branch whose PR is already open**, for example made by hand before Finish, must be linked, not duplicated. Pinned in the Task 6 tests.
4. **Push rejected (non-fast-forward)**: Finish stops, the worktree and terminals are intact, the task is `ready`, and the git message is shown. Pinned in the Task 6 tests.
5. **A base ref without a remote prefix** (`main`, not `origin/main`) targets `refs/heads/main`. **A base of `upstream/dev`** targets `refs/heads/dev`. Pinned in the Task 1 tests.

---

### Task 1: Azure Repos helpers (pure)

**Files:**
- Create: `src/main/services/azureRepos.ts`
- Test: `src/main/services/azureRepos.test.ts`

**Interfaces:**
- Produces:
  - `parseAzureReposRemote(url: string): AzureRepoRef | null`
  - `organizationOf(orgUrl: string): string | null`
  - `prAvailability(input: { remoteUrl: string | null; connectionOrgUrl: string | null }): PrAvailability`
  - `targetBranch(baseRef: string, remotes: string[]): string`
  - `prDescription(input: PrDescriptionInput): string`
  - `prTitle(task: { workItem: { id: string; title: string } | null; name: string }): string`
  - `prWebUrl(orgUrl: string, project: string, repo: string, id: number): string`
  - The types `AzureRepoRef = { org: string; project: string; repo: string }` and `PrAvailability = { available: boolean; reason: string | null; target: AzureRepoRef | null }`.

- [ ] **Step 1: Write the failing tests** in `src/main/services/azureRepos.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  organizationOf,
  parseAzureReposRemote,
  prAvailability,
  prDescription,
  prTitle,
  prWebUrl,
  targetBranch,
} from './azureRepos';

describe('parseAzureReposRemote', () => {
  const ref = { org: 'contoso', project: 'Web Shop', repo: 'DXP' };
  it.each([
    'https://dev.azure.com/contoso/Web%20Shop/_git/DXP',
    'https://contoso@dev.azure.com/contoso/Web%20Shop/_git/DXP',
    'https://dev.azure.com/contoso/Web%20Shop/_git/DXP.git',
    'https://dev.azure.com/contoso/Web%20Shop/_git/DXP/',
    'https://contoso.visualstudio.com/Web%20Shop/_git/DXP',
    'https://contoso.visualstudio.com/DefaultCollection/Web%20Shop/_git/DXP',
    'git@ssh.dev.azure.com:v3/contoso/Web%20Shop/DXP',
    'ssh://git@ssh.dev.azure.com/v3/contoso/Web%20Shop/DXP',
    'contoso@vs-ssh.visualstudio.com:v3/contoso/Web%20Shop/DXP',
  ])('parses %s', (url) => {
    expect(parseAzureReposRemote(url)).toEqual(ref);
  });
  it.each([
    'https://github.com/contoso/dxp.git',
    'git@github.com:contoso/dxp.git',
    '/Users/me/origin.git',
    '',
    'https://dev.azure.com/contoso/_git',
  ])('rejects %s', (url) => {
    expect(parseAzureReposRemote(url)).toBeNull();
  });
});

describe('organizationOf', () => {
  it('reads both URL styles, lower-cased', () => {
    expect(organizationOf('https://dev.azure.com/Contoso')).toBe('contoso');
    expect(organizationOf('https://dev.azure.com/contoso/')).toBe('contoso');
    expect(organizationOf('https://Contoso.visualstudio.com')).toBe('contoso');
    expect(organizationOf('not a url')).toBeNull();
  });
});

describe('prAvailability', () => {
  const remote = 'https://dev.azure.com/contoso/P/_git/R';
  it('is available for a remote in the connection org', () => {
    expect(
      prAvailability({
        remoteUrl: remote,
        connectionOrgUrl: 'https://dev.azure.com/Contoso',
      }),
    ).toEqual({
      available: true,
      reason: null,
      target: { org: 'contoso', project: 'P', repo: 'R' },
    });
  });
  it('explains why not', () => {
    expect(
      prAvailability({ remoteUrl: remote, connectionOrgUrl: null }).reason,
    ).toBe('this repo has no Azure DevOps connection');
    expect(
      prAvailability({
        remoteUrl: 'https://github.com/a/b',
        connectionOrgUrl: 'https://dev.azure.com/contoso',
      }).reason,
    ).toBe('origin is not an Azure Repos URL');
    expect(
      prAvailability({
        remoteUrl: null,
        connectionOrgUrl: 'https://dev.azure.com/contoso',
      }).reason,
    ).toBe('origin is not an Azure Repos URL');
    expect(
      prAvailability({
        remoteUrl: remote,
        connectionOrgUrl: 'https://dev.azure.com/fabrikam',
      }).reason,
    ).toBe('origin is in another Azure DevOps organization');
  });
});

describe('targetBranch', () => {
  it('strips a known remote prefix only', () => {
    expect(targetBranch('origin/main', ['origin'])).toBe('main');
    expect(targetBranch('upstream/dev', ['origin', 'upstream'])).toBe('dev');
    expect(targetBranch('main', ['origin'])).toBe('main');
    expect(targetBranch('feature/x', ['origin'])).toBe('feature/x');
  });
});

describe('prTitle', () => {
  it('uses id and title, or the task name', () => {
    expect(prTitle({ workItem: { id: '42', title: 'Fix it' }, name: '' })).toBe(
      '42 Fix it',
    );
    expect(prTitle({ workItem: null, name: 'Spike' })).toBe('Spike');
  });
});

describe('prWebUrl', () => {
  it('encodes project and repo', () => {
    expect(prWebUrl('https://dev.azure.com/contoso/', 'Web Shop', 'DXP', 7)).toBe(
      'https://dev.azure.com/contoso/Web%20Shop/_git/DXP/pullrequest/7',
    );
  });
});

describe('prDescription', () => {
  const base = {
    heading: 'Bug 42: Fix it',
    commits: [
      { sha: 'abc1234', subject: 'First' },
      { sha: 'def5678', subject: 'Second' },
    ],
    commitCount: 2,
    costLine: 'AI cost for this task: €1.00 (Claude €1.00, Copilot €0.00)',
  };
  it('lists commits and the cost line', () => {
    expect(prDescription(base)).toBe(
      'Bug 42: Fix it\n\n## Commits\n- abc1234 First\n- def5678 Second\n\nAI cost for this task: €1.00 (Claude €1.00, Copilot €0.00) · recorded by MIAC',
    );
  });
  it('mentions commits beyond the list', () => {
    expect(prDescription({ ...base, commitCount: 5 })).toContain(
      '…and 3 more commits',
    );
  });
  it('stays within 4000 characters by dropping commits', () => {
    const commits = Array.from({ length: 300 }, (_, i) => ({
      sha: `s${String(i).padStart(6, '0')}`,
      subject: 'x'.repeat(40),
    }));
    const text = prDescription({ ...base, commits, commitCount: 300 });
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toMatch(/…and \d+ more commits/);
    expect(text.endsWith('· recorded by MIAC')).toBe(true);
  });
  it('omits the commits section when there are none', () => {
    expect(prDescription({ ...base, commits: [], commitCount: 0 })).toBe(
      'Bug 42: Fix it\n\nAI cost for this task: €1.00 (Claude €1.00, Copilot €0.00) · recorded by MIAC',
    );
  });
});
```

- [ ] **Step 2: Run the tests and check that they fail.** Run `npx vitest run src/main/services/azureRepos.test.ts`. Expected: FAIL, cannot find module `./azureRepos`.

- [ ] **Step 3: Implement** `src/main/services/azureRepos.ts`:

```ts
/** Azure Repos remotes, PR availability and PR text. Pure: no I/O. */

export type AzureRepoRef = { org: string; project: string; repo: string };
export type PrAvailability = {
  available: boolean;
  reason: string | null;
  target: AzureRepoRef | null;
};

const PATTERNS = [
  /^https:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+?)(?:\.git)?\/?$/i,
  /^https:\/\/(?:[^@/]+@)?([^./@]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+?)(?:\.git)?\/?$/i,
  /^(?:ssh:\/\/)?git@ssh\.dev\.azure\.com[:/]v3\/([^/]+)\/([^/]+)\/([^/]+?)\/?$/i,
  /^(?:ssh:\/\/)?[^@/]+@vs-ssh\.visualstudio\.com[:/]v3\/([^/]+)\/([^/]+)\/([^/]+?)\/?$/i,
];

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function parseAzureReposRemote(url: string): AzureRepoRef | null {
  const trimmed = url.trim();
  for (const re of PATTERNS) {
    const m = re.exec(trimmed);
    if (m && m[3] !== '_git')
      return {
        org: decode(m[1]).toLowerCase(),
        project: decode(m[2]),
        repo: decode(m[3]),
      };
  }
  return null;
}

/** The organization name of a connection URL (`https://dev.azure.com/<org>` or `https://<org>.visualstudio.com`). */
export function organizationOf(orgUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(orgUrl);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === 'dev.azure.com')
    return u.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? null;
  if (host.endsWith('.visualstudio.com'))
    return host.slice(0, -'.visualstudio.com'.length);
  return null;
}

export function prAvailability(input: {
  remoteUrl: string | null;
  connectionOrgUrl: string | null;
}): PrAvailability {
  const no = (reason: string): PrAvailability => ({
    available: false,
    reason,
    target: null,
  });
  if (!input.connectionOrgUrl)
    return no('this repo has no Azure DevOps connection');
  const target = input.remoteUrl ? parseAzureReposRemote(input.remoteUrl) : null;
  if (!target) return no('origin is not an Azure Repos URL');
  if (organizationOf(input.connectionOrgUrl) !== target.org)
    return no('origin is in another Azure DevOps organization');
  return { available: true, reason: null, target };
}

/** `origin/main` -> `main` when `origin` is a remote; anything else is already a branch name. */
export function targetBranch(baseRef: string, remotes: string[]): string {
  const slash = baseRef.indexOf('/');
  if (slash > 0 && remotes.includes(baseRef.slice(0, slash)))
    return baseRef.slice(slash + 1);
  return baseRef;
}

export function prTitle(task: {
  workItem: { id: string; title: string } | null;
  name: string;
}): string {
  return task.workItem
    ? `${task.workItem.id} ${task.workItem.title}`.trim()
    : task.name;
}

export function prWebUrl(
  orgUrl: string,
  project: string,
  repo: string,
  id: number,
): string {
  return `${orgUrl.replace(/\/+$/, '')}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${id}`;
}

export const PR_DESCRIPTION_MAX = 4000;

export type PrDescriptionInput = {
  /** e.g. "Bug 42: Fix it", or the task name for a blank task. */
  heading: string;
  commits: { sha: string; subject: string }[];
  /** All commits on the branch; may exceed `commits.length`. */
  commitCount: number;
  /** e.g. "AI cost for this task: €1.00 (Claude €1.00, Copilot €0.00)". */
  costLine: string;
};

export function prDescription(input: PrDescriptionInput): string {
  const footer = `${input.costLine} · recorded by MIAC`;
  const build = (n: number): string => {
    if (input.commits.length === 0 && input.commitCount === 0)
      return `${input.heading}\n\n${footer}`;
    const lines = input.commits
      .slice(0, n)
      .map((c) => `- ${c.sha} ${c.subject}`);
    const more = input.commitCount - n;
    if (more > 0) lines.push(`- …and ${more} more commits`);
    return `${input.heading}\n\n## Commits\n${lines.join('\n')}\n\n${footer}`;
  };
  for (let n = input.commits.length; n >= 0; n--) {
    const text = build(n);
    if (text.length <= PR_DESCRIPTION_MAX) return text;
  }
  return `${input.heading}\n\n${footer}`.slice(0, PR_DESCRIPTION_MAX);
}
```

- [ ] **Step 4: Run the tests and check that they pass.** Run `npx vitest run src/main/services/azureRepos.test.ts`. Expected: PASS. If the 300-commit case fails, check the `n` loop: it must drop commits from the end until the text fits.

- [ ] **Step 5: Commit.** Run `npx oxfmt src/main/services/azureRepos.ts src/main/services/azureRepos.test.ts`, then:

```bash
git add src/main/services/azureRepos.ts src/main/services/azureRepos.test.ts
git commit -m "feat: Azure Repos remote parsing, PR availability and PR text"
```

---

### Task 2: Start update planner (pure)

**Files:**
- Create: `src/main/services/workItemStart.ts`
- Test: `src/main/services/workItemStart.test.ts`

**Interfaces:**
- Consumes: the `WorkItemStateMeta` shape `{ name: string; color: string | null; category: string | null }` from `src/shared/types.ts`, which already exists.
- Produces:
  - `type StartSettings = { moveToInProgress: boolean; assignToMe: boolean; stateOverrides: Record<string, string> }`
  - `type StartCurrent = { type: string; state: string; assignedTo: string | null }`
  - `type StartPlan = { state: string | null; assignTo: string | null; detail: string }`
  - `planStartUpdate(current: StartCurrent, states: { name: string; category: string | null }[], settings: StartSettings, user: string | null): StartPlan`

- [ ] **Step 1: Write the failing tests:**

```ts
import { describe, expect, it } from 'vitest';
import { planStartUpdate } from './workItemStart';

const states = [
  { name: 'New', category: 'Proposed' },
  { name: 'Approved', category: 'Proposed' },
  { name: 'Committed', category: 'InProgress' },
  { name: 'In Progress', category: 'InProgress' },
  { name: 'Ready for validation', category: 'Resolved' },
  { name: 'Done', category: 'Completed' },
];
const on = { moveToInProgress: true, assignToMe: true, stateOverrides: {} };
const cur = (state: string, assignedTo: string | null = null) => ({
  type: 'Task',
  state,
  assignedTo,
});

describe('planStartUpdate', () => {
  it('moves a proposed item to the first In Progress state and assigns it', () => {
    expect(planStartUpdate(cur('New'), states, on, 'me@x.com')).toEqual({
      state: 'Committed',
      assignTo: 'me@x.com',
      detail: 'New → Committed, assigned to you',
    });
  });
  it('honours a per-type override that exists', () => {
    const s = { ...on, stateOverrides: { Task: 'In Progress' } };
    expect(planStartUpdate(cur('New', 'Someone'), states, s, 'me').state).toBe(
      'In Progress',
    );
  });
  it('falls back to the default when the override is not a state of the type', () => {
    const s = { ...on, stateOverrides: { Task: 'Doing' } };
    expect(planStartUpdate(cur('New', 'Someone'), states, s, 'me').state).toBe(
      'Committed',
    );
  });
  it('never moves an item that is already in progress or further', () => {
    expect(planStartUpdate(cur('In Progress', 'A'), states, on, 'me')).toEqual({
      state: null,
      assignTo: null,
      detail: 'Already in progress',
    });
    expect(
      planStartUpdate(cur('Ready for validation', 'A'), states, on, 'me').detail,
    ).toBe('No change (Ready for validation)');
    expect(planStartUpdate(cur('Done', 'A'), states, on, 'me').state).toBeNull();
  });
  it('assigns without moving when already in progress and unassigned', () => {
    expect(planStartUpdate(cur('In Progress'), states, on, 'me')).toEqual({
      state: null,
      assignTo: 'me',
      detail: 'Assigned to you',
    });
  });
  it('respects the toggles and a missing user', () => {
    const off = { ...on, moveToInProgress: false, assignToMe: false };
    expect(planStartUpdate(cur('New'), states, off, 'me')).toEqual({
      state: null,
      assignTo: null,
      detail: 'No change',
    });
    expect(planStartUpdate(cur('New'), states, on, null).assignTo).toBeNull();
  });
  it('does not move when the type has no In Progress state', () => {
    const only = [
      { name: 'New', category: 'Proposed' },
      { name: 'Done', category: 'Completed' },
    ];
    expect(planStartUpdate(cur('New', 'A'), only, on, 'me').detail).toBe(
      'No In Progress state for Task',
    );
  });
});
```

- [ ] **Step 2: Run the tests and check that they fail.** Run `npx vitest run src/main/services/workItemStart.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/main/services/workItemStart.ts`:

```ts
/** What starting a task changes on its work item. Pure: the caller reads the item and its states, and writes the plan. */

export type StartSettings = {
  moveToInProgress: boolean;
  assignToMe: boolean;
  /** Work item type -> state name; empty means the type's first In Progress state. */
  stateOverrides: Record<string, string>;
};
export type StartCurrent = {
  type: string;
  state: string;
  assignedTo: string | null;
};
export type StartPlan = {
  state: string | null;
  assignTo: string | null;
  detail: string;
};

const ARROW = String.fromCharCode(0x2192);

export function planStartUpdate(
  current: StartCurrent,
  states: { name: string; category: string | null }[],
  settings: StartSettings,
  user: string | null,
): StartPlan {
  const category =
    states.find((s) => s.name === current.state)?.category ?? null;
  const assignTo =
    settings.assignToMe && user && !current.assignedTo ? user : null;
  let state: string | null = null;
  let note: string | null = null;
  if (settings.moveToInProgress) {
    if (category === 'Proposed') {
      const override = settings.stateOverrides[current.type];
      const target =
        (override &&
          states.find(
            (s) => s.name === override && s.category === 'InProgress',
          )) ||
        states.find((s) => s.category === 'InProgress');
      if (target) state = target.name;
      else note = `No In Progress state for ${current.type}`;
    } else if (category === 'InProgress') note = 'Already in progress';
    else note = `No change (${current.state})`;
  }
  const parts: string[] = [];
  if (state) parts.push(`${current.state} ${ARROW} ${state}`);
  if (assignTo) parts.push(parts.length ? 'assigned to you' : 'Assigned to you');
  const detail = parts.length ? parts.join(', ') : (note ?? 'No change');
  return { state, assignTo, detail };
}
```

- [ ] **Step 4: Run the tests and check that they pass.** Expected: PASS. The case "assigns without moving when already in progress" expects the detail `Assigned to you`, because a plan that does something reports that, not the note.

- [ ] **Step 5: Format and commit:** `git commit -m "feat: plan the work item update when a task starts"`.

---

### Task 3: Schemas, types, IPC contracts, and the connection's unique name

**Files:**
- Modify: `src/shared/types.ts`
  - `RepoSchema`, around line 60
  - `TaskSchema`, around line 40
  - `ConnectionSchema`, around line 174
  - `FinishOptions`
  - `SetupStepKind`
  - `SetupStepStatus`
- Modify: `src/shared/ipc.ts`, the handler map around lines 34-110.
- Modify: `src/main/services/AdoClient.ts`, `verify()` around line 112.
- Modify: `src/main/services/ConnectionStore.ts`, `setStatus`, so it stores `userUniqueName`.
- Modify: `src/main/ipc/handlers.ts`, `verifyConnection` around line 176.
- Modify: `src/main/services/RepoRegistry.ts`: add `setWorkItemOnStart`.
- Modify: `src/renderer/test-helpers/fakeApi.ts`: add defaults for the new channels.
- Tests:
  - `src/main/services/TaskStore.test.ts`
  - `src/main/services/ConnectionStore.test.ts`
  - `src/main/services/AdoClient.test.ts`
  - `src/main/services/RepoRegistry.test.ts`

**Interfaces:**
- Produces:
  - `RepoSchema.workItemOnStart: StartSettings`, defaulted.
  - `TaskSchema.pullRequest: PullRequestRef | null`, where `PullRequestRef = { id: number; url: string; repositoryId: string; project: string; repo: string; status: 'active' | 'completed' | 'abandoned'; isDraft: boolean }`.
  - `ConnectionSchema.userUniqueName: string | null`.
  - `FinishOptions.createPullRequest?: boolean`.
  - `SetupStepKind` gains `'work-item'`.
  - `SetupStepStatus` gains `'warn'`.
  - `AdoClient.verify()` now returns `{ user: string; uniqueName: string | null }`.
  - `RepoRegistry.setWorkItemOnStart(repoId, settings): Promise<Repo>`.
  - IPC:
    - `'tasks:prAvailability': { args: [taskId: string]; result: { available: boolean; reason: string | null; target: string | null } }`, where `target` is the target branch name.
    - `'tasks:prStatus': { args: [taskId: string]; result: PullRequestRef | null }`.
    - `'repos:setWorkItemOnStart': { args: [repoId: string, settings: StartSettings]; result: Repo }`.
  - `StartSettingsSchema` is exported from `src/shared/types.ts` and reused by `workItemStart.ts`. In Task 2's module, replace the hand-written `StartSettings` type with `export type { StartSettings } from '../../shared/types'`.

- [ ] **Step 1: Write the failing tests.**
  - In `TaskStore.test.ts`, add: "loads a task without pullRequest", reading a state fixture whose task lacks the field, and expect `pullRequest` to be `null`.
  - In `RepoRegistry.test.ts`, add: "loads a repo without workItemOnStart". Expect `{ moveToInProgress: true, assignToMe: true, stateOverrides: {} }`.
  - In `RepoRegistry.test.ts`, also add: "setWorkItemOnStart persists". Call it with `{ moveToInProgress: false, assignToMe: true, stateOverrides: { Task: 'Doing' } }`, reload the registry, and expect the same value.
  - In `AdoClient.test.ts`, add: "verify returns the unique name". The fake `connectionData` returns `{ authenticatedUser: { providerDisplayName: 'Me', properties: { Account: { $value: 'me@x.com' } } } }`. Expect `{ user: 'Me', uniqueName: 'me@x.com' }`. When `properties` is missing, expect `uniqueName: null`.
  - In `ConnectionStore.test.ts`, add: "setStatus stores userUniqueName", and expect the old file to load with `userUniqueName: null`.

  Use the existing tests in each file as the pattern for fixtures and fakes.

- [ ] **Step 2: Run the tests and check that they fail.** Run `npx vitest run src/main/services`. Expected: the new tests FAIL. Either the property is undefined, or `setWorkItemOnStart` is not a function.

- [ ] **Step 3: Implement.**

In `src/shared/types.ts`:

```ts
export const StartSettingsSchema = z.object({
  moveToInProgress: z.boolean().default(true),
  assignToMe: z.boolean().default(true),
  /** Work item type -> state name. Empty means the type's first In Progress state. */
  stateOverrides: z.record(z.string(), z.string()).default({}),
});
export type StartSettings = z.infer<typeof StartSettingsSchema>;

export const PullRequestRefSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  repositoryId: z.string(),
  project: z.string(),
  repo: z.string(),
  status: z.enum(['active', 'completed', 'abandoned']),
  isDraft: z.boolean(),
});
export type PullRequestRef = z.infer<typeof PullRequestRefSchema>;
```

Then:
- In `TaskSchema`, add `pullRequest: PullRequestRefSchema.nullable().default(null),`.
- In `RepoSchema`, add `workItemOnStart: StartSettingsSchema.default({ moveToInProgress: true, assignToMe: true, stateOverrides: {} }),`.
- In `ConnectionSchema`, add `userUniqueName: z.string().nullable().default(null),`.
- In `FinishOptions`, add `createPullRequest?: boolean;`.
- Add `'work-item'` to `SetupStepKind`.
- Change `SetupStepStatus` to `'todo' | 'running' | 'done' | 'warn' | 'failed'`.

Fix every type error that follows:
- Every place that creates a `Repo` must include `workItemOnStart`: `RepoRegistry.describe`, test fixtures and `fakeApi`. Use the default object.
- Everything that creates a `Task` must include `pullRequest: null`.
- `ICON` in `StepList.tsx` needs a `warn` entry. Add `warn: String.fromCharCode(0x26a0)` there. Task 5 styles it.

In `AdoClient.verify()`:

```ts
const auth = data.authenticatedUser as Json | undefined;
const user =
  (auth?.providerDisplayName as string | undefined) ?? 'unknown user';
const account = (
  (auth?.properties as Json | undefined)?.Account as Json | undefined
)?.$value;
// ...existing project check...
return {
  user,
  uniqueName: typeof account === 'string' && account ? account : null,
};
```

In `ConnectionStore.setStatus(id, status, user?, uniqueName?)`: store `userUniqueName` when it is given. In `handlers.ts` `verifyConnection`, destructure `{ user, uniqueName }` and pass both.

In `RepoRegistry`, add the method after `setConnection`, following its pattern:

```ts
async setWorkItemOnStart(repoId: string, settings: StartSettings): Promise<Repo> {
  this.get(repoId);
  const parsed = StartSettingsSchema.parse(settings);
  await this.store.update((s) => {
    const r = s.repos.find((x) => x.id === repoId);
    if (r) r.workItemOnStart = parsed;
  });
  return this.get(repoId);
}
```

`describe()` re-reads a repo. Keep the existing `workItemOnStart` when it rebuilds the object; don't reset it to the defaults.

In `src/shared/ipc.ts`, add the three channel contracts listed under Interfaces. In `handlers.ts`, implement `'repos:setWorkItemOnStart'` now: call the registry, then `s.broadcast('repos:changed', s.repos.list())`, then return the repo. Tasks 6 and 7 implement the other two channels; until then, add stubs that throw `new Error('not implemented')` so the handler map typechecks. In `fakeApi.ts`, add:
- `'tasks:prAvailability'` returning `{ available: false, reason: 'origin is not an Azure Repos URL', target: null }`;
- `'tasks:prStatus'` returning `null`;
- `'repos:setWorkItemOnStart'` echoing a repo.

- [ ] **Step 4: Run all checks.** Run `npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Format and commit:** `git commit -m "feat: schema and IPC for start settings, pull requests and the user's unique name"`.

---

### Task 4: AdoClient and GitClient calls

**Files:**
- Modify: `src/main/services/AdoClient.ts`
- Modify: `src/main/services/GitClient.ts`
- Test: `src/main/services/AdoClient.test.ts`
- Test: `src/main/services/GitClient.test.ts`

**Interfaces:**
- Produces, on `AdoClient`:
  - `workItemForStart(id: number): Promise<{ type: string; state: string; assignedTo: string | null }>`: `GET /_apis/wit/workitems/{id}?fields=System.WorkItemType,System.State,System.AssignedTo`. `assignedTo` is the `uniqueName`, then the `displayName`, then null.
  - `typeStates(project: string, type: string): Promise<{ name: string; category: string | null }[]>`: `GET /{project}/_apis/wit/workitemtypes/{type}/states`.
  - `updateWorkItem(id: number, change: { state?: string; assignedTo?: string }): Promise<void>`: a JSON Patch `add` of `/fields/System.State` and `/fields/System.AssignedTo`, with `{ write: true }`.
  - `repositoryId(project: string, repo: string): Promise<string>`: `GET /{project}/_apis/git/repositories/{repo}`, returns `id`.
  - `findActivePullRequest(project, repositoryId, branch): Promise<RawPr | null>`: `GET /{project}/_apis/git/repositories/{id}/pullrequests?searchCriteria.sourceRefName=refs/heads/{branch}&searchCriteria.status=active`, returns the first or null.
  - `createPullRequest(project, repositoryId, input: { source: string; target: string; title: string; description: string; workItemId: number | null }): Promise<RawPr>`: a POST with `isDraft: true`, `workItemRefs: workItemId ? [{ id: String(workItemId) }] : []`, and `{ write: true, code: true }`.
  - `pullRequest(project, repositoryId, id): Promise<RawPr>`.
  - The type `RawPr = { pullRequestId: number; status: 'active' | 'completed' | 'abandoned'; isDraft: boolean }`.
  - The constant `CODE_WRITE_DENIED = 'The token cannot create pull requests (needs Code: Read & write)'`.
- Produces, on `GitClient`:
  - `remoteUrl(cwd: string, remote: string): Promise<string | null>`: `git remote get-url <remote>`, or null if that fails.
  - `push(cwd: string, remote: string, branch: string): Promise<void>`: `git push -u <remote> <branch>`. Never `--force`. On failure, throw an `Error` whose message is git's stderr, trimmed.

- [ ] **Step 1: Write the failing tests.**
  - **`AdoClient.test.ts`**, using the existing fake-fetch helper in that file. For each new method:
    - check the URL path and query, the method and the body. For `createPullRequest` the body is exactly `{ sourceRefName: 'refs/heads/feature/1-x', targetRefName: 'refs/heads/main', title, description, isDraft: true, workItemRefs: [{ id: '1' }] }`;
    - check the parsed result;
    - a 403 on `createPullRequest` throws `AdoError` with message `CODE_WRITE_DENIED`;
    - a 403 on `updateWorkItem` throws with `WRITE_DENIED`;
    - a 400 whose body is `{"message":"TF401320: Rule Error for field State"}` on `updateWorkItem` throws an `AdoError` whose message contains `TF401320: Rule Error for field State`.
  - **`GitClient.test.ts`**, using its temp-repo helpers with a bare origin, as the existing push-state tests do:
    - `remoteUrl` returns the bare path for `origin` and null for `nope`;
    - `push` creates `origin/<branch>`;
    - `push` after the remote moved ahead (a commit pushed from a second clone) rejects with a message containing `rejected`.

- [ ] **Step 2: Run the tests and check that they fail.** Expected: FAIL, the methods are missing.

- [ ] **Step 3: Implement.**

In `request()`:
- extend the options to `{ write?: boolean; code?: boolean; retried?: boolean }`. For a 401 or 403, the message becomes `opts.code ? CODE_WRITE_DENIED : opts.write ? WRITE_DENIED : <existing read message>`;
- for a `!res.ok` response with a JSON body that has a string `message`, use `Azure DevOps returned ${res.status}: ${message}` as the message. Parse the body before the `!res.ok` throw; `text` is already read there.

Add the methods, following the shape of `updateWorkItemFields` and `addComment`:

```ts
async updateWorkItem(
  id: number,
  change: { state?: string; assignedTo?: string },
): Promise<void> {
  const ops = [
    ...(change.state
      ? [{ op: 'add', path: '/fields/System.State', value: change.state }]
      : []),
    ...(change.assignedTo
      ? [{ op: 'add', path: '/fields/System.AssignedTo', value: change.assignedTo }]
      : []),
  ];
  if (ops.length === 0) return;
  await this.request<Json>(
    `/_apis/wit/workitems/${id}?${API}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json-patch+json' },
      body: JSON.stringify(ops),
    },
    { write: true },
  );
}

async createPullRequest(
  project: string,
  repositoryId: string,
  input: {
    source: string;
    target: string;
    title: string;
    description: string;
    workItemId: number | null;
  },
): Promise<RawPr> {
  return this.request<RawPr>(
    `/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests?${API}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceRefName: `refs/heads/${input.source}`,
        targetRefName: `refs/heads/${input.target}`,
        title: input.title,
        description: input.description,
        isDraft: true,
        workItemRefs: input.workItemId ? [{ id: String(input.workItemId) }] : [],
      }),
    },
    { write: true, code: true },
  );
}
```

For `findActivePullRequest`, read `{ value?: RawPr[] }` and return `value[0] ?? null`. The query parameters must be URL-encoded with `encodeURIComponent` on `refs/heads/<branch>`.

In `GitClient`:

```ts
async remoteUrl(cwd: string, remote: string): Promise<string | null> {
  try {
    return (await this.run(cwd, ['remote', 'get-url', remote])).trim() || null;
  } catch {
    return null;
  }
}

async push(cwd: string, remote: string, branch: string): Promise<void> {
  await this.run(cwd, ['push', '-u', remote, branch]);
}
```

Check how `run` reports failures. If its error message is not git's stderr, wrap the call in try/catch and rethrow `new Error(stderr.trim())`, using the same field `run` already exposes. Check the existing `deleteBranch` and `worktreeRemove` callers for the pattern.

- [ ] **Step 4: Run the tests and check that they pass.** Run `npx vitest run src/main/services/AdoClient.test.ts src/main/services/GitClient.test.ts`. Expected: PASS.

- [ ] **Step 5: Format and commit:** `git commit -m "feat: Azure DevOps work item update and pull request calls; git push and remote URL"`.

---

### Task 5: The `work-item` setup step with a `warn` status

**Files:**
- Modify: `src/main/services/SetupRunner.ts` (`SetupPlan`, `SetupHooks`, `planSteps`, `run`, `execute`)
- Modify: `src/main/ipc/handlers.ts` (`buildPlan`, `runSetup`)
- Modify: `src/renderer/components/StepList.tsx` and its CSS (the step `data-status` rules, in the same stylesheet as `.step[data-status='failed']`)
- Tests:
  - `src/main/services/SetupRunner.test.ts`
  - `src/main/ipc/handlers.test.ts`
  - `src/renderer/components/StepList.test.tsx`

**Interfaces:**
- Consumes:
  - `planStartUpdate` and `StartSettings` (Tasks 2 and 3);
  - `AdoClient.workItemForStart`, `typeStates` and `updateWorkItem` (Task 4);
  - `Connection.userUniqueName` (Task 3).
- Produces:
  - `SetupPlan.updateWorkItem: boolean`;
  - `SetupHooks.updateWorkItem?: () => Promise<{ detail: string; warn: boolean }>`;
  - the step `{ kind: 'work-item', label: 'Update work item', detail: 'Move to In Progress' }`, placed right after `worktree`.

- [ ] **Step 1: Write the failing tests.**

In `SetupRunner.test.ts`:
- `planSteps` with `updateWorkItem: true` puts `work-item` at index 2, after `worktree`. With `false` it is absent.
- When the run's `updateWorkItem` hook resolves `{ detail: 'New → Doing', warn: false }`, the step events end with `{ status: 'done', detail: 'New → Doing' }`.
- When the hook resolves `{ detail: 'The token cannot update work items (needs Work Items: Read & write)', warn: true }`, the step ends with `status: 'warn'`, later steps still run, and the run finishes with `ok: true`.
- When the hook **throws**, the step ends as `warn` with the error message, and the run finishes `ok: true`.

In `handlers.test.ts`, using the existing task-creation test setup with a fake ADO client:
- Creating a task with a work item on a repo with a connection runs the step:
  - the fake `workItemForStart` returns `{ type: 'Task', state: 'To Do', assignedTo: null }`;
  - `typeStates` returns To Do (Proposed), Doing (InProgress), Done (Completed);
  - the connection's `userUniqueName` is `me@x.com`.
  - Expect `updateWorkItem(<id>, { state: 'Doing', assignedTo: 'me@x.com' })`.
- A blank task, or a repo without a connection, has no `work-item` step.
- `workItemOnStart.moveToInProgress: false` with `assignToMe: false` also has no step.

In `StepList.test.tsx`: a step with status `warn` renders `data-status="warn"` and the warn icon.

- [ ] **Step 2: Run the tests and check that they fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

In `planSteps`, after the worktree step:

```ts
if (plan.updateWorkItem)
  steps.push({
    kind: 'work-item',
    label: 'Update work item',
    detail: 'Move to In Progress',
  });
```

In `run()`, change `execute` to return `Promise<{ detail?: string; warn?: boolean } | void>`, and emit:

```ts
const out = await this.execute(steps[index], plan, hooks, log);
emit({
  type: 'step',
  index,
  status: out && out.warn ? 'warn' : 'done',
  ...(out && out.detail ? { detail: out.detail } : {}),
  ms: Date.now() - started,
});
```

In `execute()`:

```ts
case 'work-item': {
  if (!hooks.updateWorkItem) return { detail: 'Skipped' };
  try {
    const r = await hooks.updateWorkItem();
    log(r.detail);
    return r;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    log(detail);
    return { detail, warn: true };
  }
}
```

In `handlers.ts` `buildPlan`, set `updateWorkItem` to `Boolean(task.workItem && repo.connectionId && (repo.workItemOnStart.moveToInProgress || repo.workItemOnStart.assignToMe))`. In `runSetup`, pass this hook:

```ts
updateWorkItem: async () => {
  const repo = s.repos.get(task.repoId);
  const connection = s.connections.get(repo.connectionId!);
  const client = s.ado.client(connection.id);
  const id = Number(task.workItem!.id);
  const current = await client.workItemForStart(id);
  const states = await client.typeStates(connection.project, current.type);
  const plan = planStartUpdate(
    current,
    states,
    repo.workItemOnStart,
    connection.userUniqueName,
  );
  if (plan.state || plan.assignTo)
    await client.updateWorkItem(id, {
      ...(plan.state ? { state: plan.state } : {}),
      ...(plan.assignTo ? { assignedTo: plan.assignTo } : {}),
    });
  tel.event('workitem.startUpdated', {
    moved: Boolean(plan.state),
    assigned: Boolean(plan.assignTo),
  });
  return { detail: plan.detail, warn: false };
},
```

On a failure, the runner turns it into `warn`. Also record `tel.event('workitem.startUpdated', { failed: true })` in a catch that rethrows. Retrying setup from a later step skips this step, as with the other steps.

In `StepList.tsx`, the `warn` icon already exists from Task 3. In the CSS, next to `.step[data-status='failed']`, give `[data-status='warn'] .step-icon` the colour `var(--warn)`, and give the detail text the same colour.

- [ ] **Step 4: Run all checks.** Run `npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Format and commit:** `git commit -m "feat: setup moves the work item to In Progress and assigns it, warning instead of failing"`.

---

### Task 6: Finish with a draft pull request (main)

**Files:**
- Modify: `src/main/ipc/handlers.ts` (`tasks:finishChecks`, `tasks:finish`, new `tasks:prAvailability` and `tasks:prStatus`)
- Modify: `docs/telemetry.md`
- Test: `src/main/ipc/handlers.test.ts`

**Interfaces:**
- Consumes:
  - from Task 1: `prAvailability`, `targetBranch`, `prTitle`, `prDescription` and `prWebUrl`;
  - from Task 4: `GitClient.remoteUrl` and `push`, and `AdoClient.repositoryId`, `findActivePullRequest`, `createPullRequest` and `pullRequest`;
  - from Task 3: `PullRequestRef` and `FinishOptions.createPullRequest`;
  - the existing `s.openExternal`, and the usage totals the Usage panel uses. Check how `usageSync` or the `CostSection` comment builds its EUR line, and reuse that formatter. Don't write a new one.
- Produces the behaviour the renderer relies on:
  - `tasks:prAvailability(taskId)` returns `{ available, reason, target }`, where `target` is the base branch name such as `main`;
  - `tasks:finish(taskId, { ..., createPullRequest: true })` pushes, finds or creates the PR, records `task.pullRequest`, opens the PR, then runs the existing cleanup;
  - on a push or PR failure it throws an `Error` whose message starts with `Pull request not created: `, and the task stays `ready` with its worktree;
  - `tasks:prStatus(taskId)` refreshes and returns the stored ref, updated, or `null` when the task has no PR. On failure it returns the stored ref unchanged.

- [ ] **Step 1: Write the failing tests** in `handlers.test.ts`.
  - Use the existing finish tests' temp repo with a bare `origin`. Pushing goes to that bare path.
  - Availability needs an Azure Repos URL, so stub it: `vi.spyOn(s.git, 'remoteUrl').mockResolvedValue('https://dev.azure.com/contoso/P/_git/R')`. The handler deps already take the `git` object.
  - The connection's `organizationUrl` is `https://dev.azure.com/contoso`.

  The cases:
  1. **Availability:**
     - `tasks:prAvailability` returns `{ available: true, reason: null, target: 'main' }`;
     - with the remote spy returning a GitHub URL, `available: false`, reason `origin is not an Azure Repos URL`.
  2. **Happy path:**
     - `tasks:finish` with `createPullRequest: true`, a commit on the branch, and fake ADO `repositoryId` → `'repo-1'`, `findActivePullRequest` → `null`, `createPullRequest` → `{ pullRequestId: 7, status: 'active', isDraft: true }`;
     - Expect:
       - the branch exists on the bare origin;
       - `createPullRequest` was called with `source` equal to the branch, `target: 'main'`, `title` equal to `prTitle(task)`, `workItemId: <id>`, and a description containing the commit subject and `recorded by MIAC`;
       - `openExternal` was called with `https://dev.azure.com/contoso/P/_git/R/pullrequest/7`;
       - the task is `done` with `pullRequest` `{ id: 7, repositoryId: 'repo-1', project: 'P', repo: 'R', status: 'active', isDraft: true, url: <same> }`;
       - the worktree was removed.
  3. **Existing PR:** `findActivePullRequest` returns `{ pullRequestId: 3, status: 'active', isDraft: false }`. Expect `createPullRequest` not called, the task's `pullRequest.id` to be 3, and `isDraft: false`. This is Review focus 3.
  4. **Push rejected:** advance the bare origin's branch from a second clone first. Expect `tasks:finish` to reject with a message starting `Pull request not created: `, the task `ready`, the worktree folder to still exist, the terminals not killed, and `createPullRequest` not called. This is Review focus 4.
  5. **PR call fails** (`createPullRequest` throws `AdoError` with `CODE_WRITE_DENIED`): rejects with `Pull request not created: The token cannot create pull requests (needs Code: Read & write)`. The task is `ready` and the worktree exists.
  6. **`createPullRequest: true` while unavailable:** rejects with `Pull request not created: origin is not an Azure Repos URL`, and nothing is cleaned up.
  7. **`tasks:prStatus`:** after the happy path, the fake `pullRequest` returns `{ pullRequestId: 7, status: 'completed', isDraft: false }`. Expect the returned and stored status to be `completed`. When the fake throws, the stored ref is returned unchanged.
  8. **`tasks:finishChecks`:** unchanged. The renderer decides whether unpushed commits are a warning.

- [ ] **Step 2: Run the tests and check that they fail.** Run `npx vitest run src/main/ipc/handlers.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** in `handlers.ts`.

First a helper:

```ts
const prContext = async (task: Task) => {
  const repo = s.repos.get(task.repoId);
  const connection = repo.connectionId
    ? s.connections.get(repo.connectionId)
    : null;
  const remotes = await s.git.remotes(repo.path).catch(() => [] as string[]);
  const remoteUrl = remotes.includes('origin')
    ? await s.git.remoteUrl(repo.path, 'origin')
    : null;
  const availability = prAvailability({
    remoteUrl,
    connectionOrgUrl: connection?.organizationUrl ?? null,
  });
  return {
    repo,
    connection,
    availability,
    target: targetBranch(task.baseRef, remotes),
  };
};
```

The `'tasks:prAvailability'` handler:

```ts
'tasks:prAvailability': async (taskId) => {
  const c = await prContext(taskById(taskId));
  return {
    available: c.availability.available,
    reason: c.availability.reason,
    target: c.availability.available ? c.target : null,
  };
},
```

In `tasks:finish`, insert the PR phase right after `patchTask(taskId, { status: 'finishing' })` and the summary capture, before `killTerminals`:

```ts
let pullRequest: PullRequestRef | null = null;
if (options.createPullRequest) {
  try {
    const c = await prContext(task);
    if (!c.availability.available || !c.availability.target || !c.connection)
      throw new Error(c.availability.reason ?? 'pull requests are not available');
    const { project, repo: repoName } = c.availability.target;
    await s.git.push(task.worktreePath, 'origin', task.branch);
    const client = s.ado.client(c.connection.id);
    const repositoryId = await client.repositoryId(project, repoName);
    const existing = await client.findActivePullRequest(
      project,
      repositoryId,
      task.branch,
    );
    const raw =
      existing ??
      (await client.createPullRequest(project, repositoryId, {
        source: task.branch,
        target: c.target,
        title: prTitle(task),
        description: prDescription({
          heading: task.workItem
            ? `${task.workItem.type} ${task.workItem.id}: ${task.workItem.title}`
            : task.name,
          commits: summary?.commits ?? [],
          commitCount: summary?.commitCount ?? 0,
          costLine: await costLineFor(taskId),
        }),
        workItemId: task.workItem ? Number(task.workItem.id) : null,
      }));
    pullRequest = {
      id: raw.pullRequestId,
      url: prWebUrl(c.connection.organizationUrl, project, repoName, raw.pullRequestId),
      repositoryId,
      project,
      repo: repoName,
      status: raw.status,
      isDraft: raw.isDraft,
    };
    await patchTask(taskId, { pullRequest });
    tel.event(existing ? 'pr.linked' : 'pr.created');
  } catch (e) {
    await patchTask(taskId, { status: 'ready' });
    const message = e instanceof Error ? e.message : String(e);
    tel.event('pr.failed', {
      kind: e instanceof AdoError ? e.kind : 'git',
    });
    throw new Error(`Pull request not created: ${message}`);
  }
  void s.openExternal(pullRequest.url).catch(() => undefined);
}
```

Check the field names of `summary` (`TaskSummary`) in `src/shared/types.ts`. Use its real commit list and count fields; the names above match the spec's `commits` and `commitCount`.

`costLineFor(taskId)` builds `AI cost for this task: €X (Claude €Y, Copilot €Z)` from the same usage totals and EUR formatter as the work item comment. Find that code in the usage sync module and reuse its function. If no function exists, extract the line builder into an exported function in that module, and use it in both places.

`openExternal` is guarded by `allowedExternal`, and Azure DevOps URLs pass it.

The existing `try { ... } catch { patchTask ready; throw }` around cleanup stays as it is. The final `patchTask(... status: 'done' ...)` must not overwrite `pullRequest`. `patchTask` merges, so this holds; check it.

`'tasks:prStatus'`:

```ts
'tasks:prStatus': async (taskId) => {
  const task = taskById(taskId);
  const pr = task.pullRequest;
  if (!pr) return null;
  const repo = s.repos.get(task.repoId);
  if (!repo.connectionId) return pr;
  try {
    const raw = await s.ado
      .client(repo.connectionId)
      .pullRequest(pr.project, pr.repositoryId, pr.id);
    const next = { ...pr, status: raw.status, isDraft: raw.isDraft };
    await patchTask(taskId, { pullRequest: next });
    return next;
  } catch {
    return pr;
  }
},
```

In `docs/telemetry.md`, add:
- `workitem.startUpdated` (`moved`, `assigned`, `failed`);
- `pr.created`;
- `pr.linked`;
- `pr.failed` (`kind`).

- [ ] **Step 4: Run all checks.** Run `npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Format and commit:** `git commit -m "feat: Finish pushes and creates a draft pull request linked to the work item"`.

---

### Task 7: Finish page and Done page (renderer)

**Files:**
- Modify: `src/renderer/screens/FinishScreen.tsx`
- Modify: the Done task page component. In phase 2 of the redesign it lives under `src/renderer/screens/`; find it with `grep -rl "Finished before MIAC" src/renderer`.
- Tests:
  - `src/renderer/screens/FinishScreen.test.tsx`
  - the Done page's test file

**Interfaces:**
- Consumes:
  - `tasks:prAvailability` and `tasks:prStatus` (Task 6);
  - `FinishOptions.createPullRequest`;
  - `task.pullRequest`.

- [ ] **Step 1: Write the failing tests.**

On the Finish page:
- **Available:** with `tasks:prAvailability` returning `{ available: true, reason: null, target: 'main' }`:
  - a checkbox labelled `Create a draft pull request into main` is checked;
  - clicking Finish calls `tasks:finish` with `createPullRequest: true`.
- **Unavailable:** with `{ available: false, reason: 'origin is not an Azure Repos URL', target: null }`:
  - the checkbox is disabled and unchecked;
  - the reason text is visible;
  - Finish sends `createPullRequest: false`.
- **Unpushed commits:** with `finishChecks.unpushed: 2` and the PR checkbox checked, the unpushed warning is not shown. With the checkbox unchecked, it is shown as today.
- **Failure:** when `tasks:finish` rejects with `Pull request not created: The token cannot create pull requests (needs Code: Read & write)`:
  - an error block shows that message;
  - it offers **Retry** (calls `tasks:finish` again with the same options) and **Finish without PR** (calls `tasks:finish` with `createPullRequest: false`).
  - The page stays on Finish.

On the Done page:
- With `task.pullRequest = { id: 7, status: 'active', isDraft: true, url: 'https://dev.azure.com/contoso/P/_git/R/pullrequest/7', ... }`:
  - a fact "Pull request" shows `PR 7 · Draft` as a button that calls `shell:openExternal` with the URL;
  - after `tasks:prStatus` resolves with `status: 'completed', isDraft: false`, it shows `PR 7 · Completed`.
- Without `pullRequest`, there is no PR fact.

- [ ] **Step 2: Run the tests and check that they fail.**

- [ ] **Step 3: Implement.**

**FinishScreen.** Load availability with the existing checks effect (`tasks:finishChecks`):

```ts
const [pr, setPr] = useState<{
  available: boolean;
  reason: string | null;
  target: string | null;
} | null>(null);
const [createPr, setCreatePr] = useState(true);
const [finishError, setFinishError] = useState<string | null>(null);
```

- Render the checkbox above the cleanup checkboxes, using the same `label.checkbox` markup as the others:
  - label: `Create a draft pull request into {pr.target}`;
  - when unavailable: label `Create a draft pull request`, disabled, with `<span className="muted small">{pr.reason}</span>` after it.
- Send `createPullRequest: Boolean(pr?.available && createPr)` with the finish call.
- Hide the unpushed-commit warning when that value is true.
- When the finish call rejects with a message starting `Pull request not created: `:
  - set `finishError` to the message and stay on the page;
  - render the error with **Retry** and **Finish without PR** buttons (`btn` and `btn btn-subtle`, or whatever button classes this page already uses).
  - Keep the existing behaviour for other errors.

**Done page.** Next to the existing facts (Duration, Finished, Branch…), add the Pull request fact:
- on mount, when `task.pullRequest` is set, call `tasks:prStatus` once and keep the result in state;
- the status label is `Draft` when `isDraft && status === 'active'`; otherwise it is `Active`, `Completed` or `Abandoned`;
- the link uses the same `shell:openExternal` button pattern as the existing "Open in Azure DevOps" link on that page.

- [ ] **Step 4: Run all checks.** Run `npm test && npm run typecheck && npm run lint`. Expected: PASS.

- [ ] **Step 5: Format and commit:** `git commit -m "feat: Finish page creates a draft PR by default; Done page shows the PR and its status"`.

---

### Task 8: Settings: per-repo start options and PAT scope text

**Files:**
- Modify: the Settings repo section. Find it with `grep -rn "repos:setConnection" src/renderer`; it is in `SettingsScreen.tsx` or a repo section component.
- Modify: `src/renderer/components/ConnectionsSection.tsx`, the help text at line 170: `The token needs Work Items (read) and Code (read).`
- Modify: `README.md` and `docs/` wherever the PAT scope is described. Find them with `grep -rn "Work Items" README.md docs | grep -i -e scope -e read`.
- Test: the matching Settings test file and `ConnectionsSection.test.tsx`.

**Interfaces:**
- Consumes:
  - `repos:setWorkItemOnStart` (Task 3);
  - `workItems:types(connectionId)`, which already exists and returns types with `states[{ name, color, category }]`;
  - `repo.workItemOnStart`.

- [ ] **Step 1: Write the failing tests.**
  - A repo row with a connection shows two checkboxes, both checked by default:
    - `Move the work item to In Progress on start`;
    - `Assign it to me if unassigned`.
  - Unticking the first calls `repos:setWorkItemOnStart(repo.id, { moveToInProgress: false, assignToMe: true, stateOverrides: {} })`.
  - Opening "Override per type":
    - lists the types from `workItems:types`;
    - each has a select with `Default` plus its `InProgress`-category states;
    - choosing `Doing` for `Task` calls `repos:setWorkItemOnStart` with `stateOverrides: { Task: 'Doing' }`;
    - choosing `Default` removes the key.
  - A repo without a connection shows neither checkbox.
  - The connection help text contains `Work Items (Read & write) and Code (Read & write)`.

- [ ] **Step 2: Run the tests and check that they fail.**

- [ ] **Step 3: Implement**, using the existing checkbox and select markup of the Settings page. Store changes immediately with `tryInvoke(() => api().invoke('repos:setWorkItemOnStart', ...), notify)`. The `repos:changed` broadcast refreshes the store.
  - The overrides disclosure is a `<details>` element with `<summary>Override per type</summary>`.
  - Load `workItems:types` only when the disclosure opens.
  - Change the help text to: `The token needs Work Items (Read & write) and Code (Read & write). It is encrypted with` (then keep the rest of the sentence as is).

- [ ] **Step 4: Run all checks.** Expected: PASS.

- [ ] **Step 5: Format and commit:** `git commit -m "feat: per-repo start options in Settings; PAT needs Code read & write"`.

---

### Task 9: Docs and live check against the test org

**Files:**
- Modify: `CLAUDE.md`, the Status section:
  - add the feature with its date;
  - remove "the app does not yet write work item state" from the gaps, and add "Finish does not change the work item state (by choice)";
  - mention the PAT scope change.
- Modify: `docs/windows-checklist.md`: add item 13, "Work item and pull request". Start a task on a To Do item and check that it shows Doing and is assigned. Finish with the PR option and check that a draft PR opens in the browser, linked to the work item. On the Done page, check that the PR shows Draft.

- [ ] **Step 1: Live check.**
  - Test org: `https://dev.azure.com/unreliablewitness`, project `MIAC`, which has an empty Azure Repos repo named `MIAC`.
  - Read the PAT with `security find-generic-password -a miac -s miac-ado-unreliablewitness -w` into a variable. Never print it.
  - Confirm the PAT can write code. If the create call returns 403, stop and report that the dev PAT needs Code (Read & write); don't work around it.
  - Push a `main` branch to that repo from a throwaway local clone in the scratchpad: `https://dev.azure.com/unreliablewitness/MIAC/_git/MIAC`. Authenticate with an `http.extraHeader` built from the PAT on the command line, never in a file.
  - Drive the packaged app with Playwright `_electron` and a throwaway `--user-data-dir`, the same way as the earlier runs (see `scratchpad/phase2-report.md`).
  - Steps:
    1. Add the clone as a repo and link the connection.
    2. Create a task from work item 2.
    3. Check that it is now Doing and assigned to the PAT user: read it back with the REST API.
    4. Commit a file in the worktree.
    5. Finish with "Create a draft pull request" ticked and usage write-back unticked.
    6. Check through REST that an active draft PR exists, with source `refs/heads/<branch>`, target `refs/heads/main`, the work item in its `workItemRefs`, and the description listing the commit.
    7. Screenshot the Finish page, the setup step list and the Done page. Read the screenshots.
  - Afterwards:
    - abandon the PR: PATCH `status: 'abandoned'`;
    - set work item 2 back to `To Do`, unassigned;
    - delete the pushed branch on the remote.
  - This is the dev test project only. Touch no other org or project.

- [ ] **Step 2: Update the docs** as listed above, then run `npm test && npm run typecheck && npm run lint`.

- [ ] **Step 3: Commit:** `git commit -m "docs: work item state on start and draft PRs; Windows checklist item 13"`.
