# Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first run opens on a Get started page whose three steps (Agents, Connect, Repository) detect what is on the machine, connect a tracker through a provider picker, and add a repository with a proposed `.shellie.yml`; the same pages serve Settings.

**Architecture:** Main gains three services behind IPC (`agents:detect`, `connections:probe`, `repos:inspect`) and a `Tracker` interface wrapping the handlers' Azure DevOps calls. The renderer gains three full-page screens (`agents`, `connect`, `add-repo`) opened either from a new `get-started` screen (with a step strip) or from Settings (`from`), plus a Get started band on Home. Settings gets `onboarding` state and `defaultTerminals` stays the store for the agent choice (#107).

**Tech Stack:** Electron, React, TypeScript, zod, Vitest (+ Testing Library in the renderer), oxlint/oxfmt. Branch `feature/onboarding` (already holds the spec and mockups).

**Spec:** `docs/superpowers/specs/2026-10-22-onboarding-design.md` (mockups in `design/mockups/onboarding/`).

## Global Constraints

- Every screen is a full page in the app shell, no overlays; Back and Skip always visible (#15).
- All shell and spawn logic behind `Platform` (`src/main/platform/`); Windows is the release target.
- Telemetry: every new event listed in `docs/telemetry.md`; never send a PAT, remote URL, folder path or version string.
- `connections.json` stays version 1; `settings.json` stays version 1; old files must parse (schema defaults).
- Existing installs with a repository never see Get started and never get their `defaultTerminals` re-ticked.
- Checks before every commit: `npm test`, `npm run typecheck`, `npm run lint` (fix formatting with `npx oxfmt <files>`).
- Commit messages end with the session's attribution lines (see the conversation's system reminder).
- Copy: "Get started", "Agents", "Connect your tracker", "Add a repository", "Skip for now", "Check again", "Write .shellie.yml to the repository", "Keep these defaults in Shellie only", "No tracker".

## Review Focus

1. `claude --version` hangs or prints nothing: detection must report "not found" after 5 s, never block the page (Task 3).
2. An SSH Azure Repos remote (`git@ssh.dev.azure.com:v3/org/project/repo`) must link to the connection like the https form (Task 5).
3. A folder with no remote, or no git repo at all: inspection returns `remote: null` or `repos:inspect` throws "not a git repository"; the page shows it and Add is disabled (Task 5, Task 6).
4. A PAT whose scopes miss Project and Team (Read): the probe signs in but lists no projects; the page must say "The token can sign in but cannot list projects: add Project and Team (Read)" (Task 7).
5. Upgrade with connections but no repository: Get started shows with Connect done and Agents not pre-ticked wrongly — pre-tick runs (no repo means no migration flag) but only ticks found agents (Task 8).

---

### Task 1: `provider` on connections and the `nouns` helper

**Files:**
- Modify: `src/shared/types.ts` (`ConnectionSchema`, `ConnectionInput`)
- Create: `src/shared/trackers.ts`
- Test: `src/shared/trackers.test.ts`, `src/main/services/ConnectionStore.test.ts`

**Interfaces:**
- Produces: `TrackerProvider = 'azure-devops' | 'github'`; `TrackerProviderSchema`; `Connection.provider: TrackerProvider` (default `'azure-devops'`); `ConnectionInput.provider?: TrackerProvider`; `nouns(provider): { item: string; iteration: string; pullRequest: string }` (`'work item' | 'sprint' | 'pull request'` for Azure DevOps; `'issue' | 'iteration' | 'pull request'` for GitHub).

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/trackers.test.ts
it('names the tracker nouns per provider', () => {
  expect(nouns('azure-devops')).toEqual({ item: 'work item', iteration: 'sprint', pullRequest: 'pull request' });
  expect(nouns('github')).toEqual({ item: 'issue', iteration: 'iteration', pullRequest: 'pull request' });
});
// src/main/services/ConnectionStore.test.ts (add)
it('reads a connections file saved before providers existed as Azure DevOps', async () => { /* write a v1 file without provider, load, expect list()[0].provider === 'azure-devops' */ });
it('keeps the provider it saved', async () => { /* save({ ..., provider: 'github' }) then list()[0].provider === 'github' */ });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/shared/trackers.test.ts src/main/services/ConnectionStore.test.ts`
Expected: FAIL (module `./trackers` missing; `provider` undefined).

- [ ] **Step 3: Implement**

`TrackerProviderSchema = z.enum(['azure-devops', 'github'])` and `nouns` in `src/shared/trackers.ts`; `provider: TrackerProviderSchema.default('azure-devops')` on `ConnectionSchema`; `provider?: TrackerProvider` on `ConnectionInput`; `ConnectionStore.save` stores `input.provider ?? 'azure-devops'`.

- [ ] **Step 4: Run the tests, typecheck, lint** — Expected: PASS, no errors (fixtures that spread `Connection` literals may need `provider: 'azure-devops'`).

- [ ] **Step 5: Commit** — `git commit -m "Connections carry a tracker provider (Azure DevOps today)"`

### Task 2: `Tracker` interface and `TrackerRegistry` for the handlers

**Files:**
- Create: `src/main/trackers/Tracker.ts`, `src/main/trackers/AzureDevOpsTracker.ts`
- Modify: `src/main/services/AdoRegistry.ts` → rename to `src/main/trackers/TrackerRegistry.ts` (keep `client(id)` for Home and UsageSync, add `tracker(id)`), `src/main/ipc/handlers.ts` (`Services.ado` → `Services.trackers`, the `s.ado.client(...)` sites use `s.trackers.tracker(...)`), `src/main.ts`, `src/main/home/HomeService.ts` and `src/main/usage/UsageSync.ts` only where the registry type is named.
- Test: `src/main/trackers/AzureDevOpsTracker.test.ts`, `src/main/trackers/TrackerRegistry.test.ts`

**Interfaces:**
- Produces: `interface Tracker` with the methods the handlers call today, renamed neutrally: `probe(project) → verify`, `currentIteration`, `iteration(project) → sprint`, `items(project, ids) → workItems`, `searchItems → searchWorkItems`, `itemTypes → workItemTypes`, `iconDataUrl`, `typeStates`, `itemForStart → workItemForStart`, `updateItem → updateWorkItem`, `itemEstimate → workItemEstimate`, `updateItemFields → updateWorkItemFields`, `repositoryId`, `findActivePullRequest`, `createPullRequest`; same parameter and return types as `AdoClient`. `class AzureDevOpsTracker implements Tracker` (constructor `(client: AdoClient)`, pure delegation). `class TrackerRegistry { client(id): AdoClient; tracker(id): Tracker; invalidate(id?) }`; `tracker` throws `Error('GitHub connections are not supported yet')` when `provider === 'github'`.

- [ ] **Step 1: Write the failing tests** — `AzureDevOpsTracker` delegates each method to a fake `AdoClient` with the same arguments (one `it` per method, table-driven); `TrackerRegistry.tracker` returns the same instance twice, a new one after `invalidate`, and throws for a GitHub connection.
- [ ] **Step 2: Run them to verify they fail** — Run: `npx vitest run src/main/trackers` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the three files; move `AdoRegistry` to `TrackerRegistry` (`git mv`), keep `client()`.
- [ ] **Step 4: Rewire the handlers** — replace every `s.ado.client(x).<method>` and `const client = s.ado.client(x)` in `handlers.ts` with `s.trackers.tracker(x).<neutral method>`; `s.ado.invalidate` → `s.trackers.invalidate`; `Services.ado` → `trackers: TrackerRegistry`; update `handlers.test.ts`'s harness and `main.ts`. Home and UsageSync keep `client()`.
- [ ] **Step 5: Run the whole suite, typecheck, lint** — Expected: all green (`handlers.test.ts` is the proof the rewiring kept behaviour).
- [ ] **Step 6: Commit** — `git commit -m "Handlers talk to the tracker through a Tracker interface"`

### Task 3: `agents:detect`

**Files:**
- Modify: `src/main/platform/Platform.ts` (`probeCommand`), `src/main/platform/darwin.ts`, `src/main/platform/windows.ts`
- Create: `src/main/services/agentDetector.ts`
- Modify: `src/shared/ipc.ts` (`'agents:detect'`), `src/main/ipc/handlers.ts`, `src/renderer/test-helpers/fakeApi.ts` (a default result: Claude found 2.1.307, others not found)
- Test: `src/main/platform/darwin.test.ts`, `src/main/platform/windows.test.ts`, `src/main/services/agentDetector.test.ts`, `src/main/ipc/handlers.test.ts`

**Interfaces:**
- Produces: `Platform.probeCommand(name: string): Command` — a shell command whose stdout is the executable's path on line 1 and `<name> --version`'s first line on line 2, exit code non-zero when `name` is not on PATH (darwin: `login -c 'command -v <name> && <name> --version'`; windows: `(Get-Command <name> -ErrorAction Stop).Source; & <name> --version`). `AgentId = 'claude' | 'copilot' | 'opencode'`; `AgentProbe = { found: boolean; version: string | null; path: string | null }`; `AgentsDetected = { checkedAt: string; agents: Record<AgentId, AgentProbe>; shell: { label: string } }`; `detectAgents(platform, run: (cmd: Command, timeoutMs: number) => Promise<{ code: number; stdout: string }>): Promise<AgentsDetected>` with a 5 s timeout per agent, run in parallel; a timeout or non-zero exit is `found: false`. IPC `'agents:detect': { args: [force?: boolean]; result: AgentsDetected }`, cached per launch unless `force`. `INSTALL_COMMANDS: Record<AgentId, string>` in `src/shared/agents.ts` (`npm i -g @anthropic-ai/claude-code`, `npm i -g @github/copilot`, `npm i -g opencode-ai`) with `AGENT_LABELS` (`Claude Code`, `GitHub Copilot CLI`, `OpenCode`).

- [ ] **Step 1: Write the failing tests** — darwin: `probeCommand('claude')` is `login` with `-c` `command -v claude && claude --version`; windows: the PowerShell line above; `detectAgents`: found with version `2.1.307` from stdout `"/usr/local/bin/claude\n2.1.307 (Claude Code)\n"`, not found on exit 1, not found when `run` rejects with a timeout, `checkedAt` ISO; handlers: `agents:detect` returns the cached result on the second call and a fresh one with `force`.
- [ ] **Step 2: Run them to verify they fail** — Run: `npx vitest run src/main/platform src/main/services/agentDetector.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `probeCommand` on both platforms, `detectAgents` (`execFile` with `timeout` in main's `run`), the handler with its cache, `src/shared/agents.ts`, telemetry `agents.detected` (`claude`, `copilot`, `opencode` booleans).
- [ ] **Step 4: Run tests, typecheck, lint** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Detect the agent CLIs on this machine (agents:detect)"`

### Task 4: `onboarding` settings and `AgentsSection`

**Files:**
- Modify: `src/shared/usage.ts` (`onboarding`), `src/main/usage/SettingsStore.test.ts` (fixture)
- Create: `src/renderer/components/AgentsSection.tsx` (replaces `TerminalsSection.tsx`, which is deleted with its test), `src/renderer/agentsPretick.ts`
- Modify: `src/renderer/screens/SettingsScreen.tsx` (nav "Agents and terminals", section id `terminals` kept), `src/renderer/test-helpers/fakeApi.ts` (`onboarding` in the fake settings)
- Test: `src/renderer/agentsPretick.test.ts`, `src/renderer/components/AgentsSection.test.tsx`

**Interfaces:**
- Produces: `AppSettings.onboarding: { dismissedAt: string | null; agentsCheckedAt: string | null; tracker: 'none' | null }` (schema defaults null; `defaultSettings()` includes it). `pretick(detected: AgentsDetected): DefaultTerminals` — the first found of Claude Code, OpenCode, Copilot ticked, the others not, `shell: true`. `AgentsSection({ embedded?: boolean })`: table per spec (checkbox, agent with colour dot, On this machine, Cost tracking, last column), a shell row, "Check again" (`agents:detect` with `force`), the info card when more than one agent is ticked, the "No agent CLI found…" note when none is found. On first open with `onboarding.agentsCheckedAt === null`: applies `pretick`, saves `defaultTerminals` and `onboarding.agentsCheckedAt = now` in one `saveSettings`. Every click saves `defaultTerminals` at once (as #107).

- [ ] **Step 1: Write the failing tests** — `pretick`: Claude+OpenCode found → claude only; OpenCode only → opencode; none → shell only. `AgentsSection`: shows "Found · 2.1.307" for Claude and "Not found" with the Copilot install command and a Copy button; on first open with `agentsCheckedAt` null saves `{ defaultTerminals: { claude: true, copilot: false, opencode: false, shell: true }, onboarding: { ..., agentsCheckedAt: <ISO> } }`; with `agentsCheckedAt` set and `defaultTerminals.opencode` true it does not save on open; the info card appears only when two agents are ticked; "Check again" calls `agents:detect` with `true`. Settings fixture test: an old `settings.json` without `onboarding` parses with the nulls.
- [ ] **Step 2: Run them to verify they fail** — Run: `npx vitest run src/renderer/agentsPretick.test.ts src/renderer/components/AgentsSection.test.tsx src/main/usage/SettingsStore.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the schema field, `pretick`, `AgentsSection`, the Settings wiring; delete `TerminalsSection*`; keep the `#terminals` id so old `settings` links scroll.
- [ ] **Step 4: Run the whole suite, typecheck, lint** — Expected: PASS (fixtures with full settings literals gain `onboarding`).
- [ ] **Step 5: Commit** — `git commit -m "Settings: Agents and terminals shows what is installed and pre-ticks it once"`

### Task 5: `repos:inspect` and `repos:add` options

**Files:**
- Create: `src/main/services/repoInspect.ts`, `src/shared/repoInspection.ts`
- Modify: `src/main/services/RepoRegistry.ts` (`add(folder, options?)`, `describe` keeps a given `baseBranch`, `refresh` keeps it when no config file), `src/main/ipc/handlers.ts` (`repos:inspect`, `repos:add`), `src/shared/ipc.ts`, `src/main/services/azureRepos.ts` only if the SSH form is not parsed yet
- Test: `src/main/services/repoInspect.test.ts`, `src/main/services/RepoRegistry.test.ts`, `src/main/ipc/handlers.test.ts`, `src/main/services/azureRepos.test.ts`

**Interfaces:**
- Produces (`src/shared/repoInspection.ts`): `RepoInspection = { folder: string; remote: { url: string; provider: 'azure-devops' | 'github' | 'other'; connectionId: string | null; project: string | null } | null; baseBranch: string; facts: { lockfile: 'npm' | 'pnpm' | 'yarn' | null; dotnet: string[]; devScript: 'dev' | 'start' | null; apm: boolean; envFiles: string[]; existing: string | null }; proposal: string | null }`. `proposeConfig(facts, baseBranch): string` (pure; the YAML of the spec's rules, parsed back through `ShellieYmlSchema` in a test). `inspectRepo(folder, deps: { git: GitClient; connections: Connection[] }): Promise<RepoInspection>` (throws `Error('<folder> is not a git repository')`). IPC `'repos:inspect': { args: [folder: string]; result: RepoInspection }`; `'repos:add': { args: [folder: string, options?: { writeConfig?: string; baseBranch?: string; connectionId?: string | null }]; result: Repo }`. `RepoRegistry.add(folder, options?)` writes `.shellie.yml` first when `writeConfig` is given (fails with "`.shellie.yml` already exists" if present), registers with `configFound` true, sets `baseBranch` from `options.baseBranch` when given, `connectionId` from options, and copies the connection's `workItemOnStart` (field added in Task 7; until then the repo default).
- Consumes: `parseAzureReposRemote`, `matchConnection`, `GitClient.remoteUrl`, `GitClient.defaultBaseRef`.

- [ ] **Step 1: Write the failing tests** — `proposeConfig`: npm lockfile + env files + dev script → the exact YAML of the mockup (`base: main`, `branch: "{type}/{id}-{slug}"`, `copy: [.env, .env.local]`, `setup:` `- npm ci`, `run:` `dev: npm run dev`); pnpm → `pnpm install --frozen-lockfile`; `.sln` → `dotnet restore` after the npm line; the YAML parses through `ShellieYmlSchema`. `inspectRepo` on temp repos: https remote → linked to the matching connection; `git@ssh.dev.azure.com:v3/org/proj/repo` → linked too; `github.com` remote → `provider: 'github'`, `connectionId: null`; no remote → `remote: null`; a plain folder → rejects with `not a git repository`; existing `.shellie.yml` → `existing` set, `proposal` null; `envFiles` lists only git-ignored `.env*`; base from `origin/HEAD` = `develop`. `RepoRegistry.add` with `writeConfig` writes the file and `configFound` is true; fails when the file exists; `baseBranch: 'develop'` is kept by `refresh` without a file. Handler: `repos:add` with `writeConfig` reports `repo.added` with `wroteConfig: true`.
- [ ] **Step 2: Run them to verify they fail** — Run: `npx vitest run src/main/services/repoInspect.test.ts src/main/services/RepoRegistry.test.ts src/main/services/azureRepos.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** (`envFiles` via `git check-ignore` on `.env*` and `appsettings.*.local.json` matches; `devScript` from `package.json` `scripts.dev` else `scripts.start`; `dotnet` from `*.sln`/`*.csproj` in the root), telemetry `repo.inspected` (`remote`, `linked`, `lockfile`, `dotnet`, `devScript`, `apm`, `existingConfig`).
- [ ] **Step 4: Run the whole suite, typecheck, lint** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Inspect a repository folder and propose its .shellie.yml (repos:inspect)"`

### Task 6: Add repository page

**Files:**
- Create: `src/renderer/screens/AddRepoScreen.tsx`
- Modify: `src/renderer/store.ts` (`Screen` gains `{ kind: 'add-repo'; from: 'settings' | 'get-started' }`), `src/renderer/App.tsx`, `src/renderer/screens/SettingsScreen.tsx` (Add folder… → `go({ kind: 'add-repo', from: 'settings' })` after `repos:pickFolder`), `src/renderer/screens/SettingsScreen.test.tsx`
- Test: `src/renderer/screens/AddRepoScreen.test.tsx`

**Interfaces:**
- Consumes: `repos:pickFolder`, `repos:inspect`, `repos:add` (Task 5).
- Produces: `AddRepoScreen({ folder?: string })` reading `screen.from`; a `StepStrip({ current: 'agents' | 'connect' | 'repository' })` component in `src/renderer/components/ui/StepStrip.tsx` shown only when `from === 'get-started'`.

- [ ] **Step 1: Write the failing tests** — picking a folder calls `repos:inspect` and shows the "What Shellie found" rows (Remote with "Linked to project Shellie", Base branch `develop`, Stack `package-lock.json`, Scripts, Agent packages, Env files) and the proposal in a code block; Edit turns it into a textarea and an invalid YAML shows an error under it and disables Add; "Write .shellie.yml to the repository" (default) sends `repos:add(folder, { writeConfig: <text>, baseBranch, connectionId })`; "Keep these defaults in Shellie only" sends no `writeConfig`; an existing `.shellie.yml` hides the radios and shows the file; a GitHub remote shows the "A GitHub remote?" note; a folder that is not a git repository shows the error from `repos:inspect` and keeps Add repository disabled; `from: 'settings'` shows no step strip and Back goes to settings; `from: 'get-started'` shows the strip with Repository current and Add goes to home.
- [ ] **Step 2: Run them to verify they fail** — Run: `npx vitest run src/renderer/screens/AddRepoScreen.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the screen (layout per mockup 4: left card with Folder + Browse and the facts table, right column with the proposal and the GitHub note, radios below, Back / Add repository), the `Screen` kind, routing, the Settings change, telemetry `onboarding.step` (`repository`, `continued` | `back`) when `from === 'get-started'`.
- [ ] **Step 4: Run the whole suite, typecheck, lint** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add repository page: inspect the folder, propose .shellie.yml, write it or not"`

### Task 7: `connections:probe`, `Connection.workItemOnStart` and the Connect page

**Files:**
- Modify: `src/shared/types.ts` (`Connection.workItemOnStart: StartSettingsSchema.default(...)`, `ConnectionInput.workItemOnStart?`), `src/main/services/AdoClient.ts` (`projects(): Promise<{ id: string; name: string }[]>`), `src/main/services/ConnectionStore.ts` (`save` stores `workItemOnStart`), `src/main/ipc/handlers.ts` (`connections:probe`, `connections:saveMany`), `src/shared/ipc.ts`, `src/main/services/RepoRegistry.ts` (copy `workItemOnStart` at add when linked)
- Create: `src/renderer/screens/ConnectScreen.tsx`, `src/renderer/components/ProviderPicker.tsx`
- Modify: `src/renderer/store.ts` (`{ kind: 'connect'; from; connectionId?: string }`), `src/renderer/App.tsx`, `src/renderer/components/ConnectionsSection.tsx` (picker above the list, rows grouped by organization, "Add a project" per group → `go({ kind: 'connect', from: 'settings', connectionId })`, and the group's "Update token" (#82) saves the new PAT into every connection of that organization; nav label "Connections", section id `ado` kept), `src/renderer/screens/SettingsScreen.tsx`
- Test: `src/main/services/AdoClient.test.ts`, `src/main/ipc/handlers.test.ts`, `src/renderer/screens/ConnectScreen.test.tsx`, `src/renderer/components/ConnectionsSection.test.tsx`

**Interfaces:**
- Produces: IPC `'connections:probe': { args: [input: { organizationUrl: string; pat?: string; connectionId?: string }]; result: { user: string; uniqueName: string | null; projects: { id: string; name: string }[]; canListProjects: boolean } }` (a throwaway `AdoClient` with `pat`, or the stored token of `connectionId`; `projects` from `GET /_apis/projects`; a 401/403 on that call alone sets `canListProjects: false`). `'connections:saveMany': { args: [input: { organizationUrl: string; pat?: string; connectionId?: string; projects: string[]; workItemOnStart: StartSettings; provider: TrackerProvider }]; result: Connection[] }` — one `connections:save` per project (name `<org>/<project>`), skipping projects that already have a connection in that organization. `ProviderPicker({ value: TrackerProvider | 'none'; onChange })` with the three cards (GitHub disabled with the "Soon" pill and its tooltip). `ConnectScreen` per mockup 3; "No tracker" + Continue saves `onboarding.tracker = 'none'`.

- [ ] **Step 1: Write the failing tests** — `AdoClient.projects` parses `value[]`; `connections:probe` returns user and projects with a fake fetch, `canListProjects: false` on 403 for projects, and reuses the stored token when `connectionId` is given (no `pat`); `connections:saveMany` creates two connections named `uw/Shellie` and `uw/Webshop` with `workItemOnStart` and skips an existing one. `ConnectScreen`: Test shows "Signed in as Dries Hoebeke" and the project checkboxes (a single project pre-ticked); the scopes line lists the three scopes and the link's href is `<organizationUrl>/_usersSettings/tokens`; the Project and Team warning appears when `canListProjects` is false; Continue sends `saveMany` with the ticked projects and the on-start options; No tracker → Continue saves `onboarding.tracker: 'none'` and goes on; with `connectionId` the PAT field is absent. `ConnectionsSection`: rows grouped by organization with "Add a project"; Update token on a group with two projects calls `connections:save` twice with the same PAT.
- [ ] **Step 2: Run them to verify they fail** — Run: `npx vitest run src/main/services/AdoClient.test.ts src/renderer/screens/ConnectScreen.test.tsx src/renderer/components/ConnectionsSection.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** all of the above; telemetry `connection.probeFailed` (`status`) and `onboarding.step` (`connect`, outcome) when `from === 'get-started'`.
- [ ] **Step 4: Run the whole suite, typecheck, lint** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Connect page: provider picker, token probe, pick projects, on-start defaults"`

### Task 8: Get started page, Home band, migration

**Files:**
- Create: `src/renderer/screens/GetStartedScreen.tsx`, `src/renderer/components/home/GetStartedBand.tsx`, `src/renderer/onboardingState.ts`, `src/renderer/screens/AgentsScreen.tsx` (a page wrapping `AgentsSection` with the step strip and Back / Continue)
- Modify: `src/renderer/store.ts` (`{ kind: 'get-started' }`, `{ kind: 'agents'; from }`); consumes `StepStrip` from Task 6, `src/renderer/App.tsx` (first screen: `get-started` when `repos.length === 0 && settings.onboarding.dismissedAt === null`, else `home`), `src/renderer/screens/HomeScreen.tsx` (band at the top while a step is unfinished and not dismissed; the old "Add an Azure DevOps connection" button goes), `src/renderer/screens/SettingsScreen.tsx` (About: "Get started" link clears `dismissedAt` and opens the page), `src/main.ts` (migration: at settings load, when `store.repos.length > 0` and `onboarding.dismissedAt === null` and the marker `onboarding-migrated` is absent in the settings, set `dismissedAt` and `agentsCheckedAt` to now)
- Test: `src/renderer/onboardingState.test.ts`, `src/renderer/screens/GetStartedScreen.test.tsx`, `src/renderer/screens/HomeScreen.test.tsx`, `src/main/onboardingMigration.test.ts` (extract the rule to `src/main/onboardingMigration.ts`: `migrateOnboarding(settings, repoCount, now): AppSettings | null`)

**Interfaces:**
- Produces: `onboardingSteps({ settings, connections, repos, detected }): { agents: 'done' | 'todo'; connect: 'done' | 'todo'; repository: 'done' | 'todo'; current: 'agents' | 'connect' | 'repository' | null }` (agents done when `agentsCheckedAt` set; connect done when a connection exists or `tracker === 'none'`; repository done when a repo exists; `current` = first todo). `GetStartedScreen` per mockup 1 (cards with state, the current one accented with the primary button, right column with the art box and "What you get", "Skip for now" sets `dismissedAt`). `GetStartedBand` on Home: the unfinished cards in one row with a Dismiss. `migrateOnboarding` returns the updated settings or null when nothing changes.

- [ ] **Step 1: Write the failing tests** — `onboardingSteps`: fresh install → all todo, current agents; agents checked + no tracker → current repository; everything → current null. `migrateOnboarding`: repos > 0 and nulls → both timestamps set; repos 0 → null; already set → null. `GetStartedScreen`: card 1 text names the found agents and the ticked tabs ("New tasks open OpenCode and a shell."); card 2 Connect is primary when agents is done; Skip for now saves `dismissedAt` and goes home; Add folder… picks a folder and goes to `add-repo` with `from: 'get-started'`. App: a fresh store opens on `get-started`; with a repo opens on `home`; with a connection but no repo opens on `get-started` with Connect done and Agents still todo (no migration ran). Home: shows the band with "Connect your tracker" when no connection and not dismissed; hides it when dismissed.
- [ ] **Step 2: Run them to verify they fail** — Run: `npx vitest run src/renderer/onboardingState.test.ts src/renderer/screens/GetStartedScreen.test.tsx src/main/onboardingMigration.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**; the art box shows `assets/art/get-started.jpg` when it exists (import via Vite `?url` with a try at render: `onError` swaps in `MindMark` at 64 px), telemetry `onboarding.shown`, `onboarding.dismissed` (`repos`, `connections`), `onboarding.step` (`agents`, outcome).
- [ ] **Step 4: Run the whole suite, typecheck, lint** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Get started: first-run page, Home band, migration for existing installs"`

### Task 9: Art prompt, docs and status

**Files:**
- Modify: `tools/art/prompts.md` (new "Onboarding" section with its own style block and `**get-started.png**`, Landscape), `tools/art/prompts.test.ts` (the section parses with its own style block), `assets/ART.md` (entry template to fill after the owner's pick), `docs/telemetry.md` (every event from Tasks 3, 5, 6, 7, 8 and `repo.added`'s `wroteConfig`), `CLAUDE.md` (one status line in the style of the others; Settings section names), `README.md` (a short "First run" paragraph)
- Test: `tools/art/prompts.test.ts`

- [ ] **Step 1: Write the failing test** — `parsePrompts` returns `get-started` with the onboarding style block (contains `#dbeafb`) and `aspectRatio` `16:9`.
- [ ] **Step 2: Run it to verify it fails** — Run: `npx vitest run tools/art/prompts.test.ts` — Expected: FAIL.
- [ ] **Step 3: Write the prompt section** (the spec's style text verbatim), the docs, the status line. If `tools/art/gemini.local.key` or `GEMINI_API_KEY` exists, run `node tools/art/generate.mjs generate get-started` and leave the candidates in `tools/art/incoming/` for the owner to pick (do not pick; do not commit `assets/art/get-started.jpg`); otherwise say so in the PR.
- [ ] **Step 4: Run tests, typecheck, lint** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Onboarding: art prompt, telemetry docs, status"`

### Task 10: Live check and PR

- [ ] **Step 1: Run the app** (`npm start`) with a temporary `SHELLIE_USER_DATA`-style fresh profile if the app supports one, else a copy of the data folder moved aside: confirm Get started opens, Agents shows the real detection on this Mac, Connect probes the test org (`unreliablewitness`, PAT from the Keychain item `shellie-ado-unreliablewitness`) and lists `Shellie`, Add repository on this repo proposes `npm ci`, writes `.shellie.yml` into a scratch clone (not this checkout), and Home then shows the sprint. Note what was not checked (Windows).
- [ ] **Step 2: Open the PR** into `main` with the spec and mockups linked, the live-check notes, and the attribution lines.
