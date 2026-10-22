# Onboarding: Get started, agents, tracker, repository

Date: 2026-10-22. Status: design, approved in conversation from four mockups (Get started, Agents, Connect, Add a
repository) in `design/mockups/onboarding/`; the mockups' decisions are written down here. The yellow labels on the
mockups are notes, not UI.

## Intent

A fresh install of Shellie opens on an empty Home with one button ("Add an Azure DevOps connection"). A new user has
to find Settings, add a connection with a PAT whose scopes they must know, add a repository folder, and know that
`.shellie.yml` exists, before Sprint or Start show anything. Today (2026-10-22) a teammate without a Claude licence
installed Shellie and could neither make it use OpenCode (fixed by #107, PR #108) nor see why OpenCode then quit
(#109, PR #110). Onboarding makes the three things a new user must decide explicit, in order, with Shellie doing the
detection: which agents are on this machine, where the work items live, and how tasks in a repository start.

Two more goals ride along:

- **Ease the tool selection.** Shellie detects the agent CLIs and pre-ticks what it finds, so an OpenCode-only
  developer never sees a Claude Code tab fail.
- **Ease the Azure DevOps coupling and keep room for GitHub.** The connection gets a `provider`; the UI shows a
  provider picker with GitHub greyed in as "Soon"; the code that reads and writes the tracker goes behind one
  `Tracker` interface so GitHub (issues, Projects iterations, pull requests) is a second implementation, not a
  rewrite. No GitHub code ships with this design.

## Goals

1. First run opens on a **Get started** page in the normal app shell (header, left nav) with three cards: Agents,
   Connect your tracker, Add a repository. Each card opens a full page; each page is the same page Settings uses, so
   there is one implementation per step.
2. Nothing is mandatory. "Skip for now" goes to Home; every step stays reachable from Settings; Shellie works with a
   shell alone and with blank tasks (no tracker).
3. **Agents** detects `claude`, `copilot` and `opencode` on the machine (found with version, or not found with the
   install command), pre-ticks what it found, and saves into `defaultTerminals` (#107).
4. **Connect** shows a provider picker (Azure DevOps · GitHub "Soon" · No tracker), the PAT form with the exact
   scopes and a link to the organization's tokens page, Test, then the user picks which projects to show and the
   on-start options (move to In Progress, assign to me).
5. **Add a repository** inspects the folder: remote (and the connection and project it belongs to), base branch,
   stack, dev script, `apm.yml`, env files, an existing `.shellie.yml`; proposes a `.shellie.yml` and lets the user
   write it to the repo or keep the defaults in Shellie only.
6. One restrained Gemini illustration on the Get started page, in the app icon's pale-blue clam palette; nowhere
   else.
7. Telemetry for the funnel (shown, step outcomes, what was detected), scrubbed like everything else.

## Non-goals

- GitHub as a working tracker. Only the `provider` field, the picker card and the `Tracker` interface land.
- Installing agents for the user. Shellie shows the install command with Copy; it never runs it.
- Committing `.shellie.yml`. Shellie writes the file; the user commits it with their next change.
- Detecting every stack. The first proposal covers npm/pnpm/yarn, .NET and a `dev`/`start` script; other repos get
  the current defaults (`npm ci` when `package-lock.json` exists, else nothing) and the editable preview.
- Tours, tooltips or coach marks inside existing pages.

## Anti-goals (what would make this a failure)

- A modal or wizard the user cannot leave. The ADO redesign rule (#15) stands: every screen is a full page, no
  overlays, Back and Skip always visible.
- Two copies of the connection form or the repository form (onboarding and Settings drifting apart).
- Pre-ticking an agent that is not installed, or starting a task with zero tabs without saying so.
- Art that fights the ADO look: no space scenes, no dark hero banners, no art on working pages.

## Constraints

- Electron + React + TypeScript, Vitest; Windows is the release target, macOS the dev platform; shell and spawn
  logic behind `Platform` (`src/main/platform/`). Detection on Windows goes through `Platform` (`where`/`Get-Command`
  as the Windows platform already does for `code` and `pwsh`).
- Connection = one organization + one project (`ConnectionSchema` in `src/shared/types.ts`; PATs encrypted with
  `safeStorage` in `connections.json`). The multi-project pick in Connect creates one connection per picked project,
  sharing the PAT; the Connect page shows them as one organization with N projects. This keeps every existing consumer
  (Home, Sprint, PR creation, cost and time write-back) unchanged.
- Settings are `AppSettingsSchema` in `src/shared/usage.ts`, saved through `settings:save`. Repos are `RepoRegistry`
  (`repos:add(folder)` today). Remote parsing and connection matching exist: `parseAzureReposRemote`,
  `organizationOf`, `matchConnection` in `src/main/services/azureRepos.ts`.
- Telemetry events are listed in `docs/telemetry.md`; main scrubs paths and org/repo names. Nothing from a PAT, a
  remote URL or a folder path is sent.
- Art comes from `tools/art/generate.mjs` with a prompt in `tools/art/prompts.md`, picked by the owner and logged in
  `assets/ART.md` (JPEG under 400 KB).

## The design

### Get started page

- Screen kind `get-started`. Shown instead of Home when there is no repository and `onboarding.dismissedAt` is null
  in settings (new field, see below). "Skip for now" sets `dismissedAt` and goes to Home. Once a repository exists the
  page is no longer forced; the left nav's Home shows a small **Get started** band at the top with the unfinished
  cards until all three are done or the band is dismissed (same `dismissedAt`). Settings › About gets a "Get started"
  link that opens the page again (clears `dismissedAt`).
- Layout: title "Welcome to Shellie", one sentence on what a task is, three cards in order with a state each:
  - Agents: done when `agents:detect` has run once this install (`onboarding.agentsCheckedAt`); the card text names
    what was found and what new tasks open ("Found Claude Code 2.1.307 and OpenCode 1.19.3. New tasks open OpenCode
    and a shell."). Button: Change.
  - Connect your tracker: done when a connection exists or `onboarding.tracker` is `none`. Button: Connect.
  - Add a repository: done when a repository exists. Button: Add folder….
  - The current (first unfinished) card has the accent border and the primary button; others have plain buttons.
- Right column: the illustration (see Art) above a "What you get" card with three lines (Start on a sprint item →
  worktree, branch, setup, agent tabs; Claude Code and Copilot cost per task in EUR; time, changes review, Docs, draft
  PR at Finish).
- Each card's button opens the step page with a step strip (1 Agents › 2 Connect › 3 Repository) at the top and
  Back / Continue at the bottom; Continue goes to the next unfinished step, or to Home after the last. The same pages
  opened from Settings have no step strip and Back returns to Settings (`from: 'settings' | 'get-started'` in the
  screen state).

### Step 1: Agents (`agents:detect`, `AgentsSection`)

- New IPC `agents:detect` → `{ checkedAt, agents: { claude, copilot, opencode }: { found: boolean; version: string |
  null; path: string | null }, shell: { label } }`. Main runs `Platform.which(name)` and, when found, `<name>
  --version` with a 5 s timeout (first line, trimmed; null when it fails). Result cached for the launch; "Check
  again" forces it. Runs in a login shell on macOS like the agent tabs do (`login -c`), so PATH matches what a tab
  gets.
- `AgentsSection` replaces the `TerminalsSection` from #107 in Settings and is the body of the Agents step: a table
  with a checkbox, the agent with its colour dot (`--chart-claude`, `--chart-copilot`, `--chart-opencode`), On this
  machine (Found · version / Not found), Cost tracking (Claude: per task via OpenTelemetry; Copilot: per task via its
  log; OpenCode: not per task, budget only), and a last column: the install command with Copy for a missing agent
  (`npm i -g @anthropic-ai/claude-code`, `npm i -g @github/copilot`, `npm i -g opencode-ai`), "Default agent" for the
  ticked found one, "Pick this if you have no Claude licence" under OpenCode. A shell row (zsh / PowerShell 7 / 5.1
  from `Platform.shellLabel`), always available.
- Pre-tick rule, applied once per install when the step first opens and `onboarding.agentsCheckedAt` is null
  (set when the rule has run): tick found agents in the order Claude Code, then OpenCode, then Copilot,
  but only the first found one; a shell always. Nothing found: no agent ticked, the shell ticked, and a note "No
  agent CLI found. Shellie works with a shell; install one and Check again." Found several: the info card "Both found,
  both ticked? …" appears only when more than one agent is ticked.
- Saving is immediate per click into `defaultTerminals` (as #107); Continue only moves on.

### Step 2: Connect (`provider`, `ConnectionsSection` form)

- `ConnectionSchema` and `ConnectionInput` gain `provider: z.enum(['azure-devops', 'github']).default('azure-devops')`.
  `connections.json` stays version 1; old files parse with the default.
- The page shows three picker cards: Azure DevOps (selectable), GitHub with a "Soon" pill (disabled; tooltip "Issues,
  Projects iterations and pull requests come in a later release"), No tracker (selectable: shows a sentence on blank
  tasks and a Continue that skips the step). Settings shows the same picker above its connection list.
- Azure DevOps form (the existing one, extended): Organization URL, Personal access token, Test. Under the token: the
  scopes in bold (Work Items Read & write, Code Read & write, Project and Team Read) and a link "Open the tokens page
  ↗" to `<organizationUrl>/_usersSettings/tokens`. Azure DevOps has no URL that preselects scopes, so the link opens
  the page and the scopes stay listed next to it with Copy. (The mockup said "preselected"; this is the correction.)
- Test (`connections:probe`, new): with the org URL and PAT, calls `_apis/connectionData` for the user and
  `_apis/projects` for the list; returns `{ user, projects: { id, name }[], expiresAt? }` (the expiry comes from
  `_apis/tokens/pats` when the PAT has the scope, else null). Then "Signed in as …", the project checkboxes (all
  unticked except when there is one project) and the on-start options (move, assign; defaults on).
- Continue saves one connection per ticked project (name `<org>/<project>`), with the same PAT. The on-start
  options are stored as `workItemOnStart` on each `Connection` (new field, same `StartSettingsSchema`) and copied
  into a repo's own `workItemOnStart` at `repos:add`; never applied retroactively, the per-repo Settings stay the
  editable truth.
- Adding a project later to an organization that already has connections: `connections:probe` also accepts a
  `connectionId`, reuses that connection's stored token, and the Settings entry "Add a project" on the organization
  group opens the Connect page in that mode (no PAT asked again).
- "No tracker" sets `onboarding.tracker: 'none'` and counts the card as done; adding a connection later clears it.
- Settings shows connections grouped by organization and provider; "Update token" (from #82) updates every
  connection of that organization in one go.

### Step 3: Add a repository (`repos:inspect`, `repos:add` with options)

- New IPC `repos:inspect(folder)` → `RepoInspection`:
  - `remote`: `{ url, provider: 'azure-devops' | 'github' | 'other' | null, connectionId, project }` using
    `parseAzureReposRemote` + `matchConnection`; GitHub remotes (`github.com`) are recognised for the note only.
  - `baseBranch` from `origin/HEAD`, else `main`/`master` if present, else the current branch.
  - `facts`: `{ lockfile: 'npm' | 'pnpm' | 'yarn' | null, dotnet: string[] (sln/csproj names), devScript: string |
    null, apm: boolean, envFiles: string[] (existing, git-ignored `.env*` and `appsettings.*.local.json`), existing:
    string | null (an existing .shellie.yml's text) }`.
  - Nothing in Shellie runs a `run:` entry yet (the schema parses it, Settings prints it). The page row is therefore
    "Scripts", not "Dev server", and says the entry is kept in `.shellie.yml` for later; the proposal still writes
    `run: { dev: … }` because the schema supports it. Starting a run tab from it is a separate feature.
  - `proposal`: the YAML text Shellie would write (see below), or null when a `.shellie.yml` already exists.
- Proposal rules: `base: <baseBranch>`; `branch: "{type}/{id}-{slug}"`; `copy: [<envFiles>]` when any;
  `setup:` `npm ci` / `pnpm install --frozen-lockfile` / `yarn install --frozen-lockfile` by lockfile, plus `dotnet
  restore` when `dotnet` is non-empty; `run: { dev: <npm run dev | npm start> }` when `devScript` is set; a comment
  line about `apm.yml` when found. Parsed back through `ShellieYmlSchema` before it is shown, so the proposal is
  always valid.
- The page: Folder with Browse… (`repos:pickFolder`), the "What Shellie found" table (Remote with a "Linked to
  project X" pill or "Not linked: add a connection for this organization" or the GitHub note), Base branch, Stack,
  Dev server, Agent packages, Env files; the proposed `.shellie.yml` in a code block with Edit (a textarea in place,
  validated through the schema on blur, errors shown under it); the radio "Write .shellie.yml to the repository" /
  "Keep these defaults in Shellie only"; Add repository.
- `repos:add(folder, options?)` with `options: { writeConfig?: string }`: writes the file (fails if it exists), then
  registers the repo as today (`configFound` true when written), links `connectionId` from the inspection, copies the
  connection's on-start defaults. "Keep in Shellie only" registers without writing; `loadShellieConfig` keeps
  returning the built-in defaults, so there is no second config store (my call: a proposal that is not written is
  simply not used; the page says so). One exception: the inspected base branch is persisted as `repo.baseBranch`
  (today `describe()` takes it from the config, `main` without a file) and `repos:refresh` keeps it when there is no
  `.shellie.yml`, so Start branches from the real base (`develop`, `master`) either way.
- Settings › Repositories › Add folder… opens this page (`from: 'settings'`); the old direct add is gone.

### `Tracker` interface (GitHub readiness)

- `src/main/trackers/Tracker.ts`: the operations the app performs on a tracker today, named neutrally:
  `currentIteration(project)`, `iterationItems(...)`, `items(ids)`, `itemTypes(project)`, `startItem(id, options)`,
  `writeCost(...)`, `writeTime(...)`, `comment(...)`, `pullRequests(...)`, `createDraftPullRequest(...)`,
  `linkPullRequest(...)`, `probe()`. `AzureDevOpsTracker` wraps the current `AdoClient`/`azureRepos` calls without
  changing them; handlers obtain a tracker via `trackerFor(connection)` (switch on `provider`; `github` throws
  "not supported yet" and the UI never offers it).
- Reach (decided 2026-10-22): **the IPC handlers only**. The `s.ado.client(...)` sites in `src/main/ipc/handlers.ts`
  go through `Tracker`, and `AdoRegistry` becomes the tracker registry (same cache and `invalidate`). `HomeService`,
  `homePr`, `UsageSync` (cost write-back), time write-back and draft PR creation keep calling `AdoClient` directly and
  move behind `Tracker` when GitHub actually lands, so the paths verified live against the test org are not touched
  now. The interface still declares the operations those files perform, so the second implementation has one
  contract to meet.
- UI words: Azure DevOps pages keep "work item", "sprint", "pull request". Shared components that would show a
  provider's noun take it from `nouns(provider)` (`item`, `iteration`, `pullRequest`), so a GitHub implementation
  changes labels without touching the pages. This design only introduces the helper and uses it in the new pages.
- Explicitly left to a later design: GitHub auth (device flow vs PAT), Projects iteration mapping, PR write-back,
  and moving Home, write-back and PR creation behind `Tracker`.

### Settings changes

- `AppSettingsSchema` gains `onboarding: { dismissedAt: string | null; agentsCheckedAt: string | null; tracker:
  'none' | null }` (default null). Existing installs: when a repository already exists at first start of this
  version, the migration sets both `dismissedAt` and `agentsCheckedAt`, so nobody who already uses Shellie sees Get
  started and nobody's #107 choice is re-ticked (`settings:save` writes the whole file, so "has the user saved
  `defaultTerminals`" cannot be read from data; `agentsCheckedAt` is the only signal). Nav: the "Terminals and agents" section becomes "Agents and terminals" and
  holds `AgentsSection`; "Azure DevOps" becomes "Connections" with the provider picker.

### Art

- One image, `assets/art/get-started.jpg`, generated through `tools/art/generate.mjs` from a new "Onboarding"
  section in `tools/art/prompts.md`. Style block (new, not the Culture one): "Flat, minimal vector-like illustration
  for a developer tool, soft pale blue (#dbeafb) background, a single faceted clam shell in four blues from near-white
  (#f1f7ff) through #a9d0f8 and #1f56a8 to navy #122f5c, hinge up, resting on a thin pale shelf, lots of empty
  space, no text, no letters, no logos, no people, no gradients heavier than a soft shadow." Landscape 3:2, shown at
  360×240 CSS px. Works in light and dark (pale image on either page background; a 1 px `--line` border).
- Picked by the owner from the candidates, logged in `assets/ART.md`. When the file is missing the page shows the
  icon's `MindMark` in the same box, so the build never depends on the art.

### Telemetry (`docs/telemetry.md`)

- `onboarding.shown` (none), `onboarding.step` (`step`: agents | connect | repository; `outcome`: continued | skipped
  | back), `onboarding.dismissed` (`repos`, `connections` counts), `agents.detected` (`claude`, `copilot`, `opencode`
  booleans; versions are not sent), `repo.inspected` (`remote`: azure-devops | github | other | none; `linked`
  boolean; `lockfile`; `dotnet` boolean; `devScript` boolean; `apm` boolean; `existingConfig` boolean), `repo.added`
  gains `wroteConfig`. `connections:probe` failures go as `connection.probeFailed` with the HTTP status only.

## What's left to the builder

- Exact copy beyond the mockups; the step strip and card styles (ADO palette, `--radius-card`, existing `.card` and
  `.btn` classes).
- How `agents:detect` runs the login shell on macOS and `Get-Command` on Windows inside `Platform` (a `which` already
  exists on the Windows platform's deps; darwin needs one).
- Whether `connections:probe` reuses `AdoClient` with a throwaway client or a static helper.
- Test fixtures: a fake `which`, fake ADO responses for `connectionData`/`projects`, temp repos with the lockfiles for
  `repos:inspect`.
- Order of work. Suggested: (1) `provider` + `Tracker` wrapper (pure refactor, no UI); (2) `agents:detect` +
  `AgentsSection`; (3) `repos:inspect` + the repository page, wired to Settings; (4) `connections:probe` + the Connect
  page; (5) Get started page, `onboarding` settings, migration; (6) art and telemetry docs.

## Calls I made (for the owner to check)

- The multi-project pick creates one connection per project (no model change for the rest of the app).
- `run:` entries are proposed but nothing starts them yet; the page calls them Scripts and does not promise a dev
  server tab.
- The inspected base branch is saved on the repo even when `.shellie.yml` is not written.
- On-start defaults live on the connection and are copied into each repo at add time.
- Adding a project to a known organization reuses the stored token; no PAT twice.
- Existing installs are migrated with `agentsCheckedAt` set, so the pre-tick never overrides a #107 choice.
- "No tracker" is a finished state of the Connect card, not a skip.
- The tokens-page link cannot preselect scopes; the scopes stay listed with Copy.
- A `.shellie.yml` that is not written is not used: no hidden per-repo config in Shellie.
- Pre-tick picks one agent (Claude Code, else OpenCode, else Copilot) plus the shell, so a task never opens two agent
  tabs by default.
- Existing installs with a repository never see Get started (migration sets `dismissedAt`).
- The art is one pale, flat clam image on Get started only, with the icon as fallback.
