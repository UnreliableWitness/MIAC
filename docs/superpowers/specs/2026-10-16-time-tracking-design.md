# Time spent per task

Date: 2026-10-16. Owner decisions:
- Track time spent per task next to the AI cost. Two measures: **MIAC's own active time** and **agent working time**.
- Purpose: **compare with the estimate**. Not for invoicing.
- Agent time covers **Claude Code, Copilot CLI and OpenCode**, as far as each allows. The Sprint page shows it **per work item**, not per tool.
- Writing time to Azure DevOps is **opt-in, default off**, like cost. When on, booked time comes off the estimate.
- MIAC must not dictate a process: the estimate is **best effort** from whatever fields the work item type has.
- Sprint page: a **"Spent / estimate" column with a progress bar** (mockup option C).
- The developer **confirms the time at Finish**. The field starts at the measured time. MIAC also offers the other measures as an optimistic → pessimistic range, presented as **one slider** (mockup option B). Wall-clock time is one of those measures.

Calls marked *(our call)* were made during design and not explicitly decided by the owner.

## Goal

A developer or sprint planner sees, for each work item in the sprint, how much time went into it compared with its estimate. MIAC measures the time instead of relying on manual timesheets. The developer corrects the figure at Finish, because they know best.

Non-goals:
- Invoicing on time.
- Timesheets, or time outside MIAC tasks (meetings, reviews in the browser).
- Writing anything to Azure DevOps unless the user opted in.
- Any per-person reporting or monitoring view. Time is shown on the developer's own machine and, when opted in, on the work item. Nothing else.

Anti-goals (a failure even if it works):
- Double counting: two open tasks must never both count the same minute of the developer's time.
- Overwriting what the developer booked with a measured number.
- Requiring a specific process template or custom fields.

## 1. The measures

All durations are stored in seconds. They are kept per task, in a new local store next to the usage store (`time.json` under the same data folder, written through `JsonFileStore`) *(our call)*.

### 1a. Active time (MIAC, "measured")

MIAC records **intervals** (`{start, end}` ISO strings) per task. A second counts toward a task when all of these hold:
- the MIAC window has focus;
- the task is the one on screen: its task page with any pivot (Usage, Docs, a terminal), Setup, or Finish;
- the system has not been idle for 5 minutes or more. Idle comes from Electron's `powerMonitor.getSystemIdleTime()`, so reading or watching an agent counts and a developer away from the desk does not *(our call)*;
- the system is not locked or suspended (`powerMonitor` `lock-screen` / `suspend` close the open interval).

At most one task counts at any moment, which satisfies the no-double-count anti-goal. Main owns the tracker. The renderer reports which task is on screen (`time:focus`, with a task id or null), and main combines that with window focus and idle polling (every 15 s *(our call)*). Open intervals are flushed on a timer and on quit, so a crash loses at most a minute. Idle time is trimmed: when idle reaches 5 minutes, the interval ends where the idle period started.

Finished tasks never count. A reopened task counts again.

### 1b. Agent time

Agent time is the time an agent was working on the task, **whether or not the task is on screen**. It is recorded per tool, as intervals where possible, so it can be combined with active time (§1c).

- **Claude Code:** the `claude_code.active_time.total` metric, attribute `type = cli` (Claude working). `type = user` is not used, because MIAC's own active time already covers the developer. This requires turning on metrics export in `telemetryEnv.ts`: `OTEL_METRICS_EXPORTER: 'otlp'`, protocol and endpoint as for logs, plus a metrics export interval (`OTEL_METRIC_EXPORT_INTERVAL`, 10 s *(our call)*). `UsageReceiver` must then parse `/v1/metrics` instead of dropping it. Data points carry `miac.task.id` and `session.id` (see `src/main/usage/__fixtures__/claude/metrics.json`). The recorded fixture uses **delta** temporality (`aggregationTemporality: 1`), so take each data point's value as agent seconds and store it as an interval of that many seconds ending at `timeUnixNano` *(our call; an approximation, accepted for the realistic measure)*. If a data point arrives with cumulative temporality (2), diff it against the last value seen for that `session.id`. A drop, for example after `claude --resume` starts a new process, counts as a reset. The other metrics (`token.usage`, `cost.usage`) stay ignored: cost still comes from the `api_request` logs.
- **Copilot CLI:** the per-task span file that cost capture already reads (`copilot.ts`). Agent time is the union of the spans' `[start, end]` that represent an agent turn or model call. As with Copilot cost, this is built from docs and fixtures and can't be verified without a licence. Mark it the same way.
- **OpenCode** (no telemetry), and any other agent terminal without a source: an **estimate** from the terminal. After the user presses Enter in that terminal, output that keeps arriving counts as agent working time. Output gaps longer than 30 s end the interval *(our call)*. These figures are always labelled "est." in the UI.

### 1c. The derived measures shown at Finish

- **Optimistic, "measured":** total active time (§1a).
- **Realistic, "you + agents":** the length of the union of active intervals and all agent intervals. Overlaps count once.
- **Pessimistic, "wall clock":** from the task's start to now (or finish), counting only **working hours**. Default: 09:00–17:00 local time, Monday–Friday, configurable in Settings *(our call)*. For a reopened task, the time between a finish and the next reopen is excluded. That requires recording reopen and finish moments as a list of open periods on the task.

Each measure is at least the previous one in normal use, but no ordering is guaranteed: a task run in the evening can have more measured time than working-hours wall clock. The slider (§3) sorts its marks by value.

## 2. Estimate (best effort)

Per work item, in this order:
1. **Original Estimate** (`Microsoft.VSTS.Scheduling.OriginalEstimate`) when the type has the field and it has a value (Agile, CMMI).
2. Otherwise, a **baseline** MIAC records the first time a task is started for that work item: Remaining Work + Completed Work at that moment, when the type has Remaining Work (Basic and Scrum Tasks). It is stored **per work item** (keyed by connection id + work item id) in `time.json` as `{ hours, recordedAt }`. The first record wins: later tasks for the same item reuse it *(our call)*. It is not refreshed later, because write-back lowers Remaining Work.
3. Otherwise **no estimate**. Effort and Story Points are ignored, because they aren't hours.

Field presence is checked per work item type and cached per connection, like the existing types/fields lookups. The test project (Basic) has Remaining Work and Completed Work on Task and only Effort on Issue (checked 2026-10-16), so Issues there show spent time with no bar.

## 3. Finish: the "Time spent" section

A new section on the Finish screen, between "AI usage" and "Clean up", following the slider mockup (option B):
- Title "Time spent", with the start and finish moments as a subline.
- A **slider** from the lowest to the highest of the three measures, with marks and labels for each (measured, you + agents, wall clock). It snaps to 5 minutes *(our call)* and moves freely between marks.
- A **"Time to book"** field (`h m` format, also accepts decimal hours such as `3.5`), kept in sync with the slider. Typing a value outside the slider range is allowed. Its starting value is the **measured** time.
- When there's an estimate: "X of Y estimate" with the same progress bar as the Sprint page.
- Under it: agent time per tool (Claude, Copilot, OpenCode est.) as context.

On Finish, the task stores `time: { bookedSeconds, measuredSeconds, realisticSeconds, wallClockSeconds, agentSeconds: Record<tool, number>, bookedAt }`.

Reopen and finish again: the slider and measures cover the whole task, all periods included. The field starts at the **previously booked time plus measured time since the reopen** *(our call)*, so an earlier manual correction is kept.

## 4. Where it shows

- **Sprint page:** a new column, "Spent / est.", between Remaining work and MIAC (mockup option C):
  - `3h 10m / 5h` with a thin bar. The bar turns amber (`--amber` or the closest existing token) when spent exceeds the estimate.
  - Without an estimate: just the spent value, no bar. With no task for the item and no Completed Work: `–`, or `– / 4h` when an estimate is known.
  - **Teammates' time (owner decision):** a work item with a local task shows the local time. A work item with **no local task** shows its Azure DevOps **Completed Work** when that has a value, marked in the hover as "from Azure DevOps". Local and ADO figures are never added together for the same item, so your own written-back hours can't count twice.
  - **Estimate for items without a local task (owner decision):** Original Estimate when present, else Remaining Work + Completed Work **read live** from Azure DevOps. No baseline is recorded for those.
  - Spent means booked time for finished tasks and measured active time for open ones. Hovering shows the breakdown: measured, agent time, booked when set.
  - A work item with several tasks (finished and reopened, or more than one task) sums them.
  - Parent rows show their own time plus the sum of their children's, and the same for estimates *(our call)*.
  - Sprint rows need Original Estimate and Completed Work fetched alongside Remaining Work in `AdoClient` (`FIELDS`).
- **Task Usage tab:** a "Time" block next to the cost. It shows measured, you + agents, wall clock, agent time per tool, and the estimate with its bar. It updates live.
- **Done page:** the booked time next to the duration, as "booked 4h (measured 3h 10m)", plus agent time per tool.
- **CSV export:** columns for booked, measured, realistic, wall-clock and agent seconds per tool.
- **Telemetry:** a `time.booked` event with no durations or names, only which mark the booked value was closest to (measured / realistic / wall clock / custom). Add it to `docs/telemetry.md` *(our call)*.

## 5. Azure DevOps write-back (opt-in)

- A new setting, **`writeTimeToAdo`**, default `false`, also for existing installs. It's separate from `writeCostToAdo` *(our call)* and sits under it in Settings.
- Time is written **only at Finish**, with the booked value, not on the hourly sync. That way MIAC never writes a measured number the developer then corrects.
- What's written, only for fields the type has:
  - **Completed Work** += booked hours (rounded to 0.25 h *(our call)*);
  - **Remaining Work** −= booked hours, never below 0.
- Original Estimate is never touched.
- Reopen and finish again write only the **difference** from what was written last. Store `time.writtenHours` on the task. The difference can be negative when the developer books less. Remaining Work is then raised by that much again.
- A failed write is a warning on the Done page with Retry, like the usage sync error, and doesn't block cleanup.
- Neither field present: nothing is written and nothing is reported as an error.

## 6. Settings

- Settings > Time (or a block on an existing page, the builder's choice): working hours (start, end, weekdays), idle timeout (default 5 min), and "Write time spent to Azure DevOps" (`writeTimeToAdo`).
- Changing working hours or the idle timeout doesn't recompute anything already booked. Wall clock is computed live from the open periods.

## Left to the builder

- Store layout and IPC names beyond those named here.
- How the renderer's "task on screen" signal is wired (the store's selected task and current page).
- Exact Copilot span names that count as agent turns, taken from the fixtures.
- The visual details of the slider and bar within the ADO styling already in `screens.css`.
- Test approach: the interval maths (union, working-hours clipping, idle trimming, metric deltas) as pure functions with unit tests. The tracker is driven by a fake clock and fake `powerMonitor`.

## Known gaps

- Time spent outside MIAC (an external editor, the browser) isn't measured. The Finish correction is the remedy.
- OpenCode agent time is a heuristic.
- Copilot agent time is unverified without a licence.
- Tasks started before this feature have no active time from before it shipped. Their wall clock still works from `createdAt`.
