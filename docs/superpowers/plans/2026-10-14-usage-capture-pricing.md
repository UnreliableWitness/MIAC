# MIAC AI Usage Capture and Pricing (sub-project 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture token usage from Claude Code and Copilot CLI running in a task's terminals, price each request in USD from a rate table seeded with official prices, show EUR totals per task, and write the totals to the work item (custom fields when present, one comment on finish).

**Architecture:** Every task pty gets telemetry env vars. Claude Code posts OTLP/HTTP JSON log events to a `UsageReceiver` on `127.0.0.1:4319`; Copilot CLI writes JSON lines to a per-task file that a `CopilotFileTailer` reads. Both produce `UsageEvent`s that the `UsageStore` prices (via `RateTable`), dedupes by id and appends to monthly JSON-lines files. `UsageSync` writes totals to Azure DevOps through new `AdoClient` write methods. The renderer gets a Usage screen, a live cost tile, a Finish block and a Settings section.

**Tech Stack:** Existing (Electron 44, React 19, zustand, zod 4, Vitest 5). No new dependencies: `node:http` for the receiver, `node:fs` for storage.

**Spec:** `docs/superpowers/specs/2026-10-14-usage-capture-pricing-design.md`

## Global Constraints

- Receiver binds `127.0.0.1` only, default port 4319, `application/json` only (415 otherwise), body limit 5 MB (413). Events without `miac.task.id` are ignored.
- Telemetry env for every task pty: `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_LOGS_EXPORTER=otlp`, `OTEL_METRICS_EXPORTER=none`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://127.0.0.1:<port>/v1/logs`, `OTEL_LOGS_EXPORT_INTERVAL=2000`, `OTEL_RESOURCE_ATTRIBUTES=miac.task.id=<taskId>`, `COPILOT_OTEL_FILE_EXPORTER_PATH=<usageDir>/copilot/<taskId>.jsonl`. Prompt/content capture stays off (never set `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`).
- Each request is priced once at ingestion and stores a copy of the rate used; later rate edits never reprice history. Unknown model -> `costUsd: null` ("unpriced"), never 0.
- Cost USD = `(input*inputPerM + cacheRead*cachedInputPerM + cacheWrite*cacheWritePerM + output*outputPerM) / 1e6`, rounded to 6 decimals. Tier = highest `minInputTokens` <= input+cacheRead+cacheWrite among rows matching the normalised model and fast flag. EUR = USD * usdToEur * (1 + markupPct/100); work item amounts rounded to 2 decimals.
- Records are deduped by id (Claude `request_id`, Copilot `traceId:spanId`). Usage files are append-only JSON lines `records-YYYY-MM.jsonl`; damaged lines are skipped and counted, never a crash.
- Work item fields `Custom.AICost`, `Custom.AICostClaude`, `Custom.AICostCopilot` (decimal EUR), `Custom.AITokens` (integer); only fields present on the type are written. The usage comment is posted at most once per task (stored comment id). Sync failures never block finishing. Only totals and model names leave the machine.
- Core services must not import electron. Pure ASCII sources (`String.fromCharCode` / JSX entities for glyphs; the euro sign is `String.fromCharCode(0x20ac)` or `&euro;`). Run `npm run lint:fix` before commits. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The Copilot CLI path is built from documentation with synthetic fixtures (file names contain `synthetic`); it cannot be run live (no licence).

## Review Focus

1. **OTLP JSON integer encoding**: OTLP JSON encodes int64 as strings (`"intValue": "1234"`); token counts must parse from string or number. Pinned in Task 4.
2. **The same request delivered twice** (Claude Code retries a failed export; the tailer re-reads after restart): counted once. Pinned in Task 3 (store) and Task 4 (tailer offset).
3. **A model string not in the rate table** (new model, Copilot naming like `claude-sonnet-4.6`): normalised where possible, otherwise stored unpriced and visible as such. Pinned in Task 2.
4. **Port 4319 already in use**: receiver reports an error status, app keeps working. Pinned in Task 4.
5. **Finishing a task when Azure DevOps rejects the write**: the task still finishes; the error is stored and retryable. Pinned in Task 6.

---

### Task 1: Spike: record real Claude Code telemetry as fixtures

**Files:**
- Create: `tools/telemetry/record-otlp.mjs`, `src/main/usage/__fixtures__/claude/README.md`, `src/main/usage/__fixtures__/claude/*.json` (recorded)

**Interfaces:**
- Produces: recorded OTLP/HTTP JSON request bodies from a real `claude -p` run, used as test fixtures by Task 4.

- [ ] **Step 1: Write the recorder**

`tools/telemetry/record-otlp.mjs`:
```js
#!/usr/bin/env node
// node tools/telemetry/record-otlp.mjs <outDir> [port]
// Listens on 127.0.0.1:<port> (default 4399) and writes every POST body to <outDir>/<n>-<path>.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const [outDir, portArg] = process.argv.slice(2);
if (!outDir) { console.error('Usage: record-otlp.mjs <outDir> [port]'); process.exit(64); }
mkdirSync(outDir, { recursive: true });
const port = Number(portArg || 4399);
let n = 0;
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const name = `${String(++n).padStart(3, '0')}-${(req.url || '/').replace(/[^a-z0-9]+/gi, '_')}.json`;
    writeFileSync(path.join(outDir, name), body);
    console.log(`${req.method} ${req.url} ${req.headers['content-type']} ${body.length}B -> ${name}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
}).listen(port, '127.0.0.1', () => console.log(`recording on http://127.0.0.1:${port}`));
```

- [ ] **Step 2: Record one real run (approved by the owner; a few cents)**

In one terminal:
```bash
node tools/telemetry/record-otlp.mjs /tmp/miac-otlp 4399
```
In another, from an empty temp directory:
```bash
cd "$(mktemp -d)" && CLAUDE_CODE_ENABLE_TELEMETRY=1 OTEL_LOGS_EXPORTER=otlp OTEL_METRICS_EXPORTER=otlp \
  OTEL_EXPORTER_OTLP_PROTOCOL=http/json OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4399 \
  OTEL_LOGS_EXPORT_INTERVAL=1000 OTEL_METRIC_EXPORT_INTERVAL=1000 \
  OTEL_RESOURCE_ATTRIBUTES=miac.task.id=00000000-0000-4000-8000-000000000001 \
  claude -p "Reply with the single word OK"
```
Wait ~5 s after it exits, then stop the recorder. Expected: at least one `/v1/logs` body containing `claude_code.api_request`, and `/v1/metrics` bodies.

- [ ] **Step 3: Keep the fixtures**

Copy the logs bodies that contain `claude_code.api_request` and one metrics body into `src/main/usage/__fixtures__/claude/` as `api-request-logs.json` (and `api-request-logs-2.json` if there are more) and `metrics.json`. Inspect them for anything sensitive: they must not contain prompt text (it is redacted by default) and must not contain an email or account id you do not want committed; if `user.email`, `user.account_uuid` or `organization.id` attributes are present, replace their values with `redacted` (keep the keys). Write `README.md` in that folder recording: the Claude Code version (`claude --version`), date, the exact env used, the event name location (log body vs `event.name` attribute), how integers are encoded (`intValue` string or number), where `miac.task.id` appears (resource attributes or log record attributes), and the exact attribute keys seen on `claude_code.api_request`.

- [ ] **Step 4: Commit**

```bash
git add tools/telemetry src/main/usage/__fixtures__/claude
git commit -m "chore: record real Claude Code OTLP fixtures for usage parsing"
```

---

### Task 2: Shared usage types, settings schema, pricing and official rates

**Files:**
- Modify: `src/shared/types.ts` (Task fields, terminal kind, FinishOptions), `src/shared/ipc.ts` (channels, events)
- Create: `src/shared/usage.ts`, `src/main/pricing/officialRates.ts`, `src/main/pricing/RateTable.ts`
- Test: `src/main/pricing/RateTable.test.ts`, `src/shared/types.test.ts` (one test)

**Interfaces:**
- Produces (in `src/shared/usage.ts`): `UsageTool`, `UsageEvent`, `UsageRecord`, `RateSnapshot`, `Rate`, `RateSchema`, `RatesFileSchema`, `AppSettings`, `AppSettingsSchema`, `defaultSettings()`, `SessionSummary`, `TaskUsage`, `ReceiverStatus`, `FieldsStatus`, `SyncResult`. In `RateTable.ts`: `normalizeModel(model)`, `selectRate(rates, model, totalInput, fast)`, `priceEvent(rates, event): { costUsd, rateId, rate }`, `round6(n)`. In `officialRates.ts`: `OFFICIAL_RATES: Rate[]`, `OFFICIAL_RATES_AS_OF = '2026-10-14'`.
- `TerminalDefSchema.kind` gains `'copilot'`. `TaskSchema` gains `usageSyncedAt`, `usageSyncError`, `usageCommentId` (nullable with zod default null). `FinishOptions` gains `syncUsage: boolean`.

- [ ] **Step 1: Write the failing tests**

`src/main/pricing/RateTable.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Rate, UsageEvent } from '../../shared/usage';
import { OFFICIAL_RATES } from './officialRates';
import { normalizeModel, priceEvent, round6, selectRate } from './RateTable';

const ev = (over: Partial<UsageEvent> = {}): UsageEvent => ({
  id: 'r1', taskId: 't1', tool: 'claude-code', sessionId: 's1', model: 'claude-opus-5-5', at: '2026-10-14T10:00:00.000Z',
  inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10000, cacheWriteTokens: 2000, fast: false, ...over,
});

describe('normalizeModel', () => {
  it('maps provider prefixes, dotted versions and date suffixes', () => {
    expect(normalizeModel('claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(normalizeModel('Claude-Sonnet-4.6')).toBe('claude-sonnet-4-6');
    expect(normalizeModel('anthropic.claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    expect(normalizeModel('openai/gpt-5.5')).toBe('gpt-5-5');
    expect(normalizeModel('  gpt-5.4-mini ')).toBe('gpt-5-4-mini');
  });
});

describe('selectRate', () => {
  it('picks the default tier below the threshold and the long-context tier above it', () => {
    expect(selectRate(OFFICIAL_RATES, 'claude-haiku-5-5', 99_999, false)?.inputPerM).toBe(0.1);
    expect(selectRate(OFFICIAL_RATES, 'claude-haiku-5-5', 100_000, false)?.inputPerM).toBe(0.5);
    expect(selectRate(OFFICIAL_RATES, 'gpt-5.5', 300_000, false)?.inputPerM).toBe(10);
  });
  it('uses fast rows only for fast requests', () => {
    expect(selectRate(OFFICIAL_RATES, 'claude-opus-5-5', 10, true)?.inputPerM).toBe(8);
    expect(selectRate(OFFICIAL_RATES, 'claude-opus-5-5', 10, false)?.inputPerM).toBe(4);
  });
  it('returns null for unknown models', () => {
    expect(selectRate(OFFICIAL_RATES, 'some-new-model', 10, false)).toBeNull();
  });
});

describe('priceEvent', () => {
  it('prices all four token kinds and snapshots the rate', () => {
    const p = priceEvent(OFFICIAL_RATES, ev());
    // opus 5.5: 1000*4 + 10000*0.2 + 2000*5 + 500*20 = 4000+2000+10000+10000 = 26000 per 1e6
    expect(p.costUsd).toBe(0.026);
    expect(p.rate).toMatchObject({ inputPerM: 4, cachedInputPerM: 0.2, cacheWritePerM: 5, outputPerM: 20 });
    expect(p.rateId).toBeTruthy();
  });
  it('leaves unknown models unpriced', () => {
    expect(priceEvent(OFFICIAL_RATES, ev({ model: 'mystery-1' }))).toEqual({ costUsd: null, rateId: null, rate: null });
  });
  it('rounds to 6 decimals', () => {
    expect(round6(0.1234567)).toBe(0.123457);
  });
  it('prices a Copilot model by its normalised name', () => {
    const rates: Rate[] = [{ id: 'x', label: 'GPT-5.5', match: ['gpt-5-5'], minInputTokens: 0, fast: false, inputPerM: 5, cachedInputPerM: 0.5, cacheWritePerM: 0, outputPerM: 30 }];
    expect(priceEvent(rates, ev({ tool: 'copilot-cli', model: 'gpt-5.5', inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).costUsd).toBe(5);
  });
});

describe('OFFICIAL_RATES', () => {
  it('has unique ids and non-negative prices', () => {
    expect(new Set(OFFICIAL_RATES.map((r) => r.id)).size).toBe(OFFICIAL_RATES.length);
    for (const r of OFFICIAL_RATES) for (const k of ['inputPerM', 'cachedInputPerM', 'cacheWritePerM', 'outputPerM'] as const) expect(r[k]).toBeGreaterThanOrEqual(0);
  });
});
```

Add to `src/shared/types.test.ts`:
```ts
it('accepts a task saved before sub-project 3 and defaults the usage fields', async () => {
  const { TaskSchema } = await import('./types');
  const t = TaskSchema.parse({ id: 't', repoId: 'r', name: 'x', workItem: null, slug: 'x', branch: 'b', worktreePath: '/w', baseRef: 'main', status: 'ready',
    setup: { copy: false, commands: [], startClaude: false, openShell: false }, terminals: [], createdAt: 'now', finishedAt: null });
  expect(t).toMatchObject({ usageSyncedAt: null, usageSyncError: null, usageCommentId: null });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/pricing src/shared/types.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Shared usage types**

`src/shared/usage.ts`:
```ts
import { z } from 'zod';

export type UsageTool = 'claude-code' | 'copilot-cli';

/** One AI request as captured from telemetry, before pricing. */
export type UsageEvent = {
  id: string;
  taskId: string;
  tool: UsageTool;
  sessionId: string;
  model: string;
  at: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  fast: boolean;
};

export type RateSnapshot = { inputPerM: number; cachedInputPerM: number; cacheWritePerM: number; outputPerM: number };

export type UsageRecord = UsageEvent & { costUsd: number | null; rateId: string | null; rate: RateSnapshot | null };

export const RateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  match: z.array(z.string().min(1)).min(1),
  minInputTokens: z.number().int().min(0),
  fast: z.boolean(),
  inputPerM: z.number().min(0),
  cachedInputPerM: z.number().min(0),
  cacheWritePerM: z.number().min(0),
  outputPerM: z.number().min(0),
});
export type Rate = z.infer<typeof RateSchema>;
export const RatesFileSchema = z.object({ version: z.literal(1), rates: z.array(RateSchema) });

export const AppSettingsSchema = z.object({
  version: z.literal(1),
  receiverPort: z.number().int().min(1024).max(65535),
  usdToEur: z.number().positive(),
  markupPct: z.number().min(0).max(1000),
  hourlySync: z.boolean(),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export const defaultSettings = (): AppSettings => ({ version: 1, receiverPort: 4319, usdToEur: 0.92, markupPct: 0, hourlySync: true });

export type SessionSummary = {
  sessionId: string;
  tool: UsageTool;
  startedAt: string;
  models: string[];
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;          // priced part only
  unpricedRequests: number;
  billable: boolean;
};

export type ToolTotals = { costUsd: number; sessions: number; tokens: number };

export type TaskUsage = {
  taskId: string;
  sessions: SessionSummary[];
  billable: { costUsd: number; costEur: number; tokens: number };
  byTool: Record<UsageTool, ToolTotals & { costEur: number }>;
  unpricedRequests: number;
  usdToEur: number;
  markupPct: number;
};

export type ReceiverStatus = { listening: boolean; port: number; error: string | null; copilot: { records: number; unreadable: number } };

export const AI_FIELDS = ['Custom.AICost', 'Custom.AICostClaude', 'Custom.AICostCopilot', 'Custom.AITokens'] as const;
export type AiField = (typeof AI_FIELDS)[number];
export type FieldsStatus = { connectionId: string; types: { type: string; present: AiField[]; missing: AiField[] }[] };

export type SyncResult = { ok: boolean; fieldsWritten: AiField[]; fieldsMissing: AiField[]; commentPosted: boolean; error: string | null };
```

- [ ] **Step 4: Extend shared types and IPC**

In `src/shared/types.ts`:
- `TerminalDefSchema.kind`: `z.enum(['claude', 'shell', 'run', 'copilot'])`.
- `TaskSchema` gains `usageSyncedAt: z.string().nullable().default(null), usageSyncError: z.string().nullable().default(null), usageCommentId: z.number().int().nullable().default(null)`.
- `FinishOptions` gains `syncUsage: boolean`.
- `TaskSetupSchema` gains `openCopilot: z.boolean().default(false)` and `CreateTaskInput` gains `openCopilot?: boolean`.

Fix every TypeScript literal of `Task`/`FinishOptions` in source and tests that typecheck flags (add `usageSyncedAt: null, usageSyncError: null, usageCommentId: null` / `syncUsage: false`); keep test semantics.

In `src/shared/ipc.ts`, import from `./usage` and add channels:
```ts
  'usage:task': { args: [taskId: string]; result: TaskUsage };
  'usage:setBillable': { args: [taskId: string, sessionId: string, billable: boolean]; result: TaskUsage };
  'usage:sync': { args: [taskId: string]; result: SyncResult };
  'usage:exportCsv': { args: [taskId: string]; result: string };
  'usage:fieldsStatus': { args: [connectionId: string]; result: FieldsStatus };
  'usage:receiverStatus': { args: []; result: ReceiverStatus };
  'rates:list': { args: []; result: { rates: Rate[]; officialAsOf: string } };
  'rates:save': { args: [rates: Rate[]]; result: Rate[] };
  'rates:reset': { args: []; result: Rate[] };
  'settings:get': { args: []; result: AppSettings };
  'settings:save': { args: [settings: AppSettings]; result: AppSettings };
```
and events `'usage:changed': { taskId: string }; 'usage:receiverStatus': ReceiverStatus;`.

Add a temporary `} as Handlers` cast at the end of `createHandlers` if typecheck requires it (Task 7 removes it; note it in the report). Add fake defaults in `src/renderer/test-helpers/fakeApi.ts`: `'usage:receiverStatus': () => ({ listening: true, port: 4319, error: null, copilot: { records: 0, unreadable: 0 } })`.

- [ ] **Step 5: Official rates**

`src/main/pricing/officialRates.ts` (values verbatim from the pages cited; USD per 1M tokens):
```ts
import type { Rate } from '../../shared/usage';

export const OFFICIAL_RATES_AS_OF = '2026-10-14';

const r = (id: string, label: string, match: string[], p: [number, number, number, number], extra: Partial<Rate> = {}): Rate => ({
  id, label, match, minInputTokens: 0, fast: false, inputPerM: p[0], cachedInputPerM: p[1], cacheWritePerM: p[2], outputPerM: p[3], ...extra,
});

/** Source: https://platform.claude.com/docs/en/about-claude/pricing (2026-10-14). [input, cache hit, 5m cache write, output] */
const ANTHROPIC: Rate[] = [
  r('anthropic-fable-5-1', 'Claude Fable 5.1', ['claude-fable-5-1', 'claude-mythos-5-1'], [10, 0.25, 12.5, 50]),
  r('anthropic-fable-5', 'Claude Fable 5', ['claude-fable-5', 'claude-mythos-5'], [10, 1, 12.5, 50]),
  r('anthropic-opus-5-5', 'Claude Opus 5.5', ['claude-opus-5-5'], [4, 0.2, 5, 20]),
  // Fast mode: $8 / $40; caching multipliers apply on top (Opus 5.5 hit = 0.05x input, 5m write = 1.25x).
  r('anthropic-opus-5-5-fast', 'Claude Opus 5.5 (fast)', ['claude-opus-5-5'], [8, 0.4, 10, 40], { fast: true }),
  r('anthropic-opus-5', 'Claude Opus 5', ['claude-opus-5'], [5, 0.5, 6.25, 25]),
  r('anthropic-opus-5-fast', 'Claude Opus 5 (fast)', ['claude-opus-5'], [10, 1, 12.5, 50], { fast: true }),
  r('anthropic-opus-4-8', 'Claude Opus 4.8', ['claude-opus-4-8'], [5, 0.5, 6.25, 25]),
  r('anthropic-opus-4-8-fast', 'Claude Opus 4.8 (fast)', ['claude-opus-4-8'], [10, 1, 12.5, 50], { fast: true }),
  r('anthropic-opus-4-7', 'Claude Opus 4.7 / 4.6 / 4.5', ['claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5'], [5, 0.5, 6.25, 25]),
  r('anthropic-opus-4-1', 'Claude Opus 4.1 / 4', ['claude-opus-4-1', 'claude-opus-4'], [15, 1.5, 18.75, 75]),
  r('anthropic-sonnet-5-5', 'Claude Sonnet 5.5', ['claude-sonnet-5-5'], [2, 0.1, 2.5, 10]),
  r('anthropic-sonnet-5', 'Claude Sonnet 5', ['claude-sonnet-5'], [2, 0.2, 2.5, 10]),
  r('anthropic-sonnet-4-6', 'Claude Sonnet 4.6 / 4.5 / 4', ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-sonnet-4'], [3, 0.3, 3.75, 15]),
  r('anthropic-haiku-5-5', 'Claude Haiku 5.5', ['claude-haiku-5-5'], [0.1, 0.01, 0.125, 0.5]),
  r('anthropic-haiku-5-5-long', 'Claude Haiku 5.5 (>100K input)', ['claude-haiku-5-5'], [0.5, 0.05, 0.625, 2.5], { minInputTokens: 100_000 }),
  r('anthropic-haiku-4-5', 'Claude Haiku 4.5', ['claude-haiku-4-5'], [1, 0.1, 1.25, 5]),
  r('anthropic-haiku-3-5', 'Claude Haiku 3.5', ['claude-3-5-haiku', 'claude-haiku-3-5'], [0.8, 0.08, 1, 4]),
];

/** Source: https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing (2026-10-14). [input, cached input, cache write, output]. Anthropic models via Copilot share the ids above, so only non-Anthropic models are listed here; Anthropic rows apply to both tools. */
const COPILOT: Rate[] = [
  r('copilot-gpt-5-mini', 'GPT-5 mini', ['gpt-5-mini'], [0.25, 0.025, 0, 2]),
  r('copilot-gpt-5-3-codex', 'GPT-5.3-Codex', ['gpt-5-3-codex'], [1.75, 0.175, 0, 14]),
  r('copilot-gpt-5-4', 'GPT-5.4', ['gpt-5-4'], [2.5, 0.25, 0, 15]),
  r('copilot-gpt-5-4-long', 'GPT-5.4 (>272K input)', ['gpt-5-4'], [5, 0.5, 0, 22.5], { minInputTokens: 272_000 }),
  r('copilot-gpt-5-4-mini', 'GPT-5.4 mini', ['gpt-5-4-mini'], [0.75, 0.075, 0, 4.5]),
  r('copilot-gpt-5-4-nano', 'GPT-5.4 nano', ['gpt-5-4-nano'], [0.2, 0.02, 0, 1.25]),
  r('copilot-gpt-5-5', 'GPT-5.5', ['gpt-5-5'], [5, 0.5, 0, 30]),
  r('copilot-gpt-5-5-long', 'GPT-5.5 (>272K input)', ['gpt-5-5'], [10, 1, 0, 45], { minInputTokens: 272_000 }),
  r('copilot-gpt-5-6-luna', 'GPT-5.6 Luna', ['gpt-5-6-luna'], [0.2, 0.02, 0.25, 1.2]),
  r('copilot-gpt-5-6-luna-long', 'GPT-5.6 Luna (>200K input)', ['gpt-5-6-luna'], [0.4, 0.04, 0.5, 1.8], { minInputTokens: 200_000 }),
  r('copilot-gpt-5-6-sol', 'GPT-5.6 Sol', ['gpt-5-6-sol'], [4, 0.4, 5, 20]),
  r('copilot-gpt-5-6-sol-long', 'GPT-5.6 Sol (>272K input)', ['gpt-5-6-sol'], [8, 0.8, 10, 30], { minInputTokens: 272_000 }),
  r('copilot-gpt-5-6-terra', 'GPT-5.6 Terra', ['gpt-5-6-terra'], [2, 0.2, 2.5, 12]),
  r('copilot-gpt-5-6-terra-long', 'GPT-5.6 Terra (>272K input)', ['gpt-5-6-terra'], [4, 0.4, 5, 18], { minInputTokens: 272_000 }),
  r('copilot-gpt-6-astra', 'GPT-6 Astra', ['gpt-6-astra'], [10, 1, 12.5, 50]),
  r('copilot-gpt-6-astra-long', 'GPT-6 Astra (>272K input)', ['gpt-6-astra'], [20, 2, 25, 75], { minInputTokens: 272_000 }),
  r('copilot-gpt-6-luna', 'GPT-6 Luna', ['gpt-6-luna'], [0.1, 0.01, 0.125, 0.5]),
  r('copilot-gpt-6-luna-long', 'GPT-6 Luna (>272K input)', ['gpt-6-luna'], [0.2, 0.02, 0.25, 0.75], { minInputTokens: 272_000 }),
  r('copilot-gpt-6-sol', 'GPT-6 Sol', ['gpt-6-sol'], [2, 0.2, 2.5, 10]),
  r('copilot-gpt-6-sol-long', 'GPT-6 Sol (>272K input)', ['gpt-6-sol'], [4, 0.4, 5, 15], { minInputTokens: 272_000 }),
  r('copilot-gpt-6-1-sol', 'GPT-6.1 Sol', ['gpt-6-1-sol'], [2, 0.1, 2.5, 10]),
  r('copilot-gpt-6-1-sol-long', 'GPT-6.1 Sol (>272K input)', ['gpt-6-1-sol'], [4, 0.2, 5, 15], { minInputTokens: 272_000 }),
  r('copilot-gemini-3-7-flash', 'Gemini 3.7 Flash (promo to 2026-12-31)', ['gemini-3-7-flash'], [0.75, 0.075, 0, 3.75]),
  r('copilot-gemini-3-8-flash', 'Gemini 3.8 Flash (promo to 2026-12-31)', ['gemini-3-8-flash'], [0.75, 0.075, 0, 3.75]),
  r('copilot-gemini-4-argon', 'Gemini 4 Argon (promo to 2026-12-01)', ['gemini-4-argon'], [2, 0.1, 0, 10]),
  r('copilot-mai-code-1-1-flash', 'MAI-Code-1.1-Flash', ['mai-code-1-1-flash'], [0.2, 0.02, 0, 1.2]),
  r('copilot-grok-4-5', 'Grok 4.5 / 4.6 / 4.7', ['grok-4-5', 'grok-4-6', 'grok-4-7'], [2, 0.5, 0, 6]),
  r('copilot-grok-4-5-long', 'Grok 4.5 / 4.6 / 4.7 (>200K input)', ['grok-4-5', 'grok-4-6', 'grok-4-7'], [4, 1, 0, 12], { minInputTokens: 200_000 }),
  r('copilot-kimi-k3', 'Kimi K3', ['kimi-k3'], [3, 0.3, 0, 15]),
];

export const OFFICIAL_RATES: Rate[] = [...ANTHROPIC, ...COPILOT];
```

- [ ] **Step 6: RateTable**

`src/main/pricing/RateTable.ts`:
```ts
import type { Rate, RateSnapshot, UsageEvent } from '../../shared/usage';

export const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export function normalizeModel(model: string): string {
  let m = model.trim().toLowerCase();
  m = m.replace(/^(anthropic|openai|google|xai|microsoft|moonshot)[./]/, '');
  m = m.replace(/(\d)\.(\d)/g, '$1-$2').replace(/(\d)\.(\d)/g, '$1-$2');
  m = m.replace(/-\d{8}$/, '');
  m = m.replace(/[\s_]+/g, '-');
  return m;
}

export function selectRate(rates: Rate[], model: string, totalInputTokens: number, fast: boolean): Rate | null {
  const id = normalizeModel(model);
  const candidates = rates.filter((r) => r.fast === fast && r.match.some((m) => normalizeModel(m) === id) && r.minInputTokens <= totalInputTokens);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, r) => (r.minInputTokens > best.minInputTokens ? r : best));
}

export function priceEvent(rates: Rate[], e: UsageEvent): { costUsd: number | null; rateId: string | null; rate: RateSnapshot | null } {
  const totalInput = e.inputTokens + e.cacheReadTokens + e.cacheWriteTokens;
  const rate = selectRate(rates, e.model, totalInput, e.fast) ?? (e.fast ? selectRate(rates, e.model, totalInput, false) : null);
  if (!rate) return { costUsd: null, rateId: null, rate: null };
  const snap: RateSnapshot = { inputPerM: rate.inputPerM, cachedInputPerM: rate.cachedInputPerM, cacheWritePerM: rate.cacheWritePerM, outputPerM: rate.outputPerM };
  const cost = (e.inputTokens * snap.inputPerM + e.cacheReadTokens * snap.cachedInputPerM + e.cacheWriteTokens * snap.cacheWritePerM + e.outputTokens * snap.outputPerM) / 1e6;
  return { costUsd: round6(cost), rateId: rate.id, rate: snap };
}
```
(A fast request for a model without a fast row falls back to the standard row, matching Anthropic's "requests run at standard speed and are billed at standard rates" for Opus 4.6.)

- [ ] **Step 7: Run tests, suite, typecheck, lint**

Run: `npx vitest run --project main src/main/pricing src/shared && npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared src/main/pricing src/renderer/test-helpers/fakeApi.ts
git commit -m "feat: usage types, settings schema, official rates and per-request pricing"
```

---

### Task 3: SettingsStore, RateStore and UsageStore

**Files:**
- Create: `src/main/usage/JsonFileStore.ts`, `src/main/usage/SettingsStore.ts`, `src/main/usage/RateStore.ts`, `src/main/usage/UsageStore.ts`
- Test: `src/main/usage/SettingsStore.test.ts`, `src/main/usage/RateStore.test.ts`, `src/main/usage/UsageStore.test.ts`

**Interfaces:**
- Consumes: Task 2 types, `priceEvent`, `OFFICIAL_RATES`.
- Produces: `class JsonFileStore<T> { constructor(file, schema, empty); load(): Promise<{ recovered, backup? }>; get value(): T; update(mutate): Promise<T> }` (same atomic/queue/backup behaviour as `TaskStore`); `SettingsStore` (`get()`, `save(s)`); `RateStore` (`list()`, `save(rates)`, `reset()`); `class UsageStore extends EventEmitter<{ changed: [taskId: string] }> { constructor(dir, rates: () => Rate[]); load(): Promise<{ damagedLines: number }>; add(e: UsageEvent): Promise<UsageRecord | null> /* null when duplicate */; records(taskId): UsageRecord[]; setBillable(taskId, sessionId, billable): Promise<void>; isBillable(taskId, sessionId): boolean; summarize(taskId, settings): TaskUsage; changedSince(iso): string[] }`.

- [ ] **Step 1: Write the failing tests**

`src/main/usage/UsageStore.test.ts`:
```ts
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings, type UsageEvent } from '../../shared/usage';
import { OFFICIAL_RATES } from '../pricing/officialRates';
import { UsageStore } from './UsageStore';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const dir = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'miac-usage-')); dirs.push(d); return d; };
const ev = (over: Partial<UsageEvent> = {}): UsageEvent => ({
  id: 'r1', taskId: 't1', tool: 'claude-code', sessionId: 's1', model: 'claude-opus-5-5', at: '2026-10-14T10:00:00.000Z',
  inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10000, cacheWriteTokens: 2000, fast: false, ...over,
});

describe('UsageStore', () => {
  it('prices, appends to the monthly file and emits changed', async () => {
    const d = dir();
    const s = new UsageStore(d, () => OFFICIAL_RATES);
    await s.load();
    const changed: string[] = [];
    s.on('changed', (t) => changed.push(t));
    const rec = await s.add(ev());
    expect(rec?.costUsd).toBe(0.026);
    expect(readdirSync(d)).toContain('records-2026-10.jsonl');
    expect(changed).toEqual(['t1']);
  });

  it('dedupes by id, also across a reload', async () => {
    const d = dir();
    const a = new UsageStore(d, () => OFFICIAL_RATES);
    await a.load();
    await a.add(ev());
    expect(await a.add(ev())).toBeNull();
    const b = new UsageStore(d, () => OFFICIAL_RATES);
    await b.load();
    expect(await b.add(ev())).toBeNull();
    expect(b.records('t1')).toHaveLength(1);
    expect(readFileSync(path.join(d, 'records-2026-10.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('keeps the rate it was priced with when rates change later', async () => {
    const d = dir();
    let rates = OFFICIAL_RATES;
    const s = new UsageStore(d, () => rates);
    await s.load();
    await s.add(ev());
    rates = OFFICIAL_RATES.map((r) => (r.id === 'anthropic-opus-5-5' ? { ...r, inputPerM: 100 } : r));
    await s.add(ev({ id: 'r2' }));
    const [first, second] = s.records('t1');
    expect(first.rate?.inputPerM).toBe(4);
    expect(second.rate?.inputPerM).toBe(100);
  });

  it('skips damaged lines and counts them', async () => {
    const d = dir();
    const a = new UsageStore(d, () => OFFICIAL_RATES);
    await a.load();
    await a.add(ev());
    appendFileSync(path.join(d, 'records-2026-10.jsonl'), '{"id":"broken"\n');
    const b = new UsageStore(d, () => OFFICIAL_RATES);
    expect(await b.load()).toEqual({ damagedLines: 1 });
    expect(b.records('t1')).toHaveLength(1);
  });

  it('summarizes per session with billable flags, EUR and unpriced counts', async () => {
    const s = new UsageStore(dir(), () => OFFICIAL_RATES);
    await s.load();
    await s.add(ev({ id: 'a', sessionId: 's1' }));
    await s.add(ev({ id: 'b', sessionId: 's1', model: 'claude-sonnet-5-5', at: '2026-10-14T10:05:00.000Z' }));
    await s.add(ev({ id: 'c', sessionId: 's2', tool: 'copilot-cli', model: 'mystery', at: '2026-10-14T11:00:00.000Z' }));
    await s.setBillable('t1', 's1', true);
    let u = s.summarize('t1', { ...defaultSettings(), usdToEur: 0.5, markupPct: 10 });
    expect(u.sessions.map((x) => [x.sessionId, x.requests, x.models])).toEqual([['s1', 2, ['claude-opus-5-5', 'claude-sonnet-5-5']], ['s2', 1, ['mystery']]]);
    expect(u.unpricedRequests).toBe(1);
    expect(u.byTool['claude-code'].sessions).toBe(1);
    expect(u.billable.costEur).toBeCloseTo(u.billable.costUsd * 0.5 * 1.1, 6);
    await s.setBillable('t1', 's1', false);
    u = s.summarize('t1', defaultSettings());
    expect(u.sessions.find((x) => x.sessionId === 's1')?.billable).toBe(false);
    expect(u.billable.costUsd).toBe(0);
  });

  it('lists tasks changed since a time', async () => {
    const s = new UsageStore(dir(), () => OFFICIAL_RATES);
    await s.load();
    await s.add(ev({ id: 'x', taskId: 'tA' }));
    const mark = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await s.add(ev({ id: 'y', taskId: 'tB' }));
    expect(s.changedSince(mark)).toEqual(['tB']);
  });
});
```

`src/main/usage/SettingsStore.test.ts` and `RateStore.test.ts`:
```ts
// SettingsStore.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../shared/usage';
import { SettingsStore } from './SettingsStore';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const file = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'miac-set-')); dirs.push(d); return path.join(d, 'settings.json'); };

describe('SettingsStore', () => {
  it('defaults, saves and reloads', async () => {
    const f = file();
    const a = new SettingsStore(f);
    await a.load();
    expect(a.get()).toEqual(defaultSettings());
    await a.save({ ...defaultSettings(), usdToEur: 0.9, receiverPort: 5000 });
    const b = new SettingsStore(f);
    await b.load();
    expect(b.get()).toMatchObject({ usdToEur: 0.9, receiverPort: 5000 });
  });
  it('rejects invalid values', async () => {
    const s = new SettingsStore(file());
    await s.load();
    await expect(s.save({ ...defaultSettings(), receiverPort: 80 })).rejects.toThrow();
    expect(s.get().receiverPort).toBe(4319);
  });
});
```
```ts
// RateStore.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OFFICIAL_RATES } from '../pricing/officialRates';
import { RateStore } from './RateStore';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const file = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'miac-rates-')); dirs.push(d); return path.join(d, 'rates.json'); };

describe('RateStore', () => {
  it('seeds with official rates, saves edits and resets', async () => {
    const f = file();
    const s = new RateStore(f);
    await s.load();
    expect(s.list()).toEqual(OFFICIAL_RATES);
    const edited = s.list().map((r) => (r.id === 'anthropic-opus-5-5' ? { ...r, inputPerM: 3.5 } : r));
    await s.save(edited);
    const again = new RateStore(f);
    await again.load();
    expect(again.list().find((r) => r.id === 'anthropic-opus-5-5')?.inputPerM).toBe(3.5);
    await again.reset();
    expect(again.list()).toEqual(OFFICIAL_RATES);
  });
  it('rejects duplicate ids', async () => {
    const s = new RateStore(file());
    await s.load();
    await expect(s.save([...OFFICIAL_RATES, OFFICIAL_RATES[0]])).rejects.toThrow(/duplicate/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/usage`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement**

`src/main/usage/JsonFileStore.ts`:
```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';

/** One JSON document on disk, zod-validated, written atomically and serially; a corrupt file is backed up. */
export class JsonFileStore<T> {
  private current: T;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string, private readonly schema: z.ZodType<T>, private readonly empty: () => T) {
    this.current = empty();
  }

  get value(): T {
    return this.current;
  }

  async load(): Promise<{ recovered: boolean; backup?: string }> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { recovered: false };
      throw e;
    }
    try {
      this.current = this.schema.parse(JSON.parse(raw));
      return { recovered: false };
    } catch {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      await fs.rename(this.file, backup);
      this.current = this.empty();
      return { recovered: true, backup };
    }
  }

  update(mutate: (v: T) => T | void): Promise<T> {
    const run = async () => {
      const draft = structuredClone(this.current);
      const next = this.schema.parse(mutate(draft) ?? draft);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
      await fs.rename(tmp, this.file);
      this.current = next;
      return next;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
```

`src/main/usage/SettingsStore.ts`:
```ts
import { AppSettingsSchema, defaultSettings, type AppSettings } from '../../shared/usage';
import { JsonFileStore } from './JsonFileStore';

export class SettingsStore {
  private readonly store: JsonFileStore<AppSettings>;
  constructor(file: string) {
    this.store = new JsonFileStore(file, AppSettingsSchema, defaultSettings);
  }
  load() { return this.store.load(); }
  get(): AppSettings { return this.store.value; }
  save(next: AppSettings): Promise<AppSettings> { return this.store.update(() => next); }
}
```

`src/main/usage/RateStore.ts`:
```ts
import { z } from 'zod';
import { RatesFileSchema, type Rate } from '../../shared/usage';
import { OFFICIAL_RATES } from '../pricing/officialRates';
import { JsonFileStore } from './JsonFileStore';

type RatesFile = z.infer<typeof RatesFileSchema>;

export class RateStore {
  private readonly store: JsonFileStore<RatesFile>;
  constructor(file: string) {
    this.store = new JsonFileStore(file, RatesFileSchema, () => ({ version: 1, rates: structuredClone(OFFICIAL_RATES) }));
  }
  load() { return this.store.load(); }
  list(): Rate[] { return this.store.value.rates; }
  async save(rates: Rate[]): Promise<Rate[]> {
    const ids = new Set<string>();
    for (const r of rates) {
      if (ids.has(r.id)) throw new Error(`Duplicate rate id ${r.id}`);
      ids.add(r.id);
    }
    return (await this.store.update(() => ({ version: 1, rates }))).rates;
  }
  async reset(): Promise<Rate[]> {
    return (await this.store.update(() => ({ version: 1, rates: structuredClone(OFFICIAL_RATES) }))).rates;
  }
}
```

`src/main/usage/UsageStore.ts`:
```ts
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppSettings, Rate, SessionSummary, TaskUsage, UsageEvent, UsageRecord, UsageTool } from '../../shared/usage';
import { priceEvent, round6 } from '../pricing/RateTable';

const TOOLS: UsageTool[] = ['claude-code', 'copilot-cli'];

/** Priced usage records in append-only monthly JSON-lines files, indexed in memory by task. */
export class UsageStore extends EventEmitter<{ changed: [taskId: string] }> {
  private readonly byId = new Map<string, UsageRecord>();
  private readonly byTask = new Map<string, UsageRecord[]>();
  private readonly lastChange = new Map<string, string>();
  private notBillable = new Map<string, Set<string>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string, private readonly rates: () => Rate[]) {
    super();
  }

  async load(): Promise<{ damagedLines: number }> {
    let damaged = 0;
    let files: string[] = [];
    try {
      files = (await fs.readdir(this.dir)).filter((f) => /^records-\d{4}-\d{2}\.jsonl$/.test(f)).sort();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    for (const f of files) {
      const text = await fs.readFile(path.join(this.dir, f), 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line) as UsageRecord;
          if (typeof rec.id !== 'string' || typeof rec.taskId !== 'string') throw new Error('bad record');
          this.index(rec);
        } catch {
          damaged++;
        }
      }
    }
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.dir, 'billable.json'), 'utf8')) as Record<string, string[]>;
      this.notBillable = new Map(Object.entries(raw).map(([t, ids]) => [t, new Set(ids)]));
    } catch {
      this.notBillable = new Map();
    }
    return { damagedLines: damaged };
  }

  add(e: UsageEvent): Promise<UsageRecord | null> {
    const run = async () => {
      if (this.byId.has(e.id)) return null;
      const rec: UsageRecord = { ...e, ...priceEvent(this.rates(), e) };
      await fs.mkdir(this.dir, { recursive: true });
      await fs.appendFile(path.join(this.dir, `records-${e.at.slice(0, 7)}.jsonl`), `${JSON.stringify(rec)}\n`, 'utf8');
      this.index(rec);
      this.lastChange.set(e.taskId, new Date().toISOString());
      this.emit('changed', e.taskId);
      return rec;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  records(taskId: string): UsageRecord[] {
    return [...(this.byTask.get(taskId) ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  }

  isBillable(taskId: string, sessionId: string): boolean {
    return !this.notBillable.get(taskId)?.has(sessionId);
  }

  async setBillable(taskId: string, sessionId: string, billable: boolean): Promise<void> {
    const set = this.notBillable.get(taskId) ?? new Set<string>();
    if (billable) set.delete(sessionId);
    else set.add(sessionId);
    this.notBillable.set(taskId, set);
    const obj = Object.fromEntries([...this.notBillable].filter(([, s]) => s.size > 0).map(([t, s]) => [t, [...s]]));
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, 'billable.json');
    await fs.writeFile(`${file}.tmp`, JSON.stringify(obj), 'utf8');
    await fs.rename(`${file}.tmp`, file);
    this.lastChange.set(taskId, new Date().toISOString());
    this.emit('changed', taskId);
  }

  changedSince(iso: string): string[] {
    return [...this.lastChange].filter(([, at]) => at > iso).map(([t]) => t);
  }

  summarize(taskId: string, settings: AppSettings): TaskUsage {
    const sessions = new Map<string, SessionSummary>();
    for (const r of this.records(taskId)) {
      const s = sessions.get(r.sessionId) ?? {
        sessionId: r.sessionId, tool: r.tool, startedAt: r.at, models: [], requests: 0, inputTokens: 0, outputTokens: 0,
        cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, unpricedRequests: 0, billable: this.isBillable(taskId, r.sessionId),
      };
      s.requests++;
      if (!s.models.includes(r.model)) s.models.push(r.model);
      s.inputTokens += r.inputTokens;
      s.outputTokens += r.outputTokens;
      s.cacheReadTokens += r.cacheReadTokens;
      s.cacheWriteTokens += r.cacheWriteTokens;
      if (r.costUsd === null) s.unpricedRequests++;
      else s.costUsd = round6(s.costUsd + r.costUsd);
      sessions.set(r.sessionId, s);
    }
    const list = [...sessions.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const factor = settings.usdToEur * (1 + settings.markupPct / 100);
    const tokensOf = (s: SessionSummary) => s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens;
    const billableList = list.filter((s) => s.billable);
    const byTool = Object.fromEntries(TOOLS.map((tool) => {
      const ss = billableList.filter((s) => s.tool === tool);
      const costUsd = round6(ss.reduce((n, s) => n + s.costUsd, 0));
      return [tool, { costUsd, costEur: round6(costUsd * factor), sessions: ss.length, tokens: ss.reduce((n, s) => n + tokensOf(s), 0) }];
    })) as TaskUsage['byTool'];
    const costUsd = round6(billableList.reduce((n, s) => n + s.costUsd, 0));
    return {
      taskId,
      sessions: list,
      billable: { costUsd, costEur: round6(costUsd * factor), tokens: billableList.reduce((n, s) => n + tokensOf(s), 0) },
      byTool,
      unpricedRequests: list.reduce((n, s) => n + s.unpricedRequests, 0),
      usdToEur: settings.usdToEur,
      markupPct: settings.markupPct,
    };
  }

  private index(rec: UsageRecord): void {
    if (this.byId.has(rec.id)) return;
    this.byId.set(rec.id, rec);
    const list = this.byTask.get(rec.taskId) ?? [];
    list.push(rec);
    this.byTask.set(rec.taskId, list);
  }
}
```

- [ ] **Step 4: Run tests, suite, typecheck, lint**

Run: `npx vitest run --project main src/main/usage && npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/usage
git commit -m "feat: settings, rate and usage stores with dedupe and per-session billing"
```

---

### Task 4: Claude Code capture: OTLP parsing, UsageReceiver and telemetryEnv

**Files:**
- Create: `src/main/usage/otlp.ts`, `src/main/usage/UsageReceiver.ts`, `src/main/usage/telemetryEnv.ts`
- Test: `src/main/usage/otlp.test.ts`, `src/main/usage/UsageReceiver.test.ts`, `src/main/usage/telemetryEnv.test.ts`

**Interfaces:**
- Consumes: Task 1 fixtures (`src/main/usage/__fixtures__/claude/api-request-logs.json`, recorded with `miac.task.id=00000000-0000-4000-8000-000000000001`; read its README first and adapt *only* the event-name lookup if the fixture differs from what `parseClaudeLogs` checks), Task 2 `UsageEvent`.
- Produces: `anyValue(v: unknown): string | number | boolean | null`, `attrMap(list: unknown): Record<string, string | number | boolean | null>`, `parseClaudeLogs(body: unknown): { events: UsageEvent[]; skipped: number }`; `class UsageReceiver { constructor(onEvents: (events: UsageEvent[]) => void); start(port: number): Promise<ReceiverStatus-without-copilot>; stop(): Promise<void>; get status(): { listening: boolean; port: number; error: string | null } }`; `telemetryEnv(taskId: string, port: number, usageDir: string): Record<string, string>` and `copilotFile(usageDir, taskId): string`.

- [ ] **Step 1: Write the failing tests**

`src/main/usage/telemetryEnv.test.ts`:
```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { copilotFile, telemetryEnv } from './telemetryEnv';

describe('telemetryEnv', () => {
  it('points Claude Code at the receiver and Copilot CLI at a per-task file', () => {
    const env = telemetryEnv('t-1', 4319, '/data/usage');
    expect(env).toEqual({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://127.0.0.1:4319/v1/logs',
      OTEL_LOGS_EXPORT_INTERVAL: '2000',
      OTEL_RESOURCE_ATTRIBUTES: 'miac.task.id=t-1',
      COPILOT_OTEL_FILE_EXPORTER_PATH: path.join('/data/usage', 'copilot', 't-1.jsonl'),
    });
    expect(copilotFile('/data/usage', 't-1')).toBe(env.COPILOT_OTEL_FILE_EXPORTER_PATH);
  });
  it('never turns on prompt or content capture', () => {
    const keys = Object.keys(telemetryEnv('t', 1, '/u'));
    for (const k of ['OTEL_LOG_USER_PROMPTS', 'OTEL_LOG_TOOL_DETAILS', 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT']) expect(keys).not.toContain(k);
  });
});
```

`src/main/usage/otlp.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { attrMap, parseClaudeLogs } from './otlp';

const FIXTURE_TASK = '00000000-0000-4000-8000-000000000001';
const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, '__fixtures__', 'claude', name), 'utf8')) as unknown;

const kv = (key: string, value: Record<string, unknown>) => ({ key, value });
const body = (attrs: { key: string; value: Record<string, unknown> }[], resource = [kv('miac.task.id', { stringValue: 'task-9' })]) => ({
  resourceLogs: [{ resource: { attributes: resource }, scopeLogs: [{ logRecords: [{
    timeUnixNano: '1760436000000000000',
    body: { stringValue: 'claude_code.api_request' },
    attributes: [kv('event.name', { stringValue: 'api_request' }), ...attrs],
  }] }] }],
});
const full = [
  kv('model', { stringValue: 'claude-opus-5-5' }),
  kv('input_tokens', { intValue: '1200' }),
  kv('output_tokens', { intValue: 300 }),
  kv('cache_read_tokens', { intValue: '45000' }),
  kv('cache_creation_tokens', { intValue: '2000' }),
  kv('cost_usd', { doubleValue: 0.05 }),
  kv('speed', { stringValue: 'fast' }),
  kv('request_id', { stringValue: 'req_1' }),
  kv('session.id', { stringValue: 'sess_1' }),
];

describe('attrMap', () => {
  it('reads every OTLP AnyValue kind, including int64 as string', () => {
    expect(attrMap([kv('a', { stringValue: 'x' }), kv('b', { intValue: '7' }), kv('c', { doubleValue: 1.5 }), kv('d', { boolValue: true }), kv('e', {})]))
      .toEqual({ a: 'x', b: 7, c: 1.5, d: true, e: null });
  });
});

describe('parseClaudeLogs', () => {
  it('maps an api_request record to a usage event', () => {
    const { events, skipped } = parseClaudeLogs(body(full));
    expect(skipped).toBe(0);
    expect(events).toEqual([{
      id: 'req_1', taskId: 'task-9', tool: 'claude-code', sessionId: 'sess_1', model: 'claude-opus-5-5',
      at: new Date(1760436000000).toISOString(), inputTokens: 1200, outputTokens: 300, cacheReadTokens: 45000, cacheWriteTokens: 2000, fast: true,
    }]);
  });
  it('lets a record attribute carry the task id when the resource does not', () => {
    const { events } = parseClaudeLogs(body([...full, kv('miac.task.id', { stringValue: 'task-r' })], []));
    expect(events[0].taskId).toBe('task-r');
  });
  it('ignores records without a task id and other event names', () => {
    expect(parseClaudeLogs(body(full, [])).events).toEqual([]);
    const other = body(full);
    (other.resourceLogs[0].scopeLogs[0].logRecords[0] as { body: unknown }).body = { stringValue: 'claude_code.tool_result' };
    other.resourceLogs[0].scopeLogs[0].logRecords[0].attributes[0] = kv('event.name', { stringValue: 'tool_result' });
    expect(parseClaudeLogs(other).events).toEqual([]);
  });
  it('counts an api_request without a model or request id as skipped', () => {
    expect(parseClaudeLogs(body(full.filter((a) => a.key !== 'model')))).toEqual({ events: [], skipped: 1 });
    expect(parseClaudeLogs(body(full.filter((a) => a.key !== 'request_id')))).toEqual({ events: [], skipped: 1 });
  });
  it('returns nothing for bodies that are not OTLP logs', () => {
    expect(parseClaudeLogs(null)).toEqual({ events: [], skipped: 0 });
    expect(parseClaudeLogs({ resourceLogs: 'x' })).toEqual({ events: [], skipped: 0 });
  });
  it('parses the recorded Claude Code fixture', () => {
    const { events } = parseClaudeLogs(fixture('api-request-logs.json'));
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e).toMatchObject({ taskId: FIXTURE_TASK, tool: 'claude-code', fast: false });
      expect(e.model).toMatch(/^claude-/);
      expect(e.id.length).toBeGreaterThan(0);
      expect(e.sessionId.length).toBeGreaterThan(0);
      for (const n of [e.inputTokens, e.outputTokens, e.cacheReadTokens, e.cacheWriteTokens]) expect(Number.isInteger(n) && n >= 0).toBe(true);
    }
  });
});
```

`src/main/usage/UsageReceiver.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { UsageEvent } from '../../shared/usage';
import { UsageReceiver } from './UsageReceiver';

const receivers: UsageReceiver[] = [];
afterEach(async () => { await Promise.all(receivers.splice(0).map((r) => r.stop())); });

const freePort = () => new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});
async function start() {
  const got: UsageEvent[] = [];
  const r = new UsageReceiver((events) => got.push(...events));
  receivers.push(r);
  const port = await freePort();
  const status = await r.start(port);
  return { r, got, port, status };
}
const fixture = readFileSync(path.join(__dirname, '__fixtures__', 'claude', 'api-request-logs.json'));

describe('UsageReceiver', () => {
  it('accepts the recorded Claude Code body and hands over events', async () => {
    const { got, port, status } = await start();
    expect(status).toEqual({ listening: true, port, error: null });
    const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: fixture });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(got.length).toBeGreaterThan(0);
  });
  it('accepts gzip bodies', async () => {
    const { got, port } = await start();
    const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' }, body: gzipSync(fixture) });
    expect(res.status).toBe(200);
    expect(got.length).toBeGreaterThan(0);
  });
  it('accepts and ignores metrics', async () => {
    const { got, port } = await start();
    const res = await fetch(`http://127.0.0.1:${port}/v1/metrics`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"resourceMetrics":[]}' });
    expect(res.status).toBe(200);
    expect(got).toEqual([]);
  });
  it('rejects protobuf, bad JSON, oversized bodies and unknown paths', async () => {
    const { port } = await start();
    const post = (p: string, type: string, b: string | Uint8Array) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'content-type': type }, body: b });
    expect((await post('/v1/logs', 'application/x-protobuf', 'x')).status).toBe(415);
    expect((await post('/v1/logs', 'application/json', '{nope')).status).toBe(400);
    expect((await post('/v1/logs', 'application/json', new Uint8Array(5 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await post('/v1/traces', 'application/json', '{}')).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/v1/logs`)).status).toBe(405);
  });
  it('reports a port in use instead of throwing, and can move to another port', async () => {
    const a = await start();
    const b = new UsageReceiver(() => {});
    receivers.push(b);
    const status = await b.start(a.port);
    expect(status.listening).toBe(false);
    expect(status.error).toMatch(/in use/i);
    const other = await freePort();
    expect(await b.start(other)).toEqual({ listening: true, port: other, error: null });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/usage/otlp.test.ts src/main/usage/UsageReceiver.test.ts src/main/usage/telemetryEnv.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement**

`src/main/usage/telemetryEnv.ts`:
```ts
import path from 'node:path';

export const copilotFile = (usageDir: string, taskId: string): string => path.join(usageDir, 'copilot', `${taskId}.jsonl`);

/** Environment for every task pty: Claude Code exports log events to the receiver, Copilot CLI writes JSON lines to a per-task file. Content capture stays off. */
export function telemetryEnv(taskId: string, port: number, usageDir: string): Record<string, string> {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'none',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `http://127.0.0.1:${port}/v1/logs`,
    OTEL_LOGS_EXPORT_INTERVAL: '2000',
    OTEL_RESOURCE_ATTRIBUTES: `miac.task.id=${taskId}`,
    COPILOT_OTEL_FILE_EXPORTER_PATH: copilotFile(usageDir, taskId),
  };
}
```

`src/main/usage/otlp.ts`:
```ts
import type { UsageEvent } from '../../shared/usage';

type Scalar = string | number | boolean | null;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** One OTLP JSON AnyValue. int64 arrives as a string or a number. */
export function anyValue(v: unknown): Scalar {
  if (!isObj(v)) return null;
  if (typeof v.stringValue === 'string') return v.stringValue;
  if (v.intValue !== undefined) {
    const n = Number(v.intValue);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v.doubleValue === 'number') return v.doubleValue;
  if (typeof v.boolValue === 'boolean') return v.boolValue;
  return null;
}

export function attrMap(list: unknown): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const item of arr(list)) if (isObj(item) && typeof item.key === 'string') out[item.key] = anyValue(item.value);
  return out;
}

export const int = (v: Scalar | undefined): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const str = (v: Scalar | undefined): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** Nanoseconds since the epoch (string or number) to ISO; falls back to now. */
export function nanosToIso(v: unknown): string {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? new Date(Math.floor(n / 1e6)).toISOString() : new Date().toISOString();
}

const isApiRequest = (record: Obj, attrs: Record<string, Scalar>): boolean => {
  const body = anyValue(record.body);
  const name = attrs['event.name'];
  return body === 'claude_code.api_request' || name === 'api_request' || name === 'claude_code.api_request';
};

/** Picks `claude_code.api_request` events tagged with `miac.task.id` out of an OTLP/HTTP JSON logs body. */
export function parseClaudeLogs(body: unknown): { events: UsageEvent[]; skipped: number } {
  const events: UsageEvent[] = [];
  let skipped = 0;
  if (!isObj(body)) return { events, skipped };
  for (const rl of arr(body.resourceLogs)) {
    if (!isObj(rl)) continue;
    const resource = attrMap(isObj(rl.resource) ? rl.resource.attributes : undefined);
    for (const sl of arr(rl.scopeLogs)) {
      if (!isObj(sl)) continue;
      for (const record of arr(sl.logRecords)) {
        if (!isObj(record)) continue;
        const attrs = { ...resource, ...attrMap(record.attributes) };
        if (!isApiRequest(record, attrs)) continue;
        const taskId = str(attrs['miac.task.id']);
        if (!taskId) continue;
        const id = str(attrs.request_id);
        const model = str(attrs.model);
        if (!id || !model) {
          skipped++;
          continue;
        }
        const at = typeof attrs['event.timestamp'] === 'string' && !Number.isNaN(Date.parse(attrs['event.timestamp']))
          ? new Date(attrs['event.timestamp']).toISOString()
          : nanosToIso(record.timeUnixNano ?? record.observedTimeUnixNano);
        events.push({
          id,
          taskId,
          tool: 'claude-code',
          sessionId: str(attrs['session.id']) || 'unknown-session',
          model,
          at,
          inputTokens: int(attrs.input_tokens),
          outputTokens: int(attrs.output_tokens),
          cacheReadTokens: int(attrs.cache_read_tokens),
          cacheWriteTokens: int(attrs.cache_creation_tokens),
          fast: attrs.speed === 'fast',
        });
      }
    }
  }
  return { events, skipped };
}
```
(If the fixture shows `event.timestamp` is absent or the event name lives elsewhere, the fixture test tells you; keep the hand-written tests passing.)

`src/main/usage/UsageReceiver.ts`:
```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { gunzipSync } from 'node:zlib';
import type { UsageEvent } from '../../shared/usage';
import { parseClaudeLogs } from './otlp';

const LIMIT = 5 * 1024 * 1024;
type Status = { listening: boolean; port: number; error: string | null };

/** OTLP/HTTP JSON endpoint on 127.0.0.1 for Claude Code log events. */
export class UsageReceiver {
  private server: Server | null = null;
  private current: Status = { listening: false, port: 0, error: null };

  constructor(private readonly onEvents: (events: UsageEvent[]) => void) {}

  get status(): Status {
    return this.current;
  }

  async start(port: number): Promise<Status> {
    await this.stop();
    const server = createServer((req, res) => this.handle(req, res));
    this.current = await new Promise<Status>((resolve) => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        resolve({ listening: false, port, error: e.code === 'EADDRINUSE' ? `Port ${port} is in use by another program` : e.message });
      });
      server.listen(port, '127.0.0.1', () => resolve({ listening: true, port, error: null }));
    });
    this.server = this.current.listening ? server : null;
    return this.current;
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    this.current = { ...this.current, listening: false };
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const reply = (status: number, body = '{}') => {
      if (res.headersSent) return;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    };
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/v1/logs' && path !== '/v1/metrics') return reply(404);
    if (req.method !== 'POST') return reply(405);
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      req.resume();
      return reply(415);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > LIMIT) {
        tooBig = true;
        reply(413);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return;
      if (path === '/v1/metrics') return reply(200);
      let parsed: unknown;
      try {
        let buf = Buffer.concat(chunks);
        if ((req.headers['content-encoding'] ?? '').toLowerCase() === 'gzip') buf = gunzipSync(buf);
        parsed = JSON.parse(buf.toString('utf8'));
      } catch {
        return reply(400);
      }
      const { events, skipped } = parseClaudeLogs(parsed);
      if (skipped > 0) console.warn(`[usage] skipped ${skipped} api_request record(s) without a model or request id`);
      if (events.length > 0) this.onEvents(events);
      reply(200);
    });
  }
}
```

- [ ] **Step 4: Run tests, suite, typecheck, lint**

Run: `npx vitest run --project main src/main/usage && npm test && npm run typecheck && npm run lint`
Expected: PASS. (If the 413 test sees a connection reset instead of 413 on your platform, keep the `reply(413)` before `req.destroy()` and make the test accept either a 413 response or a fetch rejection; note it in the report.)

- [ ] **Step 5: Commit**

```bash
git add src/main/usage
git commit -m "feat: OTLP receiver for Claude Code usage events and per-task telemetry env"
```

---

### Task 5: Copilot CLI capture: span parsing, file tailer, terminal kind

**Files:**
- Create: `src/main/usage/copilot.ts`, `src/main/usage/CopilotFileTailer.ts`, `src/main/usage/__fixtures__/copilot/synthetic-spans.jsonl`, `src/main/usage/__fixtures__/copilot/README.md`
- Modify: `src/main/platform/Platform.ts`, `src/main/platform/darwin.ts`, `src/main/platform/darwin.test.ts`
- Test: `src/main/usage/copilot.test.ts`, `src/main/usage/CopilotFileTailer.test.ts`

**Interfaces:**
- Consumes: Task 4 `anyValue`, `attrMap`, `int`, `nanosToIso` from `./otlp`; Task 2 `UsageEvent`.
- Produces: `parseCopilotLine(line: string, taskId: string): { events: UsageEvent[]; unreadable: number }`; `class CopilotFileTailer { constructor(dir: string, onEvents: (events: UsageEvent[]) => void); poll(): Promise<void>; start(intervalMs?: number): void; stop(): void; get stats(): { records: number; unreadable: number } }`; `Platform.copilotCommand(): Command`.

The documented file format is "all signals as JSON lines". Two shapes are accepted because the exact shape is unverified: (a) a line holding an OTLP JSON traces export (`resourceSpans[].scopeSpans[].spans[]`, attributes as `{key, value}` lists), (b) a line holding one span object with plain attribute maps (`{ name, traceId, spanId, startTime | startTimeUnixNano, attributes: {...}, resource?: { attributes: {...} } }`, or ids under `spanContext`). LLM call spans are those whose `name` starts with `chat` and that carry `gen_ai.usage.input_tokens` or `gen_ai.usage.output_tokens`. Other lines (metrics, logs, other spans) are ignored, not unreadable. A line that is not JSON, or a chat span without usage or model, counts as unreadable.

- [ ] **Step 1: Synthetic fixture**

`src/main/usage/__fixtures__/copilot/README.md`:
```markdown
# Synthetic Copilot CLI spans

Hand-written from `copilot help monitoring` (Copilot CLI 1.0.57) and the OpenTelemetry GenAI semantic conventions on 2026-10-14. Not recorded from a real run: the owner has no Copilot licence. Replace with a recorded file when someone with a licence runs a task with Copilot CLI (`COPILOT_OTEL_FILE_EXPORTER_PATH` set by MIAC) and note the CLI version here.
```

`src/main/usage/__fixtures__/copilot/synthetic-spans.jsonl` (four lines: an OTLP traces line with one chat span, a flat chat span, a non-chat span, a metrics line):
```
{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"github-copilot"}}]},"scopeSpans":[{"spans":[{"traceId":"aaaa","spanId":"0001","name":"chat gpt-5.5","startTimeUnixNano":"1760436000000000000","attributes":[{"key":"gen_ai.operation.name","value":{"stringValue":"chat"}},{"key":"gen_ai.response.model","value":{"stringValue":"gpt-5.5"}},{"key":"gen_ai.usage.input_tokens","value":{"intValue":"12000"}},{"key":"gen_ai.usage.output_tokens","value":{"intValue":"800"}},{"key":"gen_ai.usage.cache_read.input_tokens","value":{"intValue":"30000"}}]}]}]}]}
{"name":"chat claude-sonnet-4.6","traceId":"bbbb","spanId":"0002","startTime":[1760436060,0],"attributes":{"gen_ai.request.model":"claude-sonnet-4.6","gen_ai.usage.input_tokens":5000,"gen_ai.usage.output_tokens":400,"gen_ai.usage.cache_creation.input_tokens":1000}}
{"name":"execute_tool bash","traceId":"bbbb","spanId":"0003","attributes":{"gen_ai.tool.name":"bash"}}
{"resourceMetrics":[]}
```

- [ ] **Step 2: Write the failing tests**

`src/main/usage/copilot.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCopilotLine } from './copilot';

const lines = readFileSync(path.join(__dirname, '__fixtures__', 'copilot', 'synthetic-spans.jsonl'), 'utf8').trim().split('\n');

describe('parseCopilotLine', () => {
  it('reads a chat span from an OTLP traces line', () => {
    expect(parseCopilotLine(lines[0], 't1')).toEqual({ unreadable: 0, events: [{
      id: 'aaaa:0001', taskId: 't1', tool: 'copilot-cli', sessionId: 'aaaa', model: 'gpt-5.5', at: new Date(1760436000000).toISOString(),
      inputTokens: 12000, outputTokens: 800, cacheReadTokens: 30000, cacheWriteTokens: 0, fast: false,
    }] });
  });
  it('reads a flat span with plain attributes and hrtime start', () => {
    expect(parseCopilotLine(lines[1], 't1').events[0]).toMatchObject({
      id: 'bbbb:0002', sessionId: 'bbbb', model: 'claude-sonnet-4.6', at: new Date(1760436060000).toISOString(),
      inputTokens: 5000, outputTokens: 400, cacheWriteTokens: 1000,
    });
  });
  it('ignores non-chat spans and other signals', () => {
    expect(parseCopilotLine(lines[2], 't1')).toEqual({ events: [], unreadable: 0 });
    expect(parseCopilotLine(lines[3], 't1')).toEqual({ events: [], unreadable: 0 });
    expect(parseCopilotLine('', 't1')).toEqual({ events: [], unreadable: 0 });
  });
  it('counts garbage and chat spans without a model as unreadable', () => {
    expect(parseCopilotLine('{not json', 't1')).toEqual({ events: [], unreadable: 1 });
    expect(parseCopilotLine('{"name":"chat x","traceId":"c","spanId":"1","attributes":{"gen_ai.usage.input_tokens":5}}', 't1')).toEqual({ events: [], unreadable: 1 });
  });
});
```

`src/main/usage/CopilotFileTailer.test.ts`:
```ts
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UsageEvent } from '../../shared/usage';
import { CopilotFileTailer } from './CopilotFileTailer';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const span = (spanId: string) => JSON.stringify({ name: 'chat gpt-5.5', traceId: 'tr', spanId, attributes: { 'gen_ai.response.model': 'gpt-5.5', 'gen_ai.usage.input_tokens': 10, 'gen_ai.usage.output_tokens': 2 } });

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'miac-cop-'));
  dirs.push(dir);
  const got: UsageEvent[] = [];
  return { dir, got, tailer: new CopilotFileTailer(dir, (e) => got.push(...e)) };
}

describe('CopilotFileTailer', () => {
  it('reads new complete lines per task file and keeps its offset', async () => {
    const { dir, got, tailer } = setup();
    writeFileSync(path.join(dir, 'task-a.jsonl'), `${span('1')}\n`);
    await tailer.poll();
    expect(got.map((e) => [e.taskId, e.id])).toEqual([['task-a', 'tr:1']]);
    appendFileSync(path.join(dir, 'task-a.jsonl'), `${span('2')}\n`);
    await tailer.poll();
    expect(got.map((e) => e.id)).toEqual(['tr:1', 'tr:2']);
    expect(tailer.stats).toEqual({ records: 2, unreadable: 0 });
  });
  it('waits for a partial last line to be completed', async () => {
    const { dir, got, tailer } = setup();
    const line = span('3');
    writeFileSync(path.join(dir, 'task-b.jsonl'), line.slice(0, 20));
    await tailer.poll();
    expect(got).toEqual([]);
    appendFileSync(path.join(dir, 'task-b.jsonl'), `${line.slice(20)}\n`);
    await tailer.poll();
    expect(got.map((e) => e.id)).toEqual(['tr:3']);
  });
  it('starts over when a file shrinks, and survives a missing folder', async () => {
    const { dir, got, tailer } = setup();
    writeFileSync(path.join(dir, 'task-c.jsonl'), `${span('4')}\n${span('5')}\n`);
    await tailer.poll();
    writeFileSync(path.join(dir, 'task-c.jsonl'), `${span('6')}\n`);
    await tailer.poll();
    expect(got.map((e) => e.id)).toEqual(['tr:4', 'tr:5', 'tr:6']);
    const missing = new CopilotFileTailer(path.join(dir, 'nope'), () => {});
    await expect(missing.poll()).resolves.toBeUndefined();
  });
  it('counts unreadable lines', async () => {
    const { dir, tailer } = setup();
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'task-d.jsonl'), 'garbage\n');
    await tailer.poll();
    expect(tailer.stats).toEqual({ records: 0, unreadable: 1 });
  });
});
```

Add to `src/main/platform/darwin.test.ts`:
```ts
it('starts Copilot CLI through a login shell', () => {
  expect(darwinPlatform({ SHELL: '/bin/zsh' }).copilotCommand()).toEqual({ command: '/bin/zsh', args: ['-l', '-c', 'exec copilot'] });
});
```
(`darwinPlatform` is already imported there.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/usage/copilot.test.ts src/main/usage/CopilotFileTailer.test.ts src/main/platform`
Expected: FAIL.

- [ ] **Step 4: Implement**

`src/main/platform/Platform.ts`, add to the interface:
```ts
  /** Start GitHub Copilot CLI. */
  copilotCommand(): Command;
```
`src/main/platform/darwin.ts`, add to the returned object: `copilotCommand: () => login(['-c', 'exec copilot']),`

`src/main/usage/copilot.ts`:
```ts
import type { UsageEvent } from '../../shared/usage';
import { attrMap, int, nanosToIso } from './otlp';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
type Attrs = Record<string, unknown>;

const plainAttrs = (v: unknown): Attrs => (Array.isArray(v) ? attrMap(v) : isObj(v) ? v : {});
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const n = (v: unknown): number => int(typeof v === 'number' || typeof v === 'string' ? v : undefined);

function startIso(span: Obj): string {
  if (Array.isArray(span.startTime) && span.startTime.length === 2) {
    const [sec, nanos] = span.startTime.map(Number);
    if (Number.isFinite(sec)) return new Date(sec * 1000 + Math.floor((nanos || 0) / 1e6)).toISOString();
  }
  return nanosToIso(span.startTimeUnixNano);
}

function toEvent(span: Obj, taskId: string): UsageEvent | 'unreadable' | null {
  const name = s(span.name);
  const a = plainAttrs(span.attributes);
  const hasUsage = a['gen_ai.usage.input_tokens'] !== undefined || a['gen_ai.usage.output_tokens'] !== undefined;
  if (!name.startsWith('chat') || !hasUsage) return name.startsWith('chat') && a['gen_ai.operation.name'] === 'chat' ? 'unreadable' : null;
  const ctx = isObj(span.spanContext) ? span.spanContext : span;
  const traceId = s(ctx.traceId) || s(span.traceId);
  const spanId = s(ctx.spanId) || s(span.spanId);
  const model = s(a['gen_ai.response.model']) || s(a['gen_ai.request.model']);
  if (!traceId || !spanId || !model) return 'unreadable';
  return {
    id: `${traceId}:${spanId}`,
    taskId,
    tool: 'copilot-cli',
    sessionId: traceId,
    model,
    at: startIso(span),
    inputTokens: n(a['gen_ai.usage.input_tokens']),
    outputTokens: n(a['gen_ai.usage.output_tokens']),
    cacheReadTokens: n(a['gen_ai.usage.cache_read.input_tokens']),
    cacheWriteTokens: n(a['gen_ai.usage.cache_creation.input_tokens']),
    fast: false,
  };
}

/** One line of the Copilot CLI file exporter. The task comes from the file name, not the line. */
export function parseCopilotLine(line: string, taskId: string): { events: UsageEvent[]; unreadable: number } {
  const out = { events: [] as UsageEvent[], unreadable: 0 };
  if (!line.trim()) return out;
  let doc: unknown;
  try {
    doc = JSON.parse(line);
  } catch {
    out.unreadable++;
    return out;
  }
  if (!isObj(doc)) return out;
  const spans: unknown[] = Array.isArray(doc.resourceSpans)
    ? doc.resourceSpans.flatMap((rs) => (isObj(rs) ? arr(rs.scopeSpans).flatMap((ss) => (isObj(ss) ? arr(ss.spans) : [])) : []))
    : typeof doc.name === 'string' ? [doc] : [];
  for (const span of spans) {
    if (!isObj(span)) continue;
    const e = toEvent(span, taskId);
    if (e === 'unreadable') out.unreadable++;
    else if (e) out.events.push(e);
  }
  return out;
}
```
Check `toEvent` against the tests: the "chat span without a model" case has `gen_ai.usage.input_tokens`, so it passes `hasUsage` and fails on `model` -> unreadable. The non-chat `execute_tool` span returns null.

`src/main/usage/CopilotFileTailer.ts`:
```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { UsageEvent } from '../../shared/usage';
import { parseCopilotLine } from './copilot';

/** Follows `<dir>/<taskId>.jsonl` files written by Copilot CLI. Offsets live in memory; the store dedupes re-reads after a restart. */
export class CopilotFileTailer {
  private readonly offsets = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private counts = { records: 0, unreadable: 0 };

  constructor(private readonly dir: string, private readonly onEvents: (events: UsageEvent[]) => void) {}

  get stats() {
    return { ...this.counts };
  }

  start(intervalMs = 5000): void {
    this.stop();
    this.timer = setInterval(() => void this.poll(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  poll(): Promise<void> {
    this.running ??= this.scan().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async scan(): Promise<void> {
    let names: string[];
    try {
      names = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      return;
    }
    for (const name of names) {
      try {
        await this.readFile(name);
      } catch (e) {
        console.warn(`[usage] could not read ${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  private async readFile(name: string): Promise<void> {
    const file = path.join(this.dir, name);
    const taskId = name.slice(0, -'.jsonl'.length);
    const { size } = await fs.stat(file);
    let offset = this.offsets.get(name) ?? 0;
    if (size < offset) offset = 0;
    if (size === offset) return;
    const handle = await fs.open(file, 'r');
    let chunk: Buffer;
    try {
      chunk = Buffer.alloc(size - offset);
      await handle.read(chunk, 0, chunk.length, offset);
    } finally {
      await handle.close();
    }
    const end = chunk.lastIndexOf(0x0a);
    if (end < 0) return;
    this.offsets.set(name, offset + end + 1);
    const events: UsageEvent[] = [];
    for (const line of chunk.subarray(0, end).toString('utf8').split('\n')) {
      const r = parseCopilotLine(line, taskId);
      events.push(...r.events);
      this.counts.unreadable += r.unreadable;
      if (r.unreadable > 0) console.warn(`[usage] ${r.unreadable} unreadable Copilot CLI line(s) in ${name}`);
    }
    this.counts.records += events.length;
    if (events.length > 0) this.onEvents(events);
  }
}
```

- [ ] **Step 5: Run tests, suite, typecheck, lint**

Run: `npx vitest run --project main src/main/usage src/main/platform && npm test && npm run typecheck && npm run lint`
Expected: PASS (typecheck may flag test fakes of `Platform` elsewhere; add `copilotCommand` to them).

- [ ] **Step 6: Commit**

```bash
git add src/main/usage src/main/platform
git commit -m "feat: Copilot CLI span tailer (synthetic fixtures) and copilot command"
```

---

### Task 6: Work item write-back: AdoClient writes, comment, UsageSync

**Files:**
- Modify: `src/main/services/AdoClient.ts`
- Create: `src/shared/workItemUsage.ts` (pure, shared so the renderer can preview the comment), `src/main/usage/UsageSync.ts`
- Test: `src/main/services/AdoClient.test.ts` (new describe block), `src/shared/workItemUsage.test.ts`, `src/main/usage/UsageSync.test.ts`

**Interfaces:**
- Consumes: Task 2 `TaskUsage`, `AI_FIELDS`, `AiField`, `FieldsStatus`, `SyncResult`; Task 2 Task fields `usageSyncedAt`, `usageSyncError`, `usageCommentId`.
- Produces:
  - `AdoClient.workItemTypeFields(project): Promise<{ type: string; fields: string[] }[]>` (one GET of `{project}/_apis/wit/workitemtypes`, disabled types dropped). This replaces the spec's per-type `workItemTypeFieldNames(project, type)`: one call returns every type with its fields, which Settings needs anyway.
  - `AdoClient.updateWorkItemFields(id: number, fields: Record<string, number>): Promise<void>`, `AdoClient.addComment(project, id: number, markdown): Promise<{ id: number }>`.
  - `WRITE_DENIED = 'The token cannot write work items (needs Work Items: Read & write)'` exported from `AdoClient.ts`.
  - `round2(n)`, `aiFieldValues(u: TaskUsage): Record<AiField, number>`, `renderUsageComment(u: TaskUsage, branch: string): string` in `src/shared/workItemUsage.ts`.
  - `class UsageSync { constructor(d: UsageSyncDeps); syncTask(taskId, opts?: { comment?: boolean; refreshFields?: boolean }): Promise<SyncResult>; syncChanged(): Promise<void>; fieldsStatus(connectionId: string, project: string): Promise<FieldsStatus> }` with
    ```ts
    export type UsageSyncDeps = {
      task: (taskId: string) => Task;
      tasks: () => Task[];
      target: (task: Task) => { connectionId: string; project: string } | null;
      client: (connectionId: string) => Pick<AdoClient, 'workItemTypeFields' | 'updateWorkItemFields' | 'addComment'>;
      run: <T>(connectionId: string, fn: () => Promise<T>) => Promise<T>;
      usage: (taskId: string) => TaskUsage;
      changedSince: (iso: string) => string[];
      patchTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
    };
    ```
  - `syncTask` never throws: failures come back as `{ ok: false, error }` and are stored in `Task.usageSyncError`. `usageSyncedAt` is set only when something was written (fields or the comment). Calls for one task are serialised so the comment can never be posted twice by overlapping syncs.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/services/AdoClient.test.ts` (it already has `server`, `client` against `${server.url}/unreliablewitness`, and `authFor`):
```ts
describe('AdoClient writes', () => {
  it('lists enabled work item types with their field reference names', async () => {
    server.route('GET', '/unreliablewitness/MIAC/_apis/wit/workitemtypes', { body: { value: [
      { name: 'Issue', fields: [{ referenceName: 'System.Title' }, { referenceName: 'Custom.AICost' }] },
      { name: 'Old', isDisabled: true, fields: [] },
    ] } });
    expect(await client.workItemTypeFields('MIAC')).toEqual([{ type: 'Issue', fields: ['System.Title', 'Custom.AICost'] }]);
  });
  it('patches fields with a JSON Patch document', async () => {
    server.route('PATCH', '/unreliablewitness/_apis/wit/workitems/7', { body: { id: 7 } });
    await client.updateWorkItemFields(7, { 'Custom.AICost': 23.85, 'Custom.AITokens': 1200 });
    const req = server.requests.at(-1)!;
    expect(req.path).toBe('/unreliablewitness/_apis/wit/workitems/7?api-version=7.1');
    expect(JSON.parse(req.body)).toEqual([
      { op: 'add', path: '/fields/Custom.AICost', value: 23.85 },
      { op: 'add', path: '/fields/Custom.AITokens', value: 1200 },
    ]);
    expect(req.auth).toBe(authFor('secret-pat'));
  });
  it('adds a markdown comment and returns its id', async () => {
    server.route('POST', '/unreliablewitness/MIAC/_apis/wit/workItems/7/comments', { body: { id: 991, text: 'x' } });
    expect(await client.addComment('MIAC', 7, 'hello')).toEqual({ id: 991 });
    const req = server.requests.at(-1)!;
    expect(req.path).toBe('/unreliablewitness/MIAC/_apis/wit/workItems/7/comments?format=markdown&api-version=7.1-preview.4');
    expect(JSON.parse(req.body)).toEqual({ text: 'hello' });
  });
  it('explains a token without write scope', async () => {
    server.route('PATCH', '/unreliablewitness/_apis/wit/workitems/7', { status: 403, body: {} });
    await expect(client.updateWorkItemFields(7, { 'Custom.AICost': 1 })).rejects.toMatchObject({ kind: 'unauthorized', message: 'The token cannot write work items (needs Work Items: Read & write)' });
    server.route('POST', '/unreliablewitness/MIAC/_apis/wit/workItems/7/comments', { status: 401, body: {} });
    await expect(client.addComment('MIAC', 7, 'x')).rejects.toMatchObject({ kind: 'unauthorized', message: 'The token cannot write work items (needs Work Items: Read & write)' });
  });
});
```
(If the file checks the request `content-type`, the fake server does not record headers; the JSON Patch content type is asserted by reading the code in review.)

`src/shared/workItemUsage.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { SessionSummary, TaskUsage } from './usage';
import { aiFieldValues, renderUsageComment, round2 } from './workItemUsage';

const EURO = String.fromCharCode(0x20ac);
const session = (over: Partial<SessionSummary>): SessionSummary => ({
  sessionId: 's', tool: 'claude-code', startedAt: '2026-10-14T09:00:00.000Z', models: ['claude-opus-5-5'], requests: 1,
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, unpricedRequests: 0, billable: true, ...over,
});
const usage = (sessions: SessionSummary[], over: Partial<TaskUsage> = {}): TaskUsage => ({
  taskId: 't', sessions, unpricedRequests: 0, usdToEur: 1, markupPct: 0,
  billable: { costUsd: 23.85, costEur: 23.854, tokens: 6812400 },
  byTool: { 'claude-code': { costUsd: 21.1, costEur: 21.104, sessions: 4, tokens: 6000000 }, 'copilot-cli': { costUsd: 2.75, costEur: 2.75, sessions: 2, tokens: 812400 } },
  ...over,
});

describe('workItemUsage', () => {
  it('rounds EUR to cents and keeps tokens whole', () => {
    expect(round2(2.345)).toBe(2.35);
    expect(aiFieldValues(usage([]))).toEqual({ 'Custom.AICost': 23.85, 'Custom.AICostClaude': 21.1, 'Custom.AICostCopilot': 2.75, 'Custom.AITokens': 6812400 });
  });
  it('renders the comment in the mockup format', () => {
    const u = usage([
      session({ sessionId: 'a', models: ['claude-opus-5-5'] }),
      session({ sessionId: 'b', models: ['claude-sonnet-5-5', 'claude-opus-5-5'] }),
      session({ sessionId: 'c', tool: 'copilot-cli', models: ['gpt-5.5'] }),
      session({ sessionId: 'd', tool: 'copilot-cli', models: ['secret-model'], billable: false }),
    ]);
    expect(renderUsageComment(u, 'feature/48213-save-delivery-address')).toBe([
      `AI usage for this work item (MIAC): ${EURO}23.85`,
      `Claude Code: ${EURO}21.10 over 4 sessions (claude-opus-5-5, claude-sonnet-5-5)`,
      `Copilot CLI: ${EURO}2.75 over 2 sessions (gpt-5.5)`,
      'Branch feature/48213-save-delivery-address',
    ].join('\n\n'));
  });
  it('omits tools without usage and mentions unpriced requests', () => {
    const u = usage([session({ sessionId: 'a', unpricedRequests: 3 })], {
      byTool: { 'claude-code': { costUsd: 1, costEur: 1, sessions: 1, tokens: 10 }, 'copilot-cli': { costUsd: 0, costEur: 0, sessions: 0, tokens: 0 } },
      billable: { costUsd: 1, costEur: 1, tokens: 10 },
    });
    expect(renderUsageComment(u, 'b')).toBe([`AI usage for this work item (MIAC): ${EURO}1.00`, `Claude Code: ${EURO}1.00 over 1 session (claude-opus-5-5)`, 'plus 3 requests with unpriced models', 'Branch b'].join('\n\n'));
  });
});
```

`src/main/usage/UsageSync.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../../shared/types';
import type { TaskUsage } from '../../shared/usage';
import { AdoClient } from '../services/AdoClient';
import { startAdoServer, type AdoServer } from '../test-helpers/adoServer';
import { UsageSync } from './UsageSync';

let server: AdoServer;
beforeEach(async () => { server = await startAdoServer(); });
afterEach(() => server.close());

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', repoId: 'r1', name: '', workItem: { id: '1', type: 'Issue', title: 'Checkout', url: null }, slug: '1-checkout', branch: 'feature/1-checkout',
  worktreePath: '/w', baseRef: 'origin/main', status: 'ready', setup: { copy: false, commands: [], startClaude: false, openShell: false, openCopilot: false },
  terminals: [], createdAt: '2026-10-14T08:00:00.000Z', finishedAt: null, usageSyncedAt: null, usageSyncError: null, usageCommentId: null, ...over,
});
const usage: TaskUsage = {
  taskId: 't1', sessions: [], unpricedRequests: 0, usdToEur: 0.92, markupPct: 0,
  billable: { costUsd: 10, costEur: 9.2, tokens: 5000 },
  byTool: { 'claude-code': { costUsd: 10, costEur: 9.2, sessions: 1, tokens: 5000 }, 'copilot-cli': { costUsd: 0, costEur: 0, sessions: 0, tokens: 0 } },
};

function setup(initial: Task = task(), changed: string[] = ['t1']) {
  const tasks = new Map([[initial.id, initial]]);
  const ran: string[] = [];
  const client = new AdoClient(`${server.url}/org`, async () => 'pat');
  const sync = new UsageSync({
    task: (id) => tasks.get(id)!,
    tasks: () => [...tasks.values()],
    target: (t) => (t.repoId === 'r1' ? { connectionId: 'c1', project: 'MIAC' } : null),
    client: () => client,
    run: (id, fn) => { ran.push(id); return fn(); },
    usage: () => usage,
    changedSince: () => changed,
    patchTask: async (id, patch) => { tasks.set(id, { ...tasks.get(id)!, ...patch }); },
  });
  server.route('GET', '/org/MIAC/_apis/wit/workitemtypes', { body: { value: [
    { name: 'Issue', fields: [{ referenceName: 'System.Title' }, { referenceName: 'Custom.AICost' }, { referenceName: 'Custom.AITokens' }] },
    { name: 'Task', fields: [{ referenceName: 'System.Title' }] },
  ] } });
  server.route('PATCH', '/org/_apis/wit/workitems/1', { body: { id: 1 } });
  server.route('POST', '/org/MIAC/_apis/wit/workItems/1/comments', { body: { id: 77 } });
  return { sync, tasks, ran };
}
const patches = () => server.requests.filter((r) => r.method === 'PATCH');
const comments = () => server.requests.filter((r) => r.method === 'POST');

describe('UsageSync', () => {
  it('writes only the fields the type has and posts the comment once', async () => {
    const { sync, tasks, ran } = setup();
    const r = await sync.syncTask('t1', { comment: true });
    expect(r).toEqual({ ok: true, fieldsWritten: ['Custom.AICost', 'Custom.AITokens'], fieldsMissing: ['Custom.AICostClaude', 'Custom.AICostCopilot'], commentPosted: true, error: null });
    expect(JSON.parse(patches()[0].body)).toEqual([{ op: 'add', path: '/fields/Custom.AICost', value: 9.2 }, { op: 'add', path: '/fields/Custom.AITokens', value: 5000 }]);
    expect(tasks.get('t1')).toMatchObject({ usageCommentId: 77, usageSyncError: null });
    expect(tasks.get('t1')!.usageSyncedAt).not.toBeNull();
    expect(ran).toEqual(['c1']);
    const again = await sync.syncTask('t1', { comment: true });
    expect(again.commentPosted).toBe(false);
    expect(comments()).toHaveLength(1);
  });
  it('never posts twice when two syncs overlap', async () => {
    const { sync } = setup();
    await Promise.all([sync.syncTask('t1', { comment: true }), sync.syncTask('t1', { comment: true })]);
    expect(comments()).toHaveLength(1);
  });
  it('skips the field write when the type has none of the fields', async () => {
    const { sync, tasks } = setup(task({ workItem: { id: '1', type: 'Task', title: 'x', url: null } }));
    const r = await sync.syncTask('t1');
    expect(r).toMatchObject({ ok: true, fieldsWritten: [], commentPosted: false });
    expect(patches()).toHaveLength(0);
    expect(tasks.get('t1')!.usageSyncedAt).toBeNull();
  });
  it('stores a write failure on the task instead of throwing', async () => {
    const { sync, tasks } = setup();
    server.route('PATCH', '/org/_apis/wit/workitems/1', { status: 403, body: {} });
    const r = await sync.syncTask('t1', { comment: true });
    expect(r).toMatchObject({ ok: false, error: 'The token cannot write work items (needs Work Items: Read & write)' });
    expect(tasks.get('t1')!.usageSyncError).toBe('The token cannot write work items (needs Work Items: Read & write)');
  });
  it('refuses tasks without a work item or connection', async () => {
    const { sync } = setup(task({ workItem: null }));
    expect(await sync.syncTask('t1')).toMatchObject({ ok: false, error: 'This task has no work item in a connected Azure DevOps project' });
    const other = setup(task({ repoId: 'r2' }));
    expect((await other.sync.syncTask('t1')).ok).toBe(false);
  });
  it('hourly sync only touches tasks whose usage changed', async () => {
    const { sync } = setup(task(), []);
    await sync.syncChanged();
    expect(patches()).toHaveLength(0);
    const changed = setup(task(), ['t1']);
    await changed.sync.syncChanged();
    expect(patches()).toHaveLength(1);
    expect(comments()).toHaveLength(0);
  });
  it('reports field presence per work item type', async () => {
    const { sync } = setup();
    expect(await sync.fieldsStatus('c1', 'MIAC')).toEqual({ connectionId: 'c1', types: [
      { type: 'Issue', present: ['Custom.AICost', 'Custom.AITokens'], missing: ['Custom.AICostClaude', 'Custom.AICostCopilot'] },
      { type: 'Task', present: [], missing: ['Custom.AICost', 'Custom.AICostClaude', 'Custom.AICostCopilot', 'Custom.AITokens'] },
    ] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project main src/main/services/AdoClient.test.ts src/shared/workItemUsage.test.ts src/main/usage/UsageSync.test.ts`
Expected: FAIL.

- [ ] **Step 3: AdoClient writes**

In `src/main/services/AdoClient.ts`:
- Export `export const WRITE_DENIED = 'The token cannot write work items (needs Work Items: Read & write)';`
- Change the private method signature to `request<T>(path: string, init: RequestInit = {}, opts: { write?: boolean; retried?: boolean } = {})`. The 429 retry becomes `return this.request<T>(path, init, { ...opts, retried: true });` guarded by `!opts.retried`. In the unauthorized branch use `opts.write && (res.status === 401 || res.status === 403) ? WRITE_DENIED : '<existing read message>'` as the message. Existing callers pass no third argument and keep their behaviour.
- Add the methods:
```ts
  async workItemTypeFields(project: string): Promise<{ type: string; fields: string[] }[]> {
    const data = await this.request<{ value?: { name: string; isDisabled?: boolean; fields?: { referenceName: string }[] }[] }>(
      `/${encodeURIComponent(project)}/_apis/wit/workitemtypes?${API}`,
    );
    return (data.value ?? [])
      .filter((t) => !t.isDisabled)
      .map((t) => ({ type: t.name, fields: (t.fields ?? []).map((f) => f.referenceName) }));
  }

  async updateWorkItemFields(id: number, fields: Record<string, number>): Promise<void> {
    await this.request<Json>(
      `/_apis/wit/workitems/${id}?${API}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json-patch+json' },
        body: JSON.stringify(Object.entries(fields).map(([name, value]) => ({ op: 'add', path: `/fields/${name}`, value }))),
      },
      { write: true },
    );
  }

  async addComment(project: string, id: number, markdown: string): Promise<{ id: number }> {
    const data = await this.request<{ id: number }>(
      `/${encodeURIComponent(project)}/_apis/wit/workItems/${id}/comments?format=markdown&api-version=7.1-preview.4`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: markdown }) },
      { write: true },
    );
    return { id: data.id };
  }
```
Update the class doc comment ("Four read-only calls") to describe reads and the three write calls.

- [ ] **Step 4: workItemUsage and UsageSync**

`src/shared/workItemUsage.ts`:
```ts
import type { AiField, TaskUsage, UsageTool } from './usage';

const EURO = String.fromCharCode(0x20ac);
const LABEL: Record<UsageTool, string> = { 'claude-code': 'Claude Code', 'copilot-cli': 'Copilot CLI' };

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const eur = (n: number) => `${EURO}${round2(n).toFixed(2)}`;

export function aiFieldValues(u: TaskUsage): Record<AiField, number> {
  return {
    'Custom.AICost': round2(u.billable.costEur),
    'Custom.AICostClaude': round2(u.byTool['claude-code'].costEur),
    'Custom.AICostCopilot': round2(u.byTool['copilot-cli'].costEur),
    'Custom.AITokens': Math.round(u.billable.tokens),
  };
}

/** The usage comment posted once on finish. Only billable sessions count; tools without usage are left out. */
export function renderUsageComment(u: TaskUsage, branch: string): string {
  const billable = u.sessions.filter((s) => s.billable);
  const lines = [`AI usage for this work item (MIAC): ${eur(u.billable.costEur)}`];
  for (const tool of ['claude-code', 'copilot-cli'] as const) {
    const t = u.byTool[tool];
    if (t.sessions === 0) continue;
    const models = [...new Set(billable.filter((s) => s.tool === tool).flatMap((s) => s.models))];
    const modelText = models.length > 0 ? ` (${models.join(', ')})` : '';
    lines.push(`${LABEL[tool]}: ${eur(t.costEur)} over ${t.sessions} session${t.sessions === 1 ? '' : 's'}${modelText}`);
  }
  const unpriced = billable.reduce((n, s) => n + s.unpricedRequests, 0);
  if (unpriced > 0) lines.push(`plus ${unpriced} request${unpriced === 1 ? '' : 's'} with unpriced models`);
  lines.push(`Branch ${branch}`);
  return lines.join('\n\n');
}
```

`src/main/usage/UsageSync.ts`:
```ts
import type { Task } from '../../shared/types';
import { AI_FIELDS, type AiField, type FieldsStatus, type SyncResult, type TaskUsage } from '../../shared/usage';
import type { AdoClient } from '../services/AdoClient';
import { aiFieldValues, renderUsageComment } from '../../shared/workItemUsage';

export type UsageSyncDeps = {
  task: (taskId: string) => Task;
  tasks: () => Task[];
  target: (task: Task) => { connectionId: string; project: string } | null;
  client: (connectionId: string) => Pick<AdoClient, 'workItemTypeFields' | 'updateWorkItemFields' | 'addComment'>;
  run: <T>(connectionId: string, fn: () => Promise<T>) => Promise<T>;
  usage: (taskId: string) => TaskUsage;
  changedSince: (iso: string) => string[];
  patchTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
};

type TypeFields = { type: string; fields: string[] }[];
const NO_TARGET = 'This task has no work item in a connected Azure DevOps project';

/** Writes usage totals to work items: the AI fields that exist on the type, and the usage comment at most once. */
export class UsageSync {
  private readonly types = new Map<string, TypeFields>();
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly d: UsageSyncDeps) {}

  syncTask(taskId: string, opts: { comment?: boolean; refreshFields?: boolean } = {}): Promise<SyncResult> {
    const prev = this.chains.get(taskId) ?? Promise.resolve();
    const next = prev.then(() => this.syncNow(taskId, opts));
    const tail = next.catch(() => undefined);
    this.chains.set(taskId, tail);
    void tail.then(() => {
      if (this.chains.get(taskId) === tail) this.chains.delete(taskId);
    });
    return next;
  }

  async syncChanged(): Promise<void> {
    for (const t of this.d.tasks()) {
      if (!t.workItem || !this.d.target(t)) continue;
      if (!this.d.changedSince(t.usageSyncedAt ?? '').includes(t.id)) continue;
      await this.syncTask(t.id);
    }
  }

  async fieldsStatus(connectionId: string, project: string): Promise<FieldsStatus> {
    const types = await this.d.run(connectionId, () => this.loadTypes(connectionId, project, true));
    return {
      connectionId,
      types: types.map((t) => ({
        type: t.type,
        present: AI_FIELDS.filter((f) => t.fields.includes(f)),
        missing: AI_FIELDS.filter((f) => !t.fields.includes(f)),
      })),
    };
  }

  private async loadTypes(connectionId: string, project: string, refresh: boolean): Promise<TypeFields> {
    const hit = this.types.get(connectionId);
    if (hit && !refresh) return hit;
    const types = await this.d.client(connectionId).workItemTypeFields(project);
    this.types.set(connectionId, types);
    return types;
  }

  private async syncNow(taskId: string, opts: { comment?: boolean; refreshFields?: boolean }): Promise<SyncResult> {
    const fail = (error: string, missing: AiField[] = []): SyncResult => ({ ok: false, fieldsWritten: [], fieldsMissing: missing, commentPosted: false, error });
    const task = this.d.task(taskId);
    const target = task.workItem ? this.d.target(task) : null;
    if (!task.workItem || !target) return fail(NO_TARGET);
    const workItem = task.workItem;
    const workItemId = Number(workItem.id);
    const usage = this.d.usage(taskId);
    try {
      const outcome = await this.d.run(target.connectionId, async () => {
        const client = this.d.client(target.connectionId);
        const types = await this.loadTypes(target.connectionId, target.project, opts.refreshFields ?? false);
        const have = new Set(types.find((t) => t.type.toLowerCase() === workItem.type.toLowerCase())?.fields ?? []);
        const present = AI_FIELDS.filter((f) => have.has(f));
        const missing = AI_FIELDS.filter((f) => !have.has(f));
        if (present.length > 0) {
          const values = aiFieldValues(usage);
          await client.updateWorkItemFields(workItemId, Object.fromEntries(present.map((f) => [f, values[f]])));
        }
        let commentPosted = false;
        if (opts.comment && this.d.task(taskId).usageCommentId === null) {
          const { id } = await client.addComment(target.project, workItemId, renderUsageComment(usage, task.branch));
          await this.d.patchTask(taskId, { usageCommentId: id });
          commentPosted = true;
        }
        return { present, missing, commentPosted };
      });
      const wrote = outcome.present.length > 0 || outcome.commentPosted;
      await this.d.patchTask(taskId, wrote ? { usageSyncedAt: new Date().toISOString(), usageSyncError: null } : { usageSyncError: null });
      return { ok: true, fieldsWritten: outcome.present, fieldsMissing: outcome.missing, commentPosted: outcome.commentPosted, error: null };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      try {
        await this.d.patchTask(taskId, { usageSyncError: message });
      } catch {
        // the store is failing; the result still carries the error
      }
      return fail(message);
    }
  }
}
```

- [ ] **Step 5: Run tests, suite, typecheck, lint**

Run: `npx vitest run --project main src/main/services/AdoClient.test.ts src/main/usage src/shared && npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/AdoClient.ts src/main/services/AdoClient.test.ts src/main/usage src/shared
git commit -m "feat: write AI cost fields and the usage comment to work items"
```

---

### Task 7: Main-process wiring: handlers, finish sync, IPC, main.ts

**Files:**
- Create: `src/main/usage/csv.ts`, `src/main/usage/csv.test.ts`
- Modify: `src/main/ipc/handlers.ts`, `src/main/ipc/handlers.test.ts`, `src/main.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-6.
- Produces: `Services` gains
  ```ts
  usage: UsageStore;
  rates: RateStore;
  settings: SettingsStore;
  receiver: Pick<UsageReceiver, 'start' | 'status'>;
  copilot: Pick<CopilotFileTailer, 'stats' | 'poll'>;
  usageDir: string;
  /** Registers a function to run every hour (main uses setInterval; tests capture it). */
  onHourly: (fn: () => void) => void;
  /** How long Finish waits after closing terminals so the last telemetry batch arrives (main 2500, tests 0). */
  finishFlushMs: number;
  ```
  All channels from Task 2 are implemented and the temporary `as Handlers` cast (if Task 2 added one) is removed. `usage:changed` is broadcast for every store change, and with `taskId: '*'` after settings change (the renderer refetches every task on `'*'`).
- `usageCsv(records: UsageRecord[], isBillable: (sessionId: string) => boolean, eurFactor: number): string`.

- [ ] **Step 1: CSV (test first)**

`src/main/usage/csv.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { UsageRecord } from '../../shared/usage';
import { usageCsv } from './csv';

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  id: 'r', taskId: 't', tool: 'claude-code', sessionId: 's1', model: 'claude-opus-5-5', at: '2026-10-14T10:00:00.000Z',
  inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, fast: false, costUsd: 0.5, rateId: 'anthropic-opus-5-5', rate: null, ...over,
});

describe('usageCsv', () => {
  it('writes one row per request with EUR, billable flag and quoting', () => {
    const csv = usageCsv([rec({}), rec({ id: 'x', sessionId: 's2', model: 'odd,"model"', costUsd: null, rateId: null })], (s) => s === 's1', 0.9);
    expect(csv.split('\r\n')).toEqual([
      'time,tool,session,model,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,fast,cost_usd,cost_eur,billable,rate_id',
      '2026-10-14T10:00:00.000Z,claude-code,s1,claude-opus-5-5,1,2,3,4,false,0.5,0.45,true,anthropic-opus-5-5',
      '2026-10-14T10:00:00.000Z,claude-code,s2,"odd,""model""",1,2,3,4,false,,,false,',
      '',
    ]);
  });
});
```

`src/main/usage/csv.ts`:
```ts
import type { UsageRecord } from '../../shared/usage';
import { round6 } from '../pricing/RateTable';

const cell = (v: string | number | boolean | null): string => {
  const s = v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function usageCsv(records: UsageRecord[], isBillable: (sessionId: string) => boolean, eurFactor: number): string {
  const head = ['time', 'tool', 'session', 'model', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'fast', 'cost_usd', 'cost_eur', 'billable', 'rate_id'];
  const rows = records.map((r) => [
    r.at, r.tool, r.sessionId, r.model, r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheWriteTokens, r.fast,
    r.costUsd, r.costUsd === null ? null : round6(r.costUsd * eurFactor), isBillable(r.sessionId), r.rateId,
  ]);
  return `${[head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
```

- [ ] **Step 2: Extend the handler test harness**

In `src/main/ipc/handlers.test.ts`, change `harness(crypto = fakeCrypto())` to `harness(crypto = fakeCrypto(), over: Partial<Services> = {})`. Before building `services`, add:
```ts
  const usageDir = mkdtempSync(path.join(os.tmpdir(), 'miac-usage-'));
  connDirs.push(usageDir);
  const rates = new RateStore(path.join(usageDir, 'rates.json'));
  await rates.load();
  const settings = new SettingsStore(path.join(usageDir, 'settings.json'));
  await settings.load();
  const usage = new UsageStore(usageDir, () => rates.list());
  await usage.load();
  const receiverStarts: number[] = [];
  let receiverStatus = { listening: true, port: 4319, error: null as string | null };
  const receiver = {
    get status() { return receiverStatus; },
    start: async (port: number) => {
      receiverStarts.push(port);
      receiverStatus = port === 1999 ? { listening: false, port, error: `Port ${port} is in use by another program` } : { listening: true, port, error: null };
      return receiverStatus;
    },
  };
  const hourly: (() => void)[] = [];
```
add to the `services` literal:
```ts
    usage, rates, settings, receiver,
    copilot: { stats: { records: 0, unreadable: 0 }, poll: async () => {} },
    usageDir,
    onHourly: (fn) => { hourly.push(fn); },
    finishFlushMs: 0,
    ...over,
```
and return `usage, settings, rates, receiverStarts, hourly, usageDir` from the harness. Imports: `RateStore`, `SettingsStore`, `UsageStore` from `../usage/...`. Add `syncUsage: false` to every existing `tasks:finish` options literal (Task 2 may have done this already).

Add a helper below `routeHealthyOrg`:
```ts
async function linkedTask(hx: Awaited<ReturnType<typeof harness>>) {
  routeHealthyOrg(hx.server);
  const c = await hx.h['connections:save']({ organizationUrl: `${hx.server.url}/unreliablewitness`, project: 'MIAC', pat: 'secret-pat' });
  await hx.h['repos:setConnection'](hx.added.id, c.id);
  const done = hx.setupDone();
  const t = await hx.h['tasks:create'](hx.input({ openShell: false }));
  await done;
  await hx.usage.add({ id: 'req-1', taskId: t.id, tool: 'claude-code', sessionId: 's1', model: 'claude-opus-5-5', at: '2026-10-14T10:00:00.000Z',
    inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, fast: false });
  hx.server.route('GET', '/unreliablewitness/MIAC/_apis/wit/workitemtypes', { body: { value: [
    { name: 'User Story', fields: [{ referenceName: 'Custom.AICost' }, { referenceName: 'Custom.AICostClaude' }, { referenceName: 'Custom.AICostCopilot' }, { referenceName: 'Custom.AITokens' }] },
  ] } });
  hx.server.route('PATCH', '/unreliablewitness/_apis/wit/workitems/48231', { body: { id: 48231 } });
  hx.server.route('POST', '/unreliablewitness/MIAC/_apis/wit/workItems/48231/comments', { body: { id: 501 } });
  return { t, c };
}
```

- [ ] **Step 3: Write the failing handler tests**

Append to `src/main/ipc/handlers.test.ts`:
```ts
describe('handlers: usage', () => {
  it('starts every task terminal with the telemetry env', async () => {
    const hx = await harness();
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](hx.input({ openShell: false }));
    await done;
    const def = await hx.h['terminals:open'](t.id, { kind: 'run', label: 'env', command: 'echo "T=$OTEL_RESOURCE_ATTRIBUTES E=$OTEL_EXPORTER_OTLP_LOGS_ENDPOINT C=$CLAUDE_CODE_ENABLE_TELEMETRY"; sleep 5' });
    await new Promise((r) => setTimeout(r, 300));
    expect(await hx.h['terminals:buffer'](def.id)).toContain(`T=miac.task.id=${t.id} E=http://127.0.0.1:4319/v1/logs C=1`);
    hx.terminals.killAllForTask(t.id);
  });

  it('opens a Copilot CLI terminal with the platform command', async () => {
    const platform = { ...darwinPlatform({ SHELL: '/bin/sh' }), copilotCommand: () => ({ command: '/bin/sh', args: ['-c', 'echo copilot-started; sleep 5'] }) };
    const hx = await harness(fakeCrypto(), { platform });
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](hx.input({ openShell: false, openCopilot: true }));
    await done;
    const def = hx.store.state.tasks[0].terminals.find((x) => x.kind === 'copilot');
    expect(def?.label).toBe('Copilot CLI');
    await new Promise((r) => setTimeout(r, 300));
    expect(await hx.h['terminals:buffer'](def!.id)).toContain('copilot-started');
    hx.terminals.killAllForTask(t.id);
  });

  it('summarises, toggles billable, exports CSV and broadcasts changes', async () => {
    const hx = await harness();
    await hx.usage.add({ id: 'a', taskId: 'tx', tool: 'claude-code', sessionId: 's1', model: 'claude-opus-5-5', at: '2026-10-14T10:00:00.000Z', inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, fast: false });
    expect(hx.broadcasts).toContainEqual({ event: 'usage:changed', payload: { taskId: 'tx' } });
    expect((await hx.h['usage:task']('tx')).billable.costUsd).toBe(4);
    const after = await hx.h['usage:setBillable']('tx', 's1', false);
    expect(after.billable.costUsd).toBe(0);
    expect(await hx.h['usage:exportCsv']('tx')).toContain(',s1,claude-opus-5-5,1000000,0,0,0,false,4,3.68,false,');
  });

  it('saves settings, moves the receiver and reports a busy port', async () => {
    const hx = await harness();
    const s = await hx.h['settings:get']();
    await hx.h['settings:save']({ ...s, usdToEur: 0.9 });
    expect(hx.receiverStarts).toEqual([]);
    await hx.h['settings:save']({ ...s, receiverPort: 1999 });
    expect(hx.receiverStarts).toEqual([1999]);
    expect(await hx.h['usage:receiverStatus']()).toEqual({ listening: false, port: 1999, error: 'Port 1999 is in use by another program', copilot: { records: 0, unreadable: 0 } });
    expect(hx.broadcasts.some((b) => b.event === 'notice' && String((b.payload as { message: string }).message).includes('in use'))).toBe(true);
    expect(hx.broadcasts).toContainEqual({ event: 'usage:changed', payload: { taskId: '*' } });
    await expect(hx.h['settings:save']({ ...s, receiverPort: 80 })).rejects.toThrow();
  });

  it('lists, saves and resets rates', async () => {
    const hx = await harness();
    const { rates, officialAsOf } = await hx.h['rates:list']();
    expect(officialAsOf).toBe('2026-10-14');
    const saved = await hx.h['rates:save'](rates.slice(0, 2));
    expect(saved).toHaveLength(2);
    expect((await hx.h['rates:reset']()).length).toBe(rates.length);
  });

  it('finish writes the fields and the comment, then the task is done', async () => {
    const hx = await harness();
    const { t } = await linkedTask(hx);
    await hx.h['tasks:finish'](t.id, { closeTerminals: true, removeWorktree: true, deleteBranch: true, syncUsage: true });
    const task = hx.store.state.tasks[0];
    expect(task).toMatchObject({ status: 'done', usageCommentId: 501, usageSyncError: null });
    const patch = hx.server.requests.find((r) => r.method === 'PATCH');
    expect(JSON.parse(patch!.body)).toContainEqual({ op: 'add', path: '/fields/Custom.AICost', value: 3.68 });
    const comment = hx.server.requests.find((r) => r.method === 'POST' && r.path.includes('/comments'));
    expect(JSON.parse(comment!.body).text).toContain('Branch feature/48231-show-estimated-delivery-date');
  });

  it('finish still completes when Azure DevOps rejects the write', async () => {
    const hx = await harness();
    const { t } = await linkedTask(hx);
    hx.server.route('PATCH', '/unreliablewitness/_apis/wit/workitems/48231', { status: 403, body: {} });
    await hx.h['tasks:finish'](t.id, { closeTerminals: true, removeWorktree: true, deleteBranch: true, syncUsage: true });
    expect(hx.store.state.tasks[0]).toMatchObject({ status: 'done', usageSyncError: 'The token cannot write work items (needs Work Items: Read & write)' });
    expect(hx.broadcasts.some((b) => b.event === 'notice' && String((b.payload as { message: string }).message).includes('could not be written'))).toBe(true);
  });

  it('sync now and the hourly sync write fields without a comment', async () => {
    const hx = await harness();
    const { t, c } = await linkedTask(hx);
    expect(await hx.h['usage:sync'](t.id)).toMatchObject({ ok: true, commentPosted: false, fieldsWritten: ['Custom.AICost', 'Custom.AICostClaude', 'Custom.AICostCopilot', 'Custom.AITokens'] });
    expect(hx.hourly).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 5)); // changedSince compares ISO times; keep them apart
    await hx.usage.add({ id: 'req-2', taskId: t.id, tool: 'claude-code', sessionId: 's1', model: 'claude-opus-5-5', at: '2026-10-14T11:00:00.000Z', inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, fast: false });
    hx.hourly[0]();
    await new Promise((r) => setTimeout(r, 200));
    expect(hx.server.requests.filter((r) => r.method === 'PATCH')).toHaveLength(2);
    expect(hx.server.requests.some((r) => r.path.includes('/comments'))).toBe(false);
    expect((await hx.h['usage:fieldsStatus'](c.id)).types[0]).toMatchObject({ type: 'User Story', missing: [] });
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run --project main src/main/ipc src/main/usage/csv.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement in `handlers.ts`**

Add to `Services` the fields listed under Interfaces (imports: `UsageStore`, `RateStore`, `SettingsStore`, `UsageReceiver`, `CopilotFileTailer`, `UsageSync`, `telemetryEnv`, `usageCsv`, `OFFICIAL_RATES_AS_OF`).

Inside `createHandlers`, after `patchTask` is defined:
```ts
  const usageSync = new UsageSync({
    task: taskById,
    tasks: () => s.store.state.tasks,
    target: (task) => {
      const connectionId = s.repos.list().find((r) => r.id === task.repoId)?.connectionId ?? null;
      if (!connectionId) return null;
      try {
        return { connectionId, project: s.connections.get(connectionId).project };
      } catch {
        return null;
      }
    },
    client: (connectionId) => s.ado.client(connectionId),
    run: withConnection,
    usage: (taskId) => s.usage.summarize(taskId, s.settings.get()),
    changedSince: (iso) => s.usage.changedSince(iso),
    patchTask,
  });
  s.usage.on('changed', (taskId) => s.broadcast('usage:changed', { taskId }));
  s.onHourly(() => {
    if (s.settings.get().hourlySync) void usageSync.syncChanged();
  });
  const receiverStatus = () => ({ ...s.receiver.status, copilot: s.copilot.stats });
```

`terminalCommand` gains `if (def.kind === 'copilot') return s.platform.copilotCommand();`. `spawnTerminal` passes `env: telemetryEnv(task.id, s.settings.get().receiverPort, s.usageDir)`. `initialTerminals` pushes `{ id: randomUUID(), kind: 'copilot', label: 'Copilot CLI' }` after Claude when `task.setup.openCopilot`. `tasks:create` stores `openCopilot: input.openCopilot ?? false` in `setup` and sets `usageSyncedAt: null, usageSyncError: null, usageCommentId: null`.

In `tasks:finish`, after the `status: 'done'` patch and before `release` (still inside `try`):
```ts
        if (options.syncUsage) {
          if (options.closeTerminals && s.finishFlushMs > 0) await new Promise((r) => setTimeout(r, s.finishFlushMs));
          await s.copilot.poll();
          const result = await usageSync.syncTask(taskId, { comment: true, refreshFields: true });
          if (!result.ok)
            s.broadcast('notice', { level: 'warn', message: `Task finished, but the AI usage could not be written to the work item: ${result.error}. Use Sync now on the Usage screen to retry.` });
        }
```

New channel handlers:
```ts
    'usage:task': async (taskId) => s.usage.summarize(taskId, s.settings.get()),
    'usage:setBillable': async (taskId, sessionId, billable) => {
      await s.usage.setBillable(taskId, sessionId, billable);
      return s.usage.summarize(taskId, s.settings.get());
    },
    'usage:sync': async (taskId) => usageSync.syncTask(taskId, { refreshFields: true }),
    'usage:exportCsv': async (taskId) => {
      const st = s.settings.get();
      return usageCsv(s.usage.records(taskId), (sessionId) => s.usage.isBillable(taskId, sessionId), st.usdToEur * (1 + st.markupPct / 100));
    },
    'usage:fieldsStatus': async (connectionId) => usageSync.fieldsStatus(connectionId, s.connections.get(connectionId).project),
    'usage:receiverStatus': async () => receiverStatus(),
    'rates:list': async () => ({ rates: s.rates.list(), officialAsOf: OFFICIAL_RATES_AS_OF }),
    'rates:save': async (rates) => s.rates.save(rates),
    'rates:reset': async () => s.rates.reset(),
    'settings:get': async () => s.settings.get(),
    'settings:save': async (next) => {
      const before = s.settings.get();
      const saved = await s.settings.save(next);
      if (saved.receiverPort !== before.receiverPort || !s.receiver.status.listening) {
        const st = await s.receiver.start(saved.receiverPort);
        s.broadcast('usage:receiverStatus', receiverStatus());
        if (!st.listening)
          s.broadcast('notice', { level: 'warn', message: `AI usage capture is off: ${st.error}. Pick another port in Settings.` });
        else if (saved.receiverPort !== before.receiverPort)
          s.broadcast('notice', { level: 'info', message: `AI usage is now received on port ${saved.receiverPort}. Terminals started before this change keep using the old port until you restart them.` });
      }
      s.broadcast('usage:changed', { taskId: '*' });
      return saved;
    },
```

- [ ] **Step 6: Wire `src/main.ts`**

In `boot()`, before `createHandlers`:
```ts
  const userData = app.getPath('userData');
  const usageDir = path.join(userData, 'usage');
  await fs.mkdir(path.join(usageDir, 'copilot'), { recursive: true });
  const settings = new SettingsStore(path.join(userData, 'settings.json'));
  const settingsLoaded = await settings.load();
  const rates = new RateStore(path.join(userData, 'rates.json'));
  const ratesLoaded = await rates.load();
  const usage = new UsageStore(usageDir, () => rates.list());
  const usageLoaded = await usage.load();
  const ingest = (events: UsageEvent[]) => {
    for (const e of events) usage.add(e).catch((err) => console.error('[usage] could not store a record', err));
  };
  const receiver = new UsageReceiver(ingest);
  const copilot = new CopilotFileTailer(path.join(usageDir, 'copilot'), ingest);
```
(`import { promises as fs } from 'node:fs';`.) Pass to `createHandlers`: `usage, rates, settings, receiver, copilot, usageDir, onHourly: (fn) => { setInterval(fn, 60 * 60 * 1000); }, finishFlushMs: 2500`. After `registerIpc`:
```ts
  const receiverStarted = await receiver.start(settings.get().receiverPort);
  copilot.start();
  terminals.on('exit', () => void copilot.poll());
```
In `did-finish-load` add notices: receiver not listening -> warn `AI usage capture is off: ${error}. Pick another port in Settings > AI cost and invoicing.`; `usageLoaded.damagedLines > 0` -> warn `${n} damaged line(s) in the usage files were skipped.`; `settingsLoaded.recovered` / `ratesLoaded.recovered` -> warn `<file> was unreadable and was moved to <backup>; defaults are used.` In `before-quit` add `copilot.stop(); void receiver.stop();`.

- [ ] **Step 7: Run tests, suite, typecheck, lint**

Run: `npx vitest run --project main src/main && npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main src/main.ts
git commit -m "feat: wire usage capture, pricing, sync and settings into the main process"
```

---

### Task 8: Renderer: cost tile, nav totals and the Usage screen

**Files:**
- Create: `src/renderer/format.ts`, `src/renderer/hooks/useTaskUsage.ts`, `src/renderer/screens/UsageScreen.tsx`
- Modify: `src/renderer/store.ts` (Screen), `src/renderer/App.tsx`, `src/renderer/components/TaskHeader.tsx`, `src/renderer/components/TaskNav.tsx`, `src/renderer/test-helpers/fakeApi.ts`, `src/renderer/styles/screens.css`
- Test: `src/renderer/format.test.tsx` (the renderer project only runs `*.test.tsx`), `src/renderer/screens/UsageScreen.test.tsx`, `src/renderer/components/TaskHeader.test.tsx`; extend `src/renderer/components/TaskNav.test.tsx`

**Interfaces:**
- Consumes: IPC channels and events from Task 2/7; `renderUsageComment`, `aiFieldValues` from `src/shared/workItemUsage.ts` (Task 6).
- Produces: `Screen` gains `{ kind: 'usage'; taskId: string }`; `eur(n)`, `compact(n)`, `ago(iso, now?)` in `format.ts`; `useTaskUsage(taskId: string | null): TaskUsage | null` (refetches on `usage:changed` for that task or `'*'`); `emptyUsage(taskId)` in `fakeApi.ts`, which also becomes the default `'usage:task'` fake.

- [ ] **Step 1: Fake API defaults**

In `src/renderer/test-helpers/fakeApi.ts`:
```ts
import type { TaskUsage } from '../../shared/usage';

export const emptyUsage = (taskId: string): TaskUsage => ({
  taskId, sessions: [], unpricedRequests: 0, usdToEur: 0.92, markupPct: 0,
  billable: { costUsd: 0, costEur: 0, tokens: 0 },
  byTool: { 'claude-code': { costUsd: 0, costEur: 0, sessions: 0, tokens: 0 }, 'copilot-cli': { costUsd: 0, costEur: 0, sessions: 0, tokens: 0 } },
});
```
and add `'usage:task': (taskId) => emptyUsage(taskId)` to `defaults`.

- [ ] **Step 2: Write the failing tests**

`src/renderer/format.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { ago, compact, eur } from './format';

describe('format', () => {
  it('formats euros, token counts and ages', () => {
    expect(eur(23.854)).toBe(`${String.fromCharCode(0x20ac)}23.85`);
    expect([compact(950), compact(412_000), compact(6_812_400)]).toEqual(['950', '412k', '6.8M']);
    const now = Date.parse('2026-10-14T12:00:00.000Z');
    expect(ago('2026-10-14T11:59:40.000Z', now)).toBe('just now');
    expect(ago('2026-10-14T11:48:00.000Z', now)).toBe('12 min ago');
    expect(ago('2026-10-14T09:00:00.000Z', now)).toBe('3 h ago');
    expect(ago('2026-10-12T12:00:00.000Z', now)).toBe('2 d ago');
  });
});
```

`src/renderer/components/TaskHeader.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskView } from '../../shared/types';
import { useStore } from '../store';
import { emptyUsage, installFakeApi } from '../test-helpers/fakeApi';
import { TaskHeader } from './TaskHeader';

const EURO = String.fromCharCode(0x20ac);
const task: TaskView = {
  id: 't1', repoId: 'r1', name: '', workItem: { id: '1', type: 'Issue', title: 'Checkout', url: null }, slug: '1-checkout', branch: 'feature/1-checkout',
  worktreePath: '/w', baseRef: 'origin/main', status: 'ready', setup: { copy: false, commands: [], startClaude: true, openShell: true, openCopilot: false },
  terminals: [], createdAt: 'now', finishedAt: null, worktreeMissing: false, usageSyncedAt: null, usageSyncError: null, usageCommentId: null,
};
const usage = { ...emptyUsage('t1'), billable: { costUsd: 10, costEur: 9.2, tokens: 100 },
  byTool: { 'claude-code': { costUsd: 9, costEur: 8.28, sessions: 1, tokens: 90 }, 'copilot-cli': { costUsd: 1, costEur: 0.92, sessions: 1, tokens: 10 } } };

beforeEach(() => {
  useStore.setState({ screen: { kind: 'workspace' }, repos: [{ id: 'r1', name: 'webshop', path: '/r', baseBranch: 'main', connectionId: 'c1', miacYmlFound: true }] });
});

describe('TaskHeader cost tile', () => {
  it('shows the billable total, the split and opens the Usage screen', async () => {
    installFakeApi({ 'usage:task': () => usage, 'tasks:gitSummary': () => ({ branch: 'b', ahead: 0, behind: 0, hasUpstream: false, files: [] }) });
    render(<TaskHeader task={task} />);
    expect(await screen.findByText(`${EURO}9.20`)).toBeTruthy();
    expect(screen.getByText(/Claude .8\.28/)).toBeTruthy();
    expect(screen.getByText('Not logged on the work item yet')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /AI cost for this task/ }));
    expect(useStore.getState().screen).toEqual({ kind: 'usage', taskId: 't1' });
  });
  it('refreshes on usage:changed and shows a sync error', async () => {
    let current = emptyUsage('t1');
    const { emit } = installFakeApi({ 'usage:task': () => current, 'tasks:gitSummary': () => ({ branch: 'b', ahead: 0, behind: 0, hasUpstream: false, files: [] }) });
    render(<TaskHeader task={{ ...task, usageSyncError: 'The token cannot write work items (needs Work Items: Read & write)' }} />);
    expect(await screen.findByText(`${EURO}0.00`)).toBeTruthy();
    current = usage;
    emit('usage:changed', { taskId: 't1' });
    await waitFor(() => expect(screen.getByText(`${EURO}9.20`)).toBeTruthy());
    expect(screen.getByText(/Sync failed: The token cannot write/)).toBeTruthy();
  });
});
```

`src/renderer/screens/UsageScreen.test.tsx`:
```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskView } from '../../shared/types';
import type { TaskUsage } from '../../shared/usage';
import { useStore } from '../store';
import { emptyUsage, installFakeApi } from '../test-helpers/fakeApi';
import { UsageScreen } from './UsageScreen';

const EURO = String.fromCharCode(0x20ac);
const task: TaskView = {
  id: 't1', repoId: 'r1', name: '', workItem: { id: '48213', type: 'Issue', title: 'Checkout: allow saving a delivery address', url: null }, slug: 's',
  branch: 'feature/48213-save-delivery-address', worktreePath: '/w', baseRef: 'origin/main', status: 'ready',
  setup: { copy: false, commands: [], startClaude: true, openShell: true, openCopilot: false }, terminals: [], createdAt: 'now', finishedAt: null,
  worktreeMissing: false, usageSyncedAt: null, usageSyncError: null, usageCommentId: null,
};
const usage: TaskUsage = {
  ...emptyUsage('t1'),
  sessions: [
    { sessionId: 's1', tool: 'claude-code', startedAt: '2026-10-14T09:12:00.000Z', models: ['claude-opus-5-5'], requests: 3, inputTokens: 412_000, outputTokens: 96_000, cacheReadTokens: 3_100_000, cacheWriteTokens: 0, costUsd: 10, unpricedRequests: 0, billable: true },
    { sessionId: 's2', tool: 'copilot-cli', startedAt: '2026-10-14T10:00:00.000Z', models: ['mystery-1'], requests: 1, inputTokens: 1000, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, unpricedRequests: 1, billable: true },
  ],
  unpricedRequests: 1,
  billable: { costUsd: 10, costEur: 9.2, tokens: 3_609_010 },
  byTool: { 'claude-code': { costUsd: 10, costEur: 9.2, sessions: 1, tokens: 3_608_000 }, 'copilot-cli': { costUsd: 0, costEur: 0, sessions: 1, tokens: 1010 } },
};

beforeEach(() => {
  useStore.setState({
    screen: { kind: 'usage', taskId: 't1' }, tasks: [task], notices: [],
    repos: [{ id: 'r1', name: 'webshop', path: '/r', baseBranch: 'main', connectionId: 'c1', miacYmlFound: true }],
    connections: [{ id: 'c1', name: 'unreliablewitness', organizationUrl: 'https://dev.azure.com/unreliablewitness', project: 'MIAC', user: 'Dries', status: 'ok', checkedAt: null }],
  });
});

describe('UsageScreen', () => {
  it('shows tiles, sessions, unpriced usage, field values and the comment preview', async () => {
    installFakeApi({ 'usage:task': () => usage, 'usage:fieldsStatus': () => ({ connectionId: 'c1', types: [{ type: 'Issue', present: ['Custom.AICost', 'Custom.AITokens'], missing: ['Custom.AICostClaude', 'Custom.AICostCopilot'] }] }) });
    render(<UsageScreen taskId="t1" />);
    expect(await screen.findByText('Billable AI cost')).toBeTruthy();
    expect(screen.getAllByText(`${EURO}9.20`).length).toBeGreaterThan(0);
    expect(screen.getByText(/USD to EUR 0.92 .* no markup/)).toBeTruthy();
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('claude-opus-5-5')).toBeTruthy();
    expect(within(rows[2]).getByText('unpriced')).toBeTruthy();
    expect(screen.getByText(/1 request uses a model that is not in the rate table/)).toBeTruthy();
    expect(screen.getByText('3,609,010')).toBeTruthy();
    expect(await screen.findAllByText('not on Issue')).toHaveLength(2);
    expect(screen.getByText(/AI usage for this work item \(MIAC\)/)).toBeTruthy();
  });
  it('toggles billable, syncs and exports', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const { calls } = installFakeApi({
      'usage:task': () => usage,
      'usage:fieldsStatus': () => ({ connectionId: 'c1', types: [] }),
      'usage:setBillable': () => ({ ...usage, sessions: usage.sessions.map((s) => (s.sessionId === 's1' ? { ...s, billable: false } : s)) }),
      'usage:sync': () => ({ ok: false, fieldsWritten: [], fieldsMissing: [], commentPosted: false, error: 'boom' }),
      'usage:exportCsv': () => 'time\r\n',
    });
    render(<UsageScreen taskId="t1" />);
    const boxes = await screen.findAllByRole('checkbox', { name: /Billable/ });
    await userEvent.click(boxes[0]);
    expect(calls.find((c) => c.channel === 'usage:setBillable')?.args).toEqual(['t1', 's1', false]);
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(useStore.getState().notices.some((n) => n.message.includes('boom'))).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });
  it('explains an empty task and a task without a connection', async () => {
    useStore.setState({ repos: [{ id: 'r1', name: 'webshop', path: '/r', baseBranch: 'main', connectionId: null, miacYmlFound: true }] });
    installFakeApi();
    render(<UsageScreen taskId="t1" />);
    expect(await screen.findByText(/No AI usage captured for this task yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync now' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/Link the repository to an Azure DevOps connection/)).toBeTruthy();
  });
});
```

Extend `src/renderer/components/TaskNav.test.tsx` (its tasks need the three usage fields and `openCopilot` from Task 2):
```tsx
it('shows the billable EUR total per task', async () => {
  installFakeApi({ 'repos:list': () => repos, 'tasks:list': () => tasks, 'usage:task': (id) => ({ ...emptyUsage(id), billable: { costUsd: 1, costEur: id === 'a' ? 12.5 : 0, tokens: 1 } }) });
  useStore.setState({ repos, tasks, selectedTaskId: 'a' });
  render(<TaskNav />);
  expect(await screen.findByText(`${String.fromCharCode(0x20ac)}12.50`)).toBeTruthy();
});
```
(import `emptyUsage` next to `installFakeApi`; adapt the setup lines to the file's existing `beforeEach` if it already installs the API.)

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run --project renderer src/renderer/format.test.tsx src/renderer/screens/UsageScreen.test.tsx src/renderer/components/TaskHeader.test.tsx src/renderer/components/TaskNav.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement**

`src/renderer/format.ts`:
```ts
const EURO = String.fromCharCode(0x20ac);

export const eur = (n: number): string => `${EURO}${(Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2)}`;

export const compact = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

export function ago(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
}
```

`src/renderer/hooks/useTaskUsage.ts`:
```ts
import { useEffect, useState } from 'react';
import type { TaskUsage } from '../../shared/usage';
import { api } from '../api';

/** Usage summary for one task, refetched whenever main reports a change for it (or '*' for all tasks). */
export function useTaskUsage(taskId: string | null): TaskUsage | null {
  const [usage, setUsage] = useState<TaskUsage | null>(null);
  useEffect(() => {
    setUsage(null);
    if (!taskId) return;
    let live = true;
    const load = () =>
      api().invoke('usage:task', taskId).then((u) => { if (live) setUsage(u); }).catch(() => undefined);
    void load();
    const off = api().on('usage:changed', (p) => {
      if (p.taskId === taskId || p.taskId === '*') void load();
    });
    return () => {
      live = false;
      off();
    };
  }, [taskId]);
  return usage;
}
```
The Usage screen keeps no local copy for billable toggles: main emits `usage:changed` on every billable change, and the hook refetches.

`src/renderer/store.ts`: add `| { kind: 'usage'; taskId: string }` to `Screen`.

`src/renderer/App.tsx`: render `<UsageScreen taskId={screen.taskId} />` for `screen.kind === 'usage'` in the first ternary chain (full screen, like Settings).

`src/renderer/components/TaskHeader.tsx`: replace the static cost tile with:
```tsx
      <button type="button" className="costtile" aria-label="AI cost for this task" onClick={() => go({ kind: 'usage', taskId: task.id })}>
        <span className="small muted">AI cost</span>
        <span className="amount">{usage ? eur(usage.billable.costEur) : <>&mdash;</>}</span>
        {usage && (
          <span className="small muted">
            Claude {eur(usage.byTool['claude-code'].costEur)} &middot; Copilot {eur(usage.byTool['copilot-cli'].costEur)}
          </span>
        )}
        <span className={task.usageSyncError ? 'small text-red' : 'small muted'}>{syncLine}</span>
      </button>
```
with, above the return:
```tsx
  const usage = useTaskUsage(task.id);
  const repo = useStore((s) => s.repos.find((r) => r.id === task.repoId));
  const linked = task.workItem !== null && Boolean(repo?.connectionId);
  const syncLine = !linked
    ? 'Not linked to an Azure DevOps work item'
    : task.usageSyncError
      ? `Sync failed: ${task.usageSyncError}`
      : task.usageSyncedAt
        ? `Logged on work item ${ago(task.usageSyncedAt)}`
        : 'Not logged on the work item yet';
```

`src/renderer/components/TaskNav.tsx` `Row`: `const usage = useTaskUsage(task.id);` and the cost cell becomes `<span className="cost">{usage && usage.billable.costEur > 0 ? eur(usage.billable.costEur) : <>&mdash;</>}</span>`.

`src/renderer/screens/UsageScreen.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { FieldsStatus, UsageTool } from '../../shared/usage';
import { AI_FIELDS } from '../../shared/usage';
import { aiFieldValues, renderUsageComment } from '../../shared/workItemUsage';
import { api, tryInvoke } from '../api';
import { TopBar } from '../components/TopBar';
import { ago, compact, eur } from '../format';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { useStore } from '../store';

const TOOL: Record<UsageTool, string> = { 'claude-code': 'Claude Code', 'copilot-cli': 'Copilot CLI' };
const FIELD_LABEL: Record<(typeof AI_FIELDS)[number], string> = {
  'Custom.AICost': 'AI Cost (EUR)', 'Custom.AICostClaude': 'AI Cost Claude', 'Custom.AICostCopilot': 'AI Cost Copilot', 'Custom.AITokens': 'AI Tokens',
};
const DOT = String.fromCharCode(0xb7);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export function UsageScreen({ taskId }: { taskId: string }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const repo = useStore((s) => s.repos.find((r) => r.id === task?.repoId));
  const go = useStore((s) => s.go);
  const notify = useStore((s) => s.notify);
  const usage = useTaskUsage(taskId);
  const [fields, setFields] = useState<FieldsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const connectionId = repo?.connectionId ?? null;
  const linked = Boolean(task?.workItem) && connectionId !== null;

  useEffect(() => {
    if (!linked || !connectionId) return;
    let live = true;
    void api().invoke('usage:fieldsStatus', connectionId).then((f) => { if (live) setFields(f); }).catch(() => undefined);
    return () => { live = false; };
  }, [linked, connectionId]);

  if (!task) return null;
  const back = () => go({ kind: 'workspace' });
  const typeFields = fields?.types.find((t) => t.type.toLowerCase() === task.workItem?.type.toLowerCase());
  const values = usage ? aiFieldValues(usage) : null;

  const sync = async () => {
    setBusy(true);
    const r = await tryInvoke(() => api().invoke('usage:sync', taskId), notify);
    setBusy(false);
    if (r && !r.ok) notify('error', `Sync failed: ${r.error}`);
    else if (r) notify('info', r.fieldsWritten.length > 0 ? `Wrote ${r.fieldsWritten.length} field(s) to work item ${task.workItem?.id}` : 'Nothing to write: the work item type has none of the AI cost fields');
  };
  const exportCsv = async () => {
    const csv = await tryInvoke(() => api().invoke('usage:exportCsv', taskId), notify);
    if (csv === undefined) return;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `miac-usage-${task.slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const setBillable = (sessionId: string, billable: boolean) =>
    tryInvoke(() => api().invoke('usage:setBillable', taskId, sessionId, billable), notify);

  const tile = (label: string, amount: number, note: string) => (
    <div className="usage-tile">
      <span className="small muted">{label}</span>
      <span className="amount">{eur(amount)}</span>
      <span className="small muted">{note}</span>
    </div>
  );

  return (
    <>
      <TopBar crumb={`${repo?.name ?? ''} / ${task.workItem?.id ?? task.name} / AI usage`}>
        <a href="#" className="spacer" onClick={(e) => { e.preventDefault(); back(); }}>Back to task</a>
      </TopBar>
      <div className="usage">
        <main className="usage-main">
          <h1>{task.workItem?.title ?? task.name}</h1>
          <div className="muted">{task.workItem ? `${task.workItem.type} ${task.workItem.id}` : 'Blank task'}</div>
          {usage && (
            <div className="usage-tiles">
              {tile('Billable AI cost', usage.billable.costEur, `your rates ${DOT} USD to EUR ${usage.usdToEur} ${DOT} ${usage.markupPct > 0 ? `${usage.markupPct}% markup` : 'no markup'}`)}
              {tile('Claude Code', usage.byTool['claude-code'].costEur, `${usage.byTool['claude-code'].sessions} sessions ${DOT} ${compact(usage.byTool['claude-code'].tokens)} tokens`)}
              {tile('Copilot CLI', usage.byTool['copilot-cli'].costEur, `${usage.byTool['copilot-cli'].sessions} sessions ${DOT} ${compact(usage.byTool['copilot-cli'].tokens)} tokens`)}
            </div>
          )}
          {usage && usage.unpricedRequests > 0 && (
            <div className="check check-warn">{`${usage.unpricedRequests} ${usage.unpricedRequests === 1 ? 'request uses a model that is' : 'requests use models that are'} not in the rate table, so ${usage.unpricedRequests === 1 ? 'it is' : 'they are'} not in the totals. Add a rate in Settings, AI cost and invoicing.`}</div>
          )}
          {usage && usage.sessions.length === 0 ? (
            <div className="empty">No AI usage captured for this task yet. Claude Code and Copilot CLI started in this task&apos;s terminals report here automatically.</div>
          ) : (
            usage && (
              <table className="usage-table">
                <thead>
                  <tr><th>Started</th><th>Tool</th><th>Model</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cost</th><th>Billable</th></tr>
                </thead>
                <tbody>
                  {usage.sessions.map((s) => (
                    <tr key={s.sessionId}>
                      <td>{when(s.startedAt)}</td>
                      <td>{TOOL[s.tool]}</td>
                      <td className="mono">{s.models.join(', ')}</td>
                      <td className="mono">{compact(s.inputTokens)}</td>
                      <td className="mono">{compact(s.outputTokens)}</td>
                      <td className="mono">{compact(s.cacheReadTokens)}</td>
                      <td className="mono">{s.unpricedRequests === s.requests ? 'unpriced' : `${eur(s.costUsd * usage.usdToEur * (1 + usage.markupPct / 100))}${s.unpricedRequests > 0 ? ' + unpriced' : ''}`}</td>
                      <td>
                        <label className="checkbox">
                          <input type="checkbox" checked={s.billable} onChange={(e) => void setBillable(s.sessionId, e.target.checked)} />
                          Billable
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </main>
        <aside className="usage-side">
          <div className="section-head">
            <h2>On the work item</h2>
            <span className="small muted">{task.usageSyncError ? `sync failed: ${task.usageSyncError}` : task.usageSyncedAt ? `synced ${ago(task.usageSyncedAt)}` : 'not synced yet'}</span>
          </div>
          {!linked && <p className="muted small">Link the repository to an Azure DevOps connection in Settings and create the task from a work item to write totals back.</p>}
          {values && (
            <dl className="usage-fields">
              {AI_FIELDS.map((f) => (
                <div key={f}>
                  <dt>{FIELD_LABEL[f]}</dt>
                  <dd className="mono">{f === 'Custom.AITokens' ? values[f].toLocaleString('en-US') : values[f].toFixed(2)}</dd>
                  {typeFields && !typeFields.present.includes(f) && <dd className="small muted">{`not on ${typeFields.type}`}</dd>}
                </div>
              ))}
            </dl>
          )}
          <div className="label">{task.usageCommentId ? `Comment posted (id ${task.usageCommentId})` : 'Comment added when the task is finished'}</div>
          {usage && <pre className="usage-comment">{renderUsageComment(usage, task.branch)}</pre>}
          <div className="actions">
            <button type="button" className="btn" onClick={sync} disabled={!linked || busy}>Sync now</button>
            <button type="button" className="btn" onClick={exportCsv}>Export CSV</button>
          </div>
        </aside>
      </div>
    </>
  );
}
```
The `notify('info', ...)` call needs `Notice['level']` to include `'info'` (it does: `'info' | 'warn' | 'error'`); if `notify` is typed narrower, widen it.

`src/renderer/styles/screens.css` (append; reuse existing tokens):
```css
.costtile { text-align: left; cursor: pointer; color: inherit; font: inherit; }
.costtile:hover { border-color: var(--accent); }
.text-red { color: var(--red); }
.usage { display: grid; grid-template-columns: 1fr 340px; gap: 24px; padding: 24px; overflow: auto; }
.usage-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.usage-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.usage-tile { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--panel); }
.usage-tile .amount { font: 600 22px var(--font-mono); }
.usage-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.usage-table th, .usage-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.usage-side { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--panel); align-self: start; }
.usage-fields { display: grid; gap: 6px; margin: 0; }
.usage-fields div { display: flex; gap: 8px; align-items: baseline; }
.usage-fields dt { flex: 1; color: var(--muted); }
.usage-fields dd { margin: 0; }
.usage-comment { white-space: pre-wrap; font: 12px var(--font-mono); background: var(--bg); padding: 10px; border-radius: var(--radius); margin: 0; }
```
(Check the token names against `src/renderer/styles/tokens.css` and use the closest existing ones.)

- [ ] **Step 5: Run tests, suite, typecheck, lint**

Run: `npx vitest run --project renderer && npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat: AI cost tile, nav totals and the task Usage screen"
```

---

### Task 9: Renderer: Finish block, Settings AI cost section, Copilot CLI terminal

**Files:**
- Create: `src/renderer/components/CostSection.tsx`, `src/renderer/components/CostSection.test.tsx`
- Modify: `src/renderer/screens/FinishScreen.tsx` (+ test), `src/renderer/screens/SettingsScreen.tsx`, `src/renderer/screens/NewTaskScreen.tsx` (+ test), `src/renderer/components/TerminalTabs.tsx`, `src/renderer/screens/WorkspaceScreen.test.tsx` (one test), `src/renderer/styles/screens.css`

**Interfaces:**
- Consumes: Tasks 2, 7, 8 (`useTaskUsage`, `eur`, `emptyUsage`).
- Produces: `CostSection` (Settings `#cost`), `FinishOptions.syncUsage` sent from the Finish dialog, `CreateTaskInput.openCopilot` sent from New task, a "Copilot CLI" button next to the "+" in the terminal tab bar.

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/screens/FinishScreen.test.tsx` (its `task` literal gains the usage fields; set `repos` so the task's repo has `connectionId: 'c1'` in the new tests):
```tsx
describe('FinishScreen AI usage', () => {
  it('shows the total and sends syncUsage when ticked', async () => {
    useStore.setState({ repos: [{ id: task.repoId, name: 'webshop', path: '/r', baseBranch: 'main', connectionId: 'c1', miacYmlFound: true }] });
    const { calls } = installFakeApi({
      'tasks:finishChecks': () => ({ uncommitted: [], unpushed: 0, runningTerminals: 0 }),
      'tasks:finish': () => undefined,
      'usage:task': (id) => ({ ...emptyUsage(id), billable: { costUsd: 10, costEur: 9.2, tokens: 5 }, byTool: { 'claude-code': { costUsd: 10, costEur: 9.2, sessions: 2, tokens: 5 }, 'copilot-cli': { costUsd: 0, costEur: 0, sessions: 0, tokens: 0 } } }),
    });
    render(<FinishScreen taskId={task.id} />);
    expect(await screen.findByText(/Claude Code .9\.20 over 2 sessions/)).toBeTruthy();
    const box = screen.getByRole('checkbox', { name: /Write final totals to the work item/ });
    expect(box).toHaveProperty('checked', true);
    await userEvent.click(screen.getByRole('button', { name: /Finish/ }));
    await waitFor(() => expect(calls.find((c) => c.channel === 'tasks:finish')?.args[1]).toMatchObject({ syncUsage: true }));
  });
  it('hides the checkbox when the repo has no connection', async () => {
    useStore.setState({ repos: [{ id: task.repoId, name: 'webshop', path: '/r', baseBranch: 'main', connectionId: null, miacYmlFound: true }] });
    const { calls } = installFakeApi({ 'tasks:finishChecks': () => ({ uncommitted: [], unpushed: 0, runningTerminals: 0 }), 'tasks:finish': () => undefined });
    render(<FinishScreen taskId={task.id} />);
    await screen.findByText(/AI usage/);
    expect(screen.queryByRole('checkbox', { name: /Write final totals/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Finish/ }));
    await waitFor(() => expect(calls.find((c) => c.channel === 'tasks:finish')?.args[1]).toMatchObject({ syncUsage: false }));
  });
});
```
(Use the file's existing finish button name; the regex above assumes it contains "Finish".)

`src/renderer/components/CostSection.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Rate } from '../../shared/usage';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { CostSection } from './CostSection';

const rates: Rate[] = [
  { id: 'anthropic-opus-5-5', label: 'Claude Opus 5.5', match: ['claude-opus-5-5'], minInputTokens: 0, fast: false, inputPerM: 4, cachedInputPerM: 0.2, cacheWritePerM: 5, outputPerM: 20 },
];
const settings = { version: 1 as const, receiverPort: 4319, usdToEur: 0.92, markupPct: 0, hourlySync: true };

beforeEach(() => {
  useStore.setState({ notices: [], connections: [{ id: 'c1', name: 'unreliablewitness', organizationUrl: 'https://dev.azure.com/unreliablewitness', project: 'MIAC', user: 'D', status: 'ok', checkedAt: null }] });
});

describe('CostSection', () => {
  it('saves exchange rate, markup, port and hourly sync', async () => {
    const { calls } = installFakeApi({ 'settings:get': () => settings, 'settings:save': (s) => s, 'rates:list': () => ({ rates, officialAsOf: '2026-10-14' }) });
    render(<CostSection />);
    const fx = await screen.findByLabelText('USD to EUR');
    await userEvent.clear(fx);
    await userEvent.type(fx, '0.9');
    await userEvent.clear(screen.getByLabelText('Markup %'));
    await userEvent.type(screen.getByLabelText('Markup %'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(calls.find((c) => c.channel === 'settings:save')?.args[0]).toMatchObject({ usdToEur: 0.9, markupPct: 10, receiverPort: 4319, hourlySync: true });
  });
  it('shows the receiver status and Copilot counters', async () => {
    installFakeApi({ 'settings:get': () => settings, 'rates:list': () => ({ rates, officialAsOf: '2026-10-14' }),
      'usage:receiverStatus': () => ({ listening: false, port: 4319, error: 'Port 4319 is in use by another program', copilot: { records: 3, unreadable: 1 } }) });
    render(<CostSection />);
    expect(await screen.findByText(/Port 4319 is in use/)).toBeTruthy();
    expect(screen.getByText('Copilot CLI: 3 records captured, 1 unreadable (unverified: built from documentation)')).toBeTruthy();
  });
  it('edits a rate, adds and deletes rows, and resets after confirming', async () => {
    const { calls } = installFakeApi({ 'settings:get': () => settings, 'rates:list': () => ({ rates, officialAsOf: '2026-10-14' }), 'rates:save': (r) => r, 'rates:reset': () => rates });
    render(<CostSection />);
    const input = await screen.findByLabelText('Claude Opus 5.5 input per 1M');
    await userEvent.clear(input);
    await userEvent.type(input, '3.5');
    await userEvent.click(screen.getByRole('button', { name: 'Add rate' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete New rate' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save rates' }));
    expect((calls.find((c) => c.channel === 'rates:save')?.args[0] as Rate[]).map((r) => [r.id, r.inputPerM])).toEqual([['anthropic-opus-5-5', 3.5]]);
    await userEvent.click(screen.getByRole('button', { name: 'Reset to official prices' }));
    expect(calls.some((c) => c.channel === 'rates:reset')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Yes, reset' }));
    await waitFor(() => expect(calls.some((c) => c.channel === 'rates:reset')).toBe(true));
  });
  it('checks the work item fields of a connection', async () => {
    installFakeApi({ 'settings:get': () => settings, 'rates:list': () => ({ rates, officialAsOf: '2026-10-14' }),
      'usage:fieldsStatus': () => ({ connectionId: 'c1', types: [{ type: 'Issue', present: ['Custom.AICost'], missing: ['Custom.AICostClaude', 'Custom.AICostCopilot', 'Custom.AITokens'] }, { type: 'Task', present: [], missing: [] }] }) });
    render(<CostSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'Check fields of unreliablewitness' }));
    expect(await screen.findByText('Issue: 1 of 4 fields (missing Custom.AICostClaude, Custom.AICostCopilot, Custom.AITokens)')).toBeTruthy();
  });
});
```

Append to `src/renderer/screens/NewTaskScreen.test.tsx` a test that ticks "Start Copilot CLI with the task" (unchecked by default) and asserts `tasks:create` received `openCopilot: true`; model it on the file's existing create test (same fake handlers and form filling).

Append to `src/renderer/screens/WorkspaceScreen.test.tsx` a test that clicks the "Copilot CLI" button in the tab bar and asserts `terminals:open` received `{ kind: 'copilot', label: 'Copilot CLI' }`; model it on the existing "+" test.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --project renderer`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

**FinishScreen** (`src/renderer/screens/FinishScreen.tsx`): add
```tsx
  const usage = useTaskUsage(ready ? taskId : null);
  const repo = useStore((s) => s.repos.find((r) => r.id === task?.repoId));
  const canSync = Boolean(task?.workItem) && Boolean(repo?.connectionId);
  const [syncUsage, setSyncUsage] = useState(true);
```
(hooks above the early returns), send `syncUsage: canSync && syncUsage` in the `tasks:finish` options, and render a new section after the safety checks:
```tsx
        <div className="finish-section">
          <div className="label">AI usage</div>
          {usage && usage.sessions.length > 0 ? (
            <div>
              <div className="amount-line">{`${eur(usage.billable.costEur)} billable`}</div>
              {(['claude-code', 'copilot-cli'] as const).filter((t) => usage.byTool[t].sessions > 0).map((t) => (
                <div key={t} className="small muted">{`${t === 'claude-code' ? 'Claude Code' : 'Copilot CLI'} ${eur(usage.byTool[t].costEur)} over ${usage.byTool[t].sessions} session${usage.byTool[t].sessions === 1 ? '' : 's'}`}</div>
              ))}
            </div>
          ) : (
            <div className="muted">No AI usage captured for this task.</div>
          )}
          {canSync && (
            <label className="checkbox">
              <input type="checkbox" checked={syncUsage} onChange={(e) => setSyncUsage(e.target.checked)} />
              Write final totals to the work item and add a usage comment
            </label>
          )}
        </div>
```
The `syncUsage` default stays `true`; the checkbox is hidden (and `false` is sent) when `canSync` is false. Existing Finish tests must still pass (they assert option objects; add `syncUsage: false` where they use `toEqual`).

**CostSection** (`src/renderer/components/CostSection.tsx`): a `<section id="cost" className="section">` with heading "AI cost and invoicing" and four parts.
1. Invoicing: "Invoice currency EUR" (static text), inputs labelled `USD to EUR` (number, step 0.0001) and `Markup %` (number), a checkbox `Sync totals to work items every hour`, and the input `Usage receiver port` (number). Button "Save settings" calls `settings:save` with the full settings object (numbers parsed with `Number`); on success `notify('info', 'Settings saved')`. Load with `settings:get` on mount.
2. Receiver status line from `usage:receiverStatus` (on mount and on the `usage:receiverStatus` event): `Listening on 127.0.0.1:<port>` (green) or the error (red), and below it the exact text `Copilot CLI: ${records} records captured, ${unreadable} unreadable (unverified: built from documentation)`.
3. Rate table: `rates:list` on mount; one table row per rate with inputs for label (aria-label `<label> label`), match (comma separated, aria-label `<label> models`), min input tokens, fast (checkbox), and the four prices with aria-labels `<label> input per 1M`, `<label> cached input per 1M`, `<label> cache write per 1M`, `<label> output per 1M`, plus a button aria-labelled `Delete <label>`. "Add rate" appends `{ id: \`custom-${Date.now()}\`, label: 'New rate', match: ['model-id'], minInputTokens: 0, fast: false, inputPerM: 0, cachedInputPerM: 0, cacheWritePerM: 0, outputPerM: 0 }`. "Save rates" calls `rates:save` with the edited list (numbers via `Number`, match split on commas and trimmed, empty entries dropped) and notifies the error on rejection. "Reset to official prices" shows an inline confirm row ("Replace your rates with the official prices of <officialAsOf>?" with "Yes, reset" and "Cancel"), modelled on the `conn-confirm` row in `ConnectionsSection`; "Yes, reset" calls `rates:reset` and replaces the table. Note under the table: "Prices are USD per million tokens. Changes apply to new usage only; recorded usage keeps the price it was recorded with."
4. Work item fields: for each connection in the store, a row with the connection name and a button aria-labelled `Check fields of <name>` that calls `usage:fieldsStatus`; the result lists, for each type with at least one present field, `<type>: <n> of 4 fields` plus ` (missing a, b)` when some are missing. If no type has any field, show the setup steps from the spec ("Test project setup") as an ordered list: create an inherited process, add the four fields (`AI Cost`, `AI Cost Claude`, `AI Cost Copilot` as Decimal, `AI Tokens` as Integer), add them to the other types, change the project to the inherited process; and "The token needs Work Items: Read & write."

**SettingsScreen**: replace the placeholder `#cost` section with `<CostSection />` and make the `#cost` nav link active (drop `disabled`/`aria-disabled`). Update `SettingsScreen.test.tsx` if it asserts the placeholder or the disabled link; give its fake API `settings:get` and `rates:list` handlers (or add `'settings:get'` and `'rates:list'` defaults to `fakeApi.ts`: `() => ({ version: 1, receiverPort: 4319, usdToEur: 0.92, markupPct: 0, hourlySync: true })` and `() => ({ rates: [], officialAsOf: '2026-10-14' })`).

**NewTaskScreen**: `const [openCopilot, setOpenCopilot] = useState(false);`, a third checkbox in "When ready" labelled `Start Copilot CLI with the task`, and `openCopilot` in the `tasks:create` input.

**TerminalTabs**: widen the `open` def type to `kind: 'shell' | 'run' | 'copilot'`; after the "+" button add
```tsx
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => open({ kind: 'copilot', label: 'Copilot CLI' })} disabled={task.worktreeMissing}>
          Copilot CLI
        </button>
```
and give copilot tabs a dot colour (`var(--accent)`).

- [ ] **Step 4: Run tests, suite, typecheck, lint**

Run: `npx vitest run --project renderer && npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat: AI usage in Finish, AI cost settings with rate editor, Copilot CLI terminals"
```

---

### Task 10: Live end-to-end check and docs (controller)

This task is run by the controller, not a subagent, because it uses the owner's Claude Code account, the Azure DevOps PAT from the Keychain and the owner's app data.

**Prerequisites (owner):** the web UI process setup from the spec ("Test project setup") is done, so `Custom.AICost` and friends exist on Issue in `unreliablewitness/MIAC`, and the Keychain PAT (`miac` / `miac-ado-unreliablewitness`) has Work Items: Read & write. If the fields are not there yet, run everything else and report the field write as pending.

- [ ] **Step 1: Prepare**

Set aside the owner's app data: rename `~/Library/Application Support/miac/{state.json,connections.json,settings.json,rates.json}` and the `usage/` folder (those that exist) to `*.pre-smoke`. Create the throwaway repo with a bare `origin` as in the slice 2 smoke. Start the app with `npx electron-forge start -- --remote-debugging-port=9333`.

- [ ] **Step 2: Drive it over CDP**

Write `cdp-usage-smoke.mjs` in the session scratchpad (same style as `cdp-ado-smoke.mjs`; read the PAT inside the script via `security find-generic-password -a miac -s miac-ado-unreliablewitness -w`, never print it). Steps:
1. `usage:receiverStatus` is listening on 4319.
2. Add the connection, add the throwaway repo, link it.
3. Create a task from work item 1 with `startClaude: false`, `openShell: false`; wait until ready.
4. Open a `run` terminal with `claude -p "Reply with the single word OK"`; wait up to 30 s for `usage:task` to show at least one Claude Code session with a non-null cost.
5. `usage:sync` and check the result (fields written if the fields exist).
6. `tasks:finish` with `syncUsage: true`; check the task is done with `usageCommentId` set and no `usageSyncError` (or the expected missing-fields outcome).
7. Read work item 1 back via the REST API in the script (fields and the latest comment) and print only the field values and the comment text.
Take one screenshot of the Usage screen before finishing (Page.captureScreenshot) and save it to the scratchpad.

- [ ] **Step 3: Restore**

Quit the app, delete the smoke data, rename the `*.pre-smoke` files back. Leave the test comment on work item 1 (it documents the smoke) unless the owner asks otherwise.

- [ ] **Step 4: Docs**

Update `CLAUDE.md` Status: sub-project 3 implemented (usage capture, pricing, write-back), Copilot CLI capture unverified (no licence), next is sub-project 4. Commit `docs: status after sub-project 3`.
