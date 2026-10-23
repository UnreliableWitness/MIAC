# Cost Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shellie records every AI request it can see (Claude Code, Copilot CLI, OpenCode with any provider) as one priced, attributed record, keeps separate Claude and Copilot budgets, writes no cost to Azure DevOps, and can send the records to a company cost server.

**Architecture:** Two pipelines read the same local sources with the same pricing. The existing budget pipeline (`src/main/budget/`) gains a `vendor` dimension and Copilot CLI input, and serves two budget bands. A new ledger pipeline (`src/main/ledger/`) keeps one record per request id in month JSONL files, attributes it (task > repo > none, only upward), feeds OpenCode task usage into the Usage tab, and a sender upserts dirty records to the cost server.

**Tech Stack:** Electron main (Node, TypeScript, zod), React renderer, Vitest. `node:sqlite` for OpenCode, `fetch` for the server.

**Spec:** `docs/superpowers/specs/2026-10-23-cost-ledger-design.md`

## Global Constraints

- No cost, token count or model reaches Azure DevOps or a PR after this work. `grep -rn "Custom.AI" src` finds nothing.
- Never sent to the server: prompts, responses, code, file paths, `cwd`, terminal output, task title. Sent: the `CostRecord` fields in Task 5, nothing more.
- Record ids: `cc:<message.id>` (Claude transcripts), `oc:<message id>` (OpenCode), `cp:<traceId>:<spanId>` (Copilot CLI), `sh:<request_id>` (Shellie's own `claude -p` for the PR description).
- Amounts are list price, `OFFICIAL_USD_TO_EUR` (0.92); an unpriced request is `null`, never 0.
- Vendor: `claude` = tool `claude-code`, or OpenCode provider `anthropic`. `copilot` = tool `copilot-cli`, or OpenCode provider `github-copilot`. Anything else `null` (in no budget).
- `billable: false` never lowers a budget.
- Attribution only goes up: `none` → `repo` → `task`; at `task` it is frozen (only `billable` may change).
- Server: `https` only, except `http://localhost` / `http://127.0.0.1`. Key encrypted with safeStorage, never in `settings.json`, logs or telemetry.
- Sending never blocks launch, task start, Finish or the Usage tab. 15 s request timeout, batches of at most 500, backoff up to 30 min.
- Telemetry never carries amounts, models, emails, organization or project names, the server address or key.
- Checks before every commit: `npx vitest run <changed tests>`; before the last commit of each task: `npm run typecheck && npm run lint`.
- Commit messages end with the session's attribution lines (see CLAUDE.md / the session's reminder).

## Review Focus

1. A Claude Code message written several times with growing tokens (the transcript reader re-emits it): the ledger keeps the largest copy, once, and resends it. Test in Task 6.
2. A worktree path reused by a later task: OpenCode messages from before that task's first open period stay with the earlier task (or repo), never move. Test in Task 6.
3. Server down for hours, then up: nothing lost, nothing doubled, records sent in order of `at`, the app stays quiet except the Settings status. Test in Task 8.
4. A `budget.json` from the previous version (v1 rows with `counted`): loads without a rescan, Claude totals unchanged. Test in Task 3.
5. Removing a repo or a task after its records were sent: their attribution does not change and nothing is resent. Test in Task 6.

---

### Task 1: Remove cost write-back to Azure DevOps

Ships on its own (nobody uses it).

**Files:**
- Delete: `src/main/usage/UsageSync.ts`, `src/main/usage/UsageSync.test.ts`, `src/shared/workItemUsage.ts`, `src/shared/workItemUsage.test.ts`, `src/renderer/hooks/useWriteCostToAdo.ts`
- Modify: `src/shared/usage.ts` (drop `writeCostToAdo`, `hourlySync`, `AI_FIELDS`), `src/main/usage/SettingsStore.ts` (defaults), `src/main/ipc/handlers.ts` (`writeCost`, `costLineFor`, hourly sync at ~712, `syncUsageOnFinish` ~1478, `usage:sync` ~2629, cost line ~1390 and ~2220, `task.finished` write-back property ~1468), `src/shared/ipc.ts` (`usage:sync` and any sync status channels), `src/main/services/azureRepos.ts` (`prDescription` cost line and "(whole task, N repos)" wording, keep the rest), `src/renderer/components/CostSection.tsx` (cost write-back and hourly sync controls), `src/renderer/components/UsagePanel.tsx` (field labels ~27-30, sync status), `src/renderer/components/PrDescriptionField.tsx`, `src/renderer/screens/FinishScreen.tsx`, `src/main.ts` (UsageSync wiring), `docs/telemetry.md`
- Test: the existing tests of each modified file (`handlers.test.ts`, `CostSection.test.tsx`, `SettingsScreen.test.tsx`, `FinishScreen.test.tsx`, `UsagePanel.test.tsx`, `SettingsStore.test.ts`, `azureRepos.test.ts`)

**Interfaces:**
- Produces: `AppSettings` without `writeCostToAdo` and `hourlySync`. `prDescription(...)` signature unchanged minus its cost argument.

- [ ] **Step 1: Write the failing tests**
  - `SettingsStore.test.ts`: `it('ignores writeCostToAdo and hourlySync from an old settings.json')`: parse `{ version: 1, receiverPort: 4319, hourlySync: true, writeCostToAdo: true }` → result has neither key (`expect('writeCostToAdo' in s).toBe(false)`).
  - `azureRepos.test.ts`: `it('never puts AI cost in the PR description')`: `prDescription` output contains no `€`, no `AI cost`, no `recorded by Shellie`.
  - `handlers.test.ts`: `it('Finish writes no Custom.AI fields and posts no usage comment')`: finish a task with usage records; the fake ADO client's `updateFields` and `addComment` were not called.
- [ ] **Step 2: Run them** — `npx vitest run src/main/usage/SettingsStore.test.ts src/main/services/azureRepos.test.ts src/main/ipc/handlers.test.ts` — FAIL.
- [ ] **Step 3: Remove the code** listed above. `AppSettingsSchema` drops both fields; zod strips unknown keys so old files load. Delete the tests that covered the removed behaviour (sync, fields, comment, cost line, the hourly toggle).
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint` — PASS. `grep -rn "Custom.AI\|writeCostToAdo\|UsageSync\|renderCostLine" src` — no output.
- [ ] **Step 5: Commit** `git commit -m "Remove AI cost write-back to Azure DevOps and PR descriptions"`

### Task 2: Capture inputs: source tag, Copilot provider prefix, records from the usage store

**Files:**
- Modify: `src/main/usage/telemetryEnv.ts`, `src/main/usage/otlp.ts`, `src/shared/usage.ts` (`UsageEvent`), `src/main/ipc/handlers.ts:~2815` (PR summary env), `src/main/pricing/RateTable.ts` (`normalizeModel`), `src/shared/budget.ts` (`BudgetTool`, `BudgetRecord`)
- Create: `src/main/budget/usageRecords.ts`
- Test: `telemetryEnv.test.ts`, `otlp.test.ts`, `RateTable.test.ts`, `src/main/budget/usageRecords.test.ts`

**Interfaces:**
- Produces:
  - `telemetryEnv(taskId: string, port: number, usageDir: string, source?: 'pr-summary'): Record<string, string>`; with `source` → `OTEL_RESOURCE_ATTRIBUTES` is `shellie.task.id=<id>,shellie.source=pr-summary`.
  - `UsageEvent.source?: 'pr-summary'`, set by `parseClaudeLogs` from resource attribute `shellie.source`.
  - `BudgetTool = 'claude-code' | 'opencode' | 'copilot-cli'`; `BudgetRecord.taskId?: string`.
  - `budgetRecordsFromUsage(records: UsageRecord[]): BudgetRecord[]` in `usageRecords.ts`: Copilot CLI records → `{ id: 'cp:' + r.id, tool: 'copilot-cli', provider: 'github-copilot', cwd: null, taskId, cacheWrite5mTokens: r.cacheWriteTokens, cacheWrite1hTokens: 0, … }`; Claude records with `source === 'pr-summary'` → `{ id: 'sh:' + r.id, tool: 'claude-code', provider: 'anthropic', … }`; all other usage records are dropped (Claude tab usage comes from transcripts).

- [ ] **Step 1: Write the failing tests**
  - `telemetryEnv.test.ts`: `it('tags the PR summary run')` → `env.OTEL_RESOURCE_ATTRIBUTES === 'shellie.task.id=t1,shellie.source=pr-summary'`; without `source` it stays `shellie.task.id=t1`.
  - `otlp.test.ts`: `it('reads shellie.source')` → event has `source: 'pr-summary'`; absent attribute → `source` undefined.
  - `RateTable.test.ts`: `it('strips the github-copilot/ prefix')` → `normalizeModel('github-copilot/claude-sonnet-4.5') === 'claude-sonnet-4-5'`.
  - `usageRecords.test.ts`: `it('maps Copilot CLI and PR summary records, drops tab records')` with three `UsageRecord`s (copilot-cli; claude-code + source; claude-code without source) → two records with ids `cp:…` and `sh:…`, providers `github-copilot` and `anthropic`, the third absent.
- [ ] **Step 2: Run** `npx vitest run src/main/usage src/main/pricing src/main/budget/usageRecords.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Add `github-copilot` to the prefix list in `normalizeModel`. Pass `'pr-summary'` to `telemetryEnv` at the PR summary call site in `handlers.ts` (the tab call at ~1176 stays without).
- [ ] **Step 4: Run** the same tests, then `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `git commit -m "Tag Shellie's own Claude runs and map Copilot CLI usage to budget records"`

### Task 3: Two budgets in main (vendor rows, Copilot input, per-vendor alerts)

**Files:**
- Modify: `src/shared/budget.ts`, `src/main/budget/BudgetStore.ts`, `src/shared/budgetView.ts`, `src/main/budget/BudgetService.ts`, `src/shared/usage.ts` (`copilotBudget` setting), `src/shared/ipc.ts` (`budget:get`), `src/main/ipc/handlers.ts:~3729`, `src/main.ts:~642-690`
- Test: `BudgetStore.test.ts`, `budgetView.test.ts`, `BudgetService.test.ts`, `handlers.test.ts`

**Interfaces:**
- Consumes: `budgetRecordsFromUsage` (Task 2).
- Produces:
  - `export type Vendor = 'claude' | 'copilot'` and `vendorOf(r: { tool: BudgetTool; provider: string }): Vendor | null` in `src/shared/budget.ts` (the Global Constraints rule).
  - `BudgetRow.vendor: Vendor | null` replaces `counted`; `rowKey` uses it. File `version: 2`. A v1 file is migrated on load (zod preprocess): `counted: true` → `'claude'`; `counted: false` → `'copilot'` when `provider === 'github-copilot'`, else `null`; cursors, `seen` and alerts kept (alerts move to key `claude:<monthKey>`).
  - `BudgetStore.apply` no longer drops records `isCounted` returned null for (`isCounted` is removed); every record is rolled up, priced when a rate exists.
  - `BudgetFile.alerts: Record<string, AlertKind[]>` keyed `<vendor>:<monthKey>`.
  - `budgetView({ …, vendor: Vendor })`: rows with `vendor === input.vendor` are counted; every other row goes to the existing "not counted" list (labelled by provider).
  - `BudgetServiceDeps.settings: (v: Vendor) => BudgetSettings`; new dep `extra: () => BudgetRecord[]` (main passes `budgetRecordsFromUsage(usage.allRecords())`); `view(vendor: Vendor, monthOffset: number): BudgetView`; alerts checked per vendor with titles `Claude budget: 80% used` / `Copilot budget: 80% used` (same three texts per vendor); telemetry `budget.alert` gains `vendor`.
  - `UsageStore.allRecords(): UsageRecord[]` (add if missing; returns every loaded record).
  - Settings: `copilotBudget: BudgetSettingsSchema.default(defaultBudgetSettings())`.
  - IPC: `'budget:get': { args: [vendor: Vendor, monthOffset: number]; result: BudgetView }`.

- [ ] **Step 1: Write the failing tests**
  - `BudgetStore.test.ts`: `it('migrates a v1 file without a rescan')`: a v1 fixture with one counted Claude row (€1.20) and one uncounted `github-copilot` Claude row → after `load()`, rows have vendors `claude` and `copilot`, cursors unchanged, the Claude total still €1.20.
  - `BudgetStore.test.ts`: `it('keeps GPT through Copilot and other providers')`: an OpenCode record `{ provider: 'github-copilot', model: 'gpt-5-mini' }` and one `{ provider: 'openai', model: 'gpt-5-mini' }` → rows with vendors `copilot` and `null`, the first priced from the Copilot rate.
  - `budgetView.test.ts`: `it('counts only the asked vendor')`: rows for both vendors → `view('copilot')` spent equals the Copilot row; Claude row appears under not counted.
  - `BudgetService.test.ts`: `it('alerts per vendor')`: Claude at 85% and Copilot at 10% → one notification titled `Claude budget: 80% used`; a second pass raises nothing.
  - `BudgetService.test.ts`: `it('rolls up Copilot CLI records from the usage store')`: `extra` returns one `cp:` record → it is in `view('copilot')`.
- [ ] **Step 2: Run** `npx vitest run src/main/budget src/shared/budgetView.test.ts` — FAIL.
- [ ] **Step 3: Implement** per Interfaces. In `main.ts`, `settings: (v) => v === 'claude' ? s.claudeBudget : s.copilotBudget` (Task 9 adds the server override behind this same function).
- [ ] **Step 4: Run** `npm test && npm run typecheck` — PASS (renderer callers of `budget:get` get `'claude'` until Task 4).
- [ ] **Step 5: Commit** `git commit -m "Budgets per vendor: Claude and Copilot, with Copilot CLI and GPT through Copilot counted"`

### Task 4: Two budget bands and the Budgets settings

**Files:**
- Modify: `src/renderer/hooks/useBudget.ts` (takes a vendor), `src/renderer/components/home/BudgetBand.tsx` (prop `vendor`, title and `INFO` per vendor), `src/renderer/screens/HomeScreen.tsx:~132`, `src/renderer/components/BudgetSection.tsx` (both budgets, heading "Budgets"), the Settings nav label
- Test: `BudgetBand.test.tsx`, `BudgetSection.test.tsx`, `HomeScreen` test if present

**Interfaces:**
- Consumes: `budget:get(vendor, offset)` (Task 3), settings `claudeBudget` / `copilotBudget`.
- Produces: `<BudgetBand vendor="claude" | "copilot" />`; `useBudget(vendor: Vendor, monthOffset: number)`; `BudgetSection` prop `managed?: { claude: boolean; copilot: boolean }` (Task 9 sets it; when true that budget's amount and start day are read-only with the text `Set by your cost server`).

- [ ] **Step 1: Write the failing tests**
  - `BudgetBand.test.tsx`: `it('titles the Copilot band')` → heading `Copilot budget`; info text mentions `GitHub Copilot list prices`.
  - `BudgetBand.test.tsx`: `it('hides a band with no spend and no budget')` → renders nothing for a view with `spentEur 0` and `budgetEur null` (Copilot only; the Claude band keeps today's behaviour).
  - `BudgetSection.test.tsx`: `it('edits both budgets')` → changing the Copilot amount saves `copilotBudget.monthlyEur`; `it('locks a managed budget')` → with `managed.copilot` the inputs are disabled and `Set by your cost server` shows.
- [ ] **Step 2: Run** `npx vitest run src/renderer/components/home/BudgetBand.test.tsx src/renderer/components/BudgetSection.test.tsx` — FAIL.
- [ ] **Step 3: Implement.** Home renders the Claude band then the Copilot band. Claude `INFO` loses "Claude models through Copilot aren't counted" and says they count in the Copilot budget. Copilot `INFO`: `Estimated at GitHub Copilot list prices in EUR. Credits included with your seat aren't subtracted.`
- [ ] **Step 4: Run** the tests, `npm run typecheck && npm run lint` — PASS.
- [ ] **Step 5: Commit** `git commit -m "Home and Settings: a Copilot budget next to the Claude budget"`

### Task 5: Ledger store

**Files:**
- Create: `src/shared/ledger.ts`, `src/main/ledger/LedgerStore.ts`
- Test: `src/main/ledger/LedgerStore.test.ts`

**Interfaces:**
- Produces, in `src/shared/ledger.ts`:
  ```ts
  export type Attribution =
    | { level: 'task'; taskId: string; organization: string; project: string;
        workItemId: number | null; workItemTitle: string | null; workItemType: string | null; repo: string }
    | { level: 'repo'; organization: string | null; project: string | null; repo: string }
    | { level: 'none' };
  export type CostRecord = BudgetTokens & {
    id: string; tool: BudgetTool; provider: string; vendor: Vendor | null;
    model: string; modelLabel: string; at: string; fast: boolean;
    costUsd: number | null; costEur: number | null; rateId: string | null;
    billable: boolean; attribution: Attribution; developer: string | null; shellieVersion: string;
  };
  export const LEVEL_RANK = { none: 0, repo: 1, task: 2 } as const;
  ```
  (`organization` is the connection's `organizationUrl`.)
- Produces, `LedgerStore` in `src/main/ledger/LedgerStore.ts`:
  - `constructor(dir: string)` — files `<dir>/records-YYYY-MM.jsonl` (month of `at`, UTC) and `<dir>/sent.json` (`Record<id, string>`: id → hash of the version last accepted by the server).
  - `load(): Promise<void>`; `get(id): CostRecord | undefined`; `all(): CostRecord[]`.
  - `upsert(recs: CostRecord[]): Promise<string[]>` — appends only records that differ from the stored version (deep compare); returns changed ids.
  - `dirty(limit: number): CostRecord[]` — records whose current hash differs from `sent.json`, oldest `at` first.
  - `markSent(recs: CostRecord[]): Promise<void>`; `resetSent(): Promise<void>` (Disconnect / new server → everything dirty again).
  - Compaction on `load()`: a month file with more superseded lines than live ones is rewritten (write to temp, rename).

- [ ] **Step 1: Write the failing tests**
  - `it('keeps the latest version per id across reloads')`: upsert v1 then v2 of `cc:a`; new store on same dir → `get('cc:a')` is v2; `all().length === 1`.
  - `it('returns no change for an identical upsert')` → `upsert([same])` returns `[]`, file length unchanged.
  - `it('lists dirty records oldest first and clears them when sent')`: three records, `markSent` the first two → `dirty(500)` has only the third; changing the first makes it dirty again.
  - `it('compacts a month file with more superseded lines than live')` → after 5 versions of one id and reload, the month file has 1 line.
  - `it('splits by UTC month of at')` → records at `2026-09-30T23:30:00Z` and `2026-10-01T00:30:00Z` go to `records-2026-09.jsonl` and `records-2026-10.jsonl`.
  - `it('skips a corrupt line')` → a garbage line between valid ones is ignored, valid ones load.
- [ ] **Step 2: Run** `npx vitest run src/main/ledger/LedgerStore.test.ts` — FAIL.
- [ ] **Step 3: Implement** per Interfaces (hash: `createHash('sha1')` of `JSON.stringify` of the record).
- [ ] **Step 4: Run** the test — PASS.
- [ ] **Step 5: Commit** `git commit -m "Ledger store: one cost record per request, month files, sent tracking"`

### Task 6: Attribution and the ledger pass (including OpenCode in the Usage tab)

**Files:**
- Create: `src/main/ledger/attribute.ts`, `src/main/ledger/price.ts`, `src/main/ledger/LedgerService.ts`
- Modify: `src/shared/usage.ts` (`UsageTool` adds `'opencode'`), `src/main/usage/UsageStore.ts` (accepts `opencode` events; `byTool`), `src/renderer/components/UsagePanel.tsx` (OpenCode colour `--chart-opencode` and label), `src/renderer/components/NewTerminalMenu.tsx:18` (drop "AI cost not tracked"), `src/main.ts` (wiring)
- Test: `src/main/ledger/attribute.test.ts`, `src/main/ledger/LedgerService.test.ts`, `UsageStore.test.ts`, `UsagePanel.test.tsx`, `NewTerminalMenu.test.tsx`

**Interfaces:**
- Consumes: `CostRecord`, `Attribution`, `LEVEL_RANK`, `LedgerStore` (Task 5); `vendorOf` (Task 3); `budgetRecordsFromUsage` (Task 2); `priceTokens` (`BudgetStore.ts`); `ClaudeTranscriptReader`, `OpenCodeReader`; `taskWorkspaces`, `isInside`.
- Produces:
  - `attributionContext(tasks: Task[], repos: Repo[], connections: Connection[]): AttributionContext` and `attribute(r: BudgetRecord, ctx: AttributionContext): Attribution` in `attribute.ts`:
    - task by `r.taskId`; else Claude by tab `sessionId` (from `terminals` and `closedTerminals`); else OpenCode by `cwd` inside one of the task's worktrees **and** `at` inside one of `task.openPeriods` (fallback `[createdAt, finishedAt ?? now]` when empty).
    - else repo by `cwd` inside a repo's `path` or any task worktree of that repo (any time).
    - else `none`.
    - The task's connection: `task.connectionId` else the home repo's `connectionId`; `repo` is the repo of the matching worktree (home repo for session/taskId matches).
  - `merge(prev: CostRecord | undefined, next: CostRecord): CostRecord` in `attribute.ts`: keeps `prev.attribution` when `LEVEL_RANK[prev.level] >= LEVEL_RANK[next.level]` (and always when `prev.level === 'task'`); token fields from whichever copy has more tokens (`tokensOf`); `billable` always from `next`.
  - `LedgerService` with deps `{ store: LedgerStore; claude: reader; openCode: reader; usageRecords: () => UsageRecord[]; context: () => AttributionContext; isBillable: (taskId: string, sessionId: string) => boolean; developer: () => string | null; version: string; toUsage: (e: UsageEvent) => void; changed: () => void }`, `pass(): Promise<void>` (single-flight like `BudgetService.pass`), `start(intervalMs = 30_000)`, `stop()`. Its own readers have no `since` and keep their cursors in `<dir>/cursors.json` (first run = full backfill). Every pass also re-attributes stored records below `task` level (cheap: in memory) and re-applies `billable`.
  - `priceRecord(rates: Rate[], model: string, fast: boolean, t: BudgetTokens): { costUsd: number; costEur: number; rateId: string } | null` in `src/main/ledger/price.ts`, the same tier and fast fallback as `priceTokens`; `priceTokens` in `BudgetStore.ts` is rewritten to return `priceRecord(...)?.costEur ?? null`, so the band and the ledger cannot disagree. `modelLabel` comes from `modelLabeler(OFFICIAL_RATES)`. Test `it('prices like the budget')` in `price.test.ts`: for three fixtures `priceRecord(...).costEur === priceTokens(...)`.
  - OpenCode records attributed to a task are passed to `toUsage` as `UsageEvent { id: 'oc:…', tool: 'opencode', taskId, sessionId, … }` so the Usage tab shows them (UsageStore dedupes by id).

- [ ] **Step 1: Write the failing tests** (`attribute.test.ts`)
  - `it('attributes a Claude session of a task tab')` → level `task`, work item id/title/type from `task.workItem`, organization from the task's connection.
  - `it('attributes OpenCode in a joined repo to the task, naming that repo')`.
  - `it('ignores OpenCode in a reused worktree before the task opened')`: task B (openPeriods from 2026-10-10) reuses task A's path; message at 2026-10-05 → task A if A's period covers it, else `repo`.
  - `it('falls back to the repo by folder, then none')`.
  - `it('never lowers attribution')`: `merge(taskLevel, noneLevel).attribution.level === 'task'`; `merge(noneLevel, repoLevel)` → `repo`.
  - `it('keeps the larger copy of a re-written message')` → `merge` with fewer tokens keeps the larger token fields.
- [ ] **Step 2: Write the failing tests** (`LedgerService.test.ts`, fake readers and an in-temp-dir store)
  - `it('backfills everything the readers have on the first pass')` — readers called with empty cursors; records stored with `vendor`, `costEur`, `modelLabel`.
  - `it('re-attributes when a task starts later')` — pass 1 with no tasks → `none`; pass 2 with the task → `task`, record dirty again.
  - `it('does not change records when a repo or task is removed')` — after removal, pass → `upsert` returns `[]`.
  - `it('applies billable without touching attribution')`.
  - `it('sends OpenCode task usage to the Usage tab once')` — `toUsage` called once per `oc:` id across two passes.
  - `it('includes Copilot CLI and PR summary records')` — ids `cp:…` / `sh:…` present with level `task`.
- [ ] **Step 3: Run** `npx vitest run src/main/ledger` — FAIL.
- [ ] **Step 4: Implement** `attribute.ts`, `LedgerService.ts`, the `opencode` usage tool, Usage tab colour and label, menu note. Wire in `main.ts` next to the budget: `new LedgerService({ store: new LedgerStore(path.join(usageDir, 'ledger')), claude: new ClaudeTranscriptReader(claudeProjectsDir()), openCode: new OpenCodeReader(openCodeDbPath()), … })`, started with `budget.start()`, passed on window focus like the budget.
- [ ] **Step 5: Run** `npm test && npm run typecheck && npm run lint` — PASS.
- [ ] **Step 6: Verify against the transcripts:** run the app on a fresh data folder (`SHELLIE_USER_DATA=<abs path> npm start`), wait for the first pass, then for today: the Claude total per model in `<userData>/usage/ledger/records-*.jsonl` (sum `costEur` where `vendor === 'claude'`, `tool === 'claude-code'`, id `cc:*`) equals `node tools/budget-check.mjs <today>`.
- [ ] **Step 7: Commit** `git commit -m "Ledger: attribute every request to a task, repo or nothing; OpenCode in the Usage tab"`

### Task 7: Cost server connection store and client

**Files:**
- Create: `src/shared/costServer.ts`, `src/main/costServer/CostServerStore.ts`, `src/main/costServer/client.ts`
- Test: `CostServerStore.test.ts`, `client.test.ts`

**Interfaces:**
- Produces:
  - `src/shared/costServer.ts`: `type ServerBudgets = { claude: { monthlyEur: number; monthStartDay: number } | null; copilot: … | null }`; `type CostServerStatus = { connected: boolean; url: string | null; email: string | null; lastSentAt: string | null; waiting: number; error: string | null; budgets: ServerBudgets | null }`; `validServerUrl(url: string): boolean` (https, or http on `localhost`/`127.0.0.1`).
  - `CostServerStore(file: string, crypto: TokenCrypto)` (file `<userData>/cost-server.json`, same crypto object as `SecretStore`): `load()`, `get(): { url: string; email: string; key: string } | null` (decrypted), `set(c: { url; email; key })`, `clear()`, `budgets: ServerBudgets | null` + `setBudgets(b)` (cached last `hello` answer).
  - `client.ts`: `hello(c, fetchImpl = fetch): Promise<{ email: string; budgets: ServerBudgets }>` → `GET <url>/api/v1/hello?email=<email>`; `sendRecords(c, records: CostRecord[], fetchImpl = fetch): Promise<number>` → `POST <url>/api/v1/records` body `{ records }`, returns `accepted`. Both send `Authorization: Bearer <key>`, abort after 15 s, and throw `CostServerError { kind: 'network' | 'auth' | 'server' | 'rejected'; status?: number }` (401/403 → auth, 5xx → server, other 4xx → rejected, fetch failure or timeout → network). Response JSON validated with zod; a response whose `server !== 'shellie-cost'` is `rejected`.

- [ ] **Step 1: Write the failing tests**
  - `CostServerStore.test.ts`: `it('stores the key encrypted')` → file contents do not contain the key; `get()` returns it; `clear()` → `get()` null.
  - `client.test.ts` (fake fetch): `it('sends the bearer key and parses budgets')`; `it('maps 401 to auth, 503 to server, 400 to rejected, a thrown fetch to network')`; `it('times out after 15 s')` (fake timers); `it('rejects a server that is not shellie-cost')`.
  - `costServer` shared: `it('accepts https and local http only')` → `https://x` true, `http://localhost:5000` true, `http://cost.example` false.
- [ ] **Step 2: Run** `npx vitest run src/main/costServer src/shared/costServer.test.ts` — FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** the tests — PASS.
- [ ] **Step 5: Commit** `git commit -m "Cost server: encrypted connection settings and the hello/records client"`

### Task 8: Sender

**Files:**
- Create: `src/main/costServer/CostSender.ts`
- Modify: `src/main.ts` (wiring: after the ledger), `src/main/ledger/LedgerService.ts` (call `sender.kick()` after a pass that changed records)
- Test: `src/main/costServer/CostSender.test.ts`

**Interfaces:**
- Consumes: `LedgerStore.dirty/markSent/resetSent` (Task 5), `CostServerStore`, `sendRecords`, `hello` (Task 7).
- Produces: `CostSender` with deps `{ ledger: LedgerStore; server: CostServerStore; send?: typeof sendRecords; hello?: typeof hello; now?: () => Date; status: (s: CostServerStatus) => void; notice: (text: string) => void; telemetry: (event: string, props: Record<string, string | number>) => void }` and methods `start()` (first run 30 s after launch, then every 5 min; `hello` at start and hourly), `kick()` (soon, debounced 5 s), `stop()`, `status(): CostServerStatus`, `onConnected()` (calls `resetSent()` then `kick()` = backfill), `onDisconnected()`.
  - Batches: `dirty(500)` repeatedly until empty. `network`/`server`: stop this run, backoff 1, 2, 4 … capped at 30 min, records stay dirty. `auth`: stop until the connection changes, one `notice('Your cost server refused the key. Check Settings › Cost server.')`, status error `The server refused the key`. `rejected` on a batch: retry that batch one record at a time; a single rejected record is logged (`console.warn` with its id only) and skipped this run.
  - `hello` result goes to `server.setBudgets`.

- [ ] **Step 1: Write the failing tests** (fake send/hello, fake timers)
  - `it('sends dirty records in batches of 500, oldest first')` — 1 200 dirty → three calls of 500, 500, 200; all marked sent.
  - `it('keeps records and backs off while the server is down, then catches up')` — 3 network errors then success → nothing lost, each id sent once after recovery, delays 1, 2, 4 min.
  - `it('stops and tells once on a refused key')` — `auth` → one notice, no further calls until `onConnected()`.
  - `it('skips one bad record without blocking the rest')` — batch rejected, single-record retries reject only `cc:bad` → others marked sent.
  - `it('backfills everything after connecting')` — `onConnected()` → `resetSent` called, all records sent.
  - `it('does nothing without a connection')`.
- [ ] **Step 2: Run** `npx vitest run src/main/costServer/CostSender.test.ts` — FAIL.
- [ ] **Step 3: Implement** per Interfaces. Telemetry: `costServer.sendFailed` with `{ kind, status }` only.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `git commit -m "Send ledger records to the cost server in the background"`

### Task 9: Settings › Cost server and budgets from the server

**Files:**
- Create: `src/renderer/components/CostServerSection.tsx`
- Modify: `src/shared/ipc.ts`, `src/main/ipc/handlers.ts`, `src/renderer/screens/SettingsScreen.tsx` (section and nav entry `Cost server`), `src/main.ts` (budget `settings` override), `src/renderer/components/BudgetSection.tsx` (pass `managed`)
- Test: `CostServerSection.test.tsx`, `handlers.test.ts`, `src/main/budget/serverBudgets.test.ts`
- Create: `src/main/budget/serverBudgets.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 7, 8.
- Produces:
  - IPC: `'costServer:status': { args: []; result: CostServerStatus }`, `'costServer:connect': { args: [c: { url: string; email: string; key: string }]; result: CostServerStatus }` (validates the URL, calls `hello`, saves only on success, then `sender.onConnected()`; on failure returns the status with `error` in plain words and saves nothing), `'costServer:disconnect': { args: []; result: CostServerStatus }`, event `'costServer:changed'`.
  - `effectiveBudget(local: BudgetSettings, server: { monthlyEur: number; monthStartDay: number } | null): BudgetSettings` in `serverBudgets.ts` — server amount and start day win, the local alert switches stay.
  - The email field is pre-filled with the first connection's `userUniqueName`; `CostRecord.developer` (Task 6's `developer` dep) reads the saved email, `null` when not connected.
  - Error texts: network → `Can't reach the server.`; auth → `The server refused the key.`; rejected → `That address isn't a Shellie cost server.`; bad URL → `Use an https:// address.`

- [ ] **Step 1: Write the failing tests**
  - `serverBudgets.test.ts`: `it('uses the server amount and keeps local alerts')`; `it('falls back to local without a server tier')`.
  - `handlers.test.ts`: `it('connect saves only after hello succeeds')`; `it('connect refuses plain http to a remote host')`; `it('disconnect clears the key and stops sending')`.
  - `CostServerSection.test.tsx`: `it('pre-fills the email from the first connection')`; `it('shows Connected as <email>, last sent and waiting')`; `it('shows the error text')`; the key input is `type="password"` and is never pre-filled after saving.
- [ ] **Step 2: Run** the tests — FAIL.
- [ ] **Step 3: Implement.** In `main.ts`, the budget `settings` dep becomes `(v) => effectiveBudget(v === 'claude' ? s.claudeBudget : s.copilotBudget, costServer.budgets?.[v] ?? null)`; a changed `hello` answer broadcasts `budget:changed`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint` — PASS.
- [ ] **Step 5: Commit** `git commit -m "Settings: connect to a cost server; budgets come from its tiers"`

### Task 10: Telemetry, docs and a live check

**Files:**
- Modify: `docs/telemetry.md`, `src/main/ledger/LedgerService.ts` (daily `ledger.records`), `src/main/ipc/handlers.ts` (`costServer.connected` / `costServer.disconnected`), `CLAUDE.md` (Status: a line for this work; remove the cost write-back mentions that no longer hold, keep history wording short)
- Test: `LedgerService.test.ts`

**Interfaces:**
- Produces: events `costServer.connected`, `costServer.disconnected` (no properties), `costServer.sendFailed` (`kind`, `status`; Task 8), `ledger.records` at most once per local day with counts only: `{ claudeCode, opencode, copilotCli, task, repo, none }`.

- [ ] **Step 1: Write the failing test** `it('reports record counts once a day, no amounts')` — two passes the same day → one event; properties are exactly those six numeric keys.
- [ ] **Step 2: Run** — FAIL; implement; run — PASS.
- [ ] **Step 3: Live check** with a throwaway local server (not committed; a 30-line Node `http` script in the scratchpad that logs `/api/v1/records` bodies and answers `/api/v1/hello` with `{ server: 'shellie-cost', version: '0', developer: { email, budgets: { claude: { monthlyEur: 100, monthStartDay: 1 }, copilot: null } } }`):
  - Connect at `http://localhost:<port>` → `Connected as <email>`; the Claude budget shows €100 and is locked.
  - The first batches arrive; no body contains `cwd`, `/Users/`, a prompt or the task title (`grep` the server log).
  - Stop the server for a few minutes, work in a task, start it again → the new records arrive once.
  - Start an OpenCode tab in a task with Copilot → its usage shows in the task's Usage tab and arrives at the server with level `task` and vendor `copilot`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint` — PASS.
- [ ] **Step 5: Commit** `git commit -m "Ledger and cost server telemetry; docs"`
