# MIAC sub-project 4: official prices only

Date: 2026-10-14
Status: design approved in conversation, awaiting written review
Builds on: sub-project 3 (AI usage capture, pricing and write-back, PR #3)

## Context

The original sub-project 4 was "invoicing and reconciliation": a per-customer roll-up screen, CSV export and a comparison against Anthropic and GitHub billing. The owner decided:

- Invoicing is a manager concern and is done with Azure DevOps queries on the AI cost fields that MIAC writes. A customer's board usually lives in the customer's own tenant, so a query in that organization covers the whole team. Managers filter by area path and Closed Date, export to CSV or chart Sum of AI Cost, and apply markup in their invoicing tool. MIAC builds no invoicing screen, query helper or guide.
- Reconciliation against Anthropic and GitHub billing is deferred to a later sub-project.
- What remains is to make sure every teammate writes the same numbers: work item amounts are priced only with the official list prices and a built-in exchange rate, with no local rates and no markup.

## Scope

In:
- Pricing always uses the built-in official rate table and a built-in USD to EUR rate.
- The rate table in Settings becomes read-only; the USD to EUR and markup settings are removed.
- The local rate store (`rates.json`) and its IPC channels for editing are removed.

Out:
- Invoicing screen, per-customer roll-up, customer mapping, CSV export across tasks.
- Creating Azure DevOps queries, manager documentation.
- Reconciliation against Anthropic and GitHub billing.
- Repricing usage recorded as unpriced after an app update adds the model.

## Design

### Pricing

- `src/main/pricing/officialRates.ts` keeps `OFFICIAL_RATES` and `OFFICIAL_RATES_AS_OF = '2026-10-14'`, and gains `OFFICIAL_USD_TO_EUR = 0.92`.
- `UsageStore` prices every event with `OFFICIAL_RATES`. Each record keeps its rate snapshot, so records already stored are never repriced.
- EUR amounts everywhere (Usage screen, header tile, nav, Finish block, work item fields, comment, CSV) are `costUsd * OFFICIAL_USD_TO_EUR`, rounded to 2 decimals on work items. There is no markup anywhere in MIAC.
- The exchange rate and the prices change only with an app update, so all teammates on the same version write identical amounts.

### Settings and storage

- `AppSettings` becomes `{ version: 1, receiverPort, hourlySync }`. An existing `settings.json` that still contains `usdToEur` or `markupPct` loads without error; the extra keys are dropped on the next save.
- `RateStore` and `<userData>/rates.json` are removed. An existing `rates.json` on disk is ignored and left in place.
- `TaskUsage` keeps `usdToEur` (always the built-in rate, so the renderer can show it) and drops `markupPct`.

### IPC

- Removed: `rates:save`, `rates:reset`.
- Kept: `rates:list` -> `{ rates, officialAsOf }` (read-only), `settings:get`, `settings:save` (with the smaller settings object).
- `settings:save` still restarts the receiver when the port changes and still broadcasts `usage:changed` with `'*'`.

### Screens

- **Settings, AI cost and invoicing**:
  - The rate table becomes read-only, titled "Official list prices as of 2026-10-14 (USD per 1M tokens)". There is no add, edit, delete or reset.
  - The currency line reads "EUR at 0.92 per USD (built in)".
  - The USD to EUR and markup inputs are removed.
  - The receiver port, hourly sync, receiver status, Copilot CLI counters and work item field check are unchanged.
- **Usage screen**: the billable tile note becomes "official list prices `·` USD to EUR 0.92".
- **Unpriced warning** (Usage screen): "N request(s) use a model that is not in MIAC's official price list yet, so it is not in the totals. A MIAC update will add it." The pointer to Settings is removed.

## Error handling

- A `settings.json` with the removed keys loads normally; a truly corrupt one is backed up as before.
- Unknown models stay unpriced (`costUsd: null`), never 0.

## Testing

- SettingsStore: an old file with `usdToEur` and `markupPct` loads, and the next save writes only the new keys.
- UsageStore/summarize: EUR uses `OFFICIAL_USD_TO_EUR`; no markup.
- Handlers: `rates:list` returns the official table; `rates:save`/`rates:reset` no longer exist (typecheck); `settings:save` with the smaller object moves the receiver; CSV EUR column uses the built-in rate.
- Renderer: the CostSection table is read-only and has no rate inputs or reset; there are no USD to EUR or markup inputs; the Usage screen shows the new note and the new unpriced text.
