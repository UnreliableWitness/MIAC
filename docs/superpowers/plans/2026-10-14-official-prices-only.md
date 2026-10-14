# MIAC Official Prices Only (sub-project 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every teammate writes identical AI cost amounts. Pricing uses only the built-in official rate table and a built-in USD to EUR rate; there are no local rates and no markup.

**Architecture:** `officialRates.ts` gains `OFFICIAL_USD_TO_EUR`. `UsageStore` prices with `OFFICIAL_RATES` and summarises with the built-in rate, so it no longer takes a settings argument. `RateStore`, `rates.json`, `rates:save` and `rates:reset` are removed. `AppSettings` loses `usdToEur` and `markupPct`. The Settings rate table becomes read-only, and the Usage screen note and unpriced text change.

**Tech Stack:** Existing (Electron 44, React 19, zod 4, Vitest 5). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-official-prices-only-design.md`

## Global Constraints

- `OFFICIAL_USD_TO_EUR = 0.92` is defined in `src/shared/usage.ts` (so main and renderer share one value) and re-exported from `src/main/pricing/officialRates.ts` next to `OFFICIAL_RATES_AS_OF = '2026-10-14'`.
- All EUR amounts are `costUsd * OFFICIAL_USD_TO_EUR`. There is no markup anywhere. Work item amounts are rounded to 2 decimals (unchanged `round2`).
- `AppSettings` is `{ version: 1, receiverPort, hourlySync }`. An old `settings.json` with `usdToEur`/`markupPct` must still load, and the extra keys disappear on the next save.
- Records keep their rate snapshot, and nothing is repriced. Unknown models stay `costUsd: null`, never 0.
- UI texts verbatim:
  - Rate table title: `Official list prices as of 2026-10-14 (USD per 1M tokens)`. Use the `officialAsOf` value from `rates:list`.
  - Currency line: `EUR at 0.92 per USD (built in)`. Use the `usdToEur` value from the summary or a shared constant.
  - Usage tile note: `official list prices <middle dot> USD to EUR 0.92`.
  - Unpriced warning: `${n} ${n === 1 ? 'request uses a model' : 'requests use models'} that ${n === 1 ? 'is' : 'are'} not in MIAC's official price list yet, so ${n === 1 ? 'it is' : 'they are'} not in the totals. A MIAC update will add ${n === 1 ? 'it' : 'them'}.`
- Core services must not import electron. Sources must be pure ASCII: use `String.fromCharCode` or JSX entities, never `\u` escapes, because oxfmt rewrites them. Run `npm run lint:fix` before commits.
- Commit messages end with two lines:
  - `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  - `Claude-Session: https://claude.ai/code/session_018pN36d8qmj82BVJLA1wM2L`

## Review Focus

1. **A `settings.json` written by sub-project 3** (with `usdToEur: 0.95, markupPct: 15`) loads, and no markup or custom rate leaks into amounts. Pinned in Task 1.
2. **A leftover `rates.json` with edited prices** in userData is ignored, so pricing uses the official table. Pinned in Task 1 (UsageStore is constructed with `OFFICIAL_RATES`; main no longer reads the file).
3. **Session row cost on the Usage screen** uses the same factor as the totals. Pinned in Task 2.
4. **Work item fields and the comment** carry official EUR with no markup. Pinned in Task 1 (handler finish test value).
5. **Typecheck catches stale callers** of the removed channels. `rates:save` and `rates:reset` are gone from `Channels`, so any remaining caller fails typecheck. Covered in Task 1 and Task 2 by running typecheck.

---

### Task 1: Main process: built-in rate, smaller settings, no rate store

**Files:**
- Modify: `src/main/pricing/officialRates.ts`, `src/shared/usage.ts`, `src/shared/ipc.ts`, `src/main/usage/UsageStore.ts`, `src/main/ipc/handlers.ts`, `src/main.ts`, `src/renderer/test-helpers/fakeApi.ts` (settings default shape only, so typecheck passes)
- Delete: `src/main/usage/RateStore.ts`, `src/main/usage/RateStore.test.ts`
- Test: `src/main/usage/SettingsStore.test.ts`, `src/main/usage/UsageStore.test.ts`, `src/main/usage/UsageSync.test.ts`, `src/shared/workItemUsage.test.ts`, `src/main/ipc/handlers.test.ts`

**Interfaces:**
- Produces:
  - `OFFICIAL_USD_TO_EUR: number`.
  - `AppSettings = { version: 1; receiverPort: number; hourlySync: boolean }`.
  - `TaskUsage` without `markupPct` (it keeps `usdToEur`).
  - `UsageStore` constructor `(dir: string, rates: () => Rate[])` is unchanged, and main passes `() => OFFICIAL_RATES`.
  - `UsageStore.summarize(taskId: string): TaskUsage` (settings parameter removed).
  - `Services.rates` removed.
  - Channels `rates:save` and `rates:reset` removed.

- [ ] **Step 1: Write the failing tests**

`src/main/usage/SettingsStore.test.ts`: replace the `usdToEur` expectations and add:
```ts
it('loads a settings file from sub-project 3 and drops the old keys on save', async () => {
  const f = file();
  writeFileSync(f, JSON.stringify({ version: 1, receiverPort: 5000, usdToEur: 0.95, markupPct: 15, hourlySync: false }));
  const s = new SettingsStore(f);
  expect(await s.load()).toEqual({ recovered: false });
  expect(s.get()).toEqual({ version: 1, receiverPort: 5000, hourlySync: false });
  await s.save({ ...s.get(), hourlySync: true });
  expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ version: 1, receiverPort: 5000, hourlySync: true });
});
```
(import `readFileSync`, `writeFileSync` from `node:fs`; `defaultSettings()` now equals `{ version: 1, receiverPort: 4319, hourlySync: true }`.)

`src/main/usage/UsageStore.test.ts`, in the summarize test: call `s.summarize('t1')` and assert
```ts
expect(u.billable.costEur).toBeCloseTo(u.billable.costUsd * OFFICIAL_USD_TO_EUR, 6);
expect(u.usdToEur).toBe(0.92);
expect('markupPct' in u).toBe(false);
```
(import `OFFICIAL_USD_TO_EUR` from `../pricing/officialRates`). Update every other `summarize(..., settings)` call to `summarize(...)`.

`src/main/ipc/handlers.test.ts`:
- Remove `RateStore` from the harness and `rates` from `services`.
- Replace the "lists, saves and resets rates" test with:
```ts
it('lists the official rates read-only', async () => {
  const hx = await harness();
  const { rates, officialAsOf } = await hx.h['rates:list']();
  expect(officialAsOf).toBe('2026-10-14');
  expect(rates).toEqual(OFFICIAL_RATES);
});
```
- In the settings test, drop the `usdToEur: 0.9` save (use `hourlySync: false` instead), and keep the port assertions.
- In the summary/CSV test, the CSV row stays `...,false,4,3.68,false,` (4 USD * 0.92).
- In the finish test, `Custom.AICost` stays `3.68`.

`src/shared/workItemUsage.test.ts` and `src/main/usage/UsageSync.test.ts`: remove `markupPct` from the `TaskUsage` literals.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --project main src/main/usage src/main/ipc src/shared`
Expected: FAIL (settings keys, summarize signature, missing `OFFICIAL_USD_TO_EUR`).

- [ ] **Step 3: Implement**

`src/shared/usage.ts`:
```ts
/** Built-in exchange rate used for every EUR amount, so all teammates on the same MIAC version write identical numbers. Changes only with an app update. */
export const OFFICIAL_USD_TO_EUR = 0.92;
```
`src/main/pricing/officialRates.ts`, below `OFFICIAL_RATES_AS_OF`: `export { OFFICIAL_USD_TO_EUR } from '../../shared/usage';`

`src/shared/usage.ts`:
- `AppSettingsSchema` becomes `z.object({ version: z.literal(1), receiverPort: z.number().int().min(1024).max(65535), hourlySync: z.boolean() })`. zod `object` strips unknown keys, which is what makes old files load. Keep it that way: no `.strict()`.
- `defaultSettings` returns `{ version: 1, receiverPort: 4319, hourlySync: true }`.
- Remove `RatesFileSchema`.
- Remove `markupPct` from `TaskUsage`.

`src/shared/ipc.ts`: delete the `rates:save` and `rates:reset` entries.

`src/main/usage/UsageStore.ts`: `summarize(taskId: string): TaskUsage`. Use `const factor = OFFICIAL_USD_TO_EUR;` (import from `../pricing/officialRates`), return `usdToEur: OFFICIAL_USD_TO_EUR`, and remove `markupPct`. Remove the now-unused `AppSettings` import.

`src/main/ipc/handlers.ts`:
- Remove the `RateStore` import and `rates` from `Services`.
- `usage: (taskId) => s.usage.summarize(taskId)` in the UsageSync deps.
- `'usage:task'` and `'usage:setBillable'` call `s.usage.summarize(taskId)`.
- `'usage:exportCsv'` passes `OFFICIAL_USD_TO_EUR` as the factor.
- `'rates:list'` returns `{ rates: OFFICIAL_RATES, officialAsOf: OFFICIAL_RATES_AS_OF }`.
- Delete the `'rates:save'` and `'rates:reset'` handlers.

`src/main.ts`:
- Remove the `RateStore` import, construction, `load()` and the `['rates.json', ratesLoaded]` notice entry.
- Construct `new UsageStore(usageDir, () => OFFICIAL_RATES)`, importing `OFFICIAL_RATES`.

Delete `src/main/usage/RateStore.ts` and `src/main/usage/RateStore.test.ts`.

`src/renderer/test-helpers/fakeApi.ts`: the `settings:get` default and `emptyUsage` lose `usdToEur`/`markupPct` where the types require it. Keep `usdToEur: 0.92` in `emptyUsage`, because `TaskUsage` keeps it. Leave other renderer files to Task 2. If renderer typecheck errors remain only in `CostSection.tsx`/`UsageScreen.tsx`, note them in the report: Task 2 fixes them. In that case run only `npx tsc --noEmit -p .` filtered to `src/main` and `src/shared` to confirm the main side is clean.

- [ ] **Step 4: Run the main tests and lint**

Run: `npx vitest run --project main && npm run lint`
Expected: PASS. A full `npm run typecheck` may still flag the two renderer files that Task 2 fixes; list them in the report.

- [ ] **Step 5: Commit**

```bash
git add -A src/main src/shared src/main.ts src/renderer/test-helpers/fakeApi.ts
git commit -m "feat: price with official rates and a built-in exchange rate only"
```

---

### Task 2: Renderer: read-only rate table, no exchange or markup inputs, new texts

**Files:**
- Modify: `src/renderer/components/CostSection.tsx`, `src/renderer/components/CostSection.test.tsx`, `src/renderer/screens/UsageScreen.tsx`, `src/renderer/screens/UsageScreen.test.tsx`, other renderer tests that typecheck flags
- Modify: `src/renderer/styles/screens.css` only if a removed element leaves dead CSS

**Interfaces:**
- Consumes: Task 1 (`AppSettings` without `usdToEur`/`markupPct`; `TaskUsage` without `markupPct`; `rates:list` only).

- [ ] **Step 1: Write the failing tests**

`src/renderer/components/CostSection.test.tsx`:
- Replace the settings-save test with:
```tsx
it('saves the port and hourly sync, and has no exchange rate or markup inputs', async () => {
  const { calls } = installFakeApi({ 'settings:get': () => settings, 'settings:save': (s) => s, 'rates:list': () => ({ rates, officialAsOf: '2026-10-14' }) });
  render(<CostSection />);
  await screen.findByLabelText('Usage receiver port');
  expect(screen.queryByLabelText('USD to EUR')).toBeNull();
  expect(screen.queryByLabelText('Markup %')).toBeNull();
  expect(screen.getByText('EUR at 0.92 per USD (built in)')).toBeTruthy();
  await userEvent.click(screen.getByRole('checkbox', { name: /every hour/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  expect(calls.find((c) => c.channel === 'settings:save')?.args[0]).toEqual({ version: 1, receiverPort: 4319, hourlySync: false });
});
```
- Replace the rate edit/reset test with:
```tsx
it('shows the official rates read-only', async () => {
  installFakeApi({ 'settings:get': () => settings, 'rates:list': () => ({ rates, officialAsOf: '2026-10-14' }) });
  render(<CostSection />);
  expect(await screen.findByText('Official list prices as of 2026-10-14 (USD per 1M tokens)')).toBeTruthy();
  expect(screen.getByText('Claude Opus 5.5')).toBeTruthy();
  expect(screen.getByText('claude-opus-5-5')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add rate' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save rates' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reset to official prices' })).toBeNull();
  expect(screen.queryAllByRole('spinbutton').filter((i) => (i.getAttribute('aria-label') ?? '').includes('per 1M'))).toHaveLength(0);
});
```
- Drop the blank-price validation test, since there are no price inputs left. Keep the port validation test if one exists, otherwise add: clearing the port and saving shows `Usage receiver port must be a number`, and `settings:save` is not called.
- `settings` literal: `{ version: 1 as const, receiverPort: 4319, hourlySync: true }`.

`src/renderer/screens/UsageScreen.test.tsx`:
- Expect the note `/official list prices .* USD to EUR 0.92/`.
- Expect the unpriced text `/1 request uses a model that is not in MIAC's official price list yet/`.
- Drop any `markupPct` from literals.
- Add a check that the session row cost equals `eur(costUsd * 0.92)`. For example, a session with `costUsd: 10` shows the euro sign followed by `9.20` in its row (build the euro sign with `String.fromCharCode(0x20ac)` in the test).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --project renderer src/renderer/components/CostSection.test.tsx src/renderer/screens/UsageScreen.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`CostSection.tsx`:
- Remove the `usdToEur` and `markupPct` draft fields, inputs and validation. Keep port validation and the hourly sync checkbox.
- Add the static line `` `EUR at ${OFFICIAL_USD_TO_EUR} per USD (built in)` ``, importing `OFFICIAL_USD_TO_EUR` from `../../shared/usage` (Task 1 put it there).
- Replace the editable rate table with a read-only table:
  - columns: Model (label), Matches (match ids joined with `, `), Tier (`from N input tokens` when `minInputTokens > 0`, `fast` when `fast`), Input, Cached input, Cache write, Output;
  - prices formatted with up to 3 decimals;
  - title above it: `Official list prices as of ${officialAsOf} (USD per 1M tokens)`.
- Remove Add rate, Save rates, Reset and the confirm row, plus the draft/parse helpers that only served them.

`UsageScreen.tsx`:
- Tile note: `official list prices ${DOT} USD to EUR ${usage.usdToEur}`.
- Row cost factor: `usage.usdToEur`, with no markup.
- Unpriced warning text exactly as in Global Constraints. Remove the pointer to Settings.

- [ ] **Step 4: Run the full checks**

Run: `npx vitest run --project renderer && npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/renderer
git commit -m "feat: read-only official price table and built-in exchange rate in the UI"
```

---

### Task 3: Live check and docs (controller)

- [ ] **Step 1:** Set aside `~/Library/Application Support/miac/state.json` (and `settings.json`/`rates.json`/`usage/` if present) as `*.pre-smoke`. Write a `settings.json` containing `{"version":1,"receiverPort":4319,"usdToEur":0.95,"markupPct":15,"hourlySync":true}` and a `rates.json` with an edited Opus 5.5 price, to prove both are ignored.
- [ ] **Step 2:** Start the app with `npx electron-forge start -- --remote-debugging-port=9333` (with the `CLAUDE*` env vars unset). Over CDP, check:
  - `settings:get` has no `usdToEur`/`markupPct`;
  - `rates:list` equals the official table;
  - Settings shows the read-only table and the built-in rate line, with no notice about `settings.json`;
  - no renderer errors.
  
  No Claude run is needed. Pricing math is covered by tests.
- [ ] **Step 3:** Quit, remove the smoke data and restore the `*.pre-smoke` files.
- [ ] **Step 4:** Update `CLAUDE.md` Status:
  - Sub-project 4 is "official prices only".
  - Invoicing is done with Azure DevOps queries on the AI fields.
  - Reconciliation is deferred.
  
  Commit `docs: status after sub-project 4`.
