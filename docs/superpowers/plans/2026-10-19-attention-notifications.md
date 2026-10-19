# Attention Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify the developer (system notification, nav and tab badges, Dock count) when a Claude Code, OpenCode or other terminal agent is blocked on them or finished its turn while that terminal is not on screen.

**Architecture:** Every signal becomes `{ state, kind?, message? }` for one terminal id.
- Claude Code: main scans pty output for OSC 7501 (answering Claude's probe).
- OpenCode: a Shellie plugin, injected with `OPENCODE_CONFIG_CONTENT`, POSTs to a new receiver route.
- Other terminals: a bare BEL.

A pure `AttentionTracker` decides what needs attention given window focus and the on-screen tab. An `AttentionHub` in main owns the scanners, notifications and Dock count. The renderer reports the on-screen tab, shows badges and navigates on notification click.

**Tech Stack:** Electron (main: `Notification`, `app.setBadgeCount`), node-pty via `TerminalManager`, zod, React + zustand renderer, Vitest + Testing Library, Playwright over CDP for the live check.

**Spec:** `docs/superpowers/specs/2026-10-19-attention-notifications-design.md`

## Global Constraints

- Never write to the developer's own agent config: `~/.claude/settings.json`, `~/.config/opencode/`, repo `opencode.json`, `.opencode/`, `.claude/`.
- OSC 7501 probe reply is exactly `\x1b]7501;?\x07`.
- Status fields are `:`-separated `key=value`; `msg` and `title` are base64 (UTF-8); messages are clamped to 200 characters.
- An OSC sequence longer than 8192 characters without a terminator is dropped and the scanner resets.
- Bell signals are throttled to one per terminal per 10 000 ms.
- Receiver route: `POST /v1/attention`, header `x-shellie-token` must equal the per-run token (else 403), unknown `terminalId` → 404, bad body → 400.
- One notification per terminal until the developer has looked at it (blocked → done → blocked while away = 1 notification).
- Setting `notifyOnDone: boolean`, default `true`. Blocked (including bell) always notifies.
- Formatting: run `npx oxfmt src` and `npx oxlint src`, never `npm run lint:fix` or bare `oxfmt` at the repo root (`.claude/worktrees/` holds other agents' worktrees).
- Comments: match the surrounding code (short JSDoc on exported things, few inline comments).
- Commits end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018pN36d8qmj82BVJLA1wM2L
  ```

## Review Focus

1. **An OSC sequence split across pty chunks** (`\x1b]75` | `01;state=blocked…\x07`, or the ST split as `\x1b` | `\\`) must still be detected. Test in Task 1.
2. **Window blurred or minimized while the flagged tab is the active tab.** The terminal is then *not* on screen, so the notification fires. When the window is focused again it is on screen and clears. Test in Task 2.
3. **A terminal closed, or its task finished, while flagged.** The badge, Dock count and OS notification must go away. `TerminalManager.kill` emits no `exit`, so this relies on `retain`. Test in Task 4.
4. **Garbage from the agent**: bad base64, an invalid UTF-8 `msg`, or a 10 KB `msg`. This must give a signal with a clamped message or none, never throw in the data path. Test in Task 1.
5. **A probe arriving after the terminal exited** (`TerminalManager.write` throws for unknown ids). The hub must swallow it. Test in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/attention.ts` (create) | Shared types, receiver body schema, message clamp |
| `src/main/attention/OscScanner.ts` (create) | Streaming scanner: OSC 7501 probe/status and bare BEL, across chunks; `programStatusSignal` decoding |
| `src/main/attention/AttentionTracker.ts` (create) | Pure per-terminal attention state and the rules of spec §2 |
| `src/main/attention/AttentionHub.ts` (create) | Owns scanners, bell throttle, tracker, OS notifications, Dock count; injected Electron bits |
| `src/main/attention/opencodePlugin.ts` (create) | Plugin source string and `OPENCODE_CONFIG_CONTENT` merge |
| `src/main/usage/UsageReceiver.ts` (modify) | `/v1/attention` route |
| `src/main/services/TerminalManager.ts` (modify) | `SHELLIE_TERMINAL_ID` env |
| `src/shared/usage.ts` (modify) | `notifyOnDone` setting |
| `src/shared/ipc.ts` (modify) | `attention:view`, `attention:get` channels; `attention:changed`, `attention:open` events |
| `src/main/ipc/handlers.ts` (modify) | attention handlers, `terminalEnv` hook in `spawnTerminal` |
| `src/main.ts` (modify) | Wiring: token, plugin file, hub, receiver, focus, retain, Notification, Dock |
| `src/renderer/store.ts` (modify) | `attention` snapshot in the store |
| `src/renderer/hooks/useAttention.ts` (create) | Subscribe, report the view, handle `attention:open` |
| `src/renderer/components/AttentionDot.tsx` (create) | The badge dot |
| `src/renderer/components/TaskNav.tsx`, `TerminalTabs.tsx` (modify) | Show the dot |
| `src/renderer/screens/SettingsScreen.tsx` (modify) | `notifyOnDone` toggle |
| `src/renderer/styles/tokens.css`, `shell.css` (modify) | `--amber`, `.attention-dot` |

---

### Task 1: Shared types and the OSC scanner

**Files:**
- Create: `src/shared/attention.ts`
- Create: `src/main/attention/OscScanner.ts`
- Test: `src/main/attention/OscScanner.test.ts`

**Interfaces:**
- Produces:
  - `AttentionState`, `AttentionSignal`, `AttentionEntry`, `AttentionSnapshot`, `AttentionView`, `AttentionPostSchema`, `clampMessage(s: string): string`, `MESSAGE_MAX = 200` (from `src/shared/attention.ts`).
  - `class OscScanner { push(chunk: string): ScanEvent[] }`.
  - `type ScanEvent = { type: 'probe' } | { type: 'status'; fields: Record<string, string> } | { type: 'bell' }`.
  - `programStatusSignal(fields: Record<string, string>): AttentionSignal | null`.
  - `PROBE_REPLY = '\x1b]7501;?\x07'`.

- [ ] **Step 1: Write the shared types**

`src/shared/attention.ts`:

```ts
import { z } from 'zod';

export const ATTENTION_STATES = [
  'working',
  'idle',
  'blocked',
  'done',
  'clear',
] as const;
export type AttentionState = (typeof ATTENTION_STATES)[number];

/** What an agent reported about one terminal. `kind` is the agent's own word (`permission`, `question`, `bell`). */
export type AttentionSignal = {
  state: AttentionState;
  kind?: string;
  message?: string;
};

/** A terminal that waits on the developer. */
export type AttentionEntry = {
  reason: 'blocked' | 'done';
  kind?: string;
  message?: string;
  since: number;
};

/** Terminal id → what it waits for; only terminals that need attention. */
export type AttentionSnapshot = Record<string, AttentionEntry>;

/** The terminal tab on screen in the renderer; null when no task page shows. */
export type AttentionView = { taskId: string; tabId: string } | null;

export const MESSAGE_MAX = 200;

/** One line, at most MESSAGE_MAX characters. */
export const clampMessage = (s: string): string => {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > MESSAGE_MAX
    ? `${line.slice(0, MESSAGE_MAX - 1)}…`
    : line;
};

/** Body of POST /v1/attention (the OpenCode plugin). */
export const AttentionPostSchema = z.object({
  terminalId: z.string().min(1).max(100),
  state: z.enum(ATTENTION_STATES),
  kind: z.string().max(40).optional(),
  message: z.string().max(4000).optional(),
});
```

- [ ] **Step 2: Write the failing scanner tests**

`src/main/attention/OscScanner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { OscScanner, PROBE_REPLY, programStatusSignal } from './OscScanner';

const ESC = '\x1b';
const BEL = '\x07';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('OscScanner', () => {
  it('finds the probe with either terminator', () => {
    const s = new OscScanner();
    expect(s.push(`${ESC}]7501;?${BEL}`)).toEqual([{ type: 'probe' }]);
    expect(s.push(`${ESC}]7501;?${ESC}\\`)).toEqual([{ type: 'probe' }]);
    expect(PROBE_REPLY).toBe(`${ESC}]7501;?${BEL}`);
  });

  it('parses status fields', () => {
    const s = new OscScanner();
    expect(
      s.push(`x${ESC}]7501;state=blocked:app=claude-code:kind=permission${BEL}y`),
    ).toEqual([
      {
        type: 'status',
        fields: { state: 'blocked', app: 'claude-code', kind: 'permission' },
      },
    ]);
  });

  it('joins sequences split across chunks, including a split ST', () => {
    const s = new OscScanner();
    expect(s.push(`ab${ESC}]75`)).toEqual([]);
    expect(s.push(`01;state=done:app=claude-code${ESC}`)).toEqual([]);
    expect(s.push('\\rest')).toEqual([
      { type: 'status', fields: { state: 'done', app: 'claude-code' } },
    ]);
  });

  it('reports a bare BEL but not the BEL that ends an OSC', () => {
    const s = new OscScanner();
    expect(s.push(`${ESC}]0;title${BEL}`)).toEqual([]);
    expect(s.push(`ding${BEL}`)).toEqual([{ type: 'bell' }]);
  });

  it('ignores other escape sequences and OSC codes', () => {
    const s = new OscScanner();
    expect(s.push(`${ESC}[31mred${ESC}[0m${ESC}]8;;http://x${BEL}`)).toEqual(
      [],
    );
  });

  it('drops an unterminated sequence over 8192 characters and recovers', () => {
    const s = new OscScanner();
    expect(s.push(`${ESC}]7501;${'a'.repeat(9000)}`)).toEqual([]);
    expect(s.push(`${BEL}${ESC}]7501;?${BEL}`)).toEqual([{ type: 'probe' }]);
  });
});

describe('programStatusSignal', () => {
  it('decodes msg and clamps it', () => {
    expect(
      programStatusSignal({
        state: 'blocked',
        kind: 'permission',
        msg: b64('approve Bash: rm /tmp/x'),
      }),
    ).toEqual({
      state: 'blocked',
      kind: 'permission',
      message: 'approve Bash: rm /tmp/x',
    });
    const long = programStatusSignal({ state: 'done', msg: b64('x'.repeat(10_000)) });
    expect(long?.message?.length).toBe(200);
  });

  it('keeps the state when msg is not base64 or not text', () => {
    expect(programStatusSignal({ state: 'done', msg: '%%%' })).toEqual({
      state: 'done',
    });
    expect(
      programStatusSignal({
        state: 'done',
        msg: Buffer.from([0xff, 0xfe, 0xfd]).toString('base64'),
      }),
    ).toEqual({ state: 'done' });
  });

  it('returns null for unknown or missing states', () => {
    expect(programStatusSignal({ state: 'dancing' })).toBeNull();
    expect(programStatusSignal({})).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/main/attention/OscScanner.test.ts`
Expected: FAIL, cannot resolve `./OscScanner`.

- [ ] **Step 4: Implement the scanner**

`src/main/attention/OscScanner.ts`:

```ts
import {
  ATTENTION_STATES,
  type AttentionSignal,
  type AttentionState,
  clampMessage,
} from '../../shared/attention';

export type ScanEvent =
  | { type: 'probe' }
  | { type: 'status'; fields: Record<string, string> }
  | { type: 'bell' };

const ESC = '\x1b';
const BEL = '\x07';
const CODE = '7501;';
const OSC_MAX = 8192;

/** What Shellie answers to Claude Code's "do you support program status?" probe. */
export const PROBE_REPLY = `${ESC}]7501;?${BEL}`;

/**
 * Finds OSC 7501 program status (probe and status) and bare BELs in a pty's output, keeping state between chunks.
 * Everything else passes by; nothing is removed from the stream.
 */
export class OscScanner {
  private mode: 'text' | 'esc' | 'osc' | 'osc-esc' | 'skip' | 'skip-esc' =
    'text';
  private osc = '';

  push(chunk: string): ScanEvent[] {
    const out: ScanEvent[] = [];
    for (const ch of chunk) {
      switch (this.mode) {
        case 'text':
          if (ch === ESC) this.mode = 'esc';
          else if (ch === BEL) out.push({ type: 'bell' });
          break;
        case 'esc':
          if (ch === ']') {
            this.mode = 'osc';
            this.osc = '';
          } else this.mode = ch === ESC ? 'esc' : 'text';
          break;
        case 'osc':
          if (ch === BEL) this.end(out);
          else if (ch === ESC) this.mode = 'osc-esc';
          else if (this.osc.length >= OSC_MAX) this.mode = 'skip';
          else this.osc += ch;
          break;
        // An over-long sequence: dropped up to its terminator, so its BEL is not taken for a bell.
        case 'skip':
          if (ch === BEL) this.mode = 'text';
          else if (ch === ESC) this.mode = 'skip-esc';
          break;
        case 'skip-esc':
          this.mode = ch === '\\' ? 'text' : 'skip';
          break;
        case 'osc-esc':
          if (ch === '\\') this.end(out);
          else if (ch === ']') {
            this.mode = 'osc';
            this.osc = '';
          } else this.mode = 'text';
          break;
      }
    }
    return out;
  }

  private end(out: ScanEvent[]): void {
    this.mode = 'text';
    const body = this.osc;
    this.osc = '';
    if (!body.startsWith(CODE)) return;
    const payload = body.slice(CODE.length);
    if (payload.startsWith('?')) {
      out.push({ type: 'probe' });
      return;
    }
    const fields: Record<string, string> = {};
    for (const part of payload.split(':')) {
      const eq = part.indexOf('=');
      if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
    }
    out.push({ type: 'status', fields });
  }
}

const decode = (b64: string | undefined): string | undefined => {
  if (!b64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return undefined;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(b64, 'base64'),
    );
    const line = clampMessage(text);
    return line === '' ? undefined : line;
  } catch {
    return undefined;
  }
};

/** A status sequence's fields as a signal; null when the state is missing or unknown. */
export function programStatusSignal(
  fields: Record<string, string>,
): AttentionSignal | null {
  const state = fields.state as AttentionState | undefined;
  if (!state || !ATTENTION_STATES.includes(state)) return null;
  const message = decode(fields.msg);
  return {
    state,
    ...(fields.kind ? { kind: fields.kind } : {}),
    ...(message ? { message } : {}),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/main/attention/OscScanner.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
npx oxfmt src/shared/attention.ts src/main/attention
git add src/shared/attention.ts src/main/attention
git commit -m "feat(attention): OSC 7501 program status scanner"
```

---

### Task 2: AttentionTracker

**Files:**
- Create: `src/main/attention/AttentionTracker.ts`
- Test: `src/main/attention/AttentionTracker.test.ts`

**Interfaces:**
- Consumes: `AttentionSignal`, `AttentionEntry`, `AttentionSnapshot`, `AttentionView` from Task 1.
- Produces:
  ```ts
  type TrackerDeps = {
    now: () => number;
    notifyOnDone: () => boolean;
    onNotify: (terminalId: string, entry: AttentionEntry) => void;
    onDismiss: (terminalId: string) => void;
    onChange: (snapshot: AttentionSnapshot) => void;
  };
  class AttentionTracker {
    signal(terminalId: string, s: AttentionSignal): void;
    setFocused(focused: boolean): void;
    setView(view: AttentionView): void;
    forget(terminalId: string): void;
    retain(ids: ReadonlySet<string>): void;
    snapshot(): AttentionSnapshot;
  }
  ```

- [ ] **Step 1: Write the failing tests**

`src/main/attention/AttentionTracker.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { AttentionSnapshot } from '../../shared/attention';
import { AttentionTracker } from './AttentionTracker';

let notified: string[];
let dismissed: string[];
let last: AttentionSnapshot;
let onDone: boolean;

const make = () =>
  new AttentionTracker({
    now: () => 1000,
    notifyOnDone: () => onDone,
    onNotify: (id) => notified.push(id),
    onDismiss: (id) => dismissed.push(id),
    onChange: (s) => {
      last = s;
    },
  });

beforeEach(() => {
  notified = [];
  dismissed = [];
  last = {};
  onDone = true;
});

describe('AttentionTracker', () => {
  it('notifies once for a blocked terminal that is not on screen', () => {
    const t = make();
    t.setFocused(true);
    t.setView({ taskId: 'a', tabId: 'other' });
    t.signal('t1', { state: 'blocked', kind: 'permission', message: 'm' });
    expect(notified).toEqual(['t1']);
    expect(last).toEqual({
      t1: { reason: 'blocked', kind: 'permission', message: 'm', since: 1000 },
    });
  });

  it('ignores signals for the terminal on screen', () => {
    const t = make();
    t.setFocused(true);
    t.setView({ taskId: 'a', tabId: 't1' });
    t.signal('t1', { state: 'blocked' });
    expect(notified).toEqual([]);
    expect(t.snapshot()).toEqual({});
  });

  it('counts the active tab of an unfocused window as out of view, and clears on focus', () => {
    const t = make();
    t.setView({ taskId: 'a', tabId: 't1' });
    t.setFocused(false);
    t.signal('t1', { state: 'done' });
    expect(notified).toEqual(['t1']);
    t.setFocused(true);
    expect(t.snapshot()).toEqual({});
    expect(dismissed).toEqual(['t1']);
  });

  it('notifies once until looked at: blocked, working, done, blocked', () => {
    const t = make();
    t.signal('t1', { state: 'blocked' });
    t.signal('t1', { state: 'working' });
    expect(t.snapshot()).toEqual({});
    t.signal('t1', { state: 'done' });
    t.signal('t1', { state: 'blocked' });
    expect(notified).toEqual(['t1']);
    expect(t.snapshot().t1.reason).toBe('blocked');
    t.setFocused(true);
    t.setView({ taskId: 'a', tabId: 't1' });
    t.setView({ taskId: 'a', tabId: 'docs' });
    t.signal('t1', { state: 'blocked' });
    expect(notified).toEqual(['t1', 't1']);
  });

  it('with notifyOnDone off, done only clears', () => {
    onDone = false;
    const t = make();
    t.signal('t1', { state: 'blocked' });
    t.signal('t1', { state: 'done' });
    expect(t.snapshot()).toEqual({});
    expect(notified).toEqual(['t1']);
  });

  it('idle and clear clear the entry and dismiss the notification', () => {
    const t = make();
    t.signal('t1', { state: 'blocked' });
    t.signal('t1', { state: 'idle' });
    expect(t.snapshot()).toEqual({});
    expect(dismissed).toEqual(['t1']);
  });

  it('forget and retain drop terminals', () => {
    const t = make();
    t.signal('t1', { state: 'blocked' });
    t.signal('t2', { state: 'blocked' });
    t.retain(new Set(['t2']));
    expect(Object.keys(t.snapshot())).toEqual(['t2']);
    t.forget('t2');
    expect(t.snapshot()).toEqual({});
    expect(dismissed).toEqual(['t1', 't2']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/attention/AttentionTracker.test.ts`
Expected: FAIL, cannot resolve `./AttentionTracker`.

- [ ] **Step 3: Implement**

`src/main/attention/AttentionTracker.ts`:

```ts
import type {
  AttentionEntry,
  AttentionSignal,
  AttentionSnapshot,
  AttentionView,
} from '../../shared/attention';

type TrackerDeps = {
  now: () => number;
  notifyOnDone: () => boolean;
  onNotify: (terminalId: string, entry: AttentionEntry) => void;
  onDismiss: (terminalId: string) => void;
  onChange: (snapshot: AttentionSnapshot) => void;
};

/**
 * Which terminals wait on the developer. A terminal is on screen when the window is focused and it is the active
 * tab; signals for it are ignored and looking at it clears it. One notification per terminal until it was seen.
 */
export class AttentionTracker {
  private readonly entries = new Map<string, AttentionEntry>();
  private readonly notified = new Set<string>();
  private focused = false;
  private view: AttentionView = null;

  constructor(private readonly d: TrackerDeps) {}

  snapshot(): AttentionSnapshot {
    return Object.fromEntries(this.entries);
  }

  signal(terminalId: string, s: AttentionSignal): void {
    if (this.onScreen(terminalId)) return;
    const reason =
      s.state === 'blocked'
        ? 'blocked'
        : s.state === 'done' && this.d.notifyOnDone()
          ? 'done'
          : null;
    if (reason === null) {
      this.drop(terminalId);
      return;
    }
    const entry: AttentionEntry = {
      reason,
      ...(s.kind ? { kind: s.kind } : {}),
      ...(s.message ? { message: s.message } : {}),
      since: this.entries.get(terminalId)?.since ?? this.d.now(),
    };
    this.entries.set(terminalId, entry);
    if (!this.notified.has(terminalId)) {
      this.notified.add(terminalId);
      this.d.onNotify(terminalId, entry);
    }
    this.d.onChange(this.snapshot());
  }

  setFocused(focused: boolean): void {
    this.focused = focused;
    this.seen();
  }

  setView(view: AttentionView): void {
    this.view = view;
    this.seen();
  }

  forget(terminalId: string): void {
    this.notified.delete(terminalId);
    this.drop(terminalId);
  }

  retain(ids: ReadonlySet<string>): void {
    for (const id of new Set([...this.entries.keys(), ...this.notified]))
      if (!ids.has(id)) this.forget(id);
  }

  private onScreen(terminalId: string): boolean {
    return this.focused && this.view?.tabId === terminalId;
  }

  private seen(): void {
    const id = this.focused ? this.view?.tabId : undefined;
    if (id !== undefined) this.forget(id);
  }

  private drop(terminalId: string): void {
    if (!this.entries.delete(terminalId)) return;
    this.d.onDismiss(terminalId);
    this.d.onChange(this.snapshot());
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/attention/AttentionTracker.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
npx oxfmt src/main/attention
git add src/main/attention/AttentionTracker.ts src/main/attention/AttentionTracker.test.ts
git commit -m "feat(attention): tracker for terminals that wait on the developer"
```

---

### Task 3: OpenCode plugin and config merge

**Files:**
- Create: `src/main/attention/opencodePlugin.ts`
- Test: `src/main/attention/opencodePlugin.test.ts`

**Interfaces:**
- Produces:
  - `OPENCODE_PLUGIN_SOURCE: string`: an ES module whose only export is `ShellieAttention`.
  - `opencodeConfigContent(existing: string | undefined, pluginPath: string): string | undefined`. Returns `undefined` when `existing` is set but is not a JSON object; the caller then leaves the env alone.

- [ ] **Step 1: Write the failing tests**

`src/main/attention/opencodePlugin.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPENCODE_PLUGIN_SOURCE, opencodeConfigContent } from './opencodePlugin';

type Hooks = { event?: (i: { event: unknown }) => Promise<void> };
type PluginFn = (input: unknown) => Promise<Hooks>;

const ENV = {
  SHELLIE_ATTENTION_URL: 'http://127.0.0.1:1/v1/attention',
  SHELLIE_ATTENTION_TOKEN: 'tok',
  SHELLIE_TERMINAL_ID: 'term-1',
};

let plugin: PluginFn;
const posts: unknown[] = [];

beforeEach(async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'shellie-oc-'));
  const file = path.join(dir, `p${Date.now()}${Math.random()}.mjs`);
  writeFileSync(file, OPENCODE_PLUGIN_SOURCE);
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  expect(Object.keys(mod)).toEqual(['ShellieAttention']);
  plugin = mod.ShellieAttention as PluginFn;
  posts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
      posts.push({ url, token: init.headers['x-shellie-token'], ...JSON.parse(init.body) });
      return new Response('{}');
    }),
  );
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const fire = async (hooks: Hooks, type: string, properties: unknown) =>
  hooks.event?.({ event: { type, properties } });

describe('ShellieAttention plugin', () => {
  it('maps permission, question, status and error events', async () => {
    const h = await plugin({});
    await fire(h, 'permission.asked', {
      sessionID: 's',
      permission: 'bash',
      patterns: ['rm -rf dist'],
    });
    await fire(h, 'permission.replied', { sessionID: 's', reply: 'once' });
    await fire(h, 'question.asked', { sessionID: 's', questions: [] });
    await fire(h, 'session.status', { sessionID: 's', status: { type: 'busy' } });
    await fire(h, 'session.status', { sessionID: 's', status: { type: 'idle' } });
    await fire(h, 'session.idle', { sessionID: 's' });
    await fire(h, 'session.error', { sessionID: 's', error: { name: 'Boom' } });
    expect(posts).toEqual([
      expect.objectContaining({ token: 'tok', terminalId: 'term-1', state: 'blocked', kind: 'permission', message: 'bash: rm -rf dist' }),
      expect.objectContaining({ state: 'working' }),
      expect.objectContaining({ state: 'blocked', kind: 'question' }),
      expect.objectContaining({ state: 'working' }),
      expect.objectContaining({ state: 'done' }),
      expect.objectContaining({ state: 'done', kind: 'error', message: 'Boom' }),
    ]);
  });

  it('ignores child sessions', async () => {
    const h = await plugin({});
    await fire(h, 'session.created', { sessionID: 'c', info: { id: 'c', parentID: 's' } });
    await fire(h, 'session.status', { sessionID: 'c', status: { type: 'idle' } });
    await fire(h, 'permission.asked', { sessionID: 'c', permission: 'edit' });
    expect(posts).toEqual([]);
  });

  it('does nothing outside Shellie and survives fetch failures', async () => {
    vi.stubEnv('SHELLIE_ATTENTION_URL', '');
    expect(await plugin({})).toEqual({});
    vi.stubEnv('SHELLIE_ATTENTION_URL', ENV.SHELLIE_ATTENTION_URL);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const h = await plugin({});
    await expect(fire(h, 'session.idle', { sessionID: 's' })).resolves.toBeUndefined();
  });
});

describe('opencodeConfigContent', () => {
  it('creates or appends the plugin entry', () => {
    expect(opencodeConfigContent(undefined, '/p.js')).toBe('{"plugin":["/p.js"]}');
    expect(
      JSON.parse(opencodeConfigContent('{"model":"x","plugin":["a"]}', '/p.js')!),
    ).toEqual({ model: 'x', plugin: ['a', '/p.js'] });
  });

  it('leaves invalid content alone', () => {
    expect(opencodeConfigContent('not json', '/p.js')).toBeUndefined();
    expect(opencodeConfigContent('[1]', '/p.js')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/attention/opencodePlugin.test.ts`
Expected: FAIL, cannot resolve `./opencodePlugin`.

- [ ] **Step 3: Implement**

`src/main/attention/opencodePlugin.ts`:

```ts
/**
 * The OpenCode plugin Shellie writes to `<userData>/opencode/shellie-attention.js` and loads through
 * OPENCODE_CONFIG_CONTENT. It reports when the main session waits on the developer. Plain JS, no imports: OpenCode
 * (Bun) loads it as is. OpenCode rejects modules with exports other than plugin functions, so it exports one.
 */
export const OPENCODE_PLUGIN_SOURCE = `// Written by Shellie on every start; edits are overwritten.
export const ShellieAttention = async () => {
  const url = process.env.SHELLIE_ATTENTION_URL;
  const token = process.env.SHELLIE_ATTENTION_TOKEN;
  const terminalId = process.env.SHELLIE_TERMINAL_ID;
  if (!url || !token || !terminalId) return {};
  const children = new Set();
  let last = '';
  const send = (state, kind, message) => {
    const key = state + '|' + (kind || '');
    if (key === last) return;
    last = key;
    const body = { terminalId, state };
    if (kind) body.kind = kind;
    if (message) body.message = String(message).slice(0, 2000);
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shellie-token': token },
      body: JSON.stringify(body),
    }).catch(() => {});
  };
  return {
    event: async ({ event }) => {
      try {
        const p = event.properties || {};
        if (event.type === 'session.created' || event.type === 'session.updated') {
          if (p.info && p.info.parentID) children.add(p.info.id || p.sessionID);
          return;
        }
        if (p.sessionID && children.has(p.sessionID)) return;
        switch (event.type) {
          case 'permission.asked':
            return send('blocked', 'permission', [p.permission, (p.patterns || []).join(' ')].filter(Boolean).join(': '));
          case 'question.asked':
            return send('blocked', 'question');
          case 'permission.replied':
          case 'question.replied':
          case 'question.rejected':
            return send('working');
          case 'session.status':
            if (!p.status) return;
            return send(p.status.type === 'idle' ? 'done' : 'working');
          case 'session.idle':
            return send('done');
          case 'session.error':
            return send('done', 'error', p.error && (p.error.name || p.error.message));
        }
      } catch {}
    },
  };
};
`;

/** OPENCODE_CONFIG_CONTENT with Shellie's plugin added; undefined when the developer's own value is not a JSON object. */
export function opencodeConfigContent(
  existing: string | undefined,
  pluginPath: string,
): string | undefined {
  if (!existing) return JSON.stringify({ plugin: [pluginPath] });
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return undefined;
  const config = parsed as { plugin?: unknown };
  const plugins = Array.isArray(config.plugin) ? config.plugin : [];
  return JSON.stringify({ ...config, plugin: [...plugins, pluginPath] });
}
```

Note on the dedupe in `send`: `session.status` idle followed by `session.idle` posts `done` once. The sequence `working` → `done` → `working` still posts each change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/attention/opencodePlugin.test.ts`
Expected: PASS (5 tests). In the first test `session.idle` right after `session.status` idle is deduplicated, so 6 of the 7 events post.

- [ ] **Step 5: Commit**

```bash
npx oxfmt src/main/attention
git add src/main/attention/opencodePlugin.ts src/main/attention/opencodePlugin.test.ts
git commit -m "feat(attention): OpenCode plugin and config merge"
```

---

### Task 4: AttentionHub

**Files:**
- Create: `src/main/attention/AttentionHub.ts`
- Test: `src/main/attention/AttentionHub.test.ts`

**Interfaces:**
- Consumes: `OscScanner`, `PROBE_REPLY`, `programStatusSignal` (Task 1); `AttentionTracker` (Task 2); `TerminalKind` from `src/shared/types.ts` (the `kind` union of `TerminalDef`; if no named export exists, use `TerminalDef['kind']`).
- Produces:
  ```ts
  type HubTerminal = { taskId: string; taskTitle: string; label: string; kind: TerminalDef['kind'] };
  type HubDeps = {
    now: () => number;
    write: (terminalId: string, data: string) => void;
    terminal: (terminalId: string) => HubTerminal | null;
    notifyOnDone: () => boolean;
    show: (n: { title: string; body: string; onClick: () => void }) => { close(): void };
    setBadgeCount: (n: number) => void;
    changed: (snapshot: AttentionSnapshot) => void;
    open: (taskId: string, terminalId: string) => void;
  };
  class AttentionHub {
    data(terminalId: string, chunk: string): void;
    signal(terminalId: string, s: AttentionSignal): boolean;
    exit(terminalId: string): void;
    retain(ids: ReadonlySet<string>): void;
    setFocused(focused: boolean): void;
    setView(view: AttentionView): void;
    snapshot(): AttentionSnapshot;
  }
  function notificationBody(label: string, e: AttentionEntry): string;
  const BELL_GAP_MS = 10_000;
  ```

- [ ] **Step 1: Write the failing tests**

`src/main/attention/AttentionHub.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { AttentionHub, notificationBody, type HubTerminal } from './AttentionHub';

const ESC = '\x1b';
const BEL = '\x07';
const b64 = (s: string) => Buffer.from(s).toString('base64');

let now: number;
let writes: [string, string][];
let shown: { title: string; body: string; onClick: () => void; closed: boolean }[];
let badge: number;
let opened: [string, string][];
let terms: Record<string, HubTerminal>;
let writeThrows: boolean;

const hub = () =>
  new AttentionHub({
    now: () => now,
    write: (id, d) => {
      if (writeThrows) throw new Error(`Unknown terminal ${id}`);
      writes.push([id, d]);
    },
    terminal: (id) => terms[id] ?? null,
    notifyOnDone: () => true,
    show: (n) => {
      const rec = { ...n, closed: false };
      shown.push(rec);
      return { close: () => { rec.closed = true; } };
    },
    setBadgeCount: (n) => { badge = n; },
    changed: () => undefined,
    open: (taskId, id) => opened.push([taskId, id]),
  });

beforeEach(() => {
  now = 0;
  writes = [];
  shown = [];
  badge = -1;
  opened = [];
  writeThrows = false;
  terms = {
    c1: { taskId: 'T', taskTitle: '42 Fix login', label: 'Claude Code', kind: 'claude' },
    o1: { taskId: 'T', taskTitle: '42 Fix login', label: 'OpenCode', kind: 'opencode' },
    s1: { taskId: 'T', taskTitle: '42 Fix login', label: 'Copilot CLI', kind: 'copilot' },
  };
});

describe('AttentionHub', () => {
  it('answers the probe and survives a terminal that is gone', () => {
    const h = hub();
    h.data('c1', `${ESC}]7501;?${BEL}`);
    expect(writes).toEqual([['c1', `${ESC}]7501;?${BEL}`]]);
    writeThrows = true;
    expect(() => h.data('c1', `${ESC}]7501;?${BEL}`)).not.toThrow();
  });

  it('turns Claude status into a notification, badge and click-through', () => {
    const h = hub();
    h.data('c1', `${ESC}]7501;state=blocked:app=claude-code:kind=permission:msg=${b64('approve Bash: ls')}${BEL}`);
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('42 Fix login');
    expect(shown[0].body).toBe('Claude Code needs permission: approve Bash: ls');
    expect(badge).toBe(1);
    shown[0].onClick();
    expect(opened).toEqual([['T', 'c1']]);
  });

  it('rings once per 10 s for a terminal without status, never for Claude or OpenCode', () => {
    const h = hub();
    h.data('s1', BEL);
    now = 5000;
    h.data('s1', BEL);
    expect(h.snapshot().s1).toMatchObject({ reason: 'blocked', kind: 'bell' });
    expect(shown.map((s) => s.body)).toEqual(['Copilot CLI rang the bell']);
    h.data('o1', BEL);
    h.data('c1', `${ESC}]7501;state=idle:app=claude-code${BEL}`);
    h.data('c1', BEL);
    expect(Object.keys(h.snapshot())).toEqual(['s1']);
  });

  it('accepts receiver signals only for known terminals', () => {
    const h = hub();
    expect(h.signal('nope', { state: 'blocked' })).toBe(false);
    expect(h.signal('o1', { state: 'blocked', kind: 'question' })).toBe(true);
    expect(shown[0].body).toBe('OpenCode has a question');
  });

  it('retain and exit clear badge and close the notification', () => {
    const h = hub();
    h.signal('o1', { state: 'blocked' });
    h.signal('s1', { state: 'done' });
    expect(badge).toBe(2);
    h.retain(new Set(['s1']));
    expect(badge).toBe(1);
    expect(shown[0].closed).toBe(true);
    h.exit('s1');
    expect(badge).toBe(0);
    expect(shown[1].closed).toBe(true);
  });
});

describe('notificationBody', () => {
  it('words each reason', () => {
    expect(notificationBody('X', { reason: 'blocked', kind: 'permission', since: 0 })).toBe('X needs permission');
    expect(notificationBody('X', { reason: 'blocked', since: 0 })).toBe('X is waiting for you');
    expect(notificationBody('X', { reason: 'done', since: 0 })).toBe('X finished');
    expect(notificationBody('X', { reason: 'done', message: 'm', since: 0 })).toBe('X finished: m');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/attention/AttentionHub.test.ts`
Expected: FAIL, cannot resolve `./AttentionHub`.

- [ ] **Step 3: Implement**

`src/main/attention/AttentionHub.ts`:

```ts
import type {
  AttentionEntry,
  AttentionSignal,
  AttentionSnapshot,
  AttentionView,
} from '../../shared/attention';
import type { TerminalDef } from '../../shared/types';
import { AttentionTracker } from './AttentionTracker';
import { OscScanner, PROBE_REPLY, programStatusSignal } from './OscScanner';

export const BELL_GAP_MS = 10_000;

export type HubTerminal = {
  taskId: string;
  taskTitle: string;
  label: string;
  kind: TerminalDef['kind'];
};

type HubDeps = {
  now: () => number;
  write: (terminalId: string, data: string) => void;
  terminal: (terminalId: string) => HubTerminal | null;
  notifyOnDone: () => boolean;
  show: (n: { title: string; body: string; onClick: () => void }) => {
    close(): void;
  };
  setBadgeCount: (n: number) => void;
  changed: (snapshot: AttentionSnapshot) => void;
  open: (taskId: string, terminalId: string) => void;
};

/** The notification text for a terminal's tab label and what it waits for. */
export function notificationBody(label: string, e: AttentionEntry): string {
  const head =
    e.reason === 'done'
      ? `${label} finished`
      : e.kind === 'permission'
        ? `${label} needs permission`
        : e.kind === 'question'
          ? `${label} has a question`
          : e.kind === 'bell'
            ? `${label} rang the bell`
            : `${label} is waiting for you`;
  return e.message ? `${head}: ${e.message}` : head;
}

/**
 * Main's side of attention: reads every terminal's output (Claude's OSC 7501 status, bells), takes the OpenCode
 * plugin's signals from the receiver, and turns the tracker's decisions into notifications and the Dock count.
 */
export class AttentionHub {
  private readonly scanners = new Map<string, OscScanner>();
  /** Terminals that reported OSC 7501 status: their bells are not a signal. */
  private readonly reporting = new Set<string>();
  private readonly lastBell = new Map<string, number>();
  private readonly shown = new Map<string, { close(): void }>();
  private readonly tracker: AttentionTracker;

  constructor(private readonly d: HubDeps) {
    this.tracker = new AttentionTracker({
      now: d.now,
      notifyOnDone: d.notifyOnDone,
      onNotify: (id, e) => this.notify(id, e),
      onDismiss: (id) => this.close(id),
      onChange: (snap) => {
        d.setBadgeCount(Object.keys(snap).length);
        d.changed(snap);
      },
    });
  }

  snapshot(): AttentionSnapshot {
    return this.tracker.snapshot();
  }

  data(terminalId: string, chunk: string): void {
    let scanner = this.scanners.get(terminalId);
    if (!scanner) {
      scanner = new OscScanner();
      this.scanners.set(terminalId, scanner);
    }
    for (const ev of scanner.push(chunk)) {
      if (ev.type === 'probe') {
        try {
          this.d.write(terminalId, PROBE_REPLY);
        } catch {
          // The terminal went away between its output and the reply.
        }
      } else if (ev.type === 'status') {
        this.reporting.add(terminalId);
        const s = programStatusSignal(ev.fields);
        if (s) this.tracker.signal(terminalId, s);
      } else this.bell(terminalId);
    }
  }

  /** A signal from the receiver; false when the terminal is unknown. */
  signal(terminalId: string, s: AttentionSignal): boolean {
    if (!this.d.terminal(terminalId)) return false;
    this.tracker.signal(terminalId, s);
    return true;
  }

  exit(terminalId: string): void {
    this.scanners.delete(terminalId);
    this.reporting.delete(terminalId);
    this.lastBell.delete(terminalId);
    this.tracker.forget(terminalId);
  }

  /** Forgets every terminal not in `ids` (closed tabs, finished tasks: kill emits no exit). */
  retain(ids: ReadonlySet<string>): void {
    for (const id of [...this.scanners.keys()])
      if (!ids.has(id)) this.exit(id);
    this.tracker.retain(ids);
  }

  setFocused(focused: boolean): void {
    this.tracker.setFocused(focused);
  }

  setView(view: AttentionView): void {
    this.tracker.setView(view);
  }

  private bell(terminalId: string): void {
    if (this.reporting.has(terminalId)) return;
    const t = this.d.terminal(terminalId);
    if (!t || t.kind === 'opencode') return;
    const now = this.d.now();
    const last = this.lastBell.get(terminalId);
    if (last !== undefined && now - last < BELL_GAP_MS) return;
    this.lastBell.set(terminalId, now);
    this.tracker.signal(terminalId, { state: 'blocked', kind: 'bell' });
  }

  private notify(terminalId: string, e: AttentionEntry): void {
    const t = this.d.terminal(terminalId);
    if (!t) return;
    this.close(terminalId);
    this.shown.set(
      terminalId,
      this.d.show({
        title: t.taskTitle,
        body: notificationBody(t.label, e),
        onClick: () => this.d.open(t.taskId, terminalId),
      }),
    );
  }

  private close(terminalId: string): void {
    this.shown.get(terminalId)?.close();
    this.shown.delete(terminalId);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/attention`
Expected: PASS (all attention tests).

- [ ] **Step 5: Commit**

```bash
npx oxfmt src/main/attention
git add src/main/attention/AttentionHub.ts src/main/attention/AttentionHub.test.ts
git commit -m "feat(attention): hub for scanners, bells, notifications and Dock count"
```

---

### Task 5: Receiver route, terminal id env, setting, IPC

**Files:**
- Modify: `src/main/usage/UsageReceiver.ts`, plus its test `src/main/usage/UsageReceiver.test.ts`
- Modify: `src/main/services/TerminalManager.ts:55`, plus its test `src/main/services/TerminalManager.test.ts:68-76`
- Modify: `src/shared/usage.ts` (`AppSettingsSchema`)
- Modify: `src/shared/ipc.ts` (`Channels`, `Events`)
- Modify: `src/main/ipc/handlers.ts` (`Services`, the handler map, `spawnTerminal`), plus its test `src/main/ipc/handlers.test.ts`
- Modify: `src/renderer/test-helpers/fakeApi.ts` (defaults for the new channels)

**Interfaces:**
- Consumes: `AttentionPostSchema`, `AttentionSignal`, `AttentionView`, `AttentionSnapshot` (Task 1); `AttentionHub` (Task 4, type only).
- Produces:
  - `new UsageReceiver(onEvents, onActiveTime?, attention?: { token: string; onSignal: (terminalId: string, s: AttentionSignal) => boolean })`.
  - `Channels['attention:view']: { args: [view: AttentionView]; result: void }`.
  - `Channels['attention:get']: { args: []; result: AttentionSnapshot }`.
  - `Events['attention:changed']: AttentionSnapshot`.
  - `Events['attention:open']: { taskId: string; terminalId: string }`.
  - `Services.attention?: Pick<AttentionHub, 'setView' | 'snapshot'>`.
  - `Services.terminalEnv?: (def: TerminalDef) => Record<string, string>`.
  - `AppSettings.notifyOnDone: boolean`.
  - pty env `SHELLIE_TERMINAL_ID`.

- [ ] **Step 1: Write the failing receiver tests**

Add to `src/main/usage/UsageReceiver.test.ts` (it already has `freePort()` and a `receivers` list stopped in `afterEach`; add `beforeEach` to the vitest import):

```ts
describe('POST /v1/attention', () => {
  const signals: [string, unknown][] = [];
  let r: UsageReceiver;
  let base: string;
  beforeEach(async () => {
    signals.length = 0;
    r = new UsageReceiver(() => undefined, undefined, {
      token: 'secret',
      onSignal: (id, s) => {
        if (id === 'unknown') return false;
        signals.push([id, s]);
        return true;
      },
    });
    receivers.push(r);
    const port = await freePort();
    expect((await r.start(port)).listening).toBe(true);
    base = `http://127.0.0.1:${port}`;
  });

  const post = (body: unknown, token = 'secret') =>
    fetch(`${base}/v1/attention`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shellie-token': token },
      body: JSON.stringify(body),
    });

  it('accepts a valid signal', async () => {
    const res = await post({ terminalId: 't1', state: 'blocked', kind: 'permission', message: 'm' });
    expect(res.status).toBe(200);
    expect(signals).toEqual([['t1', { state: 'blocked', kind: 'permission', message: 'm' }]]);
  });

  it('rejects a wrong token, a bad body and an unknown terminal', async () => {
    expect((await post({ terminalId: 't1', state: 'done' }, 'nope')).status).toBe(403);
    expect((await post({ terminalId: 't1', state: 'dancing' })).status).toBe(400);
    expect((await post({ terminalId: 'unknown', state: 'done' })).status).toBe(404);
    expect(signals).toEqual([]);
  });

  it('clamps the message', async () => {
    await post({ terminalId: 't1', state: 'done', message: 'x'.repeat(3000) });
    expect((signals[0][1] as { message: string }).message).toHaveLength(200);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/main/usage/UsageReceiver.test.ts`
Expected: the new tests FAIL with 404 responses.

- [ ] **Step 3: Implement the route**

In `src/main/usage/UsageReceiver.ts`:

- Import:
  ```ts
  import { AttentionPostSchema, clampMessage, type AttentionSignal } from '../../shared/attention';
  ```
- Add a third constructor parameter:
  ```ts
  private readonly attention?: {
    token: string;
    onSignal: (terminalId: string, s: AttentionSignal) => boolean;
  },
  ```
  The doc comment becomes "OTLP/HTTP JSON endpoint on 127.0.0.1 for Claude Code log events, and the attention route for the OpenCode plugin."
- In `handle`, replace the path check with:
  ```ts
  const path = (req.url ?? '').split('?')[0];
  const isAttention = path === '/v1/attention' && this.attention !== undefined;
  if (!isAttention && path !== '/v1/logs' && path !== '/v1/metrics') return reply(404);
  if (req.method !== 'POST') return reply(405);
  if (isAttention && req.headers['x-shellie-token'] !== this.attention!.token) {
    req.resume();
    return reply(403);
  }
  ```
- In the `end` handler, before the OTLP parsing `try`, handle attention:
  ```ts
  if (isAttention) {
    let body: ReturnType<typeof AttentionPostSchema.parse>;
    try {
      body = AttentionPostSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      return reply(400);
    }
    const { terminalId, state, kind } = body;
    const message = body.message ? clampMessage(body.message) : '';
    const known = this.attention!.onSignal(terminalId, {
      state,
      ...(kind ? { kind } : {}),
      ...(message ? { message } : {}),
    });
    return reply(known ? 200 : 404);
  }
  ```

- [ ] **Step 4: Run receiver tests**

Run: `npx vitest run src/main/usage/UsageReceiver.test.ts`
Expected: PASS (old and new).

- [ ] **Step 5: Terminal id env, test first**

In `src/main/services/TerminalManager.test.ts`, extend the existing env test (lines 68-76) to also print the terminal id:

```ts
          ? 'Write-Output "ids:$env:SHELLIE_TASK_ID,$env:MIAC_TASK_ID,$env:SHELLIE_TERMINAL_ID"'
          : 'echo ids:$SHELLIE_TASK_ID,$MIAC_TASK_ID,$SHELLIE_TERMINAL_ID',
```

and expect `'ids:task-env,task-env,env1'`. Run `npx vitest run src/main/services/TerminalManager.test.ts` and confirm it FAILs. Then add after `env.MIAC_TASK_ID = …` in `TerminalManager.spawn`:

```ts
    env.SHELLIE_TERMINAL_ID = options.id;
```

Run again and expect PASS.

- [ ] **Step 6: Setting and IPC types**

In `src/shared/usage.ts` `AppSettingsSchema`, after `showSplash`:

```ts
  /** Notify when an agent finishes its turn (blocked agents always notify). */
  notifyOnDone: z.boolean().default(true),
```

In `src/shared/ipc.ts`, import `AttentionSnapshot` and `AttentionView` from `./attention`. Add to `Channels` after the `time:` entries:

```ts
  /** The terminal tab on screen (null: no task page), so main does not flag what the developer is looking at. */
  'attention:view': { args: [view: AttentionView]; result: void };
  'attention:get': { args: []; result: AttentionSnapshot };
```

Add to `Events`:

```ts
  /** Terminals that wait on the developer. */
  'attention:changed': AttentionSnapshot;
  /** A notification was clicked: show this task's terminal tab. */
  'attention:open': { taskId: string; terminalId: string };
```

In `src/renderer/test-helpers/fakeApi.ts` `defaults`, add `'attention:view': () => undefined,` and `'attention:get': () => ({}),`.

- [ ] **Step 7: Handlers, test first**

In `src/main/ipc/handlers.test.ts`, add tests next to the existing terminal tests, using the file's `services` setup:

```ts
it('attention handlers pass the view to main and return the snapshot', async () => {
  const views: unknown[] = [];
  const h = createHandlers({
    ...services,
    attention: {
      setView: (v) => views.push(v),
      snapshot: () => ({ t1: { reason: 'done', since: 1 } }),
    },
  });
  await h['attention:view']({ taskId: 'a', tabId: 't1' });
  expect(views).toEqual([{ taskId: 'a', tabId: 't1' }]);
  expect(await h['attention:get']()).toEqual({ t1: { reason: 'done', since: 1 } });
});
```

Add a second test that opens a terminal through the existing open-terminal path used by other tests (e.g. `terminals:open` / task start, whichever the file already exercises). Give it `terminalEnv: (def) => ({ X_KIND: def.kind })` and assert the spawned options' `env.X_KIND` equals the def's kind. The file's fake `terminals` records spawn options; reuse how other tests read them.

Run: `npx vitest run src/main/ipc/handlers.test.ts`
Expected: FAIL (handlers missing).

- [ ] **Step 8: Implement the handlers**

In `src/main/ipc/handlers.ts`:

- Add to `Services`:
  ```ts
  /** What needs the developer's attention (main); absent in tests. */
  attention?: Pick<AttentionHub, 'setView' | 'snapshot'>;
  /** Extra env per terminal (main: the attention URL and token, OpenCode's plugin). */
  terminalEnv?: (def: TerminalDef) => Record<string, string>;
  ```
  with `import type { AttentionHub } from '../attention/AttentionHub';`.
- In `spawnTerminal`, put the env in this order: `{ ...telemetryEnv(...), ...(s.terminalEnv?.(def) ?? {}), ...cmd.env }`.
- In the returned handler map, next to `...createTimeHandlers(...)`:
  ```ts
  'attention:view': async (view) => s.attention?.setView(view),
  'attention:get': async () => s.attention?.snapshot() ?? {},
  ```

- [ ] **Step 9: Verify everything**

Run: `npx vitest run src/main src/shared && npm run typecheck`
Expected: PASS, no type errors. Fix any test fixture that builds a full `AppSettings` literal without `notifyOnDone` by adding `notifyOnDone: true`.

- [ ] **Step 10: Commit**

```bash
npx oxfmt src
git add src
git commit -m "feat(attention): receiver route, terminal id env, notifyOnDone setting, IPC"
```

---

### Task 6: Wire it up in main

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `AttentionHub` (Task 4), `OPENCODE_PLUGIN_SOURCE`, `opencodeConfigContent` (Task 3), the receiver third parameter, `Services.attention`, `Services.terminalEnv` (Task 5), `Events['attention:changed' | 'attention:open']`.
- Produces: a running feature; no new exports.

main.ts has no unit tests. This task is verified by typecheck, the full suite and the live check in Task 8.

- [ ] **Step 1: Token and plugin file**

In `boot()`, right after `const usageDir = …; await fs.mkdir(…copilot…)`:

```ts
    // Per-run secret for the attention route, so other local programs cannot raise notifications.
    const attentionToken = randomBytes(24).toString('hex');
    const opencodePlugin = path.join(userData, 'opencode', 'shellie-attention.js');
    await fs
      .mkdir(path.dirname(opencodePlugin), { recursive: true })
      .then(() => fs.writeFile(opencodePlugin, OPENCODE_PLUGIN_SOURCE))
      .catch((err) => console.error('[attention] could not write the OpenCode plugin', err));
```

Imports: `randomBytes` from `node:crypto` (check whether `node:crypto` is already imported and extend that import), `Notification` from `electron` (extend the existing electron import), `AttentionHub`, and `OPENCODE_PLUGIN_SOURCE, opencodeConfigContent`.

- [ ] **Step 2: The hub**

After `agentTimer` is created:

```ts
    const taskTitle = (t: Task) =>
      t.workItem ? `${t.workItem.id} ${t.workItem.title}` : t.name;
    const attention = new AttentionHub({
      now: Date.now,
      write: (id, data) => terminals.write(id, data),
      terminal: (id) => {
        for (const t of store.state.tasks) {
          const def = t.terminals.find((d) => d.id === id);
          if (def)
            return { taskId: t.id, taskTitle: taskTitle(t), label: def.label, kind: def.kind };
        }
        return null;
      },
      notifyOnDone: () => settings.get().notifyOnDone,
      show: ({ title, body, onClick }) => {
        const n = new Notification({ title, body });
        n.on('click', onClick);
        n.show();
        return n;
      },
      setBadgeCount: (n) => app.setBadgeCount(n),
      changed: (snapshot) => broadcast('attention:changed', snapshot),
      open: (taskId, terminalId) => {
        const w = mainWindow;
        if (!w || w.isDestroyed()) return;
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
        broadcast('attention:open', { taskId, terminalId });
      },
    });
```

If `Task`'s work item fields differ (`workItem.id`, `workItem.title`, `name`), use the same fields `TaskNav` `Row` uses for its title.

- [ ] **Step 3: Receiver, handlers, terminal events, focus**

- Construct the receiver with the attention route:
  ```ts
  const receiver = new UsageReceiver(
    ingest,
    (points) => { for (const p of points) keep(time.addClaudeActive(p)); },
    { token: attentionToken, onSignal: (id, s) => attention.signal(id, s) },
  );
  ```
- In `createHandlers({...})` add:
  ```ts
      attention,
      terminalEnv: (def) => {
        const env: Record<string, string> = {
          SHELLIE_ATTENTION_URL: `http://127.0.0.1:${settings.get().receiverPort}/v1/attention`,
          SHELLIE_ATTENTION_TOKEN: attentionToken,
        };
        if (def.kind === 'opencode') {
          const content = opencodeConfigContent(process.env.OPENCODE_CONFIG_CONTENT, opencodePlugin);
          if (content) env.OPENCODE_CONFIG_CONTENT = content;
        }
        return env;
      },
  ```
- Replace `broadcast,` in `createHandlers({...})` with a wrapper that prunes closed terminals whenever tasks change:
  ```ts
      broadcast: (event, payload) => {
        if (event === 'tasks:changed') attention.retain(new Set(terminals.ids()));
        broadcast(event, payload);
      },
  ```
  If TypeScript cannot infer the generic, type the wrapper as `Services['broadcast']`. `Services` is already exported from `handlers.ts`.
- Next to the existing `terminals.on(...)` lines:
  ```ts
    terminals.on('data', (id, data) => attention.data(id, data));
    terminals.on('exit', (id) => attention.exit(id));
  ```
- Change `onWindowFocus = (focused) => tracker.setFocused(focused);` to:
  ```ts
    onWindowFocus = (focused) => {
      tracker.setFocused(focused);
      attention.setFocused(focused);
    };
  ```
- In `createWindow`, add `win.on('minimize', () => onWindowFocus(false));` after the blur line. On macOS minimize normally blurs, but make it explicit. Also call `onWindowFocus(false)` in the existing `'closed'` handler before nulling `mainWindow`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx oxfmt src
git add src/main.ts
git commit -m "feat(attention): wire hub, receiver route, plugin and focus in main"
```

---

### Task 7: Renderer: view reporting, badges, click-through, setting

**Files:**
- Modify: `src/renderer/store.ts`
- Create: `src/renderer/hooks/useAttention.ts`, `src/renderer/hooks/useAttention.test.tsx`
- Create: `src/renderer/components/AttentionDot.tsx`
- Modify: `src/renderer/App.tsx` (call `useAttention()` next to `useTimeFocus()`)
- Modify: `src/renderer/components/TaskNav.tsx` (`Row`, `RailRow`), `src/renderer/components/TaskNav.test.tsx`
- Modify: `src/renderer/components/TerminalTabs.tsx` (terminal tab button)
- Modify: `src/renderer/screens/SettingsScreen.tsx` (Appearance section toggle)
- Modify: `src/renderer/styles/tokens.css`, `src/renderer/styles/shell.css`

**Interfaces:**
- Consumes: `attention:view`, `attention:get`, `attention:changed`, `attention:open` (Task 5); `AttentionSnapshot`, `AttentionEntry` (Task 1); store `taskOnScreen`, `activeTab`, `setTab`, `select`, `go`.
- Produces:
  - `useStore` fields `attention: AttentionSnapshot` and `setAttention(s: AttentionSnapshot): void`.
  - `useAttention(): void`.
  - `<AttentionDot entry={AttentionEntry} />`.

- [ ] **Step 1: Store field**

In `src/renderer/store.ts` add to `Store`:

```ts
  /** Terminals that wait on the developer, from main. */
  attention: AttentionSnapshot;
  setAttention(attention: AttentionSnapshot): void;
```

Add the initial value `attention: {},` and `setAttention: (attention) => set({ attention }),`.

- [ ] **Step 2: Write the failing hook tests**

`src/renderer/hooks/useAttention.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { useAttention } from './useAttention';

const task = (id: string, terminals: string[]) =>
  ({ id, status: 'active', terminals: terminals.map((t) => ({ id: t, kind: 'claude', label: 'Claude Code' })) }) as never;

describe('useAttention', () => {
  beforeEach(() => {
    useStore.setState({ tasks: [task('A', ['a1', 'a2'])], selectedTaskId: null, screen: { kind: 'home' }, tabByTask: {}, attention: {} });
  });

  it('reports the terminal tab on screen, and null elsewhere', async () => {
    const fake = installFakeApi();
    renderHook(() => useAttention());
    await act(async () => {
      useStore.setState({ selectedTaskId: 'A', screen: { kind: 'task' } });
    });
    await act(async () => useStore.getState().setTab('A', 'a2'));
    await act(async () => useStore.setState({ screen: { kind: 'home' } }));
    const views = fake.calls.filter((c) => c.channel === 'attention:view').map((c) => c.args[0]);
    expect(views).toEqual([null, { taskId: 'A', tabId: 'a1' }, { taskId: 'A', tabId: 'a2' }, null]);
  });

  it('loads and follows the snapshot, and opens the tab on click-through', async () => {
    const fake = installFakeApi({ 'attention:get': () => ({ a1: { reason: 'done', since: 1 } }) });
    renderHook(() => useAttention());
    await act(async () => undefined);
    expect(useStore.getState().attention).toEqual({ a1: { reason: 'done', since: 1 } });
    act(() => fake.emit('attention:changed', {}));
    expect(useStore.getState().attention).toEqual({});
    act(() => fake.emit('attention:open', { taskId: 'A', terminalId: 'a2' }));
    const s = useStore.getState();
    expect([s.screen.kind, s.selectedTaskId, s.activeTab('A')]).toEqual(['task', 'A', 'a2']);
  });
});
```

Run: `npx vitest run src/renderer/hooks/useAttention.test.tsx`
Expected: FAIL, cannot resolve `./useAttention`.

- [ ] **Step 3: Implement the hook**

`src/renderer/hooks/useAttention.ts`:

```ts
import { useEffect } from 'react';
import type { AttentionView } from '../../shared/attention';
import { api } from '../api';
import { useStore } from '../store';

const viewOf = (s: ReturnType<typeof useStore.getState>): AttentionView =>
  s.screen.kind === 'task' && s.selectedTaskId
    ? { taskId: s.selectedTaskId, tabId: s.activeTab(s.selectedTaskId) }
    : null;

/**
 * Keeps the attention badges in the store, tells main which terminal tab is on screen (so it is never flagged),
 * and opens the task and tab of a clicked notification.
 */
export function useAttention(): void {
  useEffect(() => {
    const send = (view: AttentionView) =>
      api()
        .invoke('attention:view', view)
        .catch(() => undefined);
    let last = JSON.stringify(viewOf(useStore.getState()));
    send(JSON.parse(last) as AttentionView);
    const offStore = useStore.subscribe((state) => {
      const now = JSON.stringify(viewOf(state));
      if (now === last) return;
      last = now;
      send(JSON.parse(now) as AttentionView);
    });
    void api()
      .invoke('attention:get')
      .then((s) => useStore.getState().setAttention(s))
      .catch(() => undefined);
    const offs = [
      api().on('attention:changed', (s) => useStore.getState().setAttention(s)),
      api().on('attention:open', ({ taskId, terminalId }) => {
        const st = useStore.getState();
        st.select(taskId);
        st.go({ kind: 'task' });
        st.setTab(taskId, terminalId);
      }),
    ];
    return () => {
      offStore();
      offs.forEach((off) => off());
    };
  }, []);
}
```

Call `useAttention();` in `App()` right after `useTimeFocus();`, with the import. Run the hook tests and expect PASS.

- [ ] **Step 4: The dot, test first**

Add to `src/renderer/components/TaskNav.test.tsx`, using the file's existing task fixtures. Pick a task with one terminal, or add `terminals: [{ id: 'c1', kind: 'claude', label: 'Claude Code' }]` to a fixture:

```tsx
it('marks a task whose terminal waits on the developer', () => {
  // `t` is a fixture task with a terminal 'c1'.
  useStore.setState({ attention: { c1: { reason: 'blocked', kind: 'permission', message: 'approve Bash: ls', since: 1 } } });
  render(<TaskNav />);
  expect(screen.getByLabelText('Needs permission: approve Bash: ls')).toBeInTheDocument();
});
```

Run: `npx vitest run src/renderer/components/TaskNav.test.tsx` and expect the new test to FAIL.

`src/renderer/components/AttentionDot.tsx`:

```tsx
import type { AttentionEntry } from '../../shared/attention';

/** What a waiting terminal wants, for the dot's label and tooltip. */
export function attentionLabel(e: AttentionEntry): string {
  const head =
    e.reason === 'done'
      ? 'Finished'
      : e.kind === 'permission'
        ? 'Needs permission'
        : e.kind === 'question'
          ? 'Has a question'
          : 'Waiting for you';
  return e.message ? `${head}: ${e.message}` : head;
}

/** Amber when an agent is blocked on the developer, accent when it finished its turn. */
export function AttentionDot({ entry }: { entry: AttentionEntry }) {
  const label = attentionLabel(entry);
  return (
    <span
      className={`attention-dot attention-${entry.reason}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
```

In `TaskNav.tsx` `Row`, before the status `dot` span:

```tsx
      {waiting && <AttentionDot entry={waiting} />}
```

with, at the top of `Row` (and the same in `RailRow`, rendered after `<TypeIcon …/>`):

```tsx
  const waiting = useStore((s) => {
    const entries = task.terminals.flatMap((d) => s.attention[d.id] ?? []);
    return entries.find((e) => e.reason === 'blocked') ?? entries[0];
  });
```

Note: this selector returns an existing object from the store, so zustand's equality check stays stable.

In `TerminalTabs.tsx`, inside the terminal tab `<button className="pivot">` after `{t.label}`:

```tsx
                {attention[t.id] && <AttentionDot entry={attention[t.id]} />}
```

with `const attention = useStore((s) => s.attention);` next to the component's other store reads.

CSS. In `tokens.css`, next to `--red`:

```css
  --amber: #f2c94c;
```

In `shell.css`, after `.tab-new`:

```css
.attention-dot {
  display: inline-block;
  flex: none;
  width: 8px;
  height: 8px;
  margin-left: 6px;
  border-radius: 50%;
  vertical-align: middle;
}
.attention-blocked {
  background: var(--amber);
}
.attention-done {
  background: var(--link);
}
```

Run `npx vitest run src/renderer/components/TaskNav.test.tsx` and expect PASS.

- [ ] **Step 5: Settings toggle**

In `SettingsScreen.tsx` Appearance section:
- Widen the `toggle` patch type to `Pick<AppSettings, 'showSplash' | 'sendTelemetry' | 'notifyOnDone'>`.
- Add a third `list-row`:

```tsx
        <div className="list-row">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings?.notifyOnDone ?? true}
              disabled={!settings}
              onChange={(e) => void toggle({ notifyOnDone: e.target.checked })}
            />{' '}
            Notify when an agent finishes its turn
          </label>
        </div>
```

If `SettingsScreen.test.tsx` has a test for the splash toggle, add the same test for this toggle: click it and expect a `settings:save` call with `notifyOnDone: false`.

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run typecheck && npx oxlint src && npx oxfmt --check src`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
npx oxfmt src
git add src
git commit -m "feat(attention): badges, click-through and the notify-on-done setting"
```

---

### Task 8: Live functional check of the packaged app

**Files:**
- Create (session scratchpad, not the repo): `func/attention-check.mjs`

The owner wants real click-through checks with asserted results. Follow the earlier pattern:
- Playwright `_electron` drives the packaged app over CDP.
- Use a throwaway git repo.
- Set the developer's `state.json` and `connections.json` aside beforehand and restore them afterwards, even when the check fails (`try/finally`).
- In a fresh worktree, run `node node_modules/electron/install.js` before `npm run package`.

- [ ] **Step 1: Package**

Run: `npm ci` (if `node_modules` is missing), then `node node_modules/electron/install.js && npm run package`.
Expected: `out/Shellie-darwin-arm64/Shellie.app`.

- [ ] **Step 2: Write the check**

Spy on notifications and the Dock count from the main process:

```js
await app.evaluate(({ Notification, app: a }) => {
  globalThis.__shown = [];
  globalThis.__badge = [];
  const show = Notification.prototype.show;
  Notification.prototype.show = function () {
    globalThis.__shown.push({ title: this.title, body: this.body });
    return show.call(this);
  };
  const set = a.setBadgeCount.bind(a);
  a.setBadgeCount = (n) => {
    globalThis.__badge.push(n);
    return set(n);
  };
});
```

If patching the prototype does not take effect (the hub keeps a reference to `Notification` from the `electron` import), fall back to counting `attention:changed` broadcasts and checking `app.getBadgeCount()`. Record in the report which method was used.

Scenarios, each with an asserted result:
1. Create two tasks (A, B) in the throwaway repo, each with a shell tab. On A's shell tab run `printf '\033]7501;state=blocked:app=claude-code:kind=permission:msg=%s\007' "$(printf 'approve Bash: ls' | base64)"`, with a 3 s `sleep` in front, then switch to B before it fires. Assert:
   - 1 notification, body `Shell needs permission: approve Bash: ls` (the shell tab label is whatever `platform.shellLabel` is; assert on "needs permission: approve Bash: ls")
   - `app.getBadgeCount() === 1`
   - A's nav row has the label "Needs permission: approve Bash: ls"
2. Switch to A's shell tab. Assert the dot is gone and the badge count is 0.
3. On screen, print the same sequence without the sleep. Assert no new notification and no dot.
4. Switch to B. On A, print blocked, then done, then blocked (with sleeps). Assert exactly one new notification.
5. Real Claude. Create a throwaway folder and register it as a repo. Claude's trust dialog will appear in the new worktree; send Enter on "Yes, I trust this folder" through `terminals:write`, or pre-trust the folder by starting the task in a folder already marked trusted. In the Claude tab send `Use the Bash tool to run exactly: rm /tmp/shellie-attention-probe` (create the file first) with `--permission-mode default`. If Shellie's Claude command does not take extra args, send `/permissions` instead; the default mode asks for `rm`. Switch away and assert an entry `{ reason: 'blocked', kind: 'permission' }` via `attention:get` within 30 s. Clean up: press Esc in the tab, then delete the file.
6. If `which opencode` succeeds: open an OpenCode tab, send a short prompt (`say ok`), switch away, and assert a `done` entry within 60 s.

- [ ] **Step 3: Run it and record results**

Run: `node <scratchpad>/func/attention-check.mjs`
Expected: every scenario prints PASS with its asserted values. Report the counts (e.g. 6/6) and any scenario skipped (OpenCode not installed) with the reason.

- [ ] **Step 4: Note results**

Nothing to commit from the scratchpad. Put the results in the PR description.

---

## Self-Review Notes

- **Spec coverage.** §1.1 is Tasks 1 and 4 (scanner on every terminal, probe reply, decoding). §1.2 is Task 3 (plugin, merge, child filtering, error mapping) plus Task 5/6 (env vars, plugin file). §1.3 is Task 4 (bell, throttle, exclusions). §1.4 is Task 5 (route, token, 404). §2 rules 1-6 are Task 2, with exit and retain wired in Tasks 4 and 6. §2.1 is Task 7 (hook). §3.1 is Tasks 4 and 6 (title, body, click, close on clear). §3.2 is Task 7. §3.3 is Task 6. §4 is Tasks 5 and 7. §5 is Tasks 1 and 4, and Windows is out of scope. §6 is Tasks 1-8.
- **Type names used consistently:** `AttentionSignal`, `AttentionEntry`, `AttentionSnapshot`, `AttentionView`, `AttentionHub.{data,signal,exit,retain,setFocused,setView,snapshot}`, `Services.attention`, `Services.terminalEnv`, `notifyOnDone`.
