# Time Spent per Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure the time spent per task (MIAC active time, agent time, wall clock), let the developer book it at Finish, show it against the estimate on the Sprint page, and optionally write it to Azure DevOps.

**Architecture:**
- Pure interval maths lives in `src/shared/time.ts`.
- Main stores intervals in a new `TimeStore` (`time.json`, through `JsonFileStore`). Three things feed it:
  - an `ActivityTracker`, driven by window focus, the renderer's "task on screen" signal and `powerMonitor` idle time;
  - Claude Code's `claude_code.active_time.total` metric, Copilot span durations and an OpenCode terminal heuristic.
- Finish stores a booking on the task and, when opted in, writes Completed Work and Remaining Work.
- The renderer reads `time:*` channels. It adds a Finish slider, a Sprint column, a Usage tab block, a Done fact and a Settings section.

**Tech Stack:** Electron, TypeScript, React, zustand, zod, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-16-time-tracking-design.md`

## Global Constraints

- All stored durations are seconds; stored instants are epoch milliseconds inside `time.json` and ISO strings on `Task`.
- Idle timeout default **5 minutes**. Idle poll every **15 s**. Open intervals flushed every **60 s** and on quit.
- Claude metrics export interval **10 s** (`OTEL_METRIC_EXPORT_INTERVAL: '10000'`). Only `type = cli` data points count.
- OpenCode heuristic: output after Enter counts. A gap of more than **30 s** ends the interval. Always labelled "est.".
- Working hours default **09:00–17:00, Monday–Friday**, local time.
- Finish slider snaps to **5 minutes**. "Time to book" starts at measured time (on re-finish: the previous booking + measured time since the reopen).
- Write-back rounds to **0.25 h** and adds the booked hours to Completed Work. It subtracts them from Remaining Work, never below 0, and never touches Original Estimate. It writes only fields the type has, only at Finish, and only the **difference** from `writtenHours`.
- New settings default: `writeTimeToAdo: false` (also for existing installs), `idleMinutes: 5`, `workHours: { start: '09:00', end: '17:00', days: [1,2,3,4,5] }`.
- Estimate rule everywhere: live Original Estimate, else the recorded baseline (Remaining + Completed at first Start), else live Remaining + Completed. Effort and Story Points are ignored.
- Sprint "Spent": a local task gives the local time (booked when finished, else measured), with no task the item's ADO Completed Work; local and ADO figures are never added for one item. Parent rows show their own value plus their children's, for spent and estimate.
- UI copy uses hours/minutes as `3h 10m`, `45m`, `5h`. The Sprint column header is `Spent / est.`.
- Checks: `npm test`, `npm run typecheck`, `npm run lint` must pass after every task.

## Review Focus

1. **Two tasks, one window:** switching between two open tasks quickly must never put the same minute in both tasks' active intervals. Test in Task 3 (`never counts two tasks at once`).
2. **Machine asleep or locked mid-interval:** resuming after suspend must not count the sleep. Test in Task 3 (`suspend closes the interval at the suspend moment`).
3. **Re-finish with a lower booking:** booking less than already written must raise Remaining Work and lower Completed Work by the difference. Test in Task 6 (`negative delta gives time back`).
4. **Old tasks without periods or bookings:** tasks created before this feature must show a wall clock from `createdAt` and no crash on the Sprint page, Finish or Done page. Test in Task 1 (`periodsOf falls back to createdAt/finishedAt`) and Task 8 (`row with a pre-feature done task`).
5. **"Time to book" typed input:** `3.5`, `3h 30m`, `210m`, `3h` parse, and junk like `abc` or empty disables Finish with an inline error instead of booking 0. Test in Task 1 (`parseDuration`) and Task 7 (`invalid time blocks finish`).

---

### Task 1: Shared time model and maths

**Files:**
- Create: `src/shared/time.ts`, `src/shared/time.test.ts`
- Modify: `src/shared/types.ts` (TaskSchema), `src/shared/usage.ts` (AppSettingsSchema, defaultSettings), `src/main/ipc/handlers.ts:705-735` (new task literal gets the new fields)

**Interfaces:**
- Produces (in `src/shared/time.ts`):
  - `type Interval = [startMs: number, endMs: number]`
  - `type AgentTool = 'claude-code' | 'copilot-cli' | 'opencode'`
  - `const AGENT_TOOLS: AgentTool[]`
  - `type WorkHours = { start: string; end: string; days: number[] }` (days: 0 = Sunday … 6 = Saturday)
  - `mergeIntervals(list: Interval[]): Interval[]`: sorted, overlapping or touching ones joined, empty or negative ones dropped
  - `totalMs(list: Interval[]): number`
  - `unionMs(...lists: Interval[][]): number`
  - `clip(list: Interval[], from: number, to: number): Interval[]`
  - `workingMs(periods: Interval[], hours: WorkHours): number`: the length of `periods` that falls inside working hours, in local time
  - `periodsOf(task: Pick<Task,'openPeriods'|'createdAt'|'finishedAt'>, now: number): Interval[]`: open periods with `end: null` taken as `now`. Empty `openPeriods` falls back to `[[createdAt, finishedAt ?? now]]`
  - `parseDuration(text: string): number | null`: seconds. Accepts `3.5`, `3,5`, `3h`, `3h 30m`, `3h30`, `210m`, `45m`; returns null for empty, junk or negative
  - `formatDuration(seconds: number): string`: `0m`, `45m`, `3h`, `3h 10m`. Minutes rounded
  - `type TimeBooking` (zod `TimeBookingSchema`): `{ bookedSeconds, measuredSeconds, realisticSeconds, wallClockSeconds, agentSeconds: Record<AgentTool, number>, bookedAt: string, writtenHours: number, syncError: string | null }`
  - `type TaskTime = { taskId; activeSeconds; agentSeconds: Record<AgentTool, number>; realisticSeconds; wallClockSeconds; measuredSinceReopenSeconds; booking: TimeBooking | null; estimate: { hours: number; source: 'original' | 'baseline' | 'live' } | null }`
- Produces (in `types.ts` TaskSchema): `openPeriods: z.array(z.object({ start: z.string(), end: z.string().nullable() })).default([])`, `time: TimeBookingSchema.nullable().default(null)`
- Produces (in `usage.ts` AppSettingsSchema): `writeTimeToAdo: z.boolean().default(false)`, `idleMinutes: z.number().int().min(1).max(60).default(5)`, `workHours: WorkHoursSchema.default({ start: '09:00', end: '17:00', days: [1,2,3,4,5] })`. `WorkHoursSchema` is exported from `time.ts`. `start` and `end` are `HH:MM`, and `end` must be after `start`.

- [ ] **Step 1: Write failing tests in `src/shared/time.test.ts`**
  - `mergeIntervals([[5,10],[0,3],[3,4],[9,12],[7,7]])` → `[[0,4],[5,12]]`
  - `unionMs([[0,10]],[[5,15]],[[20,25]])` → `20`
  - `clip([[0,100]], 10, 50)` → `[[10,50]]`
  - `workingMs`: one Monday 08:00–18:00 local → `8 * 3600_000`. Friday 16:00 to Monday 10:00 → `2 * 3600_000`. Saturday only → `0`. Build dates with `new Date(2026, 9, 12, 8)` (Monday 12 Oct 2026, local).
  - `periodsOf falls back to createdAt/finishedAt`: `openPeriods: []` gives `[[Date.parse(createdAt), Date.parse(finishedAt)]]`; an open period `end: null` ends at `now`.
  - `parseDuration`: `'3.5'`→12600, `'3,5'`→12600, `'3h'`→10800, `'3h 30m'`→12600, `'3h30'`→12600, `'210m'`→12600, `'45m'`→2700, `''`→null, `'abc'`→null, `'-1'`→null
  - `formatDuration`: 0→`'0m'`, 2700→`'45m'`, 10800→`'3h'`, 11400→`'3h 10m'`, 89→`'1m'`
  - Schema: `TaskSchema.parse` of a task without `openPeriods`/`time` gives `[]`/`null`. `AppSettingsSchema.parse` of an old settings object gives the defaults above.

- [ ] **Step 2: Run `npx vitest run src/shared/time.test.ts`.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement `src/shared/time.ts` and the schema fields.** `workingMs` walks day by day in local time (`new Date(y, m, d, hh, mm)`), so DST days stay correct. In `tasks:create`, set `openPeriods: [{ start: createdAt, end: null }]` and `time: null` on the new task literal.
- [ ] **Step 4: Run `npx vitest run src/shared` and `npm run typecheck`.** Expected: PASS (fix test fixtures that build full `Task`/`AppSettings` literals, e.g. `src/shared/types.test.ts`, `naming.test.ts`, renderer fake tasks, by adding the new fields).
- [ ] **Step 5: Commit** `feat(time): shared interval maths, task and settings fields`

### Task 2: TimeStore

**Files:**
- Create: `src/main/time/TimeStore.ts`, `src/main/time/TimeStore.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Interval`, `AgentTool`, `mergeIntervals`, `unionMs`, `workingMs`, `periodsOf`, `TaskTime`, `WorkHours`), `JsonFileStore`.
- Produces: `class TimeStore extends EventEmitter<{ changed: [taskId: string] }>`:
  - `constructor(file: string)`; `load(): Promise<{ recovered: boolean; backup?: string }>`
  - `addActive(taskId: string, iv: Interval): Promise<void>`
  - `addAgent(taskId: string, tool: AgentTool, iv: Interval): Promise<void>`
  - `addClaudeActive(p: { taskId: string; sessionId: string; endMs: number; value: number; cumulative: boolean }): Promise<void>`. Delta: an interval of `value` seconds ending at `endMs`. Cumulative: diffed against the last value for `sessionId`; a drop is a reset (the new value is the delta).
  - `recordBaseline(key: string, hours: number): Promise<void>`: first write wins. `key` = `${connectionId}:${workItemId}`.
  - `baseline(key: string): number | null`
  - `summarize(task: Task, hours: WorkHours, now: number): Omit<TaskTime, 'estimate'>`. Realistic = `unionMs(active, ...agent)`; wall clock = `workingMs(periodsOf(task, now), hours)`; `measuredSinceReopenSeconds` = active clipped to the start of the last open period.
  - `activeIntervals(taskId): Interval[]`, `agentIntervals(taskId): Record<AgentTool, Interval[]>`
- File schema (zod, version 1): `{ version: 1, active: Record<taskId, Interval[]>, agent: Record<taskId, Partial<Record<AgentTool, Interval[]>>>, claudeLast: Record<sessionId, number>, baselines: Record<key, { hours: number; recordedAt: string }> }`. Every add merges the list (`mergeIntervals`), so the file stays small.

- [ ] **Step 1: Write failing tests** in a temp dir (`mkdtempSync`):
  - `addActive` twice with overlapping intervals → `activeIntervals` merged, and `changed` emitted with the task id
  - `addClaudeActive` delta 1.72 at endMs 10_000 → agent claude interval `[8280, 10000]`
  - cumulative 5 then 8 for one session → 3 s added. Then 2 (a reset) → 2 s added
  - `recordBaseline('c:12', 5)` then `('c:12', 7)` → `baseline('c:12') === 5`
  - `summarize`: active `[0,60_000]`, claude `[30_000,90_000]` → `activeSeconds 60`, `realisticSeconds 90`, `agentSeconds['claude-code'] 60`
  - reload from disk keeps everything. A corrupt file is backed up (`recovered: true`)
- [ ] **Step 2: Run `npx vitest run src/main/time/TimeStore.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement `TimeStore`.** Writes go through `JsonFileStore.update`, one queue.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(time): TimeStore for intervals and baselines`

### Task 3: ActivityTracker

**Files:**
- Create: `src/main/time/ActivityTracker.ts`, `src/main/time/ActivityTracker.test.ts`

**Interfaces:**
- Produces: `class ActivityTracker`:
  - `constructor(d: { now: () => number; idleSeconds: () => number; idleLimitSeconds: () => number; onInterval: (taskId: string, iv: Interval) => void })`
  - `setTask(taskId: string | null): void`: the task on screen (from the renderer)
  - `setFocused(focused: boolean): void`: the main window has focus
  - `suspend(): void`: lock-screen or suspend; closes at `now()`
  - `tick(): void`: called every 15 s by main
  - `flush(): void`: emits the open interval up to `now()` and keeps counting from `now()` (called every 60 s and on quit)
- Rules: counting = focused && task !== null && idleSeconds < idleLimit. When idle reaches the limit, the interval ends at `now - idleSeconds*1000` (never before its start). Any state change closes the open interval at `now()` first. Intervals shorter than 1 s are dropped.

- [ ] **Step 1: Write failing tests** with a fake clock and a fake idle value:
  - focused + task A for 60 s, then `flush` → one interval `[0, 60000]` for A
  - `never counts two tasks at once`: A at 0, `setTask(B)` at 10 s, `setTask(A)` at 20 s, `flush` at 30 s → A `[0,10000]`, `[20000,30000]`; B `[10000,20000]`. No overlaps across tasks
  - unfocused → nothing recorded. Re-focus starts a new interval
  - idle 300 s seen on a tick at 400 s → interval ends at 100 s
  - `suspend closes the interval at the suspend moment`: suspend at 50 s, tick at 5000 s with idle 0 → the first interval is `[0,50000]` and a new one starts at 5000 s only
- [ ] **Step 2: Run `npx vitest run src/main/time/ActivityTracker.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(time): activity tracker with idle and focus rules`

### Task 4: Agent time sources

**Files:**
- Modify: `src/main/usage/otlp.ts` (add `parseClaudeActiveTime`), `src/main/usage/UsageReceiver.ts` (route `/v1/metrics`), `src/main/usage/telemetryEnv.ts`, `src/main/usage/copilot.ts` (add `copilotAgentIntervals`), `src/main/usage/CopilotFileTailer.ts` (optional third constructor arg)
- Create: `src/main/time/TerminalAgentTimer.ts`, `src/main/time/TerminalAgentTimer.test.ts`
- Test: `src/main/usage/otlp.test.ts`, `UsageReceiver.test.ts`, `telemetryEnv.test.ts`, `copilot.test.ts`, `CopilotFileTailer.test.ts`

**Interfaces:**
- Produces: `type ClaudeActive = { taskId: string; sessionId: string; endMs: number; value: number; cumulative: boolean }`. `parseClaudeActiveTime(body: unknown): ClaudeActive[]` takes `claude_code.active_time.total` sum data points with `type === 'cli'` and a `miac.task.id` (resource or point attributes). `asDouble`/`asInt` give the value; `aggregationTemporality === 2` means cumulative.
- Produces: `new UsageReceiver(onEvents, onActiveTime?: (points: ClaudeActive[]) => void)`. `/v1/metrics` bodies are parsed (gzip as for logs), bad JSON → 400, and the reply is 200.
- Produces: `telemetryEnv` sets `OTEL_METRICS_EXPORTER: 'otlp'`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: http://127.0.0.1:${port}/v1/metrics`, `OTEL_METRIC_EXPORT_INTERVAL: '10000'` (the logs keys are unchanged).
- Produces: `copilotAgentIntervals(line: string): Interval[]`. Spans named `invoke_agent*`, `chat*` or `execute_tool*` that have both a start and an end (`startTimeUnixNano`/`endTimeUnixNano` or `startTime`/`endTime` `[sec, nanos]`). `new CopilotFileTailer(dir, onEvents, onAgent?: (taskId: string, ivs: Interval[]) => void)`.
- Produces: `class TerminalAgentTimer`:
  - `constructor(d: { now: () => number; watch: (terminalId: string) => { taskId: string } | null; onInterval: (taskId: string, iv: Interval) => void; gapMs?: number /* 30000 */ })`
  - `input(terminalId: string, data: string): void`: Enter (`\r`) arms the terminal
  - `output(terminalId: string): void`: when armed, output opens or extends the interval
  - `tick(): void`: closes intervals with no output for more than `gapMs`
  - `close(terminalId: string): void`: on exit or kill, emits the open interval
  - `watch` returns null for terminals that are not OpenCode (main decides by the terminal's kind).

- [ ] **Step 1: Write failing tests:**
  - `parseClaudeActiveTime(fixture metrics.json)` → one point: `taskId '00000000-0000-4000-8000-000000000001'`, `value 1.72`, `cumulative false`, `endMs 1791986361380`. A `type: user` point is ignored.
  - Receiver: a POST of the fixture to `/v1/metrics` → 200 and `onActiveTime` called with one point. Bad JSON → 400.
  - `telemetryEnv('t', 4319, dir)` has the three metrics keys above.
  - `copilotAgentIntervals` of a span line with start 1760436000 s and end 1760436012 s → `[[1760436000000, 1760436012000]]`. The fixture lines without an end → `[]`.
  - TerminalAgentTimer: input `'\r'` at 0, output at 1 s, 5 s, 20 s, tick at 60 s → `[1000, 20000]`. Output without an earlier Enter → nothing. `close` emits the open interval.
- [ ] **Step 2: Run the touched test files.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again, then `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(time): agent time from Claude metrics, Copilot spans and OpenCode output`

### Task 5: Main wiring and time IPC

**Files:**
- Create: `src/main/time/timeHandlers.ts`, `src/main/time/timeHandlers.test.ts`
- Modify: `src/shared/ipc.ts`, `src/main/ipc/handlers.ts` (Services `time`, open periods on finish and reopen, baseline at create, `terminals:write` → `onTerminalInput`), `src/main.ts`, `src/main/ipc/handlers.test.ts` (helper gets a `TimeStore`)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces (IPC in `shared/ipc.ts`):
  - `'time:focus': { args: [taskId: string | null]; result: void }`
  - `'time:task': { args: [taskId: string]; result: TaskTime }`
  - `'time:sprint': { args: [connectionId: string]; result: Record<string /* workItemId */, LocalItemTime> }`, where `type LocalItemTime = { spentSeconds: number; measuredSeconds: number; agentSeconds: number; booked: boolean; baselineHours: number | null }` (exported from `shared/time.ts`). It sums every task of that work item on repos linked to the connection.
  - `'time:sync': { args: [taskId: string]; result: void }`: retries the write-back (Task 6)
  - Event `'time:changed': { taskId: string }`
- Produces: `Services.time: TimeStore`, `Services.tracker?: Pick<ActivityTracker, 'setTask'>`, `Services.onTerminalInput?: (id: string, data: string) => void`.
- `createTimeHandlers(d: { time: TimeStore; tasks: () => Task[]; task: (id: string) => Task; settings: () => AppSettings; connectionOf: (task: Task) => string | null; tracker?: Pick<ActivityTracker,'setTask'>; now?: () => number })` returns the `time:focus`, `time:task` and `time:sprint` handlers. `time:task` estimate: the baseline for the task's work item key as `source: 'baseline'`, else null. The renderer upgrades it with the live original estimate (Task 7).
- Handlers changes:
  - `tasks:finish` closes the last open period (`end = finishedAt`).
  - `tasks:reopen` (both paths) pushes `{ start: now, end: null }`.
  - `tasks:create` with a work item and a linked connection calls `recordBaseline` after the store write, non-blocking. It reads `client.workItemEstimate(id)` (Task 6), and only when Original Estimate is null and Remaining Work is not null. A failure is ignored.
- `main.ts`:
  - Create a `TimeStore(path.join(usageDir, 'time.json'))` and load it.
  - Create an `ActivityTracker` with `powerMonitor.getSystemIdleTime()` and `idleLimitSeconds: () => settings.get().idleMinutes * 60`, `onInterval` → `time.addActive`.
  - Window `focus`/`blur` → `setFocused`. `powerMonitor` `lock-screen`/`suspend` → `suspend()`.
  - `setInterval` tick 15 s, flush 60 s; flush on `before-quit`.
  - `receiver` gets `onActiveTime` → `time.addClaudeActive`. The Copilot tailer gets `onAgent` → `time.addAgent(taskId, 'copilot-cli', iv)`.
  - A `TerminalAgentTimer`: `watch` finds the terminal's task and kind in `store.state.tasks` and watches `kind === 'opencode'`. `terminals.on('data')` → `output`, `terminals.on('exit')` → `close`, tick on the 15 s timer, and `onTerminalInput` → `input`.
  - `time.on('changed')` → `broadcast('time:changed', { taskId })`.

- [ ] **Step 1: Write failing tests**
  - In `timeHandlers.test.ts`: `time:focus` passes the id to a fake tracker. `time:task` returns active/agent/realistic from a seeded store. `time:sprint` sums two tasks of work item 12 (one done with a booking of 3600, one open with 600 s active) → `spentSeconds 4200`, `booked true`. A task on another connection is excluded.
  - In `handlers.test.ts`: finish sets `openPeriods[0].end`. Reopen appends an open period. Create stores `openPeriods: [{ start: createdAt, end: null }]`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement; spread `createTimeHandlers(...)` into the handler map like `createDocsHandlers`.**
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(time): wire tracking in main and add time IPC`

### Task 6: Azure DevOps fields and booking at Finish

**Files:**
- Create: `src/main/time/timeWriteBack.ts`, `src/main/time/timeWriteBack.test.ts`
- Modify: `src/main/services/AdoClient.ts` (sprint fields, `workItemEstimate`), `src/shared/types.ts` (`SprintItem`, `FinishOptions`), `src/main/ipc/handlers.ts` (`tasks:finish`, `time:sync`, the `workItems:get` destructure), `src/main/services/AdoClient.test.ts`, `src/main/ipc/handlers.test.ts`

**Interfaces:**
- Produces: `SprintItem = WorkItemSummary & { remainingWork: number | null; originalEstimate: number | null; completedWork: number | null }`. `AdoClient.workItems` requests `Microsoft.VSTS.Scheduling.OriginalEstimate` and `Microsoft.VSTS.Scheduling.CompletedWork` too (verified 2026-10-16: absent fields are simply omitted).
- Produces: `AdoClient.workItemEstimate(id: number): Promise<{ type: string; originalEstimate: number | null; remainingWork: number | null; completedWork: number | null }>`.
- Produces: `FinishOptions.bookedSeconds?: number`.
- Produces: `planTimeWrite(p: { bookedSeconds: number; writtenHours: number; current: { remainingWork: number | null; completedWork: number | null }; fields: string[] }): { patch: Record<string, number>; hours: number } | null`. `hours` is the booked time rounded to 0.25. `delta = hours - writtenHours`, and null when the delta is 0 or neither field is on the type. The patch sets Completed Work to `(completed ?? 0) + delta` and Remaining Work to `max(0, (remaining ?? 0) - delta)`, each only when its field is in `fields`.
- Finish flow in `tasks:finish`, after `status: 'done'`, when `options.bookedSeconds` is a finite number ≥ 0:
  - Build the booking from `time.summarize` plus `bookedSeconds` and keep the previous `writtenHours` (0 when none). Patch `task.time`.
  - Send telemetry `time.booked` with `{ closest: 'measured' | 'realistic' | 'wallClock' | 'custom' }`; custom means more than 5 minutes from all three.
  - When `writeTimeToAdo` is on and the task has a work item and a connection, write through `withConnection`, using `usageSync`'s cached `workItemTypeFields` lookup or a new small cache. On success set `writtenHours = hours` and `syncError: null`. On failure set `syncError` to the message and broadcast a warn notice: "Task finished, but the time could not be written to the work item: <msg>. Use Retry on the Done page." The write never blocks cleanup.
- `time:sync` reruns the same write for a done task with a booking. It throws when `writeTimeToAdo` is off.

- [ ] **Step 1: Write failing tests:**
  - `planTimeWrite` with booked 3h 10m (11400 s), written 0, current 5/0, both fields → hours 3.25, patch `{CompletedWork: 3.25, RemainingWork: 1.75}`
  - `negative delta gives time back`: booked 2h, written 3.25, current 1.75/3.25 → patch `{CompletedWork: 2, RemainingWork: 3}`
  - Remaining Work never goes below 0. Only Completed Work on the type → only that field. Neither field → null. Delta 0 → null
  - AdoClient (existing fake-server tests): `workItems` maps the two new fields. `workItemEstimate` parses them
  - handlers: finish with `bookedSeconds: 7200` and `writeTimeToAdo` off → `task.time.bookedSeconds 7200`, no PATCH. With it on (`adoServer` helper) → a PATCH with both fields and `writtenHours 2`. A failing PATCH → task done, `time.syncError` set, a warn notice sent
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(time): book time at finish and write it to Azure DevOps when opted in`

### Task 7: Renderer: focus reporting, time hook and the Finish slider

**Files:**
- Create: `src/renderer/hooks/useTaskTime.ts`, `src/renderer/components/TimeSpentSection.tsx`, `src/renderer/components/TimeSpentSection.test.tsx`
- Modify: `src/main/ipc/handlers.ts` + `src/shared/ipc.ts` (`workItems:get` keeps the three estimate fields), `src/renderer/App.tsx` (focus effect), `src/renderer/screens/FinishScreen.tsx`, `src/renderer/format.ts` (re-export `formatDuration`), `src/renderer/styles/screens.css`, `src/renderer/test-helpers/fakeApi.ts`

**Interfaces:**
- Consumes: `time:task`, `time:changed`, `time:focus`, `workItems:get`, `FinishOptions.bookedSeconds`.
- Produces: `useTaskTime(taskId: string | null): TaskTime | null` (refetches on `time:changed` for the id), modelled on `useTaskUsage`.
- Produces: `taskOnScreen(state): string | null`: `task` → `selectedTaskId`, `setup`/`finish` → `screen.taskId`, else null. In `App`, a `useStore.subscribe` effect invokes `time:focus` when the value changes.
- Produces: `<TimeSpentSection task={TaskView} time={TaskTime} estimateHours={number|null} value={number|null} onChange={(seconds: number|null) => void} />`:
  - title "Time spent", subline `Started <dateTime> · finishing now`;
  - a range input from the lowest to the highest of measured, realistic and wall clock, `step` 300 s, with three labelled marks (`measured`, `you + agents`, `wall clock (work hrs)`);
  - a text field "Time to book" (`formatDuration` value, `parseDuration` on change; invalid input → `onChange(null)` and the inline error `Enter a time like 3h 30m or 3.5`);
  - when there's an estimate, `X of Y estimate` with the bar (`.time-bar`, amber `.over` when above 100%);
  - agent time per tool, with OpenCode suffixed ` est.`.
- FinishScreen:
  - Renders the section between "AI usage" and "Clean up".
  - The initial value is `time.booking ? booking.bookedSeconds + measuredSinceReopenSeconds : activeSeconds`.
  - The estimate is the live `originalEstimate` from `workItems:get`, else `time.estimate.hours`, else the live Remaining + Completed. `workItems:get` must return those three fields: extend its summary type to keep `originalEstimate`, `remainingWork` and `completedWork` instead of stripping `remainingWork`.
  - Sends `bookedSeconds` with Finish. Finish is disabled while the value is null.

- [ ] **Step 1: Write failing tests (`TimeSpentSection.test.tsx`, plus FinishScreen tests in its existing test file):**
  - Renders the three marks with `formatDuration` values. The field starts at measured (`3h 10m` for 11400).
  - Moving the slider to 14700 s → the field shows `4h 5m` and `onChange(14700)` is called.
  - `invalid time blocks finish`: typing `abc` shows the error and the Finish button is disabled.
  - Estimate 5h with 11400 s → text `3h 10m of 5h estimate`. Over the estimate → the bar has class `over`.
  - Changing the screen to a task page invokes `time:focus` with the task id. The Sprint page → `null`.
- [ ] **Step 2: Run `npx vitest run src/renderer`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Styles follow the existing ADO tokens in `screens.css`.
- [ ] **Step 4: Run `npm test && npm run typecheck && npm run lint`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(time): Time spent step on Finish with an optimistic to pessimistic slider`

### Task 8: Sprint page "Spent / est." column

**Files:**
- Create: `src/shared/sprintTime.ts`, `src/shared/sprintTime.test.ts`
- Modify: `src/renderer/screens/SprintScreen.tsx`, `src/renderer/styles/screens.css` (`--grid-cols` gets a 150px column after Remaining work), `src/renderer/screens/SprintScreen.test.tsx`

**Interfaces:**
- Consumes: `SprintRow` with the new fields, `time:sprint` (`LocalItemTime`).
- Produces: `sprintTime(rows: SprintRow[], local: Record<string, LocalItemTime>): Map<string, { spentSeconds: number | null; estimateHours: number | null; source: 'local' | 'ado' | null; rolledUp: boolean }>`:
  - Spent per item: local `spentSeconds` when there's a local entry, else `completedWork * 3600` when not null, else null.
  - Estimate per item: `originalEstimate ?? local.baselineHours ?? (remainingWork !== null || completedWork !== null ? (remainingWork ?? 0) + (completedWork ?? 0) : null)`.
  - Parents add their descendants' values to their own, and `rolledUp` is true when any descendant contributed.
- SprintScreen:
  - Fetches `time:sprint` with the sprint and on `time:changed`.
  - The cell shows `formatDuration(spent) / formatDuration(est*3600)` with `.time-bar` (amber over 100%); only the spent value when there's no estimate; `–` or `– / 4h` with no spent.
  - Its `title` lists measured, agent and booked, and `from Azure DevOps` for the ADO source.
  - The header is `Spent / est.`.

- [ ] **Step 1: Write failing tests:**
  - `sprintTime`: a local item with 11400 s and original estimate 5 → `{ spentSeconds: 11400, estimateHours: 5, source: 'local' }`. An item without a local entry, completedWork 2 and remaining 3 → `{ 7200, 5, 'ado' }`. A Basic Issue (all null) → `{ null, null, null }`. A parent with two children (3600 s local, 2 h ADO) and its own nothing → `spentSeconds 10800`, `rolledUp true`. Local and ADO are never added for one item: local 3600 s with completedWork 9 → 3600.
  - `row with a pre-feature done task`: a done task with `time: null` and no periods renders the measured value or `–` without throwing.
  - The grid renders the header `Spent / est.` and `3h 10m / 5h` for a seeded row.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test && npm run typecheck && npm run lint`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(time): Spent / estimate column on the Sprint page`

### Task 9: Usage tab, Done page, Settings and CSV

**Files:**
- Create: `src/renderer/components/TimePanel.tsx`, `src/renderer/components/TimePanel.test.tsx`, `src/renderer/components/TimeSection.tsx` (Settings)
- Modify: `src/renderer/components/UsagePanel.tsx` (renders `TimePanel` first), `src/renderer/screens/DoneTaskPage.tsx`, `src/renderer/screens/SettingsScreen.tsx`, `src/shared/ipc.ts` + `src/main/time/timeHandlers.ts` (`time:exportCsv`), `src/main/time/timeCsv.ts` + test

**Interfaces:**
- Produces: `'time:exportCsv': { args: [taskId: string]; result: string }`, built by `timeCsv(rows: { task: string; workItem: string; booked: number|null; measured: number; realistic: number; wallClock: number; claude: number; copilot: number; opencode: number }[]): string`. One row for the task, seconds as integers, header `task,work_item,booked_s,measured_s,realistic_s,wall_clock_s,claude_s,copilot_s,opencode_est_s`. It uses the same `cell` quoting as `usage/csv.ts` (move `cell` into a small shared helper or duplicate the four lines). *(Our call: a separate time CSV, because the usage CSV is one row per AI request.)*
- TimePanel (Usage tab):
  - an `h3` "Time";
  - measured, you + agents and wall clock;
  - agent per tool;
  - the estimate bar (same estimate rule as Finish);
  - booked, when there is a booking;
  - an "Export time (CSV)" button that saves like the usage export does.
- DoneTaskPage:
  - A `Fact label="Time booked"` showing `booked 4h (measured 3h 10m)`, or `Not booked` for older tasks.
  - When `time.syncError` is set, a warning line with a Retry button that calls `time:sync`.
- Settings `TimeSection` (`id="time"`, `h2` "Time tracking"), placed after `CostSection`:
  - working hours start and end (`type="time"`);
  - weekday checkboxes;
  - idle minutes (1–60);
  - the checkbox "Write booked time to Azure DevOps (adds to Completed Work, lowers Remaining Work)" bound to `writeTimeToAdo`.
  - It saves through `settings:save` the way `CostSection` does.

- [ ] **Step 1: Write failing tests:** the TimePanel shows `3h 10m` measured and `1h 40m` Claude. The Done page shows `booked 4h (measured 3h 10m)`, and Retry calls `time:sync`. The Settings checkbox saves `writeTimeToAdo: true`. `timeCsv` produces the exact header and one row.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test && npm run typecheck && npm run lint`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(time): time on the Usage tab, Done page, Settings and CSV export`

### Task 10: Docs

**Files:**
- Modify: `docs/telemetry.md` (the `time.booked` event and its `closest` property), `CLAUDE.md` (Status: time tracking implemented 2026-10-16 on `feature/time-tracking`; a summary of the measures, Finish booking, the Sprint column and the opt-in `writeTimeToAdo`; known gaps: OpenCode heuristic, Copilot unverified, time outside MIAC not measured)

- [ ] **Step 1: Edit both files.**
- [ ] **Step 2: Run `npm run lint`.** Expected: PASS.
- [ ] **Step 3: Commit** `docs: time tracking in status and telemetry`
