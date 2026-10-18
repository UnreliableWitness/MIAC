import type { AiField, TaskUsage, UsageTool } from './usage';

const EURO = String.fromCharCode(0x20ac);
const LABEL: Record<UsageTool, string> = {
  'claude-code': 'Claude Code',
  'copilot-cli': 'Copilot CLI',
};

export const round2 = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;
const eur = (n: number) => `${EURO}${round2(n).toFixed(2)}`;

export function aiFieldValues(u: TaskUsage): Record<AiField, number> {
  return {
    'Custom.AICost': round2(u.billable.costEur),
    'Custom.AICostClaude': round2(u.byTool['claude-code'].costEur),
    'Custom.AICostCopilot': round2(u.byTool['copilot-cli'].costEur),
    'Custom.AITokens': Math.round(u.billable.tokens),
  };
}

/**
 * The usage comment posted once on finish, naming the task's pushed branches. Only billable sessions count;
 * tools without usage are left out.
 */
export function renderUsageComment(u: TaskUsage, branches: string[]): string {
  const billable = u.sessions.filter((s) => s.billable);
  const lines = [
    `AI usage for this work item (Shellie): ${eur(u.billable.costEur)}`,
  ];
  for (const tool of ['claude-code', 'copilot-cli'] as const) {
    const t = u.byTool[tool];
    if (t.sessions === 0) continue;
    const models = [
      ...new Set(
        billable.filter((s) => s.tool === tool).flatMap((s) => s.models),
      ),
    ];
    const modelText = models.length > 0 ? ` (${models.join(', ')})` : '';
    lines.push(
      `${LABEL[tool]}: ${eur(t.costEur)} over ${t.sessions} session${t.sessions === 1 ? '' : 's'}${modelText}`,
    );
  }
  const unpriced = billable.reduce((n, s) => n + s.unpricedRequests, 0);
  if (unpriced > 0)
    lines.push(
      `plus ${unpriced} request${unpriced === 1 ? '' : 's'} with unpriced models`,
    );
  const names = [...new Set(branches)];
  lines.push(
    names.length === 1 ? `Branch ${names[0]}` : `Branches ${names.join(', ')}`,
  );
  return lines.join('\n\n');
}

export const COST_LINE_PREFIX = 'AI cost for this task: ';

/** The one-line cost summary for a pull request description, in the same EUR format as the comment and fields. */
export function renderCostLine(u: TaskUsage): string {
  return `${COST_LINE_PREFIX}${eur(u.billable.costEur)} (Claude ${eur(u.byTool['claude-code'].costEur)}, Copilot ${eur(u.byTool['copilot-cli'].costEur)})`;
}
