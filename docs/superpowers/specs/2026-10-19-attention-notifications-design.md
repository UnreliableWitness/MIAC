# Attention notifications: tell the developer when an agent needs them

Date: 2026-10-19. Owner decisions:
- **"Out of view"** means the terminal is not on screen: Shellie is not the focused window, **or** Shellie is focused but shows another task, another tab of the task (Docs, Changes, Usage, another terminal) or another page (Home, Sprint).
- **Triggers:** the agent is **blocked** on the developer (permission prompt, question) **and** the agent **finished its turn** and waits for the next message.
- **Detection:** the agent tells Shellie itself, no output guessing. Claude Code through its terminal status protocol (OSC 7501), OpenCode through a small Shellie plugin, other terminals through the terminal bell as a fallback.
- **Signals:** a system notification that opens the right task and tab on click, a badge on the task in the nav and on the terminal tab, a count on the Dock icon.

Calls marked *(our call)* were made during design and not explicitly decided by the owner.

## Why

A developer runs several tasks, each with a Claude Code or OpenCode terminal. Agents stop to ask for permission or finish a turn while the developer works in another task, another app or the browser. Today they only find out by checking each terminal, so agents sit idle for minutes.

## Goals

- Within a second of an agent blocking or finishing, a developer who is not looking at that terminal gets a notification.
- Clicking it brings Shellie to the front on the right task and terminal tab.
- Inside Shellie, it is visible at a glance which tasks and tabs wait on the developer.
- Nothing fires for the terminal the developer is looking at.

## Non-goals

- Agents running outside Shellie (iTerm, VS Code terminals). Shellie only knows its own terminals.
- Answering a permission prompt from the notification (Allow/Deny buttons).
- Sounds or notification styles beyond the system default; the OS notification settings for Shellie govern banner vs. alert and sound.
- Phone or remote push.
- Copilot CLI-specific detection (it gets the bell fallback only).

## Anti-goals (a failure even if it works)

- Touching the developer's own agent configuration (`~/.claude/settings.json`, `~/.config/opencode/`, repo `opencode.json` or `.claude/`).
- A stream of notifications: one agent that blocks, finishes and blocks again while the developer is away gives **one** notification until they look *(our call)*.
- Parsing or guessing from terminal text output.

## 1. Detection

Every source turns into one signal per terminal: `{ terminalId, state, kind?, message? }` with `state` one of `working | idle | blocked | done | clear`. `kind` is free text from the agent (`permission`, `question`, ...). `message` is a short human line, already decoded.

### 1.1 Claude Code: OSC 7501 program status

Verified live against Claude Code 2.1.302 in a pty on 2026-10-19:

- At start, Claude writes the probe `ESC ] 7501 ; ? BEL`. Without a reply it never reports status. When the terminal replies with `ESC ] 7501 ; ? BEL`, Claude reports its state in its output as `ESC ] 7501 ; <fields> (BEL | ESC \)`, fields joined with `:`:
  - `state=idle:app=claude-code`: ready, and after the developer presses Esc during a turn.
  - `state=working:app=claude-code[:msg=<base64>]`: running; `msg` is a status line.
  - `state=blocked:app=claude-code:kind=permission:msg=<base64>`: waiting for permission; `msg` decoded was `approve Bash: rm /tmp/...`.
  - `state=done:app=claude-code`: turn finished.
  - `state=clear` (optionally `:id=...`): status cleared, sent on exit.
  - Optional fields seen in the code: `id`, `progress`, `title` (base64).
- Shellie's main process scans every terminal's output (`TerminalManager` `data` events) with a streaming parser that copes with sequences split across chunks. On the probe it writes the reply to that pty. On a status sequence it emits a signal, decoding `msg` (base64, UTF-8, clamped to 200 characters).
- The scanner runs on **every** terminal, not only Claude tabs *(our call)*: the protocol is generic, a shell running `claude` by hand then works too, and answering a probe a program sent is harmless.
- The sequences still reach xterm.js in the renderer, which ignores unknown OSC codes. Nothing is stripped.
- Why not hooks: the `Notification` hook fires about 6 s after a permission prompt and about 60 s after idle, `Stop` does not fire on an Esc interrupt, and Claude holds back all hooks until the workspace trust dialog is accepted, which a fresh task worktree has not had. OSC 7501 is instant, covers interrupts and needs no settings.

### 1.2 OpenCode: Shellie plugin

Verified against the OpenCode 1.14.22 source; not yet run live.

- At startup main writes the plugin `shellie-attention.js` into `<userData>/opencode/`. It is written from a string in the code, so no packaging change is needed.
- OpenCode tabs get `OPENCODE_CONFIG_CONTENT='{"plugin":["<absolute path>"]}'`. OpenCode deep-merges this on top of global, project and `.opencode` config (plugin arrays are concatenated), so the developer's own plugins and config stay. If the developer already has `OPENCODE_CONFIG_CONTENT` set, Shellie parses it and appends to its `plugin` array. If it is not valid JSON, Shellie leaves it alone and the tab has no OpenCode detection *(our call)*.
- Every task pty gets `SHELLIE_TERMINAL_ID` (next to the existing `SHELLIE_TASK_ID`) and `SHELLIE_ATTENTION_URL` / `SHELLIE_ATTENTION_TOKEN` (see 1.4).
- The plugin does nothing when `SHELLIE_ATTENTION_URL` is missing, so OpenCode started outside Shellie is unaffected. It exports only the plugin function; OpenCode rejects other exports.
- Event mapping:
  - `permission.asked` → `blocked`, kind `permission`, message from `permission` + `patterns`.
  - `question.asked` → `blocked`, kind `question`.
  - `permission.replied`, `question.replied`, `question.rejected`, `session.status` busy/retry → `working`.
  - `session.status` idle → `done`. `session.idle` (deprecated) is handled the same way, deduplicated.
  - `session.error` → `done` with the error as message *(our call: an error also means the agent stopped and waits)*.
- Subagent sessions are ignored: the plugin remembers `info.parentID` from `session.created` / `session.updated` and drops events for child sessions.
- The plugin POSTs each signal with `fetch` and swallows every error. OpenCode never waits on it.

### 1.3 Other terminals: bell

- A BEL byte outside an escape sequence, in a terminal that has not reported OSC 7501 status and is not an OpenCode tab, emits `done` with message "rang the bell".
- Bells from one terminal are throttled to one signal per 10 s *(our call)*.

### 1.4 Receiver route

- `UsageReceiver` gets a route `POST /v1/attention`, JSON `{ terminalId, state, kind?, message? }`, validated with zod.
- The header `x-shellie-token` must equal a random token generated per app run and passed to ptys as `SHELLIE_ATTENTION_TOKEN`; otherwise 403. This keeps other local programs from raising notifications *(our call)*.
- A `terminalId` Shellie does not know is answered with 404 and ignored.

## 2. Attention state

A pure class `AttentionTracker` in `src/main/attention/` (clock and focus injected, like `ActivityTracker` and `TerminalAgentTimer`) owns per-terminal state:

- `needs: null | { reason: 'blocked' | 'done', kind?, message?, since }` and `notified: boolean`.
- It knows what is on screen from two inputs: window focus (from the existing `focus` / `blur` handling, also false when minimized or hidden) and the view `{ taskId, tabId } | null` reported by the renderer (2.1).

Rules:

1. `blocked` → needs `blocked`. `done` → needs `done`, unless the "notify when a turn finishes" setting is off, in which case `done` only clears.
2. `working`, `idle` and `clear` → needs cleared: the agent is no longer waiting, for example because the developer answered in the terminal.
3. If the terminal is on screen when a signal sets `needs`, nothing is recorded: no badge, no notification.
4. When `needs` is set while out of view and `notified` is false, show one notification and set `notified`. Later changes (blocked → done → blocked) update the badge and its text but do not notify again until the developer has looked *(our call)*.
5. When the terminal comes on screen, `needs` and `notified` are cleared.
6. Terminal exit, task finish and task delete clear the terminal's state.

Each change emits a snapshot `Record<terminalId, { reason, kind?, message? }>`, which main broadcasts to the renderer as `attention:changed` and from which it sets the Dock count.

### 2.1 What is on screen

- A renderer hook `useAttentionView` sends `attention:view` with `{ taskId, tabId }` whenever the task page and its active tab change (`taskOnScreen` from `useTimeFocus` plus `activeTab(taskId)` from the store), and `null` for every other page.
- `tabId` is a terminal id, or a fixed id such as `DOCS_TAB` that matches no terminal.

## 3. Signals

### 3.1 Notification

- Electron `Notification`. Title: the task title (work item number and title when linked). Body by reason:
  - blocked, kind `permission`: "Claude Code needs permission: approve Bash: rm ..." (tab label + message).
  - blocked, another kind: "OpenCode has a question" / "<tab label> is waiting for you".
  - done: "<tab label> finished" (+ message when present).
- Click: show and focus the window (restore if minimized), go to the task page and select that terminal tab (new broadcast `attention:open` `{ taskId, terminalId }`, which the renderer handles through the store). Selecting it puts the terminal on screen, which clears it (rule 5).
- Notifications of a terminal that was cleared meanwhile are closed (`notification.close()`) *(our call)*, so the Notification Center does not keep stale ones.

### 3.2 In-app badges

- **Nav (`TaskNav`):** a dot on each task with at least one terminal needing attention; amber for blocked, the accent colour for done; tooltip with the message.
- **Terminal tab (`TerminalTabs`):** the same dot on the tab label.
- The renderer keeps the snapshot from `attention:changed` in the store; `attention:get` returns it on load.

### 3.3 Dock

- `app.setBadgeCount(n)` with `n` = terminals with `needs` set. macOS shows it on the Dock icon; on Windows it is a no-op (taskbar overlay deferred to the Windows pass).

## 4. Settings

- `notifyOnDone: boolean`, default `true`, in `AppSettingsSchema`, with a toggle in Settings: "Notify when an agent finishes its turn". Blocked always notifies; a developer who wants no notifications at all turns them off for Shellie in macOS System Settings.

## 5. Errors and edge cases

- Malformed OSC 7501 fields or bad base64: the signal is used without a message; never throws in the data path.
- A sequence longer than 8 KB without a terminator is dropped and the scanner resets *(our call)*.
- Resumed or respawned Claude tabs probe again at start, so they report again.
- Notifications not permitted by the OS: badges and the Dock count still work. No error is shown.
- Windows: ConPTY may not pass OSC 7501 through. Verifying that is part of the Windows pass (standing decision: macOS first). The OpenCode plugin and the bell work there regardless.

## 6. Testing

- Unit (Vitest):
  - OSC scanner: split chunks, BEL vs. `ESC \` terminator, probe reply, bell outside sequences, oversize reset, base64 decoding.
  - `AttentionTracker`: every rule in section 2, including on-screen suppression, a single notification while away, clearing on view, and `notifyOnDone` off.
  - Receiver route: token, validation, unknown terminal.
  - OpenCode plugin: run the exported function with fake events and a fake `fetch`. Covers the mapping, child session filtering, no-op without env, and the `OPENCODE_CONFIG_CONTENT` merge.
  - Renderer: nav and tab badges from a snapshot, `attention:view` reporting, `attention:open` navigation.
- Live functional check of the packaged app (Playwright over CDP, throwaway repo, the developer's `state.json` and `connections.json` set aside and restored):
  1. A shell tab printing OSC 7501 `blocked` while another task is on screen gives a badge, a notification and Dock count 1. Notification creation is asserted through a main-process spy.
  2. Switching to that tab clears the badge and the count.
  3. A sequence printed on screen gives no badge.
  4. blocked → done → blocked while away gives exactly one notification.
  5. A real Claude Code tab in a trusted throwaway folder, asked to run a command that needs permission, goes to `blocked` with kind `permission`.
  6. If OpenCode is installed: an OpenCode tab reports `done` after a prompt.
