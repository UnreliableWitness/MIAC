import type { ModelTotals } from '../shared/usage';

/** A chart colour per Claude model family. Works on raw ids and on labels ("Claude Opus 5.5"). */
export function modelColor(model: string): string {
  const m = model.toLowerCase();
  for (const f of ['opus', 'sonnet', 'haiku', 'fable'] as const)
    if (m.includes(f)) return `var(--chart-${f})`;
  return 'var(--line-strong)';
}

/** The Usage tab's colour for a model: Copilot CLI's purple for anything used through Copilot, else the family. */
export const usageModelColor = (m: ModelTotals): string =>
  m.tool === 'copilot-cli' ? 'var(--chart-copilot)' : modelColor(m.label);
