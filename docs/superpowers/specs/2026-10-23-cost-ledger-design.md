# Cost ledger: every AI request as one record, sent to the company's own cost server

Date: 2026-10-23. Project 1 of 3:
1. **This spec.** Shellie records every AI request it can see as one priced record, attributes it to a customer's work item where it can, keeps two budgets (Claude and Copilot), stops writing cost to Azure DevOps, and can send the records to a central server.
2. The central server and dashboard (a .NET container, a separate repo, its own spec). It implements the protocol in section 7.
3. Vendor imports on that server (Anthropic Enterprise Analytics API, GitHub Copilot billing), for real billed totals, claude.ai usage and overhead. Optional, needs admin keys.

Owner decisions:
- **Customers must never see our raw cost data.** Charging (markup, overhead, bundling, per-customer deals) is management's decision, made outside Shellie. Shellie's job ends at *recorded, priced, stored centrally*.
- **All cost write-back to Azure DevOps is removed**, for simplicity: the `writeCostToAdo` setting, the `Custom.AI*` fields, the usage comment, the hourly sync and the cost line in draft PR descriptions.
- **Cost tracking is a main feature for Claude and for GitHub Copilot through OpenCode alike**, not a Claude feature with Copilot on the side.
- **Several developers can work on one work item**; the server adds them up. So Shellie sends individual records, never totals.
- **An Azure DevOps organization belongs to exactly one customer**; a customer can (rarely) have several organizations. Mapping organizations to customers happens on the server, once per organization, by management. Shellie only reports organization and project.
- **One server serves one company.** No SaaS, no tenants. It starts on the owner's home server in Docker.
- **Budgets are tiers decided by management per developer**, and there are **two separate budgets: Claude and Copilot**.

Calls marked *(our call)* were made during design and not explicitly decided by the owner.

## Why

Management invoices customers for AI cost, and wants to see who uses their budget well and who will run short. Today each developer's cost lives only on their own machine (`<userData>/usage`), and the only way it reached anyone else was the work item fields and comment in Azure DevOps. Those are visible to the customer, who would then see the numbers management bases its prices on. Removing that leaves no way to collect the team's numbers, so a company-owned server takes its place.

Shellie also misses a large part of the cost: OpenCode is not cost-tracked per task at all, and the budget drops every non-Claude model used through OpenCode (`isCounted` in `src/main/budget/BudgetStore.ts`). Many developers use GitHub Copilot through OpenCode.

## Goals

- One priced **cost record per AI request** for Claude Code, Copilot CLI and OpenCode (any provider), each counted exactly once.
- Every record attributed as precisely as possible: to a task (and so a work item, project and organization), else to a registered repo (project and organization), else unattributed.
- OpenCode usage shows in the task's Usage tab like Claude Code and Copilot CLI.
- Two budget bands on Home, Claude and Copilot, each with forecast and alerts.
- Optionally, records go to a cost server in the background, survive the server or the network being down, and are never counted twice there.
- When connected, the two budget amounts come from the developer's tiers on the server.
- Nothing about cost is written anywhere the customer can see it.

## Non-goals

- The server, the dashboard, customers, tiers management (project 2).
- Vendor billing data, claude.ai usage, real invoiced amounts, overhead (project 3).
- Any charging logic: markup, overhead allocation, invoices.
- Copilot in VS Code or other IDEs, claude.ai, other machines: Shellie cannot see them.
- Per-developer server keys, sign-in to the server, an enrollment link (`shellie://`). *(our call: a single company key for now; see Risks.)*
- Deleting cost already written to existing work items (`Custom.AI*` values and posted usage comments stay; Shellie never touches them again).

## Anti-goals (a failure even if it works)

- Any cost, token count or model mix reaching Azure DevOps, a PR, or anything else a customer can read.
- Sending prompts, code, file contents, file paths, or terminal output to the server.
- The same request counted twice, locally or on the server (Claude Code writes several lines per message id; resumed sessions copy history; resends after an outage).
- Shellie slowing down, blocking a task or showing errors because the server is down. A home server will be down at times.
- Showing €0 for usage that could not be priced.
- Shellie depending on the server: without one, everything except sending works as before.

## 1. The cost record

A new shared type `CostRecord` (in `src/shared/ledger.ts` *(our call on the name and place)*):

| Field | Meaning |
|---|---|
| `id` | Unique per request, stable across rescans: `cc:<message.id>` (Claude Code transcripts), `oc:<message id>` (OpenCode), `cp:<traceId>:<spanId>` (Copilot CLI). The same ids the budget readers and `copilot.ts` use today. |
| `tool` | `claude-code`, `copilot-cli`, `opencode` |
| `provider` | `anthropic`, `github-copilot`, or the OpenCode `providerID` as is |
| `vendor` | Which budget it counts against: `claude`, `copilot`, or `null` (section 4) |
| `model` | The model id as the tool reports it, plus `modelLabel` from the rate table (`Sonnet 5.5`) |
| `at` | Request time, ISO, UTC |
| tokens | `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWrite5mTokens`, `cacheWrite1hTokens`, `fast` |
| `costUsd`, `costEur` | List price from the official rate table, `OFFICIAL_USD_TO_EUR`; both `null` when the model has no rate (counted as unpriced, never as 0) |
| `rateId` | The rate used, for later checks |
| `billable` | `false` when the session is marked not billable in the Usage tab (today's `billable.json`), else `true` |
| `attribution` | Section 2 |
| `developer` | The developer's email (section 5) |
| `shellieVersion` | App version that made the record |

Not in the record: prompts, responses, file paths, `cwd`, session ids of other tools, the task title. *(our call: the work item title and type are in, section 2, since the server has no Azure DevOps access and management needs to recognise the item.)*

## 2. Attribution

Each record gets one of three levels, decided in this order:

1. **Task.** The request belongs to a Shellie task:
   - Claude Code: the transcript's session id is the `sessionId` of one of the task's Claude Code tabs (as `inShellieFor` does today in `src/main/budget/BudgetService.ts`).
   - OpenCode: the message's `path.cwd` is inside one of the task's worktrees (home or a joined repo of a multi-repo task).
   - Copilot CLI: the task id in the per-task file name, as today.

   The record then carries `taskId`, the work item (`organization` URL, `project`, `workItemId`, `workItemTitle`, `workItemType`) from the task's own connection, and the repo name (the home repo; for an OpenCode request in a joined repo, that repo). A multi-repo task's cost goes to the task's own work item, also when a joined repo is in another organization. *(our call: the work item is what gets billed.)*
2. **Repo.** Not a task, but the folder (`cwd` from the transcript or OpenCode message) is inside a registered repo's main checkout or one of its worktrees: `organization` and `project` from the repo's connection, the repo name, no work item. Discovered repos (`discovered`) count too.
3. **Unattributed.** Everything else: Claude Code in a folder Shellie does not know, a repo without a connection. Still recorded and sent, with `attribution.level = 'none'`, so the server can show it as overhead.

Attribution can change after a record is first made: a task's session ids are known only once its tab has started, a multi-repo task joins repos later, a repo gets registered later, a session is marked not billable. A record is therefore **re-evaluated** when its inputs change, and the latest version wins (sent again, section 7). *(our call: re-evaluate on the same triggers that already exist: a budget pass, a task joining a repo, a repo added, a billable toggle.)*

**Attribution only goes up** *(our call)*: none → repo → task, never back. The ledger stores each record's attribution rather than recomputing it from current state, so removing a repo from Shellie, removing a repo from a task, or deleting a task never moves already-recorded cost off a work item that may have been invoiced. Once a record is at task level its attribution is frozen; only `billable` can still change.

**OpenCode matching by folder is bounded in time** *(our call)*: a message joins a task only when its time falls inside one of the task's active periods (from creation to Finish, and from each Reopen to the next Finish). A worktree path reused by a later task therefore never pulls in an earlier task's messages.

## 3. Sources and the local ledger

**One source per tool, so no request is counted twice:**
- **Claude Code:** the transcripts (`src/main/budget/claudeTranscripts.ts`), not the OTLP receiver. The budget already proved them complete and exact (`tools/budget-check.mjs`, 2026-10-19), they cover usage outside Shellie, and they keep the 5m/1h cache split. The OTLP receiver stays as it is for the live per-task Usage tab and agent time.
- **OpenCode:** `opencode.db` (`src/main/budget/openCode.ts`), now **all providers**, not only Anthropic. Copilot through OpenCode has `providerID` `github-copilot` and a bare model id (`claude-sonnet-4.5`, `gpt-5-mini`) that the rate table already matches. *(Builder: check the `github-copilot/` prefix case `normalizeModel` does not strip.)*
- **Copilot CLI:** its per-task file (`CopilotFileTailer`), as today. Copilot CLI outside a Shellie task is not visible (no file is written there).
- **Shellie's own Claude calls** *(our call: they count)*: the draft PR description at Finish (`src/main/services/prSummary.ts`) runs `claude -p --no-session-persistence`, which writes no transcript. It is the one exception to the transcript rule: its process gets an extra OTLP resource attribute `shellie.source=pr-summary`, and the ledger takes OTLP requests with that attribute (and only those) as records with id `sh:<request_id>`, attributed to the task. Any future Shellie-run agent call follows the same pattern.

**The ledger store** *(our call)*: `<userData>/usage/ledger/records-YYYY-MM.jsonl`, append-only JSON lines like `UsageStore`, the latest line per `id` wins, compacted when a month file has more superseded lines than live ones. `budget.json` keeps only rollups and cannot serve here; it may be rebuilt from the ledger, or stay as is and be fed by the same readers. That choice is left to the builder, as long as the budget band and the ledger agree on the totals.

History: the readers already rescan everything Claude Code and OpenCode still have, so the first run fills the ledger back about 30 days (Claude Code's `cleanupPeriodDays`) and further for OpenCode.

The ledger's month split, dedupe and compaction are unit-tested; the totals per day and model are checked equal to `tools/budget-check.mjs` for Claude.

## 4. Two budgets

The Claude budget becomes two budgets with the same shape (`BudgetSettingsSchema`: monthly EUR, month start day, the three alerts):
- **Claude**: `tool` `claude-code` (all providers it reports), plus OpenCode with `provider` `anthropic`. Unchanged from today.
- **Copilot**: `tool` `copilot-cli`, plus OpenCode with `provider` `github-copilot`, all models (Claude models through Copilot included, at Copilot's price, which is Anthropic's list price).
- Any other OpenCode provider (OpenAI direct, a local model): recorded and sent, `vendor: null`, in no budget. The budget band lists it as "not in a budget" the way it lists "not counted" today.

**`billable` does not affect budgets** *(our call)*: a budget measures what the company pays, so a session marked not billable still counts in the developer's budget, locally and on the server. `billable` only says whether management may pass the cost on to the customer.

Copilot is priced at the per-token list price. GitHub includes credits with each seat, pooled across the company, so the real marginal cost is lower until the pool runs out. That is a company-level reconciliation for project 3; the budget and the server use list price so a developer's number does not depend on who else used Copilot this month. *(our call, discussed with the owner.)*

Settings: `claudeBudget` stays, `copilotBudget` is added with the same defaults. Settings › Claude budget becomes **Budgets** with both. Home shows a band per budget that has spend or an amount; the Copilot band reuses the Claude band's parts (burn-down, daily bars by model, per-model totals, daily allowance). *(our call: stacked, Claude first.)* Alerts are per budget and say which one.

**When connected to a server** (section 6), the monthly amount (and month start day) of each budget comes from the server's answer for this developer: the fields are read-only in Settings with "Set by your cost server". When the server has no tier for that budget, or cannot be reached and has never answered, the local amount applies. The last answer is cached, so a server outage changes nothing.

## 5. The developer

Developers normally use the same account in every customer's organization (owner). Each record still carries **one fixed developer email**, the one set in Settings › Cost server, whatever the task's connection *(our call)*: it is pre-filled with the first connection's `userUniqueName` (already stored per connection, `src/shared/types.ts`) and editable, it is the email `hello` looks up the tiers by, and it keeps one person as one developer on the server in the rare case a customer issues its own account.

Without a server connection the email is `null`; the local views do not need it.

## 6. Settings › Cost server

A new section *(our call on the name)*:
- Server address (https URL) and company key. A **Test** button calls the server (section 7) and shows "Connected as <email>" or what went wrong.
- The email (section 5).
- Status line: last sent, records waiting, the last error in plain words.
- Disconnect: stops sending and drops the queue state; the ledger stays.

The key is stored with `safeStorage` like PATs, never in `settings.json` in clear, never logged, never in telemetry. Plain `http` is refused unless the host is `localhost` (for development). *(our call.)*

## 7. Protocol (Shellie's side; project 2 implements it)

JSON over https, `Authorization: Bearer <company key>`, versioned under `/api/v1`. *(our call; project 2 may refine names, not semantics.)*

- `GET /api/v1/hello?email=<email>` → `{ server: "shellie-cost", version, developer: { email, budgets: { claude: { monthlyEur, monthStartDay } | null, copilot: … } } }`. Used by Test, at launch and every hour.
- `POST /api/v1/records` with `{ records: CostRecord[] }`, at most 500 per call → `{ accepted: n }`. **Upsert by `id`**: a record sent again replaces the earlier version (attribution or billable changed). Sending the same version twice is harmless.

Sending, in main *(our call on the timings)*:
- A record is marked dirty when it is new or changed. A sender sends dirty records in batches, starting 30 s after launch, then every 5 minutes and after each budget pass.
- On a network error, 5xx or timeout (15 s): keep them dirty, back off up to 30 minutes. On 401/403: stop and show it in Settings and as one quiet notice. On another 4xx: keep the batch, log it, and move on with the rest so one bad record cannot block the queue.
- On first connect, every record the ledger has is sent (the backfill).
- Never on the critical path: sending never delays launch, task start, Finish or the Usage tab.

## 8. Removing cost write-back to Azure DevOps

Remove: `writeCostToAdo` and `hourlySync` settings (ignored when found in an old `settings.json`), `UsageSync` (`src/main/usage/UsageSync.ts`), `syncUsageOnFinish`, the `usage:sync` IPC, `AI_FIELDS`, `aiFieldValues`, `renderUsageComment`, `renderCostLine` and its use in `prDescription`, the cost part of `CostSection` in Settings, `useWriteCostToAdo`, the work item field labels in `UsagePanel`, and their tests. The `task.finished` telemetry property about write-back goes too.

Keep: time write-back (`writeTimeToAdo`), the PR description text Claude writes at Finish (#111), the Usage tab, the CSV export, `task.usageCommentId` on old tasks (ignored).

Nobody uses the write-back today (owner), so this part can ship on its own, before the server exists.

After this, a search of the codebase for `Custom.AI` finds nothing outside old specs, plans and the migration note in CLAUDE.md.

## 9. Usage tab

OpenCode requests attributed to the task appear in the Usage tab: in the Billable ring per model, the Tokens card and the 6-hour bins, with OpenCode's own colour (`--chart-opencode`), and the session list. Their billable toggle works like the others. The NewTerminalMenu note "AI cost not tracked" on OpenCode goes. The tab may read the ledger or `UsageStore`; the builder chooses, as long as no request is shown twice (OTLP and transcript ids differ for the same Claude request).

## 10. Telemetry

Add to `docs/telemetry.md`: `costServer.connected` and `costServer.disconnected` (no address), `costServer.sendFailed` (status class and error code only), `ledger.records` once a day (counts per tool and attribution level, no amounts). Never amounts, models, emails, organization or project names, the address or the key.

## Risks and known gaps

- **A single company key** means any holder can post records under any email. Acceptable for a home server and one company to start; per-developer keys belong to project 2 if needed.
- Shellie's Claude numbers are list price; the Enterprise discount and real invoice come with project 3.
- Copilot in VS Code, claude.ai and other machines are not seen. The server shows only what Shellie sends.
- Copilot CLI outside a task is not seen.
- Claude Code deletes transcripts after about 30 days; a developer who connects later backfills only that far.
- OpenCode cache writes are priced as 5-minute writes (as in the budget).
- Usage tab (OTLP) and ledger (transcripts) can differ for a Claude request that OTLP missed; the ledger is authoritative.
- Windows: transcript and `opencode.db` paths verified by CI only, as for the budget.

## Left to the builder

File and module names beyond those given, the ledger compaction rule, whether `budget.json` is derived from the ledger, how the Usage tab gets OpenCode records, the Settings layout, retry timings within the bounds above, and how the Copilot band is laid out next to the Claude one.
