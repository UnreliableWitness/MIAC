# Home: a developer dashboard across connections

Date: 2026-10-17. Owner decisions:
- A new **Home** page is the start page. It covers every connection, because a developer can work in several Azure DevOps orgs and projects.
- Purpose: **both a launchpad and a personal overview**, weighted to the launchpad: what to work on now first, a compact stats band below.
- Layout: **stacked full-width bands** (mockup option B): my tasks, then reviews and my PRs side by side, then my sprints, then stats.
- Sprints shown: **the sprints where I have work** (items assigned to me in a current iteration of a team I'm in), with linked projects where I have nothing shown as slim "nothing assigned" cards.
- **Pull requests that need my review** are on Home: named requests first, requests to a team I'm in collapsed under "Team requests (n)".
- Data comes from **one aggregating service in main** with a cached snapshot (approach A).

Calls marked *(our call)* were made during design and not explicitly decided by the owner.

## Why

The app opens on the Sprint page, which shows one project's default team. A connection is one org plus one project (`ConnectionSchema`: `organizationUrl`, `project`), and a developer often has several. To see what needs doing they switch project by project, and nothing shows the PRs waiting for their review or how their week went.

## Goals

- One page, opened at launch, that answers "what do I work on now" across all connections: open tasks, things that need attention, PRs to review, my sprints.
- A compact personal overview: AI cost, time, estimate accuracy and throughput for this week or month.
- One failing connection never blanks the page.

## Non-goals

- Searching work items across connections.
- Reviews requested from security groups that are not ADO teams (`[Project]\Contributors` and the like). Resolving group membership needs the Graph API and a wider PAT scope.
- Re-review detection (I voted "Waiting for author" and the author pushed since).
- Configurable or pinned sprints, widgets or layout.
- Replacing the Sprint page. It stays as the per-project detail view.

## Anti-goals (a failure even if it works)

- Comparing developers or showing anyone else's stats. Like time tracking, Home shows the developer's own data on their own machine only.
- A network call blocking the first paint: Home renders from the cached snapshot and local stores.
- Writing anything to Azure DevOps.

## 1. Page

### Navigation

- Home is the top item in the left nav (`TaskNav`), and a new screen kind `{ kind: 'home' }` in `store.ts`. The app starts on it, and it replaces `{ kind: 'sprint' }` as the fallback when a task's screen goes away.
- The Sprint item and the project switcher stay as they are.
- Header breadcrumb: "Home". On the right of the page header: a refresh button, "updated 2 min ago", and a **health chip per connection**: green when OK, red when unauthorized or unreachable, amber when its data is stale. A chip click opens Settings › Connections.

### Band 1: My tasks

- A card per open MIAC task over all connections (states other than done): work item ID and title, connection name, status (setting up, ready, needs attention), live cost and active time. Click opens the task (`select`), and a task that needs attention (failed setup, failed push or PR at Finish) shows its Retry action, which goes to the screen that offers it.
- The last card is **Up next**: up to 3 items assigned to me in a current sprint, in a state of category Proposed, with no MIAC task, each with Start (the same `startTask` flow as the Sprint page). Order: sprint order as returned, oldest sprint end first *(our call)*.
- Cards wrap onto more rows when there are many.

### Band 2: Reviews for me | My pull requests (side by side)

- **Reviews for me:** active PRs where I'm a named reviewer and my vote is 0 (no vote), oldest first. Row: repo, title, author, age, draft, merge conflict, my vote. Below them a collapsed **Team requests (n)** row: active PRs that list one of my teams as reviewer and not me by name. Expanding it shows the same rows.
- **My pull requests:** my active PRs: repo, title, age, votes summary (approved, waiting, rejected), draft, merge conflict.
- A row click opens the PR in the browser (`shell.openExternal` through the existing link handler).

### Band 3: My sprints

- One card per (connection, iteration) with items of mine: connection name, iteration name, days left, my items by state category (to do, in progress, done), spent against estimate with the progress bar from time tracking (same estimate rules, `2026-10-16-time-tracking-design.md` §2), amber when over.
- A card click switches the project to that connection and opens the Sprint page.
- Connections linked to a repo where I have nothing in a current sprint: a slim muted card "nothing assigned" at the end.

### Band 4: Stats

- A **This week / This month** toggle *(week starts Monday, local time; our call)*. Tiles:
  - AI cost in EUR. Tooltip: split by tool (Claude Code, Copilot CLI) and by connection.
  - Active time and agent time (from `TimeStore`).
  - Estimate accuracy: total spent ÷ total estimate over tasks finished in the period that have an estimate, as a percentage; `–` when none.
  - Tasks finished and PRs opened (from finished tasks' summaries) in the period.
- All local data. It does not depend on `writeCostToAdo` or the time write-back setting.

### Empty and loading states

- No connections: bands 2 and 3 are replaced by one line, "Add an Azure DevOps connection", linking to Settings. Bands 1 and 4 still show.
- A band with nothing in it keeps its title and shows one muted line ("No reviews waiting", "No open tasks"), so the layout doesn't move.
- First launch without a cached snapshot: bands 2 and 3 show skeleton rows until the first build finishes.

## 2. Data and architecture

### `HomeService` (main, `src/main/home/`)

Builds a `HomeSnapshot` (schema in `src/shared/types.ts`, zod like the rest):

```ts
HomeSnapshot = {
  builtAt: string;
  connections: {
    id: string; name: string;
    status: 'ok' | 'error' | 'stale';
    error: string | null;      // short, user-facing
    fetchedAt: string | null;  // last successful fetch
  }[];
  sprints: HomeSprint[];        // connectionId, iteration id/name/path, start/finish dates, my items
  upNext: HomeWorkItem[];
  reviews: { named: HomePr[]; team: HomePr[] };
  myPrs: HomePr[];
}
```

`HomeWorkItem` carries id, type, title, state, state category, iteration path, and the estimate fields time tracking already reads. `HomePr` carries connection id, repo, id, title, author, created date, draft, merge status, my vote, votes summary and web URL.

Tasks are not in the snapshot: the renderer already has them in its store. Stats are a separate local call (below).

### Per connection, in parallel

Each connection runs these steps through its `AdoClient` (from `AdoRegistry`), with a 15 s timeout for the whole connection *(our call)*:

1. **Me:** `GET {org}/_apis/connectionData` → `authenticatedUser.id`. Cached in memory per connection.
2. **My teams:** `GET {org}/_apis/projects/{project}/teams?$mine=true`.
3. **Current iterations:** `GET {org}/{project}/{team}/_apis/work/teamsettings/iterations?$timeframe=current` per team, deduplicated by iteration path.
4. **My items:** one WIQL query, `[System.AssignedTo] = @Me AND [System.IterationPath] IN (<paths>)`, then a batch get of the fields. Skipped when there are no paths. These feed the sprint cards and Up next.
5. **Reviews:** `GET {org}/{project}/_apis/git/pullrequests?searchCriteria.reviewerId=<me>&searchCriteria.status=active` for named requests, and the same call per team ID from step 2 for team requests, minus PRs that already list me by name.
6. **My PRs:** `searchCriteria.creatorId=<me>&searchCriteria.status=active`.

Steps 1, 2, 3, 4 and 5–6 each fail on their own: a failed step leaves its part of the snapshot empty for that connection with an error, and the other parts still fill. The PAT scopes already required (Work Items read & write, Code read & write) cover all calls.

Steps 1, 2, 3 and 5 were checked live against `unreliablewitness/MIAC` on 2026-10-17 (all 200; `$mine` returns `MIAC Team`; the current iteration is `MIAC\Sprint 1`; the reviewer filter also works at org level). Steps 4 and 6 use the existing WIQL path and the documented `creatorId` filter, checked during the live check before merge.

### Caching and refresh

- The last snapshot is written to `home.json` in the data folder through `JsonFileStore`, so Home renders straight away at launch.
- Rebuild when Home is opened and the snapshot is older than 60 s, every 5 minutes while the window has focus, and on the refresh button. One rebuild at a time: a request during a rebuild joins it.
- A connection that fails keeps its previous data in the snapshot, marked `stale`, with `error` set. A connection that was removed is dropped from the snapshot.

### Stats (`src/main/home/homeStats.ts`)

`homeStats(period, now)` reads `UsageStore`, `TimeStore` and the task store, and returns the tile values and the cost splits. Pure function over the store contents, so it is unit tested without IO.

### IPC (`src/shared/ipc.ts`)

- `home:get` → the cached `HomeSnapshot | null`.
- `home:refresh` → starts a rebuild and resolves when it finishes, with the new snapshot.
- `home:updated` (main → renderer event) → a rebuild finished (also the 5-minute ones).
- `home:stats` `(period: 'week' | 'month')` → stats.

### Renderer

- `src/renderer/screens/HomeScreen.tsx` with one component per band in `src/renderer/components/home/`.
- Reuses `TaskTypeIcon`, the state colours from `workItems:types`, the cost and duration formatting in `format.ts`, and the spent / estimate bar from the Sprint page (extracted into a shared component if it is inline today).

### Telemetry

`home_viewed`, `home_refresh` (duration, connection count, failed connection count), `home_click` (band: task, up-next, review, team-review, my-pr, sprint, stats-period). No names or IDs. Added to `docs/telemetry.md`.

## 3. Errors

- **401/403:** the connection's chip goes red, its sprints and PRs stay visible greyed with "stale since 09:12", and one notice says the PAT for that connection was refused, with a link to Settings.
- **Unreachable or timeout:** same, with an amber chip. Retried on the next refresh only.
- **One step fails** (for example PRs): that band shows "Couldn't load pull requests for <connection>"; the rest of the connection's data still shows.
- **No current iteration** for any of my teams: no sprint card for that connection, and the "nothing assigned" card if it is linked to a repo.
- A rebuild never rejects to the renderer: failures are data in the snapshot. Each failure kind is tracked once per rebuild, scrubbed by the existing telemetry scrubber.

## 4. Testing

- **`HomeService`** against `src/main/test-helpers/adoServer.ts`: two connections, one OK and one returning 401 (stale data kept, other connection updates); two teams sharing an iteration (one card); named vs team reviews (no duplicates); Up next skips items with a MIAC task and items not in category Proposed; a failing PR step leaves sprints intact; concurrent refresh requests share one rebuild; a removed connection drops out.
- **`homeStats`:** week and month boundaries in local time, Monday start; cost split by tool and connection; accuracy only over finished tasks with an estimate; empty stores.
- **`HomeScreen`:** each band's empty state; no-connections state; the team requests row collapsed by default; stale styling and chips; card and row clicks go to the right screen or URL; Start on Up next calls `startTask`.
- **App and store:** the app opens on Home; the fallback screen is Home; the Sprint nav item still works.
- **Live check before merge:** seed an active PR in the test org with my user as reviewer and one with `MIAC Team` as reviewer, then click through the packaged app with asserted results (named review row, team requests count, sprint card for `Sprint 1`, Up next item, refresh, a broken PAT on a second connection turning its chip red).

## Known gaps

- Team requests cover ADO teams only, not other security groups.
- Up next only looks at current sprints, not the backlog.
- Stats count PRs opened through MIAC's Finish only.
