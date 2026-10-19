# Claude Budget on Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Claude budget" band on Home showing this month's Claude spend (all Claude Code and Anthropic-billed OpenCode usage on the machine) against a personal monthly budget, with a forecast, daily bars per model, and alerts.

**Architecture:** Two readers in main (`src/main/budget/`) turn Claude Code transcripts and the OpenCode SQLite database into `BudgetRecord`s. `BudgetStore` dedupes, prices and rolls them up per day × tool × model in `budget.json`. `BudgetService` runs passes on a timer and on focus, fires alerts and broadcasts `budget:changed`. A pure `budgetView()` in `src/shared/` builds the view model the renderer's `BudgetBand` draws.

**Tech Stack:** Electron 44 (main: Node 24, `node:sqlite`), React 19, TypeScript, zod 4, Vitest 5 (main = node env, renderer = jsdom), oxlint/oxfmt.

**Spec:** `docs/superpowers/specs/2026-10-19-claude-budget-design.md`

## Global Constraints

- Work in the worktree `/Users/drieshoebeke/Projects/Shellie.worktrees/claude-budget`, branch `feature/claude-budget`.
- Counted = Claude Code always; OpenCode only when `providerID === 'anthropic'`. Other providers with a `claude-` model are "not counted" (requests + tokens, no cost). Non-Claude models are dropped.
- Dedupe keys: `cc:<message.id>` and `oc:<message id>`.
- Prices: `RateTable` official rates, USD → EUR with `OFFICIAL_USD_TO_EUR`. 1h cache write = 2× input, 5m = 1.25× (already `cacheWritePerM`). A model without a rate is unpriced (`costEur: null`), never €0.
- Store: `budget.json` in `usageDir` (`<userData>/usage`), `JsonFileStore`, compact JSON (indent 0).
- Refresh: pass at launch (after window load), every 30 s, on window focus; never two passes at once.
- Forecast hidden while `daysElapsed <= 3`. `monthStartDay` 1-28, default 1. Week starts Monday (as `periodRange`).
- Alerts: `at80`, `forecastOver` (only when the forecast is shown), `at100`; each at most once per budget month; none without a budget.
- Telemetry: no amounts, models or paths. Events `home.clicked` (`band: 'budget-month' | 'budget-settings'`) and `budget.alert` (`{ kind }`).
- New settings fields use `.default(<full value>)` (zod 4 does not parse defaults).
- Copy text (exact): info tip `Estimated at Anthropic API list prices in EUR. Your company's invoice may differ. Claude models through Copilot aren't counted.`; empty `No Claude Code or OpenCode usage found on this computer.`; link `Set a monthly budget`.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018pN36d8qmj82BVJLA1wM2L
  ```
- Before each commit: `npx vitest run <touched test files>`, `npm run typecheck`, `npx oxfmt --write <touched files>`.

## Review Focus

1. **Resumed sessions copy history into a new transcript file** → those lines must not be counted twice (test in Task 4: same message id in two files).
2. **A transcript line still being written (no trailing newline)** → it is not parsed now and is counted once complete on the next pass (Task 4).
3. **OpenCode message updated after it was counted** (tokens filled in on completion) → totals reflect the final tokens, not the sum of both versions (Task 5 + Task 6).
4. **Budget month starting on day 15 and "today" before the 15th** → the month shown is the 15th of last month to the 14th of this one (Task 3).
5. **A model Shellie has no rate for** → shown as unpriced with tokens and excluded from € totals and alerts, then priced once rates include it (Task 6 + Task 7).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/budget.ts` (new) | Types (`BudgetRecord`, `BudgetRow`, `BudgetView`…), `BudgetSettingsSchema`, date helpers (`dayKey`, `budgetMonth`) |
| `src/shared/budgetView.ts` (new) | Pure `budgetView(input)`: header status, forecast, burn-down points, daily bars, model totals, not-counted, alerts due |
| `src/main/budget/claudeTranscripts.ts` (new) | `parseTranscriptLine()` + `ClaudeTranscriptReader` (offsets) |
| `src/main/budget/openCode.ts` (new) | `parseOpenCodeMessage()` + `OpenCodeReader` (`node:sqlite`, cursor) |
| `src/main/budget/BudgetStore.ts` (new) | Rollup, dedupe/seen, cursors, alerts fired, pricing, repricing, pruning |
| `src/main/budget/BudgetService.ts` (new) | Passes, timer, focus, in-Shellie classification, alerts, broadcast |
| `src/main/pricing/officialRates.ts`, `src/shared/usage.ts` | `cacheWrite1hPerM` on Anthropic rates; `claudeBudget` setting |
| `src/shared/ipc.ts`, `src/main/ipc/handlers.ts`, `src/main.ts` | `budget:get` channel, `budget:changed` / `budget:open` events, wiring |
| `src/renderer/hooks/useBudget.ts`, `src/renderer/components/home/BudgetBand.tsx`, `src/renderer/styles/home.css`, `tokens.css` | Home band |
| `src/renderer/components/BudgetSection.tsx`, `SettingsScreen.tsx` | Settings section |
| `docs/telemetry.md`, `CLAUDE.md`, `tools/budget-check.mjs` | Docs and the real-data check |

---

### Task 1: 1-hour cache write price on Anthropic rates

**Files:**
- Modify: `src/shared/usage.ts` (`RateSchema`)
- Modify: `src/main/pricing/officialRates.ts`
- Test: `src/main/pricing/RateTable.test.ts`

**Interfaces:**
- Produces: `Rate.cacheWrite1hPerM?: number` (USD per million tokens). Every official Anthropic rate has it set to `2 × inputPerM`; other providers leave it undefined. `RateSnapshot` is unchanged (the budget prices from `Rate` directly, see Task 6) *(deviation from spec §2, which put it on the snapshot: the snapshot is only used by per-task usage, which has no 1h split)*.

- [ ] **Step 1: Write the failing test** (append to `RateTable.test.ts`)

```ts
import { OFFICIAL_RATES } from './officialRates';

describe('1-hour cache writes', () => {
  it('prices every Anthropic rate at twice its input price', () => {
    const anthropic = OFFICIAL_RATES.filter((r) => r.id.startsWith('anthropic-'));
    expect(anthropic.length).toBeGreaterThan(5);
    for (const r of anthropic) expect(r.cacheWrite1hPerM).toBeCloseTo(r.inputPerM * 2, 6);
  });
  it('leaves other providers without a 1-hour price', () => {
    const other = OFFICIAL_RATES.filter((r) => !r.id.startsWith('anthropic-'));
    for (const r of other) expect(r.cacheWrite1hPerM).toBeUndefined();
  });
});
```

(Check the export name first: `grep -n "export const" src/main/pricing/officialRates.ts`. If the list is not called `OFFICIAL_RATES`, use the real name everywhere in this plan.)

- [ ] **Step 2: Run it, expect FAIL**

Run: `npx vitest run src/main/pricing/RateTable.test.ts`
Expected: FAIL, `cacheWrite1hPerM` is undefined.

- [ ] **Step 3: Implement**

In `src/shared/usage.ts` `RateSchema`, after `cacheWritePerM`:

```ts
  /** 1-hour cache write price; absent means the 5-minute price applies. */
  cacheWrite1hPerM: z.number().min(0).optional(),
```

In `officialRates.ts`, where the `ANTHROPIC` array is used to build the exported list, wrap it:

```ts
/** Anthropic's 1-hour cache writes cost 2x base input (pricing page, 2026-10-14). */
const withHourWrites = (rates: Rate[]): Rate[] =>
  rates.map((x) => ({ ...x, cacheWrite1hPerM: Math.round(x.inputPerM * 2 * 1e6) / 1e6 }));
```

and use `...withHourWrites(ANTHROPIC)` in place of `...ANTHROPIC`. Before committing, open `https://platform.claude.com/docs/en/about-claude/pricing` and confirm the 1-hour cache write multiplier is 2x; if it differs, change the factor and the test.

- [ ] **Step 4: Run tests, expect PASS**

Run: `npx vitest run src/main/pricing src/renderer/components/CostSection.test.tsx && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/shared/usage.ts src/main/pricing
git commit -m "feat(pricing): 1-hour cache write price on Anthropic rates"
```

---

### Task 2: Budget setting

**Files:**
- Create: `src/shared/budget.ts` (settings part only in this task)
- Modify: `src/shared/usage.ts` (`AppSettingsSchema`)
- Modify: `src/renderer/test-helpers/fakeApi.ts` (default `settings:get`)
- Test: `src/main/usage/SettingsStore.test.ts`

**Interfaces:**
- Produces: `BudgetSettingsSchema`, `type BudgetSettings = { monthlyEur: number | null; monthStartDay: number; alerts: { at80: boolean; forecastOver: boolean; at100: boolean } }`, `defaultBudgetSettings(): BudgetSettings`, `AppSettings.claudeBudget: BudgetSettings`.

- [ ] **Step 1: Write the failing test** (append to `SettingsStore.test.ts`, reusing its temp-dir helper)

```ts
it('fills claudeBudget with defaults for older settings files', async () => {
  const file = path.join(dir, 'settings.json');
  writeFileSync(file, JSON.stringify({ version: 1, receiverPort: 4319, hourlySync: true }));
  const s = new SettingsStore(file);
  await s.load();
  expect(s.get().claudeBudget).toEqual({
    monthlyEur: null,
    monthStartDay: 1,
    alerts: { at80: true, forecastOver: true, at100: true },
  });
});
it('rejects a month start day after 28', () => {
  expect(() =>
    AppSettingsSchema.parse({ ...defaultSettings(), claudeBudget: { ...defaultBudgetSettings(), monthStartDay: 29 } }),
  ).toThrow();
});
```

(Match the file's existing imports/temp-dir variable names; add imports for `AppSettingsSchema`, `defaultSettings` from `../../shared/usage` and `defaultBudgetSettings` from `../../shared/budget`.)

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/main/usage/SettingsStore.test.ts`

- [ ] **Step 3: Implement**

`src/shared/budget.ts`:

```ts
import { z } from 'zod';

export const BudgetSettingsSchema = z.object({
  /** The company's monthly Claude budget in EUR; null means no budget (spend shown, no alerts). */
  monthlyEur: z.number().positive().nullable(),
  /** Day of the month the budget resets on (1-28). */
  monthStartDay: z.number().int().min(1).max(28),
  alerts: z.object({ at80: z.boolean(), forecastOver: z.boolean(), at100: z.boolean() }),
});
export type BudgetSettings = z.infer<typeof BudgetSettingsSchema>;
export const defaultBudgetSettings = (): BudgetSettings => ({
  monthlyEur: null,
  monthStartDay: 1,
  alerts: { at80: true, forecastOver: true, at100: true },
});
```

In `AppSettingsSchema` (`src/shared/usage.ts`), after `notifyOnDone`:

```ts
  /** The developer's monthly Claude budget (Home's Claude budget band). */
  claudeBudget: BudgetSettingsSchema.default(defaultBudgetSettings()),
```

with `import { BudgetSettingsSchema, defaultBudgetSettings } from './budget';`. In `fakeApi.ts` defaults for `settings:get`, add `claudeBudget: { monthlyEur: null, monthStartDay: 1, alerts: { at80: true, forecastOver: true, at100: true } },`.

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/main/usage src/renderer/screens/SettingsScreen.test.tsx && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/shared/budget.ts src/shared/usage.ts src/renderer/test-helpers/fakeApi.ts src/main/usage/SettingsStore.test.ts
git commit -m "feat(budget): claudeBudget setting"
```

---

### Task 3: Budget types and month dates

**Files:**
- Modify: `src/shared/budget.ts`
- Test: `src/shared/budget.test.ts` (new)

**Interfaces:**
- Produces (all exported from `src/shared/budget.ts`):

```ts
export type BudgetTool = 'claude-code' | 'opencode';
export type BudgetTokens = {
  inputTokens: number; outputTokens: number; cacheReadTokens: number;
  cacheWrite5mTokens: number; cacheWrite1hTokens: number;
};
export type BudgetRecord = BudgetTokens & {
  id: string; tool: BudgetTool; sessionId: string; model: string; provider: string;
  at: string; cwd: string | null; fast: boolean;
};
/** One rollup row: a day × tool × model × provider × counted × inShellie. */
export type BudgetRow = BudgetTokens & {
  tool: BudgetTool; model: string; provider: string; counted: boolean; inShellie: boolean;
  requests: number; fast: boolean; costEur: number | null;
};
export type BudgetMonth = { start: Date; end: Date; days: string[] }; // end exclusive; days = day keys
export function dayKey(d: Date): string;                // local 'YYYY-MM-DD'
export function budgetMonth(now: Date, startDay: number, offset?: number): BudgetMonth; // offset 0 = current, -1 = previous
export function tokensOf(t: BudgetTokens): number;      // sum of all five
```

- [ ] **Step 1: Write the failing test** `src/shared/budget.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { budgetMonth, dayKey, tokensOf } from './budget';

describe('dayKey', () => {
  it('uses local dates', () => expect(dayKey(new Date(2026, 9, 5, 23, 30))).toBe('2026-10-05'));
});

describe('budgetMonth', () => {
  it('runs from the 1st by default', () => {
    const m = budgetMonth(new Date(2026, 9, 19, 12), 1);
    expect(dayKey(m.start)).toBe('2026-10-01');
    expect(dayKey(m.end)).toBe('2026-11-01');
    expect(m.days).toHaveLength(31);
  });
  it('starts on day 15 of last month when today is before the 15th', () => {
    const m = budgetMonth(new Date(2026, 9, 3, 9), 15);
    expect(dayKey(m.start)).toBe('2026-09-15');
    expect(dayKey(m.end)).toBe('2026-10-15');
    expect(m.days[0]).toBe('2026-09-15');
    expect(m.days.at(-1)).toBe('2026-10-14');
  });
  it('steps back with an offset, across a year', () => {
    const m = budgetMonth(new Date(2026, 0, 10), 1, -1);
    expect(dayKey(m.start)).toBe('2025-12-01');
    expect(m.days).toHaveLength(31);
  });
});

describe('tokensOf', () => {
  it('adds all token kinds', () =>
    expect(tokensOf({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWrite5mTokens: 4, cacheWrite1hTokens: 5 })).toBe(15));
});
```

- [ ] **Step 2: Run, expect FAIL**: `npx vitest run src/shared/budget.test.ts`

- [ ] **Step 3: Implement** (append to `src/shared/budget.ts`, plus the types above)

```ts
const pad = (n: number) => String(n).padStart(2, '0');
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function budgetMonth(now: Date, startDay: number, offset = 0): BudgetMonth {
  const before = now.getDate() < startDay ? -1 : 0;
  const start = new Date(now.getFullYear(), now.getMonth() + before + offset, startDay);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, startDay);
  const days: string[] = [];
  for (const d = new Date(start); d < end; d.setDate(d.getDate() + 1)) days.push(dayKey(d));
  return { start, end, days };
}
export const tokensOf = (t: BudgetTokens): number =>
  t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWrite5mTokens + t.cacheWrite1hTokens;
```

- [ ] **Step 4: Run, expect PASS**; `npm run typecheck`

- [ ] **Step 5: Commit**: `git add src/shared/budget* && git commit -m "feat(budget): record types and budget month dates"`

---

### Task 4: Claude Code transcript reader

**Files:**
- Create: `src/main/budget/claudeTranscripts.ts`
- Test: `src/main/budget/claudeTranscripts.test.ts`

**Interfaces:**
- Consumes: `BudgetRecord` (Task 3).
- Produces:

```ts
export function parseTranscriptLine(line: string): BudgetRecord | null;
export type FileCursor = { offset: number; size: number; mtimeMs: number; ino: number };
export class ClaudeTranscriptReader {
  constructor(root: string, opts?: { since?: number /* epoch ms: skip files with older mtime when unseen */ });
  /** Reads lines appended since `cursors`; returns records and the new cursors (same object shape, keyed by absolute path). `found` is false when root does not exist. */
  read(cursors: Record<string, FileCursor>): Promise<{ records: BudgetRecord[]; cursors: Record<string, FileCursor>; found: boolean }>;
}
export function claudeProjectsDir(env?: NodeJS.ProcessEnv, home?: string): string; // $CLAUDE_CONFIG_DIR/projects else ~/.claude/projects
```

- [ ] **Step 1: Write the failing tests**

```ts
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeTranscriptReader, claudeProjectsDir, parseTranscriptLine } from './claudeTranscripts';

const line = (o: { id?: string; model?: string; usage?: object; type?: string; speed?: string } = {}) =>
  JSON.stringify({
    type: o.type ?? 'assistant',
    timestamp: '2026-10-07T11:21:00.626Z',
    sessionId: 's1',
    cwd: '/w/repo',
    message: {
      id: o.id ?? 'msg_1',
      model: o.model ?? 'claude-opus-5-5',
      usage: o.usage ?? {
        input_tokens: 2, output_tokens: 87, cache_read_input_tokens: 25716,
        cache_creation_input_tokens: 20289,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 20289 },
        speed: o.speed ?? 'standard',
      },
    },
  });

describe('parseTranscriptLine', () => {
  it('reads an assistant line with the 5m/1h split', () => {
    expect(parseTranscriptLine(line())).toEqual({
      id: 'cc:msg_1', tool: 'claude-code', sessionId: 's1', model: 'claude-opus-5-5', provider: 'anthropic',
      at: '2026-10-07T11:21:00.626Z', cwd: '/w/repo', fast: false,
      inputTokens: 2, outputTokens: 87, cacheReadTokens: 25716, cacheWrite5mTokens: 0, cacheWrite1hTokens: 20289,
    });
  });
  it('treats cache writes as 5-minute when the split is missing', () => {
    const r = parseTranscriptLine(line({ usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 50 } }));
    expect(r).toMatchObject({ cacheWrite5mTokens: 50, cacheWrite1hTokens: 0, cacheReadTokens: 0 });
  });
  it('marks fast mode', () => {
    const r = parseTranscriptLine(line({ usage: { input_tokens: 1, output_tokens: 1, speed: 'fast' } }));
    expect(r?.fast).toBe(true);
  });
  it('skips user lines, synthetic models, lines without usage and garbage', () => {
    expect(parseTranscriptLine(line({ type: 'user' }))).toBeNull();
    expect(parseTranscriptLine(line({ model: '<synthetic>' }))).toBeNull();
    expect(parseTranscriptLine(JSON.stringify({ type: 'assistant', message: { id: 'x' } }))).toBeNull();
    expect(parseTranscriptLine('{not json')).toBeNull();
  });
});

describe('claudeProjectsDir', () => {
  it('honours CLAUDE_CONFIG_DIR', () =>
    expect(claudeProjectsDir({ CLAUDE_CONFIG_DIR: '/cfg' }, '/home/u')).toBe(path.join('/cfg', 'projects')));
  it('defaults to ~/.claude/projects', () =>
    expect(claudeProjectsDir({}, '/home/u')).toBe(path.join('/home/u', '.claude', 'projects')));
});

describe('ClaudeTranscriptReader', () => {
  const setup = () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'cc-'));
    mkdirSync(path.join(root, 'proj', 's1', 'subagents'), { recursive: true });
    return root;
  };

  it('reads nested files and only new lines on the next pass', async () => {
    const root = setup();
    const f = path.join(root, 'proj', 's1.jsonl');
    writeFileSync(f, `${line({ id: 'a' })}\n`);
    writeFileSync(path.join(root, 'proj', 's1', 'subagents', 'x.jsonl'), `${line({ id: 'b' })}\n`);
    const reader = new ClaudeTranscriptReader(root);
    const first = await reader.read({});
    expect(first.records.map((r) => r.id).sort()).toEqual(['cc:a', 'cc:b']);
    appendFileSync(f, `${line({ id: 'c' })}\n`);
    const second = await reader.read(first.cursors);
    expect(second.records.map((r) => r.id)).toEqual(['cc:c']);
  });

  it('leaves a half-written last line for the next pass', async () => {
    const root = setup();
    const f = path.join(root, 'proj', 's1.jsonl');
    const full = line({ id: 'a' });
    writeFileSync(f, full.slice(0, 30));
    const reader = new ClaudeTranscriptReader(root);
    const first = await reader.read({});
    expect(first.records).toEqual([]);
    appendFileSync(f, `${full.slice(30)}\n`);
    expect((await reader.read(first.cursors)).records.map((r) => r.id)).toEqual(['cc:a']);
  });

  it('re-reads a file that shrank', async () => {
    const root = setup();
    const f = path.join(root, 'proj', 's1.jsonl');
    writeFileSync(f, `${line({ id: 'a' })}\n${line({ id: 'b' })}\n`);
    const reader = new ClaudeTranscriptReader(root);
    const first = await reader.read({});
    writeFileSync(f, `${line({ id: 'z' })}\n`);
    expect((await reader.read(first.cursors)).records.map((r) => r.id)).toEqual(['cc:z']);
  });

  it('skips unseen files older than `since`', async () => {
    const root = setup();
    writeFileSync(path.join(root, 'proj', 'old.jsonl'), `${line({ id: 'old' })}\n`);
    const reader = new ClaudeTranscriptReader(root, { since: Date.now() + 60_000 });
    expect((await reader.read({})).records).toEqual([]);
  });

  it('reports a missing folder as not found', async () => {
    const r = await new ClaudeTranscriptReader('/no/such/dir').read({});
    expect(r).toEqual({ records: [], cursors: {}, found: false });
  });
});
```

(Duplicate ids across files are deduped by the store, Task 6, not the reader.)

- [ ] **Step 2: Run, expect FAIL**: `npx vitest run src/main/budget/claudeTranscripts.test.ts`

- [ ] **Step 3: Implement** `src/main/budget/claudeTranscripts.ts`

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BudgetRecord } from '../../shared/budget';

type Usage = {
  input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  speed?: string;
};
const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

/** One Claude Code transcript line as a budget record; null for anything that is not a priced response. */
export function parseTranscriptLine(line: string): BudgetRecord | null {
  let d: { type?: string; timestamp?: string; sessionId?: string; cwd?: string; message?: { id?: string; model?: string; usage?: Usage } };
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  const m = d.message;
  if (d.type !== 'assistant' || !m?.usage || !m.id || !m.model || m.model === '<synthetic>' || !d.timestamp) return null;
  const u = m.usage;
  const split = u.cache_creation;
  const w1h = n(split?.ephemeral_1h_input_tokens);
  const w5m = split ? n(split.ephemeral_5m_input_tokens) : n(u.cache_creation_input_tokens);
  return {
    id: `cc:${m.id}`, tool: 'claude-code', sessionId: d.sessionId ?? '', model: m.model, provider: 'anthropic',
    at: d.timestamp, cwd: d.cwd ?? null, fast: u.speed === 'fast',
    inputTokens: n(u.input_tokens), outputTokens: n(u.output_tokens), cacheReadTokens: n(u.cache_read_input_tokens),
    cacheWrite5mTokens: w5m, cacheWrite1hTokens: w1h,
  };
}

export function claudeProjectsDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  return env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, 'projects') : path.join(home, '.claude', 'projects');
}

export type FileCursor = { offset: number; size: number; mtimeMs: number; ino: number };

async function* jsonlFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFiles(p);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield p;
  }
}

const tick = () => new Promise<void>((r) => setImmediate(r));

/** Follows every Claude Code transcript under `root`, reading only bytes appended since the last pass. */
export class ClaudeTranscriptReader {
  constructor(private readonly root: string, private readonly opts: { since?: number } = {}) {}

  async read(cursors: Record<string, FileCursor>) {
    try {
      await fs.access(this.root);
    } catch {
      return { records: [] as BudgetRecord[], cursors: {}, found: false };
    }
    const next: Record<string, FileCursor> = {};
    const records: BudgetRecord[] = [];
    for await (const file of jsonlFiles(this.root)) {
      let st;
      try {
        st = await fs.stat(file);
      } catch {
        continue;
      }
      const prev = cursors[file];
      if (!prev && this.opts.since !== undefined && st.mtimeMs < this.opts.since) {
        next[file] = { offset: st.size, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino };
        continue;
      }
      const reset = !prev || st.size < prev.offset || st.ino !== prev.ino;
      const from = reset ? 0 : prev.offset;
      if (!reset && st.size === prev.size && st.mtimeMs === prev.mtimeMs) {
        next[file] = prev;
        continue;
      }
      const fh = await fs.open(file, 'r');
      try {
        const buf = Buffer.alloc(st.size - from);
        await fh.read(buf, 0, buf.length, from);
        const end = buf.lastIndexOf(0x0a);
        const complete = end < 0 ? '' : buf.subarray(0, end).toString('utf8');
        for (const l of complete.split('\n')) {
          const r = l && parseTranscriptLine(l);
          if (r) records.push(r);
        }
        next[file] = { offset: from + end + 1, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino };
      } finally {
        await fh.close();
      }
      await tick();
    }
    return { records, cursors: next, found: true };
  }
}
```

Note: `since` marks old unseen files as read up to their current size, so they are never read later either (spec: older transcripts are ignored).

- [ ] **Step 4: Run, expect PASS**; `npm run typecheck`

- [ ] **Step 5: Commit**: `git add src/main/budget/claudeTranscripts* && git commit -m "feat(budget): Claude Code transcript reader"`

---

### Task 5: OpenCode reader

**Files:**
- Create: `src/main/budget/openCode.ts`
- Test: `src/main/budget/openCode.test.ts`

**Interfaces:**
- Consumes: `BudgetRecord`.
- Produces:

```ts
export function parseOpenCodeMessage(id: string, sessionId: string, data: string): BudgetRecord | null;
export function openCodeDbPath(env?: NodeJS.ProcessEnv, home?: string): string;
export class OpenCodeReader {
  constructor(file: string);
  /** Messages with time_updated > cursor; returns records and the new cursor (max time_updated seen). */
  read(cursor: number): { records: BudgetRecord[]; cursor: number; found: boolean };
}
```

- [ ] **Step 1: Write the failing tests**

```ts
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { OpenCodeReader, openCodeDbPath, parseOpenCodeMessage } from './openCode';

const msg = (o: Partial<{ provider: string; model: string; role: string; completed: number | null; output: number }> = {}) =>
  JSON.stringify({
    role: o.role ?? 'assistant',
    path: { cwd: '/w/repo', root: '/w/repo' },
    cost: 0,
    tokens: { total: 0, input: 3, output: o.output ?? 4, reasoning: 0, cache: { write: 12018, read: 7 } },
    modelID: o.model ?? 'claude-sonnet-5-5',
    providerID: o.provider ?? 'anthropic',
    time: { created: 1792384827209, completed: o.completed === undefined ? 1792384829895 : o.completed },
  });

describe('parseOpenCodeMessage', () => {
  it('maps tokens and provider', () => {
    expect(parseOpenCodeMessage('m1', 'ses1', msg())).toEqual({
      id: 'oc:m1', tool: 'opencode', sessionId: 'ses1', model: 'claude-sonnet-5-5', provider: 'anthropic',
      at: new Date(1792384827209).toISOString(), cwd: '/w/repo', fast: false,
      inputTokens: 3, outputTokens: 4, cacheReadTokens: 7, cacheWrite5mTokens: 12018, cacheWrite1hTokens: 0,
    });
  });
  it('skips user messages, unfinished messages and bad JSON', () => {
    expect(parseOpenCodeMessage('m', 's', msg({ role: 'user' }))).toBeNull();
    expect(parseOpenCodeMessage('m', 's', msg({ completed: null }))).toBeNull();
    expect(parseOpenCodeMessage('m', 's', '{')).toBeNull();
  });
});

describe('openCodeDbPath', () => {
  it('uses XDG_DATA_HOME', () =>
    expect(openCodeDbPath({ XDG_DATA_HOME: '/x' }, '/h')).toBe(path.join('/x', 'opencode', 'opencode.db')));
  it('defaults to ~/.local/share', () =>
    expect(openCodeDbPath({}, '/h')).toBe(path.join('/h', '.local', 'share', 'opencode', 'opencode.db')));
});

describe('OpenCodeReader', () => {
  const makeDb = () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'oc-')), 'opencode.db');
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`);
    const put = (id: string, updated: number, data: string) =>
      db.prepare('INSERT OR REPLACE INTO message VALUES (?, ?, ?, ?, ?)').run(id, 'ses1', 1, updated, data);
    return { file, put, close: () => db.close() };
  };

  it('reads new messages after the cursor, all providers', () => {
    const { file, put, close } = makeDb();
    put('m1', 100, msg());
    put('m2', 200, msg({ provider: 'github-copilot', model: 'claude-sonnet-4.6' }));
    const reader = new OpenCodeReader(file);
    const first = reader.read(0);
    expect(first.records.map((r) => [r.id, r.provider])).toEqual([['oc:m1', 'anthropic'], ['oc:m2', 'github-copilot']]);
    expect(first.cursor).toBe(200);
    put('m1', 300, msg({ output: 400 }));
    const second = reader.read(first.cursor);
    expect(second.records.map((r) => [r.id, r.outputTokens])).toEqual([['oc:m1', 400]]);
    close();
  });

  it('reports a missing database as not found', () =>
    expect(new OpenCodeReader('/no/such.db').read(5)).toEqual({ records: [], cursor: 5, found: false }));
});
```

- [ ] **Step 2: Run, expect FAIL**: `npx vitest run src/main/budget/openCode.test.ts`

- [ ] **Step 3: Implement** `src/main/budget/openCode.ts`

```ts
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BudgetRecord } from '../../shared/budget';

const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

/** One OpenCode `message` row as a budget record; null unless it is a finished assistant message. */
export function parseOpenCodeMessage(id: string, sessionId: string, data: string): BudgetRecord | null {
  let d: {
    role?: string; modelID?: string; providerID?: string; path?: { cwd?: string };
    tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } };
    time?: { created?: number; completed?: number | null };
  };
  try {
    d = JSON.parse(data);
  } catch {
    return null;
  }
  if (d.role !== 'assistant' || !d.time?.completed || !d.time.created || !d.modelID) return null;
  return {
    id: `oc:${id}`, tool: 'opencode', sessionId, model: d.modelID, provider: d.providerID ?? '',
    at: new Date(d.time.created).toISOString(), cwd: d.path?.cwd ?? null, fast: false,
    inputTokens: n(d.tokens?.input), outputTokens: n(d.tokens?.output), cacheReadTokens: n(d.tokens?.cache?.read),
    // OpenCode does not say which cache TTL it wrote; priced as 5-minute writes (spec, our call).
    cacheWrite5mTokens: n(d.tokens?.cache?.write), cacheWrite1hTokens: 0,
  };
}

export function openCodeDbPath(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  const base = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(base, 'opencode', 'opencode.db');
}

/** Reads OpenCode's SQLite database read-only; OpenCode may be writing (WAL), so a busy database waits briefly. */
export class OpenCodeReader {
  constructor(private readonly file: string) {}

  read(cursor: number): { records: BudgetRecord[]; cursor: number; found: boolean } {
    if (!existsSync(this.file)) return { records: [], cursor, found: false };
    const db = new DatabaseSync(this.file, { readOnly: true, timeout: 2000 });
    try {
      const rows = db
        .prepare('SELECT id, session_id, time_updated, data FROM message WHERE time_updated > ? ORDER BY time_updated')
        .all(cursor) as { id: string; session_id: string; time_updated: number; data: string }[];
      const records: BudgetRecord[] = [];
      let next = cursor;
      for (const r of rows) {
        next = Math.max(next, r.time_updated);
        const rec = parseOpenCodeMessage(r.id, r.session_id, r.data);
        if (rec) records.push(rec);
      }
      return { records, cursor: next, found: true };
    } finally {
      db.close();
    }
  }
}
```

If `npm run typecheck` reports no types for `node:sqlite`, check `@types/node` covers it (`grep -rl "node:sqlite" node_modules/@types/node | head -1`); if not, add `src/main/budget/sqlite.d.ts` declaring the `DatabaseSync` surface used here. If Vitest's Node lacks `node:sqlite` (Node < 22.5), stop and report: the main test project must run on a Node with it.

- [ ] **Step 4: Run, expect PASS**; `npm run typecheck`

- [ ] **Step 5: Commit**: `git add src/main/budget/openCode* && git commit -m "feat(budget): OpenCode database reader"`

---

### Task 6: BudgetStore (dedupe, pricing, rollup)

**Files:**
- Create: `src/main/budget/BudgetStore.ts`
- Test: `src/main/budget/BudgetStore.test.ts`

**Interfaces:**
- Consumes: `BudgetRecord`, `BudgetRow`, `dayKey`, `budgetMonth` (Task 3); `FileCursor` (Task 4); `Rate`, `OFFICIAL_USD_TO_EUR` (`src/shared/usage.ts`); `selectRate`, `normalizeModel`, `round6` (`src/main/pricing/RateTable.ts`); `JsonFileStore`.
- Produces:

```ts
export type AlertKind = 'at80' | 'forecastOver' | 'at100';
export type BudgetFile = {
  version: 1;
  days: Record<string, BudgetRow[]>;
  /** Dedupe: Claude Code ids map to their day key; OpenCode ids keep what they contributed, so a later update replaces it. */
  seen: Record<string, string | SeenContribution>;
  claudeCursors: Record<string, FileCursor>;
  openCodeCursor: number;
  /** Budget month start day key → alerts fired in that month. */
  alerts: Record<string, AlertKind[]>;
  sources: { claudeCode: boolean; openCode: boolean };
};
export type SeenContribution = { day: string; key: string; requests: 1 } & BudgetTokens & { costEur: number | null };
export function rowKey(r: Pick<BudgetRow, 'tool' | 'model' | 'provider' | 'counted' | 'inShellie' | 'fast'>): string;
export function isCounted(rec: BudgetRecord): boolean | null; // true counted, false not-counted Claude, null drop
export function priceTokens(rates: Rate[], model: string, fast: boolean, t: BudgetTokens): number | null; // EUR
export class BudgetStore {
  constructor(file: string, rates: () => Rate[]);
  load(): Promise<void>;
  get value(): BudgetFile;
  /** Adds records (deduped), updates cursors/sources, reprices unpriced rows of the kept months, prunes `seen`. Returns true when anything changed. */
  apply(input: {
    records: BudgetRecord[]; inShellie: (r: BudgetRecord) => boolean; now: Date; monthStartDay: number;
    claudeCursors?: Record<string, FileCursor>; openCodeCursor?: number; sources: { claudeCode: boolean; openCode: boolean };
  }): Promise<boolean>;
  markAlert(monthKey: string, kind: AlertKind): Promise<void>;
}
```

- [ ] **Step 1: Write the failing tests**

```ts
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BudgetRecord } from '../../shared/budget';
import type { Rate } from '../../shared/usage';
import { OFFICIAL_USD_TO_EUR } from '../../shared/usage';
import { BudgetStore, isCounted, priceTokens } from './BudgetStore';

const opus: Rate = {
  id: 'anthropic-opus-5-5', label: 'Opus 5.5', match: ['claude-opus-5-5'], minInputTokens: 0, fast: false,
  inputPerM: 4, cachedInputPerM: 0.2, cacheWritePerM: 5, cacheWrite1hPerM: 8, outputPerM: 20,
} as Rate;
const rec = (o: Partial<BudgetRecord> = {}): BudgetRecord => ({
  id: 'cc:m1', tool: 'claude-code', sessionId: 's1', model: 'claude-opus-5-5', provider: 'anthropic',
  at: new Date(2026, 9, 7, 10).toISOString(), cwd: '/w', fast: false,
  inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, ...o,
});
const now = new Date(2026, 9, 19, 12);
const base = { inShellie: () => false, now, monthStartDay: 1, sources: { claudeCode: true, openCode: true } };
const store = async (rates: Rate[] = [opus]) => {
  const s = new BudgetStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'bs-')), 'budget.json'), () => rates);
  await s.load();
  return s;
};
const day = (s: BudgetStore) => s.value.days['2026-10-07'];

describe('priceTokens', () => {
  it('prices 1h writes at their own rate, in EUR', () => {
    const t = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 1e6, cacheWrite1hTokens: 1e6 };
    expect(priceTokens([opus], 'claude-opus-5-5', false, t)).toBeCloseTo((5 + 8) * OFFICIAL_USD_TO_EUR, 6);
  });
  it('returns null for an unknown model', () =>
    expect(priceTokens([opus], 'claude-mystery-9', false, { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 })).toBeNull());
});

describe('isCounted', () => {
  it('counts Claude Code and Anthropic OpenCode, keeps Copilot Claude as not counted, drops the rest', () => {
    expect(isCounted(rec())).toBe(true);
    expect(isCounted(rec({ tool: 'opencode', provider: 'anthropic' }))).toBe(true);
    expect(isCounted(rec({ tool: 'opencode', provider: 'github-copilot', model: 'claude-sonnet-4.6' }))).toBe(false);
    expect(isCounted(rec({ tool: 'opencode', provider: 'openai', model: 'gpt-5' }))).toBeNull();
  });
});

describe('BudgetStore.apply', () => {
  it('counts a message id once, across lines and files', async () => {
    const s = await store();
    await s.apply({ ...base, records: [rec(), rec()] });
    await s.apply({ ...base, records: [rec()] });
    expect(day(s)).toHaveLength(1);
    expect(day(s)[0]).toMatchObject({ requests: 1, inputTokens: 1_000_000, counted: true });
    expect(day(s)[0].costEur).toBeCloseTo(4 * OFFICIAL_USD_TO_EUR, 6);
  });

  it('replaces an OpenCode message updated after it was counted', async () => {
    const s = await store();
    const oc = (out: number) => rec({ id: 'oc:x', tool: 'opencode', inputTokens: 0, outputTokens: out });
    await s.apply({ ...base, records: [oc(1_000_000)] });
    await s.apply({ ...base, records: [oc(2_000_000)] });
    expect(day(s)[0]).toMatchObject({ requests: 1, outputTokens: 2_000_000 });
    expect(day(s)[0].costEur).toBeCloseTo(40 * OFFICIAL_USD_TO_EUR, 6);
  });

  it('keeps not-counted rows without cost and drops non-Claude models', async () => {
    const s = await store();
    await s.apply({ ...base, records: [
      rec({ id: 'oc:c', tool: 'opencode', provider: 'github-copilot', model: 'claude-sonnet-4.6' }),
      rec({ id: 'oc:g', tool: 'opencode', provider: 'openai', model: 'gpt-5' }),
    ] });
    expect(day(s)).toEqual([expect.objectContaining({ counted: false, costEur: null, requests: 1, provider: 'github-copilot' })]);
  });

  it('stores an unknown model unpriced and prices it once a rate exists', async () => {
    const rates: Rate[] = [];
    const s = await store(rates);
    await s.apply({ ...base, records: [rec({ id: 'cc:u', model: 'claude-opus-5-5' })] });
    expect(day(s)[0].costEur).toBeNull();
    rates.push(opus);
    expect(await s.apply({ ...base, records: [] })).toBe(true);
    expect(day(s)[0].costEur).toBeCloseTo(4 * OFFICIAL_USD_TO_EUR, 6);
  });

  it('splits rows by in/outside Shellie', async () => {
    const s = await store();
    await s.apply({ ...base, inShellie: (r) => r.sessionId === 'in', records: [rec({ id: 'cc:a', sessionId: 'in' }), rec({ id: 'cc:b' })] });
    expect(day(s).map((r) => r.inShellie).sort()).toEqual([false, true]);
  });

  it('forgets seen ids older than the previous budget month', async () => {
    const s = await store();
    await s.apply({ ...base, records: [rec({ id: 'cc:old', at: new Date(2026, 7, 2).toISOString() })] });
    expect(s.value.seen['cc:old']).toBe('2026-08-02');
    await s.apply({ ...base, records: [] });
    expect(s.value.seen['cc:old']).toBeUndefined();
    expect(s.value.days['2026-08-02']).toHaveLength(1);
  });

  it('survives a reload', async () => {
    const s = await store();
    await s.apply({ ...base, records: [rec()], claudeCursors: { '/f': { offset: 1, size: 1, mtimeMs: 1, ino: 1 } }, openCodeCursor: 9 });
    const again = new BudgetStore((s as unknown as { file: string }).file, () => [opus]);
    await again.load();
    expect(again.value.openCodeCursor).toBe(9);
    expect(again.value.seen['cc:m1']).toBe('2026-10-07');
  });
});
```

(For the reload test, give `BudgetStore` a `readonly file` constructor property, as below.)

- [ ] **Step 2: Run, expect FAIL**: `npx vitest run src/main/budget/BudgetStore.test.ts`

- [ ] **Step 3: Implement** `src/main/budget/BudgetStore.ts`

```ts
import { z } from 'zod';
import type { BudgetRecord, BudgetRow, BudgetTokens } from '../../shared/budget';
import { budgetMonth, dayKey } from '../../shared/budget';
import { OFFICIAL_USD_TO_EUR, type Rate } from '../../shared/usage';
import { normalizeModel, round6, selectRate } from '../pricing/RateTable';
import { JsonFileStore } from '../usage/JsonFileStore';
import type { FileCursor } from './claudeTranscripts';

export type AlertKind = 'at80' | 'forecastOver' | 'at100';
export type SeenContribution = BudgetTokens & { day: string; key: string; requests: 1; costEur: number | null };
export type BudgetFile = {
  version: 1;
  days: Record<string, BudgetRow[]>;
  seen: Record<string, string | SeenContribution>;
  claudeCursors: Record<string, FileCursor>;
  openCodeCursor: number;
  alerts: Record<string, AlertKind[]>;
  sources: { claudeCode: boolean; openCode: boolean };
};

const tokens = { inputTokens: z.number(), outputTokens: z.number(), cacheReadTokens: z.number(), cacheWrite5mTokens: z.number(), cacheWrite1hTokens: z.number() };
const Row = z.object({ ...tokens, tool: z.enum(['claude-code', 'opencode']), model: z.string(), provider: z.string(), counted: z.boolean(), inShellie: z.boolean(), requests: z.number(), fast: z.boolean(), costEur: z.number().nullable() });
const Seen = z.union([z.string(), z.object({ ...tokens, day: z.string(), key: z.string(), requests: z.literal(1), costEur: z.number().nullable() })]);
const FileSchema: z.ZodType<BudgetFile> = z.object({
  version: z.literal(1),
  days: z.record(z.string(), z.array(Row)),
  seen: z.record(z.string(), Seen),
  claudeCursors: z.record(z.string(), z.object({ offset: z.number(), size: z.number(), mtimeMs: z.number(), ino: z.number() })),
  openCodeCursor: z.number(),
  alerts: z.record(z.string(), z.array(z.enum(['at80', 'forecastOver', 'at100']))),
  sources: z.object({ claudeCode: z.boolean(), openCode: z.boolean() }),
});
const empty = (): BudgetFile => ({ version: 1, days: {}, seen: {}, claudeCursors: {}, openCodeCursor: 0, alerts: {}, sources: { claudeCode: false, openCode: false } });

const TOKEN_KEYS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWrite5mTokens', 'cacheWrite1hTokens'] as const;

export const rowKey = (r: Pick<BudgetRow, 'tool' | 'model' | 'provider' | 'counted' | 'inShellie' | 'fast'>) =>
  [r.tool, r.model, r.provider, r.counted, r.inShellie, r.fast].join('|');

export function isCounted(rec: BudgetRecord): boolean | null {
  if (rec.tool === 'claude-code' || rec.provider === 'anthropic') return true;
  return normalizeModel(rec.model).startsWith('claude-') ? false : null;
}

export function priceTokens(rates: Rate[], model: string, fast: boolean, t: BudgetTokens): number | null {
  const totalIn = t.inputTokens + t.cacheReadTokens + t.cacheWrite5mTokens + t.cacheWrite1hTokens;
  const rate = selectRate(rates, model, totalIn, fast) ?? (fast ? selectRate(rates, model, totalIn, false) : null);
  if (!rate) return null;
  const usd =
    (t.inputTokens * rate.inputPerM + t.outputTokens * rate.outputPerM + t.cacheReadTokens * rate.cachedInputPerM +
      t.cacheWrite5mTokens * rate.cacheWritePerM + t.cacheWrite1hTokens * (rate.cacheWrite1hPerM ?? rate.cacheWritePerM)) / 1e6;
  return round6(usd * OFFICIAL_USD_TO_EUR);
}

/** The month rollup behind the Claude budget band: one row per day × tool × model × provider × counted × in Shellie × fast. */
export class BudgetStore {
  private readonly store: JsonFileStore<BudgetFile>;
  constructor(readonly file: string, private readonly rates: () => Rate[]) {
    this.store = new JsonFileStore(file, FileSchema, empty, 0);
  }
  async load() {
    await this.store.load();
  }
  get value(): BudgetFile {
    return this.store.value;
  }

  async apply(input: {
    records: BudgetRecord[]; inShellie: (r: BudgetRecord) => boolean; now: Date; monthStartDay: number;
    claudeCursors?: Record<string, FileCursor>; openCodeCursor?: number; sources: { claudeCode: boolean; openCode: boolean };
  }): Promise<boolean> {
    const rates = this.rates();
    const keepFrom = dayKey(budgetMonth(input.now, input.monthStartDay, -1).start);
    let changed = false;
    await this.store.update((f) => {
      const rowFor = (day: string, proto: Omit<BudgetRow, 'requests' | 'costEur' | (typeof TOKEN_KEYS)[number]>) => {
        const list = (f.days[day] ??= []);
        const k = rowKey(proto);
        let row = list.find((r) => rowKey(r) === k);
        if (!row) {
          row = { ...proto, requests: 0, costEur: proto.counted ? 0 : null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };
          list.push(row);
        }
        return row;
      };
      const add = (row: BudgetRow, t: BudgetTokens, requests: number, cost: number | null, sign: 1 | -1) => {
        for (const key of TOKEN_KEYS) row[key] += sign * t[key];
        row.requests += sign * requests;
        if (row.counted) row.costEur = cost === null || row.costEur === null ? null : round6(row.costEur + sign * cost);
      };
      for (const rec of input.records) {
        const counted = isCounted(rec);
        if (counted === null) continue;
        const prev = f.seen[rec.id];
        if (typeof prev === 'string') continue;
        const day = dayKey(new Date(rec.at));
        const proto = { tool: rec.tool, model: rec.model, provider: rec.provider, counted, inShellie: input.inShellie(rec), fast: rec.fast };
        const cost = counted ? priceTokens(rates, rec.model, rec.fast, rec) : null;
        if (prev) {
          const old = f.days[prev.day]?.find((r) => rowKey(r) === prev.key);
          if (old) add(old, prev, 1, prev.costEur, -1);
        }
        add(rowFor(day, proto), rec, 1, cost, 1);
        const t = Object.fromEntries(TOKEN_KEYS.map((key) => [key, rec[key]])) as BudgetTokens;
        f.seen[rec.id] = rec.tool === 'claude-code' ? day : { ...t, day, key: rowKey(proto), requests: 1, costEur: cost };
        changed = true;
      }
      // Rows that were unpriced: price them from their tokens once a rate exists.
      for (const [day, list] of Object.entries(f.days)) {
        if (day < keepFrom) continue;
        for (const row of list) {
          if (!row.counted || row.costEur !== null) continue;
          const cost = priceTokens(rates, row.model, row.fast, row);
          if (cost !== null) {
            row.costEur = cost;
            changed = true;
          }
        }
      }
      for (const [id, s] of Object.entries(f.seen)) {
        if ((typeof s === 'string' ? s : s.day) < keepFrom) {
          delete f.seen[id];
          changed = true;
        }
      }
      if (input.claudeCursors) f.claudeCursors = input.claudeCursors;
      if (input.openCodeCursor !== undefined) f.openCodeCursor = input.openCodeCursor;
      if (f.sources.claudeCode !== input.sources.claudeCode || f.sources.openCode !== input.sources.openCode) changed = true;
      f.sources = input.sources;
    });
    return changed;
  }

  async markAlert(monthKey: string, kind: AlertKind) {
    await this.store.update((f) => {
      const list = (f.alerts[monthKey] ??= []);
      if (!list.includes(kind)) list.push(kind);
    });
  }
}
```

Also note unpriced rows: once a counted row has `costEur: null`, `add` keeps it null; the reprice loop prices the whole row from its tokens. A row that mixes priced and unpriced requests of the same model cannot occur because pricing depends only on the model, fast flag and the rate table (a rate appearing mid-month reprices the whole row).

- [ ] **Step 4: Run, expect PASS**; `npm run typecheck`

- [ ] **Step 5: Commit**: `git add src/main/budget/BudgetStore* && git commit -m "feat(budget): rollup store with dedupe and pricing"`

---

### Task 7: budgetView (forecast, bars, totals, alerts due)

**Files:**
- Create: `src/shared/budgetView.ts`
- Test: `src/shared/budgetView.test.ts`

**Interfaces:**
- Consumes: `BudgetRow`, `BudgetSettings`, `budgetMonth`, `dayKey`, `tokensOf` (Tasks 2-3); `AlertKind` — define it in `src/shared/budget.ts` (move it there from `BudgetStore.ts` and import it back in `BudgetStore.ts`).
- Produces:

```ts
export type ModelTotal = { model: string; costEur: number; tokens: number; requests: number };
export type BudgetDay = { day: string; future: boolean; today: boolean; byModel: { model: string; costEur: number; outsideEur: number; tokens: number }[]; costEur: number };
export type BudgetView = {
  monthOffset: number; startDay: string; endDay: string; // endDay = last day (inclusive)
  budgetEur: number | null; spentEur: number;
  daysElapsed: number; daysInMonth: number;
  forecastEur: number | null; // null when hidden (not the current month, or daysElapsed <= 3)
  status: 'none' | 'onTrack' | 'paceOver' | 'over';
  cumulative: { day: string; eur: number }[]; // past and today only
  days: BudgetDay[];
  models: ModelTotal[];      // counted, by cost desc
  todayEur: number; weekEur: number; outsideShare: number; // 0-1 of spentEur
  notCounted: { model: string; provider: string; requests: number; tokens: number }[];
  unpriced: { model: string; tokens: number; requests: number }[];
  sources: { claudeCode: boolean; openCode: boolean };
  alertsDue: AlertKind[];
};
export function budgetView(input: {
  days: Record<string, BudgetRow[]>; settings: BudgetSettings; now: Date; monthOffset: number;
  fired: AlertKind[]; sources: { claudeCode: boolean; openCode: boolean };
}): BudgetView;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import type { BudgetRow, BudgetSettings } from './budget';
import { budgetView } from './budgetView';

const row = (o: Partial<BudgetRow> = {}): BudgetRow => ({
  tool: 'claude-code', model: 'claude-opus-5-5', provider: 'anthropic', counted: true, inShellie: true, fast: false,
  requests: 1, costEur: 10, inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, ...o,
});
const settings = (o: Partial<BudgetSettings> = {}): BudgetSettings => ({
  monthlyEur: 500, monthStartDay: 1, alerts: { at80: true, forecastOver: true, at100: true }, ...o,
});
const sources = { claudeCode: true, openCode: true };
const view = (days: Record<string, BudgetRow[]>, o: { now?: Date; s?: BudgetSettings; fired?: ('at80' | 'forecastOver' | 'at100')[]; offset?: number } = {}) =>
  budgetView({ days, settings: o.s ?? settings(), now: o.now ?? new Date(2026, 9, 19, 12), monthOffset: o.offset ?? 0, fired: o.fired ?? [], sources });

describe('budgetView', () => {
  it('sums the month and forecasts from the daily pace', () => {
    const v = view({ '2026-10-01': [row({ costEur: 100 })], '2026-10-19': [row({ costEur: 90 })], '2026-09-30': [row({ costEur: 999 })] });
    expect(v.spentEur).toBe(190);
    expect(v.daysElapsed).toBe(19);
    expect(v.daysInMonth).toBe(31);
    expect(v.forecastEur).toBeCloseTo((190 / 19) * 31, 6);
    expect(v.status).toBe('onTrack');
    expect(v.cumulative.at(-1)).toEqual({ day: '2026-10-19', eur: 190 });
    expect(v.days).toHaveLength(31);
    expect(v.days[19].future).toBe(true);
    expect(v.days[18].today).toBe(true);
  });

  it('flags a forecast over budget, then over budget', () => {
    expect(view({ '2026-10-10': [row({ costEur: 400 })] }).status).toBe('paceOver');
    expect(view({ '2026-10-10': [row({ costEur: 501 })] }).status).toBe('over');
  });

  it('hides the forecast in the first three days and for past months', () => {
    expect(view({}, { now: new Date(2026, 9, 3, 12) }).forecastEur).toBeNull();
    expect(view({}, { now: new Date(2026, 9, 4, 12) }).forecastEur).not.toBeNull();
    expect(view({}, { offset: -1 }).forecastEur).toBeNull();
  });

  it('has status none without a budget, and no alerts', () => {
    const v = view({ '2026-10-10': [row({ costEur: 9999 })] }, { s: settings({ monthlyEur: null }) });
    expect(v.status).toBe('none');
    expect(v.alertsDue).toEqual([]);
  });

  it('respects a month starting on the 15th', () => {
    const v = view({ '2026-09-20': [row({ costEur: 5 })], '2026-10-14': [row({ costEur: 7 })], '2026-10-15': [row({ costEur: 100 })] },
      { now: new Date(2026, 9, 3, 12), s: settings({ monthStartDay: 15 }) });
    expect(v.startDay).toBe('2026-09-15');
    expect(v.endDay).toBe('2026-10-14');
    expect(v.spentEur).toBe(5);
  });

  it('splits models, today, the week and the outside share', () => {
    const v = view({
      '2026-10-13': [row({ costEur: 10 })], // Monday
      '2026-10-12': [row({ costEur: 1000, inShellie: false })], // Sunday, not this week
      '2026-10-19': [row({ costEur: 20, model: 'claude-sonnet-5-5', inShellie: false }), row({ costEur: 30 })],
    }, { s: settings({ monthlyEur: 5000 }) });
    expect(v.models.map((m) => [m.model, m.costEur])).toEqual([['claude-opus-5-5', 1040], ['claude-sonnet-5-5', 20]]);
    expect(v.todayEur).toBe(50);
    expect(v.weekEur).toBe(60);
    expect(v.outsideShare).toBeCloseTo(1020 / 1060, 6);
  });

  it('lists not-counted and unpriced usage apart from the totals', () => {
    const v = view({ '2026-10-19': [
      row({ counted: false, costEur: null, provider: 'github-copilot', model: 'claude-sonnet-4.6', requests: 59 }),
      row({ costEur: null, model: 'claude-mystery-9', requests: 2 }),
    ] });
    expect(v.spentEur).toBe(0);
    expect(v.notCounted).toEqual([{ model: 'claude-sonnet-4.6', provider: 'github-copilot', requests: 59, tokens: 100 }]);
    expect(v.unpriced).toEqual([{ model: 'claude-mystery-9', requests: 2, tokens: 100 }]);
  });

  it('makes alerts due once per month, forecast only when shown', () => {
    expect(view({ '2026-10-10': [row({ costEur: 410 })] }).alertsDue).toEqual(['at80', 'forecastOver']);
    expect(view({ '2026-10-10': [row({ costEur: 410 })] }, { fired: ['at80'] }).alertsDue).toEqual(['forecastOver']);
    expect(view({ '2026-10-10': [row({ costEur: 600 })] }).alertsDue).toEqual(['at80', 'forecastOver', 'at100']);
    expect(view({ '2026-10-02': [row({ costEur: 450 })] }, { now: new Date(2026, 9, 2, 12) }).alertsDue).toEqual(['at80']);
    expect(view({ '2026-10-10': [row({ costEur: 600 })] }, { s: settings({ alerts: { at80: false, forecastOver: true, at100: false } }) }).alertsDue).toEqual(['forecastOver']);
    expect(view({ '2026-09-10': [row({ costEur: 600 })] }, { offset: -1 }).alertsDue).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**: `npx vitest run src/shared/budgetView.test.ts`

- [ ] **Step 3: Implement** `src/shared/budgetView.ts`

```ts
import { type AlertKind, type BudgetRow, type BudgetSettings, budgetMonth, dayKey, tokensOf } from './budget';

export type ModelTotal = { model: string; costEur: number; tokens: number; requests: number };
export type BudgetDay = { day: string; future: boolean; today: boolean; costEur: number; byModel: { model: string; costEur: number; outsideEur: number; tokens: number }[] };
export type BudgetView = {
  monthOffset: number; startDay: string; endDay: string;
  budgetEur: number | null; spentEur: number; daysElapsed: number; daysInMonth: number;
  forecastEur: number | null; status: 'none' | 'onTrack' | 'paceOver' | 'over';
  cumulative: { day: string; eur: number }[]; days: BudgetDay[]; models: ModelTotal[];
  todayEur: number; weekEur: number; outsideShare: number;
  notCounted: { model: string; provider: string; requests: number; tokens: number }[];
  unpriced: { model: string; tokens: number; requests: number }[];
  sources: { claudeCode: boolean; openCode: boolean };
  alertsDue: AlertKind[];
};

const r2 = (n: number) => Math.round(n * 1e6) / 1e6;

export function budgetView(input: {
  days: Record<string, BudgetRow[]>; settings: BudgetSettings; now: Date; monthOffset: number;
  fired: AlertKind[]; sources: { claudeCode: boolean; openCode: boolean };
}): BudgetView {
  const { settings, now, monthOffset } = input;
  const month = budgetMonth(now, settings.monthStartDay, monthOffset);
  const today = dayKey(now);
  const current = monthOffset === 0;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const weekFrom = dayKey(weekStart);

  const models = new Map<string, ModelTotal>();
  const notCounted = new Map<string, { model: string; provider: string; requests: number; tokens: number }>();
  const unpriced = new Map<string, { model: string; tokens: number; requests: number }>();
  let spent = 0;
  let outside = 0;
  let running = 0;
  const cumulative: { day: string; eur: number }[] = [];
  const days: BudgetDay[] = month.days.map((day) => {
    const byModel = new Map<string, { model: string; costEur: number; outsideEur: number; tokens: number }>();
    let dayEur = 0;
    for (const row of input.days[day] ?? []) {
      const tokens = tokensOf(row);
      if (!row.counted) {
        const k = `${row.provider}|${row.model}`;
        const e = notCounted.get(k) ?? { model: row.model, provider: row.provider, requests: 0, tokens: 0 };
        e.requests += row.requests;
        e.tokens += tokens;
        notCounted.set(k, e);
        continue;
      }
      if (row.costEur === null) {
        const e = unpriced.get(row.model) ?? { model: row.model, tokens: 0, requests: 0 };
        e.tokens += tokens;
        e.requests += row.requests;
        unpriced.set(row.model, e);
        continue;
      }
      dayEur += row.costEur;
      if (!row.inShellie) outside += row.costEur;
      const m = byModel.get(row.model) ?? { model: row.model, costEur: 0, outsideEur: 0, tokens: 0 };
      m.costEur += row.costEur;
      if (!row.inShellie) m.outsideEur += row.costEur;
      m.tokens += tokens;
      byModel.set(row.model, m);
      const t = models.get(row.model) ?? { model: row.model, costEur: 0, tokens: 0, requests: 0 };
      t.costEur += row.costEur;
      t.tokens += tokens;
      t.requests += row.requests;
      models.set(row.model, t);
    }
    spent += dayEur;
    const future = current && day > today;
    if (!future) {
      running += dayEur;
      cumulative.push({ day, eur: r2(running) });
    }
    return { day, future, today: current && day === today, costEur: r2(dayEur), byModel: [...byModel.values()] };
  });

  const daysInMonth = month.days.length;
  const daysElapsed = current ? month.days.indexOf(today) + 1 : daysInMonth;
  const forecastEur = current && daysElapsed > 3 ? r2((spent / daysElapsed) * daysInMonth) : null;
  const budget = settings.monthlyEur;
  const status: BudgetView['status'] =
    budget === null ? 'none' : spent > budget ? 'over' : forecastEur !== null && forecastEur > budget ? 'paceOver' : 'onTrack';

  const alertsDue: AlertKind[] = [];
  if (budget !== null && current) {
    const due = (k: AlertKind, hit: boolean) => hit && settings.alerts[k] && !input.fired.includes(k) && alertsDue.push(k);
    due('at80', spent >= budget * 0.8);
    due('forecastOver', forecastEur !== null && forecastEur > budget);
    due('at100', spent >= budget);
  }

  const sumDays = (from: string) => r2(days.filter((d) => d.day >= from && d.day <= today).reduce((a, d) => a + d.costEur, 0));
  return {
    monthOffset, startDay: month.days[0], endDay: month.days.at(-1)!,
    budgetEur: budget, spentEur: r2(spent), daysElapsed, daysInMonth, forecastEur, status, cumulative, days,
    models: [...models.values()].map((m) => ({ ...m, costEur: r2(m.costEur) })).sort((a, b) => b.costEur - a.costEur),
    todayEur: current ? sumDays(today) : 0,
    weekEur: current ? sumDays(weekFrom) : 0,
    outsideShare: spent > 0 ? outside / spent : 0,
    notCounted: [...notCounted.values()], unpriced: [...unpriced.values()],
    sources: input.sources, alertsDue,
  };
}
```

Note: `weekEur` only sums days inside the budget month (the band shows the current budget month; a week that started in the previous budget month shows its part in this month). Document this in the ⓘ? No: keep it, it matches the bars shown.

Fix the test expectation if needed: in "splits models…", Sunday 12 Oct is not in the week (Monday 13 Oct start), so `weekEur` = 10 + 50 = 60. ✓

- [ ] **Step 4: Run, expect PASS**; `npm run typecheck`

- [ ] **Step 5: Commit**: `git add src/shared/budget.ts src/shared/budgetView* src/main/budget/BudgetStore.ts && git commit -m "feat(budget): view model with forecast and alerts"`

---

### Task 8: BudgetService, IPC and main wiring

**Files:**
- Create: `src/main/budget/BudgetService.ts`
- Test: `src/main/budget/BudgetService.test.ts`
- Modify: `src/shared/ipc.ts` (channel + events), `src/main/ipc/handlers.ts` (`Services.budget?`, handler), `src/main.ts` (construct, focus hook, notifications, open), `docs/telemetry.md`

**Interfaces:**
- Consumes: readers (Tasks 4-5), `BudgetStore` (Task 6), `budgetView` (Task 7), `isInside` (`src/main/paths.ts`), `taskWorkspaces` (`src/shared/workspaces.ts`).
- Produces:

```ts
// src/shared/ipc.ts
// Channels:
'budget:get': { args: [monthOffset: number]; result: BudgetView };
// Events:
'budget:changed': Record<string, never>;
'budget:open': Record<string, never>;

// src/main/budget/BudgetService.ts
export type BudgetServiceDeps = {
  store: BudgetStore;
  claude: { read: ClaudeTranscriptReader['read'] };
  openCode: { read: OpenCodeReader['read'] };
  settings: () => BudgetSettings;
  inShellie: (r: BudgetRecord) => boolean;
  now?: () => Date;
  changed: () => void;
  notify: (n: { title: string; body: string }) => void;
  telemetry?: (kind: AlertKind) => void;
};
export class BudgetService {
  constructor(d: BudgetServiceDeps);
  /** One pass; concurrent calls share the running one. */
  pass(): Promise<void>;
  view(monthOffset: number): BudgetView;
  start(intervalMs?: number): void; // default 30_000
  stop(): void;
}
export function inShellieFor(tasks: () => Task[]): (r: BudgetRecord) => boolean;
```

- [ ] **Step 1: Write the failing tests** `BudgetService.test.ts`

```ts
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BudgetRecord } from '../../shared/budget';
import { defaultBudgetSettings } from '../../shared/budget';
import type { Rate } from '../../shared/usage';
import { BudgetService, inShellieFor } from './BudgetService';
import { BudgetStore } from './BudgetStore';

const opus = { id: 'anthropic-opus-5-5', label: 'Opus', match: ['claude-opus-5-5'], minInputTokens: 0, fast: false, inputPerM: 4, cachedInputPerM: 0.2, cacheWritePerM: 5, cacheWrite1hPerM: 8, outputPerM: 20 } as Rate;
const rec = (id: string, eurMillions = 1): BudgetRecord => ({
  id, tool: 'claude-code', sessionId: 's', model: 'claude-opus-5-5', provider: 'anthropic',
  at: new Date(2026, 9, 10, 9).toISOString(), cwd: null, fast: false,
  inputTokens: eurMillions * 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0,
});

async function setup(records: BudgetRecord[], budget: number | null = 5) {
  const store = new BudgetStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'bsv-')), 'budget.json'), () => [opus]);
  await store.load();
  const notify = vi.fn();
  const changed = vi.fn();
  const claudeRead = vi.fn(async () => ({ records, cursors: {}, found: true }));
  const svc = new BudgetService({
    store, claude: { read: claudeRead }, openCode: { read: () => ({ records: [], cursor: 0, found: false }) },
    settings: () => ({ ...defaultBudgetSettings(), monthlyEur: budget }), inShellie: () => false,
    now: () => new Date(2026, 9, 19, 12), changed, notify,
  });
  return { svc, store, notify, changed, claudeRead };
}

describe('BudgetService', () => {
  it('runs one pass at a time', async () => {
    const { svc, claudeRead } = await setup([]);
    await Promise.all([svc.pass(), svc.pass()]);
    expect(claudeRead).toHaveBeenCalledTimes(1);
  });

  it('broadcasts only when something changed', async () => {
    const { svc, changed } = await setup([rec('cc:a')]);
    await svc.pass();
    await svc.pass();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('fires each alert once per month, also after a restart', async () => {
    const { svc, store, notify } = await setup([rec('cc:a', 2)], 4); // 2M input at $4 = $8 → ~€7.36 > €4
    await svc.pass();
    await svc.pass();
    expect(notify.mock.calls.map((c) => c[0].title)).toEqual([
      'Claude budget: 80% used', 'Claude budget: on pace to go over', 'Claude budget: used up',
    ]);
    expect(store.value.alerts['2026-10-01']).toEqual(['at80', 'forecastOver', 'at100']);
  });

  it('records sources and builds the view', async () => {
    const { svc } = await setup([rec('cc:a')]);
    await svc.pass();
    const v = svc.view(0);
    expect(v.sources).toEqual({ claudeCode: true, openCode: false });
    expect(v.spentEur).toBeGreaterThan(0);
  });
});

describe('inShellieFor', () => {
  const task = {
    id: 't', worktreePath: '/w/a', extraWorkspaces: [{ id: 'x', repoId: 'r2', worktreePath: '/w/b', dropped: false }],
    terminals: [{ id: '1', kind: 'claude', label: 'C', sessionId: 'S1' }], closedTerminals: [{ id: '2', kind: 'claude', label: 'C', sessionId: 'S2' }],
  } as never;
  const f = inShellieFor(() => [task]);
  const r = (o: Partial<BudgetRecord>) => ({ ...rec('x'), ...o });
  it('matches Claude Code by session id, open or closed tab', () => {
    expect(f(r({ sessionId: 'S1' }))).toBe(true);
    expect(f(r({ sessionId: 'S2' }))).toBe(true);
    expect(f(r({ sessionId: 'other' }))).toBe(false);
  });
  it('matches OpenCode by working directory inside any task worktree', () => {
    expect(f(r({ tool: 'opencode', cwd: '/w/b/src' }))).toBe(true);
    expect(f(r({ tool: 'opencode', cwd: '/elsewhere' }))).toBe(false);
  });
});
```

(Check `taskWorkspaces(task)` works on this partial task; if `homeView` needs more fields, add them to the literal: look at `homeView` in `src/shared/workspaces.ts`.)

- [ ] **Step 2: Run, expect FAIL**: `npx vitest run src/main/budget/BudgetService.test.ts`

- [ ] **Step 3: Implement** `src/main/budget/BudgetService.ts`

```ts
import type { AlertKind, BudgetRecord, BudgetSettings } from '../../shared/budget';
import { budgetMonth, dayKey } from '../../shared/budget';
import { type BudgetView, budgetView } from '../../shared/budgetView';
import type { Task } from '../../shared/types';
import { taskWorkspaces } from '../../shared/workspaces';
import { isInside } from '../paths';
import type { BudgetStore } from './BudgetStore';
import type { ClaudeTranscriptReader } from './claudeTranscripts';
import type { OpenCodeReader } from './openCode';

const ALERT_TEXT: Record<AlertKind, string> = {
  at80: 'Claude budget: 80% used',
  forecastOver: 'Claude budget: on pace to go over',
  at100: 'Claude budget: used up',
};

export type BudgetServiceDeps = {
  store: BudgetStore;
  claude: { read: ClaudeTranscriptReader['read'] };
  openCode: { read: OpenCodeReader['read'] };
  settings: () => BudgetSettings;
  inShellie: (r: BudgetRecord) => boolean;
  now?: () => Date;
  changed: () => void;
  notify: (n: { title: string; body: string }) => void;
  telemetry?: (kind: AlertKind) => void;
};

const eur = (n: number) => `€${n.toFixed(2)}`;

/** Reads Claude Code and OpenCode usage into the budget rollup, on a timer and on demand, and raises the budget alerts. */
export class BudgetService {
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly d: BudgetServiceDeps) {}

  private now() {
    return this.d.now?.() ?? new Date();
  }

  pass(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run() {
    const s = this.d.settings();
    const f = this.d.store.value;
    const claude = await this.d.claude.read(f.claudeCursors);
    let oc: { records: BudgetRecord[]; cursor: number; found: boolean };
    try {
      oc = this.d.openCode.read(f.openCodeCursor);
    } catch (err) {
      console.warn('[budget] OpenCode database not readable this pass', err);
      oc = { records: [], cursor: f.openCodeCursor, found: f.sources.openCode };
    }
    const changed = await this.d.store.apply({
      records: [...claude.records, ...oc.records], inShellie: this.d.inShellie, now: this.now(), monthStartDay: s.monthStartDay,
      claudeCursors: claude.cursors, openCodeCursor: oc.cursor, sources: { claudeCode: claude.found, openCode: oc.found },
    });
    const v = this.view(0);
    const monthKey = v.startDay;
    for (const kind of v.alertsDue) {
      await this.d.store.markAlert(monthKey, kind);
      this.d.notify({ title: ALERT_TEXT[kind], body: `${eur(v.spentEur)} of ${eur(v.budgetEur ?? 0)} spent${v.forecastEur !== null ? `, on pace for ${eur(v.forecastEur)}` : ''}.` });
      this.d.telemetry?.(kind);
    }
    if (changed) this.d.changed();
  }

  view(monthOffset: number): BudgetView {
    const s = this.d.settings();
    const f = this.d.store.value;
    const now = this.now();
    const monthKey = dayKey(budgetMonth(now, s.monthStartDay, monthOffset).start);
    return budgetView({ days: f.days, settings: s, now, monthOffset, fired: f.alerts[monthKey] ?? [], sources: f.sources });
  }

  start(intervalMs = 30_000) {
    void this.pass();
    this.timer ??= setInterval(() => void this.pass(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** In Shellie: a Claude Code session one of the tasks' Claude tabs ran, or OpenCode working inside a task's worktree. */
export function inShellieFor(tasks: () => Task[]): (r: BudgetRecord) => boolean {
  return (r) => {
    const all = tasks();
    if (r.tool === 'claude-code')
      return all.some((t) => [...t.terminals, ...t.closedTerminals].some((x) => x.sessionId === r.sessionId));
    const cwd = r.cwd;
    return !!cwd && all.some((t) => taskWorkspaces(t).some((w) => !!w.worktreePath && isInside(w.worktreePath, cwd)));
  };
}
```

Note: the store's `apply` reads cursors from `store.value` at pass start; that is safe because passes never overlap.

**IPC** (`src/shared/ipc.ts`): add the channel next to the home channels and the two events next to `'home:updated'`, importing `BudgetView` from `./budgetView`.

**Handlers** (`src/main/ipc/handlers.ts`): add `budget?: BudgetService` to `Services`; add the handler:

```ts
    'budget:get': async (monthOffset) => {
      if (!s.budget) throw new Error('Budget is not available');
      return s.budget.view(monthOffset);
    },
```

**main.ts** (after `usage`/`time` are loaded, around :417, and before `createHandlers`):

```ts
  const budgetStore = new BudgetStore(path.join(usageDir, 'budget.json'), () => OFFICIAL_RATES);
  await budgetStore.load();
  const budget = new BudgetService({
    store: budgetStore,
    claude: new ClaudeTranscriptReader(claudeProjectsDir(), {
      since: budgetMonth(new Date(), settings.get().claudeBudget.monthStartDay, -1).start.getTime(),
    }),
    openCode: new OpenCodeReader(openCodeDbPath()),
    settings: () => settings.get().claudeBudget,
    inShellie: inShellieFor(() => store.state.tasks),
    changed: () => broadcast('budget:changed', {}),
    notify: ({ title, body }) => {
      try {
        const n = new Notification({ title, body });
        n.on('click', () => {
          const w = mainWindow;
          if (!w || w.isDestroyed()) return;
          if (w.isMinimized()) w.restore();
          w.show();
          w.focus();
          broadcast('budget:open', {});
        });
        n.show();
      } catch (err) {
        console.error('[budget] could not show a notification', err);
      }
    },
    telemetry: (kind) => telemetry.event('budget.alert', { kind }),
  });
```

(Use the real variable names in `main.ts` for the telemetry client, task store and rates list; they are `telemetry`/`store`/`OFFICIAL_RATES` per the code map; verify with `grep -n "new UsageStore\|telemetry =\|const store" src/main.ts`.) Pass `budget` into `createHandlers({... budget })`. In `onWindowFocus` (around :634) add `if (focused) void budget.pass();`. Start it after the window has loaded: find the place where the window's `did-finish-load` or `ready-to-show` is handled and call `budget.start();` there; if none, call it right after `createWindow()` inside `setTimeout(() => budget.start(), 2000)`. On `before-quit`/`will-quit` (find the existing cleanup) call `budget.stop()`.

**Telemetry docs**: in `docs/telemetry.md` add rows: `budget.alert` (main; props `kind`: `at80` | `forecastOver` | `at100`), and `home.clicked` bands `budget-month`, `budget-settings`.

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/main/budget src/main/ipc && npm run typecheck`

- [ ] **Step 5: Commit**: `git add src/main/budget src/shared/ipc.ts src/main/ipc/handlers.ts src/main.ts docs/telemetry.md && git commit -m "feat(budget): service, IPC and wiring"`

---

### Task 9: Settings section

**Files:**
- Create: `src/renderer/components/BudgetSection.tsx`
- Test: `src/renderer/components/BudgetSection.test.tsx`
- Modify: `src/renderer/screens/SettingsScreen.tsx` (render `<BudgetSection />` after `<TimeSection />`, add an `id="claude-budget"` anchor)

**Interfaces:**
- Consumes: `saveSettings`, `tryInvoke`, `api` (`src/renderer/api.ts`), `useStore((s) => s.notify)`, `BudgetSettings`.
- Produces: `export function BudgetSection(): JSX.Element` rendered as `<section id="claude-budget" className="section">`.

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installFakeApi } from '../test-helpers/fakeApi';
import { BudgetSection } from './BudgetSection';

describe('BudgetSection', () => {
  it('saves a budget, start day and alert toggles', async () => {
    const { calls } = installFakeApi();
    render(<BudgetSection />);
    fireEvent.change(await screen.findByLabelText('Monthly budget (€)'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Month starts on day'), { target: { value: '15' } });
    fireEvent.click(screen.getByLabelText('Warn when the forecast goes over'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const saved = calls.filter((c) => c[0] === 'settings:save').at(-1)?.[1] as { claudeBudget: unknown };
      expect(saved.claudeBudget).toEqual({ monthlyEur: 500, monthStartDay: 15, alerts: { at80: true, forecastOver: false, at100: true } });
    });
  });

  it('clears the budget when the field is empty, and rejects bad input', async () => {
    const { calls } = installFakeApi();
    render(<BudgetSection />);
    fireEvent.change(await screen.findByLabelText('Month starts on day'), { target: { value: '31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Month start day must be 1 to 28.')).toBeTruthy();
    expect(calls.some((c) => c[0] === 'settings:save')).toBe(false);
  });
});
```

(Check how `installFakeApi` records calls — the shape of `calls` — in `src/renderer/test-helpers/fakeApi.ts`, and adapt the `calls.filter(...)` lines to it.)

- [ ] **Step 2: Run, expect FAIL**: `npx vitest run src/renderer/components/BudgetSection.test.tsx`

- [ ] **Step 3: Implement** `BudgetSection.tsx` (follow `TimeSection.tsx`'s draft/Save pattern and class names)

```tsx
import { useEffect, useState } from 'react';
import type { BudgetSettings } from '../../shared/budget';
import { api, saveSettings, tryInvoke } from '../api';
import { useStore } from '../store';

type Draft = { monthlyEur: string; monthStartDay: string; alerts: BudgetSettings['alerts'] };

export function BudgetSection() {
  const notify = useStore((s) => s.notify);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void tryInvoke(() => api().invoke('settings:get'), notify).then((s) => {
      if (!live || !s) return;
      const b = s.claudeBudget;
      setDraft({ monthlyEur: b.monthlyEur === null ? '' : String(b.monthlyEur), monthStartDay: String(b.monthStartDay), alerts: b.alerts });
    });
    return () => {
      live = false;
    };
  }, [notify]);

  const save = async () => {
    if (!draft) return;
    const raw = draft.monthlyEur.trim();
    const monthlyEur = raw === '' ? null : Number(raw);
    if (monthlyEur !== null && !(Number.isFinite(monthlyEur) && monthlyEur > 0)) return setError('The budget must be a positive amount, or empty for none.');
    const day = Number(draft.monthStartDay);
    if (!/^\d+$/.test(draft.monthStartDay) || day < 1 || day > 28) return setError('Month start day must be 1 to 28.');
    setError(null);
    const saved = await tryInvoke(() => saveSettings({ claudeBudget: { monthlyEur, monthStartDay: day, alerts: draft.alerts } }), notify);
    if (saved) notify('info', 'Settings saved');
  };

  const alert = (key: keyof Draft['alerts'], label: string) => (
    <label className="checkbox">
      <input type="checkbox" checked={draft?.alerts[key] ?? true} disabled={!draft}
        onChange={(e) => draft && setDraft({ ...draft, alerts: { ...draft.alerts, [key]: e.target.checked } })} />{' '}
      {label}
    </label>
  );

  return (
    <section id="claude-budget" className="section">
      <div className="section-head"><h2>Claude budget</h2></div>
      <p className="muted small">Your monthly Claude budget from your company. Home shows the spend of Claude Code and OpenCode (Anthropic) on this computer against it.</p>
      <div className="list">
        <div className="list-row">
          <label htmlFor="budget-eur">Monthly budget (€)</label>
          <input id="budget-eur" className="field mono" type="number" min={1} step="any" placeholder="No budget"
            value={draft?.monthlyEur ?? ''} disabled={!draft} onChange={(e) => draft && setDraft({ ...draft, monthlyEur: e.target.value })} />
        </div>
        <div className="list-row">
          <label htmlFor="budget-day">Month starts on day</label>
          <input id="budget-day" className="field mono" type="number" min={1} max={28}
            value={draft?.monthStartDay ?? '1'} disabled={!draft} onChange={(e) => draft && setDraft({ ...draft, monthStartDay: e.target.value })} />
        </div>
        <div className="list-row">{alert('at80', 'Warn at 80% of the budget')}</div>
        <div className="list-row">{alert('forecastOver', 'Warn when the forecast goes over')}</div>
        <div className="list-row">{alert('at100', 'Warn when the budget is used up')}</div>
      </div>
      {error && <p className="error small">{error}</p>}
      <button type="button" className="btn primary" disabled={!draft} onClick={() => void save()}>Save</button>
    </section>
  );
}
```

(Match class names to `TimeSection.tsx` — e.g. its error and button classes — instead of the guesses `error small` / `btn primary` if they differ.)

- [ ] **Step 4: Run, expect PASS**: `npx vitest run src/renderer/components/BudgetSection.test.tsx src/renderer/screens/SettingsScreen.test.tsx && npm run typecheck`

- [ ] **Step 5: Commit**: `git add src/renderer/components/BudgetSection* src/renderer/screens/SettingsScreen.tsx && git commit -m "feat(budget): Claude budget settings section"`

---

### Task 10: Home band

**Files:**
- Create: `src/renderer/hooks/useBudget.ts`, `src/renderer/components/home/BudgetBand.tsx`
- Test: `src/renderer/components/home/BudgetBand.test.tsx`
- Modify: `src/renderer/screens/HomeScreen.tsx` (render `<BudgetBand />` right after `<StatsBand />`), `src/renderer/styles/home.css`, `src/renderer/styles/tokens.css`, `src/renderer/test-helpers/fakeApi.ts` (default `budget:get`), `src/renderer/App.tsx` or the hook file used for app-wide events (handle `budget:open`)

**Interfaces:**
- Consumes: `budget:get`, `budget:changed`, `budget:open` (Task 8), `BudgetView` (Task 7), `Band`, `eur`, `compact`, `track`, `useStore` `go`.
- Produces: `useBudget(monthOffset: number): BudgetView | null`; `BudgetBand()`; `modelColor(model: string): string` (CSS var name) exported from `BudgetBand.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BudgetView } from '../../../shared/budgetView';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { BudgetBand, modelColor } from './BudgetBand';

const view = (o: Partial<BudgetView> = {}): BudgetView => ({
  monthOffset: 0, startDay: '2026-10-01', endDay: '2026-10-31', budgetEur: 500, spentEur: 312, daysElapsed: 19, daysInMonth: 31,
  forecastEur: 470, status: 'onTrack', cumulative: [{ day: '2026-10-01', eur: 12 }], days: [],
  models: [{ model: 'claude-opus-5-5', costEur: 241, tokens: 1_000_000, requests: 10 }],
  todayEur: 14, weekEur: 71, outsideShare: 0.38, notCounted: [], unpriced: [], sources: { claudeCode: true, openCode: true }, alertsDue: [], ...o,
});

describe('BudgetBand', () => {
  it('shows spend of budget and an on-track forecast', async () => {
    installFakeApi({ 'budget:get': () => view() });
    render(<BudgetBand />);
    expect(await screen.findByText('€312.00')).toBeTruthy();
    expect(screen.getByText('of €500.00')).toBeTruthy();
    expect(screen.getByText('On track: about €470.00 by Oct 31')).toBeTruthy();
    expect(screen.getByText('Today €14.00 · This week €71.00 · 38% outside Shellie')).toBeTruthy();
  });

  it('warns when the pace or the spend goes over', async () => {
    installFakeApi({ 'budget:get': () => view({ status: 'paceOver', forecastEur: 510 }) });
    render(<BudgetBand />);
    expect(await screen.findByText('On pace for €510.00, €10.00 over')).toBeTruthy();
  });

  it('shows over budget', async () => {
    installFakeApi({ 'budget:get': () => view({ status: 'over', spentEur: 530, forecastEur: 800 }) });
    render(<BudgetBand />);
    expect(await screen.findByText('Over budget by €30.00')).toBeTruthy();
  });

  it('offers to set a budget when there is none', async () => {
    installFakeApi({ 'budget:get': () => view({ budgetEur: null, status: 'none' }) });
    render(<BudgetBand />);
    expect(await screen.findByText('€312.00 this month')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set a monthly budget' })).toBeTruthy();
  });

  it('lists not-counted and unpriced usage', async () => {
    installFakeApi({ 'budget:get': () => view({
      notCounted: [{ model: 'claude-sonnet-4.6', provider: 'github-copilot', requests: 59, tokens: 700_000 }],
      unpriced: [{ model: 'claude-mystery-9', tokens: 2_000, requests: 2 }],
    }) });
    render(<BudgetBand />);
    expect(await screen.findByText('Not counted: claude-sonnet-4.6 via github-copilot, 59 requests')).toBeTruthy();
    expect(screen.getByText('Unpriced: claude-mystery-9, 2k tokens')).toBeTruthy();
  });

  it('says when neither tool was found', async () => {
    installFakeApi({ 'budget:get': () => view({ sources: { claudeCode: false, openCode: false }, spentEur: 0, models: [] }) });
    render(<BudgetBand />);
    expect(await screen.findByText('No Claude Code or OpenCode usage found on this computer.')).toBeTruthy();
  });

  it('steps to the previous month and tracks it', async () => {
    const { calls, tracked } = installFakeApi({ 'budget:get': (offset) => view({ monthOffset: offset }) });
    render(<BudgetBand />);
    fireEvent.click(await screen.findByRole('button', { name: 'Previous month' }));
    expect(await screen.findByRole('button', { name: 'Next month' })).toBeTruthy();
    expect(calls.some((c) => c[0] === 'budget:get' && c[1] === -1)).toBe(true);
    expect(tracked.some((t) => t.name === 'home.clicked' && t.props?.band === 'budget-month')).toBe(true);
  });

  it('refetches on budget:changed', async () => {
    let spent = 1;
    const { emit } = installFakeApi({ 'budget:get': () => view({ spentEur: spent }) });
    render(<BudgetBand />);
    expect(await screen.findByText('€1.00')).toBeTruthy();
    spent = 2;
    emit('budget:changed', {});
    expect(await screen.findByText('€2.00')).toBeTruthy();
  });
});

describe('modelColor', () => {
  it('colours by model family', () => {
    expect(modelColor('claude-opus-5-5')).toBe('var(--chart-opus)');
    expect(modelColor('claude-sonnet-4.6')).toBe('var(--chart-sonnet)');
    expect(modelColor('claude-haiku-5-5')).toBe('var(--chart-haiku)');
    expect(modelColor('claude-fable-5-1')).toBe('var(--chart-fable)');
    expect(modelColor('x')).toBe('var(--line-strong)');
  });
});
```

(Adapt `calls`/`tracked`/`emit` usage to `installFakeApi`'s real return shape.)

- [ ] **Step 2: Run, expect FAIL**: `npx vitest run src/renderer/components/home/BudgetBand.test.tsx`

- [ ] **Step 3: Implement**

`src/renderer/hooks/useBudget.ts`:

```ts
import { useEffect, useState } from 'react';
import type { BudgetView } from '../../shared/budgetView';
import { api } from '../api';

export function useBudget(monthOffset: number): BudgetView | null {
  const [view, setView] = useState<BudgetView | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => api().invoke('budget:get', monthOffset).then((v) => live && setView(v)).catch(() => undefined);
    void load();
    const off = api().on('budget:changed', () => void load());
    return () => {
      live = false;
      off();
    };
  }, [monthOffset]);
  return view;
}
```

Settings changes reach the band through `budget:changed`: in `handlers.ts` `'settings:save'`, after saving, call `void s.budget?.pass()` and `s.broadcast('budget:changed', {})` (add this in the handler, then cover it with one assertion in `src/main/ipc/handlers.test.ts` if that file has a settings:save test to extend).

`tokens.css`, under the existing chart tokens:

```css
  /* Claude budget: one colour per model family. */
  --chart-opus: #2b88d8;
  --chart-sonnet: #6cb8f6;
  --chart-haiku: #b4d6fa;
  --chart-fable: #a083e0;
```

`BudgetBand.tsx`:

```tsx
import { useState } from 'react';
import type { BudgetView } from '../../../shared/budgetView';
import { compact, eur } from '../../format';
import { useBudget } from '../../hooks/useBudget';
import { useStore } from '../../store';
import { track } from '../../telemetry';
import { Band } from './Band';

const INFO = "Estimated at Anthropic API list prices in EUR. Your company's invoice may differ. Claude models through Copilot aren't counted.";

export function modelColor(model: string): string {
  for (const f of ['opus', 'sonnet', 'haiku', 'fable'] as const) if (model.includes(f)) return `var(--chart-${f})`;
  return 'var(--line-strong)';
}
const shortDate = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function Status({ v }: { v: BudgetView }) {
  if (v.status === 'over' && v.budgetEur !== null) return <span className="budget-status is-over">Over budget by {eur(v.spentEur - v.budgetEur)}</span>;
  if (v.status === 'paceOver' && v.forecastEur !== null && v.budgetEur !== null)
    return <span className="budget-status is-over">On pace for {eur(v.forecastEur)}, {eur(v.forecastEur - v.budgetEur)} over</span>;
  if (v.forecastEur !== null) return <span className="budget-status">On track: about {eur(v.forecastEur)} by {shortDate(v.endDay)}</span>;
  return null;
}

const W = 600;
function BurnDown({ v }: { v: BudgetView }) {
  const n = v.daysInMonth;
  const top = Math.max(v.budgetEur ?? 0, v.forecastEur ?? 0, v.spentEur, 1) * 1.05;
  const x = (i: number) => (W * i) / Math.max(1, n - 1);
  const y = (eurValue: number) => 90 - (85 * eurValue) / top;
  const line = v.cumulative.map((p, i) => `${x(i)},${y(p.eur)}`).join(' ');
  const last = v.cumulative.length - 1;
  return (
    <svg role="img" aria-label="Spend this month against the budget" viewBox={`0 0 ${W} 92`} preserveAspectRatio="none" className="budget-burn">
      {v.budgetEur !== null && (
        <>
          <line x1={0} y1={y(v.budgetEur)} x2={W} y2={y(v.budgetEur)} className="budget-limit" />
          <line x1={0} y1={y(0)} x2={W} y2={y(v.budgetEur)} className="budget-pace" />
        </>
      )}
      <polyline points={line} className="budget-line">
        <title>{v.cumulative.map((p) => `${shortDate(p.day)}: ${eur(p.eur)}`).join('\n')}</title>
      </polyline>
      {v.forecastEur !== null && last >= 0 && (
        <line x1={x(last)} y1={y(v.cumulative[last].eur)} x2={W} y2={y(v.forecastEur)} className="budget-forecast" />
      )}
    </svg>
  );
}

function DailyBars({ v }: { v: BudgetView }) {
  const max = Math.max(...v.days.map((d) => d.costEur), 0.01);
  const bw = W / Math.max(1, v.days.length);
  return (
    <svg role="img" aria-label="Spend per day by model" viewBox={`0 0 ${W} 60`} preserveAspectRatio="none" className="budget-bars">
      <defs>
        <pattern id="budget-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="2" height="4" fill="var(--bg-card)" opacity="0.6" />
        </pattern>
      </defs>
      {v.days.map((d, i) => {
        let yTop = 60;
        return (
          <g key={d.day} data-part="day" className={d.today ? 'is-today' : undefined}>
            <title>{`${shortDate(d.day)}: ${eur(d.costEur)}${d.byModel.map((m) => `\n${m.model} ${eur(m.costEur)} · ${compact(m.tokens)} tokens`).join('')}`}</title>
            {d.byModel.map((m) => {
              const h = (58 * m.costEur) / max;
              yTop -= h;
              const hOut = (58 * m.outsideEur) / max;
              return (
                <g key={m.model}>
                  <rect x={i * bw + 1} y={yTop} width={bw - 2} height={h} fill={modelColor(m.model)} />
                  {hOut > 0 && <rect x={i * bw + 1} y={yTop} width={bw - 2} height={hOut} fill="url(#budget-hatch)" />}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

export function BudgetBand() {
  const [offset, setOffset] = useState(0);
  const v = useBudget(offset);
  const go = useStore((s) => s.go);
  const step = (d: number) => {
    track('home.clicked', { band: 'budget-month' });
    setOffset((o) => Math.min(0, o + d));
  };
  return (
    <Band title="Claude budget">
      {v && (
        <div className="budget">
          <div className="budget-head">
            <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => step(-1)}>‹</button>
            <span className="muted small">{shortDate(v.startDay)} – {shortDate(v.endDay)}</span>
            {offset < 0 && <button type="button" className="icon-btn" aria-label="Next month" onClick={() => step(1)}>›</button>}
          </div>
          {!v.sources.claudeCode && !v.sources.openCode ? (
            <p className="muted">No Claude Code or OpenCode usage found on this computer.</p>
          ) : (
            <>
              <div className="budget-total">
                {v.budgetEur === null ? (
                  <>
                    <b>{eur(v.spentEur)} this month</b>
                    <button type="button" className="link" onClick={() => { track('home.clicked', { band: 'budget-settings' }); go({ kind: 'settings' }); }}>
                      Set a monthly budget
                    </button>
                  </>
                ) : (
                  <>
                    <b>{eur(v.spentEur)}</b> <span className="muted">of {eur(v.budgetEur)}</span>
                  </>
                )}
                <span className="budget-info" title={INFO} aria-label={INFO}>ⓘ</span>
                <Status v={v} />
              </div>
              <BurnDown v={v} />
              <DailyBars v={v} />
              <ul className="budget-models">
                {v.models.map((m) => (
                  <li key={m.model}><i style={{ background: modelColor(m.model) }} /> {m.model} {eur(m.costEur)}</li>
                ))}
              </ul>
              {offset === 0 && (
                <p className="muted small">{`Today ${eur(v.todayEur)} · This week ${eur(v.weekEur)} · ${Math.round(v.outsideShare * 100)}% outside Shellie`}</p>
              )}
              {v.notCounted.map((x) => (
                <p key={`${x.provider}|${x.model}`} className="muted small">{`Not counted: ${x.model} via ${x.provider}, ${x.requests} requests`}</p>
              ))}
              {v.unpriced.map((x) => (
                <p key={x.model} className="muted small">{`Unpriced: ${x.model}, ${compact(x.tokens)} tokens`}</p>
              ))}
            </>
          )}
        </div>
      )}
    </Band>
  );
}
```

(`go({ kind: 'settings' })` opens Settings; if the Settings screen supports scrolling to an anchor, pass `claude-budget`; check the `Screen` union in `store.ts`. Check `compact(2000)` returns `2k`; adjust the test text if its format differs.)

`home.css`:

```css
.budget-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.budget-total { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.budget-total b { font-size: 20px; }
.budget-status { margin-left: auto; color: var(--text-muted); }
.budget-status.is-over { color: var(--red); }
.budget-info { cursor: help; color: var(--text-muted); }
.budget-burn { width: 100%; height: 92px; margin-top: 8px; }
.budget-bars { width: 100%; height: 60px; margin-top: 6px; }
.budget-limit { stroke: var(--red); stroke-dasharray: 4 3; }
.budget-pace { stroke: var(--line-strong); opacity: 0.5; }
.budget-line { fill: none; stroke: var(--chart-claude); stroke-width: 2; vector-effect: non-scaling-stroke; }
.budget-forecast { stroke: var(--chart-claude); stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
.budget-bars .is-today rect { opacity: 0.6; }
.budget-models { display: flex; flex-wrap: wrap; gap: 12px; list-style: none; padding: 0; margin: 8px 0 4px; }
.budget-models i { display: inline-block; width: 8px; height: 8px; margin-right: 4px; }
```

(Use the real variable names from `tokens.css` for muted text and lines: check `grep -n "\-\-text\|--line" src/renderer/styles/tokens.css`.)

`fakeApi.ts` defaults: add `'budget:get': () => ({ ...a minimal BudgetView with sources both false })` so other Home tests keep passing.

`budget:open`: where `attention:open` is handled (`src/renderer/hooks/useAttention.ts`), add a listener `api().on('budget:open', () => useStore.getState().go({ kind: 'home' }))`.

- [ ] **Step 4: Run, expect PASS**: `npx vitest run src/renderer && npm run typecheck && npm run lint`

- [ ] **Step 5: Commit**: `git add src/renderer && git commit -m "feat(budget): Claude budget band on Home"`

---

### Task 11: Real-data check, packaged check, docs

**Files:**
- Create: `tools/budget-check.mjs`
- Modify: `CLAUDE.md` (status paragraph), `docs/windows-checklist.md` (one item)

- [ ] **Step 1: Write the independent check script** `tools/budget-check.mjs`: sums one day's Claude Code tokens per model straight from `~/.claude/projects` (dedupe by `message.id`), independent of Shellie's code:

```js
// Usage: node tools/budget-check.mjs 2026-10-19
import { readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const day = process.argv[2];
const root = path.join(os.homedir(), '.claude', 'projects');
const seen = new Set();
const totals = {};
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.jsonl') && statSync(p).mtimeMs > Date.parse(day) - 864e5) {
      for (const l of readFileSync(p, 'utf8').split('\n')) {
        if (!l.includes('"usage"')) continue;
        let o; try { o = JSON.parse(l); } catch { continue; }
        const m = o.message;
        if (o.type !== 'assistant' || !m?.usage || seen.has(m.id) || m.model === '<synthetic>') continue;
        const t = new Date(o.timestamp);
        const local = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        if (local !== day) continue;
        seen.add(m.id);
        const u = m.usage;
        const x = (totals[m.model] ??= { requests: 0, input: 0, output: 0 });
        x.requests++; x.input += u.input_tokens ?? 0; x.output += u.output_tokens ?? 0;
      }
    }
  }
};
walk(root);
console.log(JSON.stringify(totals, null, 2));
```

- [ ] **Step 2: Run the app in dev against real data and compare**

Run: `npm start` (in the worktree; see the `run` skill / `CLAUDE.md` for the dev command). After the first pass, compare `budget.json` (`~/Library/Application Support/Shellie/usage/budget.json` — confirm the dev userData folder name) rows for today with `node tools/budget-check.mjs <today>`: requests and input/output tokens per model must match for `tool: 'claude-code'`. Record the numbers in the PR description.

- [ ] **Step 3: Packaged functional check** (user preference: real click-through checks with asserted results)

Build (`npm run make` or the repo's package command), launch the packaged app, and assert by reading the screen (screenshots plus DOM or accessibility text):
1. Home shows the Claude budget band with `€X this month` and "Set a monthly budget".
2. Settings → Claude budget: set 1 (€1), Save. Back on Home: header `€X of €1.00`, status "Over budget by …"; a system notification "Claude budget: used up" appeared once (and 80% / forecast ones); relaunch → no repeat.
3. ‹ shows last month's range; › returns.
4. Hover a daily bar shows that day's models.
5. Set the budget back to empty.

- [ ] **Step 4: Docs**

`CLAUDE.md` status list: add one paragraph after the attention notifications/latest entry, in the file's style:

> Claude budget (spec `docs/superpowers/specs/2026-10-19-claude-budget-design.md`) implemented 2026-10-19 on `feature/claude-budget`: a "Claude budget" band on Home under Stats shows this budget month's Claude spend against `claudeBudget.monthlyEur` (Settings > Claude budget; month start day 1-28), with a forecast (from day 4), a burn-down, daily bars stacked by model (outside-Shellie part hatched) and per-model totals; ‹ › step through earlier months. Data comes from every Claude Code transcript on the machine (`~/.claude/projects`, `CLAUDE_CONFIG_DIR` honoured, deduped by message id, 5m/1h cache writes priced apart) and OpenCode's `opencode.db` (read-only `node:sqlite`; only `providerID` `anthropic` counts, Claude through other providers is listed as not counted), rolled up in `<userData>/usage/budget.json` by `src/main/budget/` (pass at launch, every 30 s and on focus). Alerts at 80%, forecast over and 100%, once per budget month. Known gaps: list prices, not the company invoice; other machines and claude.ai are not counted; OpenCode cache writes priced as 5-minute; Windows paths verified by CI only.

`docs/windows-checklist.md`: add "Claude budget: Home band shows Claude Code usage from `%USERPROFILE%\.claude\projects` and OpenCode from `%USERPROFILE%\.local\share\opencode\opencode.db`."

- [ ] **Step 5: Final verification and commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

```bash
git add tools/budget-check.mjs CLAUDE.md docs/windows-checklist.md
git commit -m "docs: Claude budget status and real-data check"
```
