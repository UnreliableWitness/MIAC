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

export type RateSnapshot = {
  inputPerM: number;
  cachedInputPerM: number;
  cacheWritePerM: number;
  outputPerM: number;
};

export type UsageRecord = UsageEvent & {
  costUsd: number | null;
  rateId: string | null;
  rate: RateSnapshot | null;
};

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

/** Built-in exchange rate used for every EUR amount, so all teammates on the same MIAC version write identical numbers. Changes only with an app update. */
export const OFFICIAL_USD_TO_EUR = 0.92;

export const AppSettingsSchema = z.object({
  version: z.literal(1),
  receiverPort: z.number().int().min(1024).max(65535),
  hourlySync: z.boolean(),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export const defaultSettings = (): AppSettings => ({
  version: 1,
  receiverPort: 4319,
  hourlySync: true,
});

export type SessionSummary = {
  sessionId: string;
  tool: UsageTool;
  startedAt: string;
  lastAt: string;
  models: string[];
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number; // priced part only
  unpricedRequests: number;
  billable: boolean;
};

export type ToolTotals = { costUsd: number; sessions: number; tokens: number };

/** One billable, priced request from the last 6 hours, for the usage timeline. */
export type RecentPoint = { at: string; tool: UsageTool; costEur: number };

export type TaskUsage = {
  taskId: string;
  sessions: SessionSummary[];
  billable: { costUsd: number; costEur: number; tokens: number };
  byTool: Record<UsageTool, ToolTotals & { costEur: number }>;
  unpricedRequests: number;
  usdToEur: number;
  recent: RecentPoint[];
};

export type ReceiverStatus = {
  listening: boolean;
  port: number;
  error: string | null;
  copilot: { records: number; unreadable: number };
};

export const AI_FIELDS = [
  'Custom.AICost',
  'Custom.AICostClaude',
  'Custom.AICostCopilot',
  'Custom.AITokens',
] as const;
export type AiField = (typeof AI_FIELDS)[number];
export type FieldsStatus = {
  connectionId: string;
  types: { type: string; present: AiField[]; missing: AiField[] }[];
};

export type SyncResult = {
  ok: boolean;
  fieldsWritten: AiField[];
  fieldsMissing: AiField[];
  commentPosted: boolean;
  error: string | null;
};
