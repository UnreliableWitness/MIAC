import type { Rate } from '../../shared/usage';

export const OFFICIAL_RATES_AS_OF = '2026-10-14';
export { OFFICIAL_USD_TO_EUR } from '../../shared/usage';

const r = (
  id: string,
  label: string,
  match: string[],
  p: [number, number, number, number],
  extra: Partial<Rate> = {},
): Rate => ({
  id,
  label,
  match,
  minInputTokens: 0,
  fast: false,
  inputPerM: p[0],
  cachedInputPerM: p[1],
  cacheWritePerM: p[2],
  outputPerM: p[3],
  ...extra,
});

/** Source: https://platform.claude.com/docs/en/about-claude/pricing (2026-10-14). [input, cache hit, 5m cache write, output] */
const ANTHROPIC: Rate[] = [
  r(
    'anthropic-fable-5-1',
    'Claude Fable 5.1',
    ['claude-fable-5-1', 'claude-mythos-5-1'],
    [10, 0.25, 12.5, 50],
  ),
  r(
    'anthropic-fable-5',
    'Claude Fable 5',
    ['claude-fable-5', 'claude-mythos-5'],
    [10, 1, 12.5, 50],
  ),
  r(
    'anthropic-opus-5-5',
    'Claude Opus 5.5',
    ['claude-opus-5-5'],
    [4, 0.2, 5, 20],
  ),
  // Fast mode: $8 / $40; caching multipliers apply on top (Opus 5.5 hit = 0.05x input, 5m write = 1.25x).
  r(
    'anthropic-opus-5-5-fast',
    'Claude Opus 5.5 (fast)',
    ['claude-opus-5-5'],
    [8, 0.4, 10, 40],
    { fast: true },
  ),
  r('anthropic-opus-5', 'Claude Opus 5', ['claude-opus-5'], [5, 0.5, 6.25, 25]),
  r(
    'anthropic-opus-5-fast',
    'Claude Opus 5 (fast)',
    ['claude-opus-5'],
    [10, 1, 12.5, 50],
    { fast: true },
  ),
  r(
    'anthropic-opus-4-8',
    'Claude Opus 4.8',
    ['claude-opus-4-8'],
    [5, 0.5, 6.25, 25],
  ),
  r(
    'anthropic-opus-4-8-fast',
    'Claude Opus 4.8 (fast)',
    ['claude-opus-4-8'],
    [10, 1, 12.5, 50],
    { fast: true },
  ),
  r(
    'anthropic-opus-4-7',
    'Claude Opus 4.7 / 4.6 / 4.5',
    ['claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5'],
    [5, 0.5, 6.25, 25],
  ),
  r(
    'anthropic-opus-4-1',
    'Claude Opus 4.1 / 4',
    ['claude-opus-4-1', 'claude-opus-4'],
    [15, 1.5, 18.75, 75],
  ),
  r(
    'anthropic-sonnet-5-5',
    'Claude Sonnet 5.5',
    ['claude-sonnet-5-5'],
    [2, 0.1, 2.5, 10],
  ),
  r(
    'anthropic-sonnet-5',
    'Claude Sonnet 5',
    ['claude-sonnet-5'],
    [2, 0.2, 2.5, 10],
  ),
  r(
    'anthropic-sonnet-4-6',
    'Claude Sonnet 4.6 / 4.5 / 4',
    ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-sonnet-4'],
    [3, 0.3, 3.75, 15],
  ),
  r(
    'anthropic-haiku-5-5',
    'Claude Haiku 5.5',
    ['claude-haiku-5-5'],
    [0.1, 0.01, 0.125, 0.5],
  ),
  r(
    'anthropic-haiku-5-5-long',
    'Claude Haiku 5.5 (>100K input)',
    ['claude-haiku-5-5'],
    [0.5, 0.05, 0.625, 2.5],
    { minInputTokens: 100_000 },
  ),
  r(
    'anthropic-haiku-4-5',
    'Claude Haiku 4.5',
    ['claude-haiku-4-5'],
    [1, 0.1, 1.25, 5],
  ),
  r(
    'anthropic-haiku-3-5',
    'Claude Haiku 3.5',
    ['claude-3-5-haiku', 'claude-haiku-3-5'],
    [0.8, 0.08, 1, 4],
  ),
];

/** Source: https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing (2026-10-14). [input, cached input, cache write, output]. Anthropic models via Copilot share the ids above, so only non-Anthropic models are listed here; Anthropic rows apply to both tools. */
const COPILOT: Rate[] = [
  r('copilot-gpt-5-mini', 'GPT-5 mini', ['gpt-5-mini'], [0.25, 0.025, 0, 2]),
  r(
    'copilot-gpt-5-3-codex',
    'GPT-5.3-Codex',
    ['gpt-5-3-codex'],
    [1.75, 0.175, 0, 14],
  ),
  r('copilot-gpt-5-4', 'GPT-5.4', ['gpt-5-4'], [2.5, 0.25, 0, 15]),
  r(
    'copilot-gpt-5-4-long',
    'GPT-5.4 (>272K input)',
    ['gpt-5-4'],
    [5, 0.5, 0, 22.5],
    { minInputTokens: 272_000 },
  ),
  r(
    'copilot-gpt-5-4-mini',
    'GPT-5.4 mini',
    ['gpt-5-4-mini'],
    [0.75, 0.075, 0, 4.5],
  ),
  r(
    'copilot-gpt-5-4-nano',
    'GPT-5.4 nano',
    ['gpt-5-4-nano'],
    [0.2, 0.02, 0, 1.25],
  ),
  r('copilot-gpt-5-5', 'GPT-5.5', ['gpt-5-5'], [5, 0.5, 0, 30]),
  r(
    'copilot-gpt-5-5-long',
    'GPT-5.5 (>272K input)',
    ['gpt-5-5'],
    [10, 1, 0, 45],
    { minInputTokens: 272_000 },
  ),
  r(
    'copilot-gpt-5-6-luna',
    'GPT-5.6 Luna',
    ['gpt-5-6-luna'],
    [0.2, 0.02, 0.25, 1.2],
  ),
  r(
    'copilot-gpt-5-6-luna-long',
    'GPT-5.6 Luna (>200K input)',
    ['gpt-5-6-luna'],
    [0.4, 0.04, 0.5, 1.8],
    { minInputTokens: 200_000 },
  ),
  r('copilot-gpt-5-6-sol', 'GPT-5.6 Sol', ['gpt-5-6-sol'], [4, 0.4, 5, 20]),
  r(
    'copilot-gpt-5-6-sol-long',
    'GPT-5.6 Sol (>272K input)',
    ['gpt-5-6-sol'],
    [8, 0.8, 10, 30],
    { minInputTokens: 272_000 },
  ),
  r(
    'copilot-gpt-5-6-terra',
    'GPT-5.6 Terra',
    ['gpt-5-6-terra'],
    [2, 0.2, 2.5, 12],
  ),
  r(
    'copilot-gpt-5-6-terra-long',
    'GPT-5.6 Terra (>272K input)',
    ['gpt-5-6-terra'],
    [4, 0.4, 5, 18],
    { minInputTokens: 272_000 },
  ),
  r('copilot-gpt-6-astra', 'GPT-6 Astra', ['gpt-6-astra'], [10, 1, 12.5, 50]),
  r(
    'copilot-gpt-6-astra-long',
    'GPT-6 Astra (>272K input)',
    ['gpt-6-astra'],
    [20, 2, 25, 75],
    { minInputTokens: 272_000 },
  ),
  r(
    'copilot-gpt-6-luna',
    'GPT-6 Luna',
    ['gpt-6-luna'],
    [0.1, 0.01, 0.125, 0.5],
  ),
  r(
    'copilot-gpt-6-luna-long',
    'GPT-6 Luna (>272K input)',
    ['gpt-6-luna'],
    [0.2, 0.02, 0.25, 0.75],
    { minInputTokens: 272_000 },
  ),
  r('copilot-gpt-6-sol', 'GPT-6 Sol', ['gpt-6-sol'], [2, 0.2, 2.5, 10]),
  r(
    'copilot-gpt-6-sol-long',
    'GPT-6 Sol (>272K input)',
    ['gpt-6-sol'],
    [4, 0.4, 5, 15],
    { minInputTokens: 272_000 },
  ),
  r('copilot-gpt-6-1-sol', 'GPT-6.1 Sol', ['gpt-6-1-sol'], [2, 0.1, 2.5, 10]),
  r(
    'copilot-gpt-6-1-sol-long',
    'GPT-6.1 Sol (>272K input)',
    ['gpt-6-1-sol'],
    [4, 0.2, 5, 15],
    { minInputTokens: 272_000 },
  ),
  r(
    'copilot-gemini-3-7-flash',
    'Gemini 3.7 Flash (promo to 2026-12-31)',
    ['gemini-3-7-flash'],
    [0.75, 0.075, 0, 3.75],
  ),
  r(
    'copilot-gemini-3-8-flash',
    'Gemini 3.8 Flash (promo to 2026-12-31)',
    ['gemini-3-8-flash'],
    [0.75, 0.075, 0, 3.75],
  ),
  r(
    'copilot-gemini-4-argon',
    'Gemini 4 Argon (promo to 2026-12-01)',
    ['gemini-4-argon'],
    [2, 0.1, 0, 10],
  ),
  r(
    'copilot-mai-code-1-1-flash',
    'MAI-Code-1.1-Flash',
    ['mai-code-1-1-flash'],
    [0.2, 0.02, 0, 1.2],
  ),
  r(
    'copilot-grok-4-5',
    'Grok 4.5 / 4.6 / 4.7',
    ['grok-4-5', 'grok-4-6', 'grok-4-7'],
    [2, 0.5, 0, 6],
  ),
  r(
    'copilot-grok-4-5-long',
    'Grok 4.5 / 4.6 / 4.7 (>200K input)',
    ['grok-4-5', 'grok-4-6', 'grok-4-7'],
    [4, 1, 0, 12],
    { minInputTokens: 200_000 },
  ),
  r('copilot-kimi-k3', 'Kimi K3', ['kimi-k3'], [3, 0.3, 0, 15]),
];

export const OFFICIAL_RATES: Rate[] = [...ANTHROPIC, ...COPILOT];
