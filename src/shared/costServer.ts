export type ServerBudget = { monthlyEur: number; monthStartDay: number };
export type ServerBudgets = {
  claude: ServerBudget | null;
  copilot: ServerBudget | null;
};

/** What Settings shows about the cost server. Never carries the key. */
export type CostServerStatus = {
  connected: boolean;
  url: string | null;
  email: string | null;
  lastSentAt: string | null;
  waiting: number;
  error: string | null;
  budgets: ServerBudgets | null;
};

/** https, or plain http on this machine only. */
export function validServerUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'https:') return true;
  return (
    u.protocol === 'http:' &&
    (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
  );
}
