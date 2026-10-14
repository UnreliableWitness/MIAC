# MIAC sub-project 3: AI usage capture, pricing and work item write-back

Date: 2026-10-14
Status: approved in conversation, awaiting written review
Builds on: sub-project 1 (task workspace, PR #1) and sub-project 2 (Azure DevOps connections, PR #2)

## Context

MIAC tracks AI cost per task so a consultancy can invoice customers for consumption-based AI usage. This slice captures token usage from the AI tools that run inside a task's terminals, prices it per request in USD with a rate table seeded with the official list prices, shows it in EUR, and writes the totals to the task's work item (custom fields when they exist, plus one usage comment on finish).

UI reference: `design/mockups/Usage.dc.html`, `Main.dc.html` (cost tile), `Done.dc.html` (AI usage block), `Settings.dc.html` (AI cost and invoicing section).

## Scope

In:
- Capture from **Claude Code** (verified live) and **GitHub Copilot CLI** (from documentation; see "Copilot CLI verification") running in any terminal MIAC starts for a task, including tools started by hand inside a shell tab.
- A new terminal kind `copilot` ("Copilot CLI") alongside Claude Code, shell and run.
- Per-request pricing with a rate table seeded with official prices; EUR conversion with a fixed exchange rate and markup.
- Usage screen, live cost tile in the workspace header, cost per task in the nav, AI usage block in the Finish dialog, AI cost section in Settings.
- Write-back to Azure DevOps: four custom fields when present on the work item type, a usage comment once on finish, hourly field sync, Sync now.

Out:
- Copilot Chat in VS Code (the owner chose to skip it; a later slice can add it via its OTel settings and the `github.copilot.git.branch` span attribute).
- Customer mapping from area path, the invoicing screen, reconciliation against GitHub and Anthropic billing (sub-project 4).
- Creating processes or fields in Azure DevOps.

## Research facts this design relies on (verified 2026-10-14)

Claude Code (code.claude.com/docs/en/monitoring-usage, env-vars):
- Telemetry needs `CLAUDE_CODE_ENABLE_TELEMETRY=1`; logs exporter `OTEL_LOGS_EXPORTER=otlp`; protocol must be set explicitly (`OTEL_EXPORTER_OTLP_PROTOCOL=http/json` supported); endpoint via `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`; logs export interval default 5000 ms. Variables are read at process start.
- `OTEL_RESOURCE_ATTRIBUTES="k=v,..."` keys are attached as standard attributes on metrics and events.
- Event `claude_code.api_request` carries `model`, `input_tokens` (excludes cache), `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `cost_usd` (an estimate), `speed`, `request_id`, plus standard attributes incl. `session.id`.
- Prompt and content capture are off by default (`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS` unset).

GitHub Copilot CLI (`copilot help monitoring`, v1.0.57):
- OTel activates when `COPILOT_OTEL_FILE_EXPORTER_PATH` is set; it writes all signals to that file as JSON lines.
- `chat <model>` spans per LLM call; GenAI semantic conventions: `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens`. `OTEL_RESOURCE_ATTRIBUTES` honoured.

Pricing (official pages, 2026-10-14):
- Anthropic: platform.claude.com/docs/en/about-claude/pricing (base input, 5m cache write, cache hits, output; Haiku 5.5 long-context tier above 100,000 input tokens; fast mode for Opus 5.5 / Opus 5 / Opus 4.8).
- GitHub Copilot moved to usage-based billing on 2026-06-01: docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing lists USD per 1M input, cached input, cache write and output per model, with long-context tiers above a model-specific input threshold. 1 AI credit = USD 0.01. Code completions are not billed.

## Architecture

### Capture

- **`UsageReceiver`** (main process): an HTTP server bound to `127.0.0.1` on a configurable port (default **4319**). Accepts `POST /v1/logs` (and `/v1/metrics`, accepted and ignored) with `Content-Type: application/json` only (415 otherwise), body limit 5 MB (413). Parses OTLP JSON `resourceLogs[].scopeLogs[].logRecords[]`, selects records whose event name is `claude_code.api_request`, reads the attributes, requires `miac.task.id`, and hands a `UsageEvent` to the `UsageStore`. Responds 200 `{}` (partial success is not used).
- **`CopilotFileTailer`**: per task, reads `<userData>/usage/copilot/<taskId>.jsonl` incrementally from a stored byte offset (polling every 5 s and on terminal exit), parses each line, selects `chat` spans with `gen_ai.usage.*`, and hands `UsageEvent`s to the store. A partial last line is retried on the next poll.
- **Terminal environment**: `TerminalManager.spawn` receives extra env from the handlers for every task pty:
  - `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_LOGS_EXPORTER=otlp`, `OTEL_METRICS_EXPORTER=none`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://127.0.0.1:<port>/v1/logs`, `OTEL_LOGS_EXPORT_INTERVAL=2000`
  - `OTEL_RESOURCE_ATTRIBUTES=miac.task.id=<taskId>` (task ids are UUIDs; no escaping needed)
  - `COPILOT_OTEL_FILE_EXPORTER_PATH=<userData>/usage/copilot/<taskId>.jsonl`
  - The env is computed by a pure function `telemetryEnv(taskId, port, usageDir)` so it is unit-testable and the Windows port only changes paths.
- **Terminal kind `copilot`**: label "Copilot CLI", command from `Platform.copilotCommand()` (`copilot`); offered as a New task "When ready" checkbox (unchecked by default) and in the "+" menu.

### Records and storage

```ts
type UsageTool = 'claude-code' | 'copilot-cli';
type UsageRecord = {
  id: string;            // claude: request_id; copilot: span id (traceId:spanId)
  taskId: string;
  tool: UsageTool;
  sessionId: string;     // claude: session.id; copilot: trace id
  model: string;
  at: string;            // ISO time of the request
  inputTokens: number;   // excludes cache
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  fast: boolean;         // claude speed === 'fast'
  costUsd: number | null;      // null = unpriced (model not in the rate table)
  rateId: string | null;       // which rate row priced it
  rate: RateSnapshot | null;   // copy of the row's prices at ingestion
};
```

- **`UsageStore`**: append-only JSON-lines files `<userData>/usage/records-YYYY-MM.jsonl`; on startup reads all files into an in-memory map keyed by `id` (dedupe) and a per-task index; a line that fails to parse is skipped and counted (notice on startup). `add(event)` prices the event, dedupes by id, appends one line, updates the index and emits `usage:changed` for the task.
- **Billable flags** are per session: `<userData>/usage/billable.json` maps `taskId -> sessionId[]` of sessions marked not billable (default everything billable). Atomic writes like `TaskStore`.
- Totals per task are computed from records whose session is billable.

### Pricing

```ts
type Rate = {
  id: string;
  label: string;               // shown in Settings
  match: string[];             // model ids that use this row (exact, after normalisation)
  minInputTokens: number;      // 0 for default tier; e.g. 100000 for Haiku 5.5 long context
  fast: boolean;               // fast-mode row
  inputPerM: number; cachedInputPerM: number; cacheWritePerM: number; outputPerM: number;
};
```

- `RateTable` is stored in `<userData>/rates.json`; on first run (or "Reset to official prices") it is seeded from `src/main/pricing/officialRates.ts`, which contains the Anthropic table and the GitHub Copilot table as of 2026-10-14 with a `source` and `asOf` comment per block.
- Model normalisation: lowercase, strip a leading provider prefix (`anthropic.`, `anthropic/`, `openai/`), replace dots between digits with dashes (`claude-sonnet-4.6` -> `claude-sonnet-4-6`), drop a trailing date suffix (`-20251001`). Rates match on normalised ids.
- Tier selection: among rows matching the model and `fast` flag, the one with the highest `minInputTokens` not exceeding the request's total input tokens (input + cache read + cache write).
- Cost: `(input*inputPerM + cacheRead*cachedInputPerM + cacheWrite*cacheWritePerM + output*outputPerM) / 1e6`, rounded to 6 decimals. Unknown model -> `costUsd: null`.
- Cache writes are priced at the 5-minute cache-write rate: Claude Code reports one `cache_creation_tokens` count without the TTL. Fast-mode rows apply the standard caching multipliers on top of the fast input price (cached input = 0.1x fast input on Opus 4.8/Opus 5, per the Anthropic pricing page; Opus 5.5 rows use its published 0.05x ratio), and are listed with their derivation in `officialRates.ts`.
- EUR: `costEur = costUsd * usdToEur * (1 + markupPct/100)`, computed at display and sync time; settings `usdToEur` default 0.92, `markupPct` default 0. Amounts on work items are rounded to 2 decimals.

### Settings additions

`<userData>/settings.json` (zod, atomic): `receiverPort` (4319), `usdToEur` (0.92), `markupPct` (0), `hourlySync` (true). Existing slice-1/2 settings are unaffected.

### Write-back to Azure DevOps

- `AdoClient` gains `workItemTypeFieldNames(project, type)`, `updateWorkItemFields(id, fields)` (JSON Patch `add` per field, `application/json-patch+json`) and `addComment(project, id, markdown)` (`POST {project}/_apis/wit/workItems/{id}/comments?format=markdown&api-version=7.1-preview.4`), all through the existing request path (same error mapping; 401/403 on writes map to `unauthorized` with message "The token cannot write work items (needs Work Items: Read & write)").
- Fields: `Custom.AICost` (EUR total, decimal), `Custom.AICostClaude`, `Custom.AICostCopilot` (decimal), `Custom.AITokens` (integer, all token types summed). Only fields present on the work item type are written; presence is cached per connection+type for the session and refreshed on Sync now.
- Comment (once per task, on finish, if the Finish checkbox is ticked):

  ```
  AI usage for this work item (MIAC): €23.85
  Claude Code: €21.10 over 4 sessions (claude-opus-5-5, claude-sonnet-5-5)
  Copilot CLI: €2.75 over 2 sessions (gpt-5.5)
  Branch feature/48213-save-delivery-address
  ```
  Lines for a tool with no usage are omitted; unpriced usage adds "plus N requests with unpriced models". The returned comment id is stored on the task (`Task.usageCommentId`), so a retry never posts twice.
- `UsageSync` service: `syncTask(taskId, { comment })` writes fields (and the comment when asked and not yet posted), records `Task.usageSyncedAt` and `Task.usageSyncError`. Hourly timer syncs tasks with a work item and connection whose usage changed since the last sync. Failures never block finishing.
- `Task` gains optional `usageSyncedAt: string | null`, `usageSyncError: string | null`, `usageCommentId: number | null` (zod defaults null for existing state files).

### IPC

Channels: `usage:task` (taskId) -> `{ totals, sessions, unpricedCount }`; `usage:setBillable` (taskId, sessionId, billable); `usage:sync` (taskId) -> sync result; `usage:exportCsv` (taskId) -> CSV string; `usage:fieldsStatus` (connectionId) -> per-type presence; `rates:list`, `rates:save` (rows), `rates:reset`; `settings:get`, `settings:save`; `usage:receiverStatus` -> `{ listening, port, error }`. Events: `usage:changed` (taskId), `usage:receiverStatus`.

`tasks:finish` options gain `syncUsage: boolean` (write totals + comment).

## Screens

- **Workspace header cost tile**: billable EUR total, "Claude €x · Copilot €y", "Logged on work item N min ago" or the sync error; click opens the Usage screen. Nav task rows show the EUR total.
- **Usage screen** (`{ kind: 'usage', taskId }`): tiles (billable total with rate/markup note; Claude Code with sessions and tokens; Copilot CLI with sessions and tokens); a session table (started, tool, models, input, output, cache read, cost, Billable checkbox; unpriced shown as "unpriced"); side panel "On the work item" with the four values, the comment preview, Sync now, Export CSV, and which fields were found.
- **Finish dialog**: AI usage block with the total and per-tool split and the checkbox "Write final totals to the work item and add a usage comment" (ticked when the task has a work item and its repo has a connection; hidden otherwise).
- **Settings, AI cost and invoicing**: invoice currency (EUR, fixed for now), USD to EUR, markup; rate table editor (add, edit, delete rows; Reset to official prices with confirm); receiver port and status; hourly sync switch; work item fields status per connection with the setup steps below.

## Error handling

- Receiver port in use: status `error` with the message, notice, Settings shows it; capture resumes after changing the port (terminals started earlier keep the old endpoint until restarted; the notice says so).
- Malformed OTLP body: 400; events without `miac.task.id`: ignored; events for unknown task ids: stored (the task may be in another MIAC instance's state) but not shown.
- Damaged usage lines: skipped and counted; never a crash.
- Sync failures: stored on the task, shown on the Usage screen and tile, retry via Sync now; finishing still succeeds.
- Token without write scope: connection status `unauthorized` with the specific message; capture and display continue.

## Testing

- Spike (plan task 1): run `claude -p "Reply with OK"` once in a temp dir with the telemetry env pointing at a tiny recorder, save the OTLP JSON bodies as fixtures under `src/main/usage/__fixtures__/claude/`. Costs a few cents on the owner's account (approved).
- Copilot CLI fixtures are hand-written from the documented GenAI conventions and labelled `synthetic` in their file names.
- Unit: rate normalisation, tier selection, fast mode, cost rounding, unknown models; telemetryEnv; UsageStore dedupe, monthly files, damaged lines, billable flags; CopilotFileTailer partial lines and offsets; comment rendering.
- Integration: UsageReceiver over real loopback HTTP with the recorded fixtures; UsageSync against the fake Azure DevOps server from slice 2 (fields present/absent, comment once, 401/403).
- Renderer: Usage screen, header tile, Finish block, Settings rate table.
- Live end to end over CDP: a real Claude Code run in a task in the throwaway repo, usage appears, Finish writes fields + comment to a work item in the test project.

## Copilot CLI verification

The owner has no Copilot licence, so the Copilot CLI path cannot be run in development. It is built from GitHub's documentation and synthetic fixtures. The tailer logs (to the main-process console) any `chat` span it cannot parse and counts it, and Settings shows "Copilot CLI: N records captured, M unreadable" so a teammate with a licence can confirm it. Treat Copilot CLI capture as unverified until then.

## Test project setup (owner, web UI, about 5 minutes)

The test project `unreliablewitness/MIAC` uses the built-in Basic process, which cannot have custom fields. To exercise field writes:

1. Organization settings > Boards > Process. On the **Basic** row, open the "..." menu > **Create inherited process**. Name it `Basic (MIAC)`.
2. Open `Basic (MIAC)` > **Issue** > **New field**: Name `AI Cost`, Type **Decimal** > Add field. Repeat for `AI Cost Claude` (Decimal), `AI Cost Copilot` (Decimal), `AI Tokens` (Integer). The reference names become `Custom.AICost`, `Custom.AICostClaude`, `Custom.AICostCopilot`, `Custom.AITokens`.
3. Open **Task**, then **Epic**: New field > **Use an existing field** and add the same four.
4. Back on the process list, `Basic (MIAC)` > "..." > **Change team projects to use Basic (MIAC)** > select `MIAC` > OK.

Reversible: switch the project back to Basic at any time. The token used by MIAC needs **Work Items: Read & write** to sync.
