# Claude budget: the monthly budget on Home, per day and per model

Date: 2026-10-19. Owner decisions:
- The budget is a **personal monthly amount assigned by the company**, entered once as a setting. There is no API to read it from.
- **All Claude usage on this machine counts**, not only sessions started in Shellie: Claude Code anywhere, and OpenCode.
- In OpenCode only usage **billed by Anthropic** (`providerID` `anthropic`) counts. Claude models through other providers (GitHub Copilot) are shown as "not counted".
- **One source for the totals** (approach 1): Shellie reads the tools' own local logs. The OTLP pipeline stays for the per-task Usage tab and is not used for the budget.
- Home layout **A, a full band**: burn-down with forecast, daily bars stacked by model, model totals.

Calls marked *(our call)* were made during design and not explicitly decided by the owner.

## Why

Developers get a monthly Claude budget from the company. Shellie prices AI usage per task, but only for terminals it started, and only for this week or month as one number. Nothing tells the developer how much of the budget is gone, whether they are on pace to overshoot, or which model the money goes to. Usage outside Shellie (a plain terminal, VS Code, another project) is invisible, so any number Shellie shows today is too low.

## Goals

- At a glance on Home: spent this month against the budget, and the month-end forecast.
- Spend per day, per week and per month, broken down by model.
- Every Claude Code and OpenCode request on this machine is counted exactly once.
- History survives Claude Code deleting its old transcripts.
- A warning before the budget is gone, not after.

## Non-goals

- Reading the company's real invoice or an org spend limit (Admin API, Analytics API).
- claude.ai chat, other machines, Copilot CLI.
- Budgets per model, per week, per team.
- CSV export of the budget data.

## Anti-goals (a failure even if it works)

- Counting the same request twice (Claude Code writes one line per content block; resumed sessions copy history).
- Showing €0 for usage it could not price.
- Re-reading 2+ GB of transcripts on every launch or blocking the first paint.
- Sending amounts or model names to telemetry.

## 1. Data sources

Two readers in main, in `src/main/budget/`, each producing `BudgetRecord`s:

```ts
type BudgetRecord = {
  id: string;            // dedupe key
  tool: 'claude-code' | 'opencode';
  sessionId: string;
  model: string;
  provider: string;      // 'anthropic' for Claude Code
  at: string;            // ISO timestamp of the response
  cwd: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  fast: boolean;
};
```

### Claude Code transcripts (`ClaudeTranscriptReader`)

- Folder: `$CLAUDE_CONFIG_DIR/projects` when the variable is set, else `~/.claude/projects`, read recursively for `*.jsonl` (subagent transcripts included).
- A line counts when `type === 'assistant'` and `message.usage` exists. Fields: `message.id`, `message.model`, `timestamp`, `sessionId`, `cwd`, `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` (falling back to `cache_creation_input_tokens` as 5m when the split is missing), `usage.speed === 'fast'`. Model `<synthetic>` is skipped.
- Dedupe key: `cc:<message.id>`. Claude Code writes one line per content block with the same id and usage, and resumed sessions copy earlier lines into a new file.
- Incremental: per file the byte offset read so far, plus size and mtime. A file that shrank or changed inode is read again from 0 (dedupe keeps the totals right). A trailing line without a newline is left for the next pass.
- First run: only files with mtime in the current or previous budget month *(our call)*. Older transcripts are ignored.

### OpenCode database (`OpenCodeReader`)

- File: `$XDG_DATA_HOME/opencode/opencode.db`, else `~/.local/share/opencode/opencode.db` (also on Windows; verify on real hardware).
- Opened **read-only** with Electron's built-in `node:sqlite` (no native module), with a short busy timeout; OpenCode keeps it in WAL mode and may be writing.
- Query: rows of `message` with `time_updated` greater than the stored cursor; in JSON `data` keep `role === 'assistant'` with `time.completed` set. Fields: `modelID`, `providerID`, `tokens.input`, `tokens.output`, `tokens.cache.read`, `tokens.cache.write` (as 5m; OpenCode has no split *(our call)*), `time.created`, `path.cwd`, `session_id`.
- Dedupe key: `oc:<message id>`. A message updated after it was counted (tokens filled in late) replaces its earlier contribution: the store keeps the counted cost per id for the current and previous month and applies the difference.
- Tokens only; OpenCode's own `cost` field is ignored so pricing matches Claude Code.

### Counted or not

- Claude Code: always counted.
- OpenCode: counted when `providerID === 'anthropic'`. Other providers with a Claude model (`normalizeModel` starts with `claude-`) are kept as **not counted**: requests and tokens, no cost. Non-Claude models are dropped.

### In Shellie or outside

Not used for totals, only as a split in the breakdown:
- Claude Code: in Shellie when `sessionId` matches a Claude terminal's `sessionId` or a session in `UsageStore`.
- OpenCode: in Shellie when `cwd` is inside a task worktree (any repo of a multi-repo task).

## 2. Pricing

- `priceEvent` from `RateTable` with the current official rates, converted with `OFFICIAL_USD_TO_EUR`, the same way as the rest of Shellie.
- 1-hour cache writes cost 2x base input, 5-minute writes 1.25x (Anthropic pricing page). `RateSnapshot` gains `cacheWrite1hPerM`; official Anthropic rates set it to 2x `inputPerM`, and rates without it fall back to `cacheWritePerM`. Verify the multiplier against the pricing page during implementation.
- A model without a rate is **unpriced**: counted in tokens, shown as "unpriced" with the token count, never as €0. When an app update adds the rate, unpriced days of the current and previous month are priced on the next pass (the store keeps their tokens).

## 3. Rollup store (`BudgetStore`)

- File: `budget.json` in the app data folder, written with `JsonFileStore` (atomic, serial; writes batched once per pass).
- `days`: `{ 'YYYY-MM-DD': [{ tool, model, counted, inShellie, requests, costEur | null, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }] }`, local dates.
- `seen`: dedupe ids with their counted cost, for the current and previous budget month only; older ids are pruned at month change *(our call: bounded size, re-counting a transcript older than that is impossible because its file is not read)*.
- `cursors`: Claude Code file offsets, the OpenCode `time_updated` cursor.
- `alerts`: which alerts fired in which budget month.
- Days are kept forever (small: one row per day × tool × model).

## 4. Refresh

- `BudgetService` runs a pass at launch (after first paint), every 30 s, and when the window gets focus, never two at once *(our call)*.
- A pass reads new records from both readers, prices them, updates the store and pushes `budget:changed` to the renderer when anything changed.
- The first pass may read a lot; it yields between files so main stays responsive.

## 5. Settings

In `AppSettingsSchema`, Settings screen section **Claude budget**:
- `claudeBudget.monthlyEur`: number or null, default null (no budget: spend shown, no budget line, no alerts).
- `claudeBudget.monthStartDay`: 1-28, default 1. The budget month runs from that day to the day before it in the next month.
- `claudeBudget.alerts`: `{ at80: true, forecastOver: true, at100: true }`.

## 6. Home band "Claude budget"

A new band under Stats, layout A. Stats keeps its own "AI cost" tile (Shellie tasks, Claude and Copilot).

- **Header:** `€312 of €500`, and one status: *On track: about €470 by <end date>* (neutral), *On pace for €510, €10 over* (red), *Over budget by €X* (red). No budget: `€312 this month` and a *Set a monthly budget* link to Settings. An ⓘ explains: *Estimated at Anthropic API list prices in EUR. Your company's invoice may differ. Claude models through Copilot aren't counted.*
- **Forecast:** spent ÷ days elapsed (today counted as a full day) × days in the budget month. Hidden for the first 3 days of the month.
- **Burn-down chart:** cumulative counted spend per day as a line, a dashed budget line, a faint even-pace diagonal, a dotted forecast line from today to month end. Hover: date and cumulative spend.
- **Daily bars:** one bar per day of the budget month, stacked by model (consistent model colours from chart tokens), the outside-Shellie part hatched, today's bar marked as in progress. Hover: that day's models with cost and tokens.
- **Footer:** per-model totals for the month by cost; `Today €14 · This week €71 · 38% outside Shellie` (week from Monday, like Home's week); one line per not-counted group, e.g. `Not counted: Claude Sonnet 4.6 via GitHub Copilot, 59 requests`; unpriced models with their token count.
- **Months:** ‹ › to step through earlier months from the store; the forecast shows only for the current month.
- **Empty:** neither source found: *No Claude Code or OpenCode usage found on this computer.*
- Renderer reads one IPC call `budget:get(monthOffset)` returning a ready view model (`BudgetView`, computed in `src/shared/budgetView.ts` so it is unit-testable), refetched on `budget:changed`.

## 7. Alerts

System notifications through the same mechanism as the attention notifications, each at most once per budget month, each with its own toggle:
- 80% of the budget used.
- Forecast over budget (from day 4).
- 100% reached.

Clicking one opens Home. Fired alerts are stored in `budget.json`, so a restart never repeats one. No budget, no alerts.

## 8. Telemetry

`home.clicked` with `band: 'budget-month'` (‹ ›) and `band: 'budget-settings'`, plus `budget.alert` with `{ kind }`. No amounts, models or paths. `docs/telemetry.md` is updated.

## 9. Errors

- Missing folder or database: that source is "not found"; the other still works.
- Unparsable line: skipped, counted in a debug log.
- Database busy or locked: retried next pass.
- Unknown model: unpriced (section 2).
- Store file corrupt: renamed aside and rebuilt from the sources that still exist (`JsonFileStore` behaviour).

## 10. Testing

- **Unit (Vitest):** transcript line parsing (5m/1h split, fallback, fast, synthetic skipped), dedupe across lines and files, offset handling (partial last line, shrunk file); OpenCode reader against a temp SQLite file made with `node:sqlite` (provider filter, late token update, cursor); pricing with 1h writes and unpriced models; store month pruning and repricing; `budgetView` (forecast, hidden before day 4, month start day 15, week split, over-budget states, no budget); alert firing once per month.
- **Component:** the band's header states, empty states, not-counted line, month stepping.
- **Real data check:** run the readers over this Mac's `~/.claude/projects` and `opencode.db` and compare a day's totals with an independent sum of the same files (script, deduped by message id).
- **Packaged app check:** launch the built app, set a budget, assert the band's numbers match the store, step months, trigger the 80% alert with a low budget.

## Known gaps

- Cost is at API list price, not the company's invoice.
- Usage on other machines or in claude.ai is not counted.
- OpenCode cache writes are priced as 5-minute writes.
- Windows paths for both sources are verified by CI only until checked on real hardware.
