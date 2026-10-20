import { z } from 'zod';
import { BudgetSettingsSchema, defaultBudgetSettings } from './budget';
import { defaultEditorPrefs, EditorPrefsSchema } from './editors';
import { WorkHoursSchema } from './time';

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
  /** 1-hour cache write price; absent means the 5-minute price applies. */
  cacheWrite1hPerM: z.number().min(0).optional(),
  outputPerM: z.number().min(0),
});
export type Rate = z.infer<typeof RateSchema>;

/** Built-in exchange rate used for every EUR amount, so all teammates on the same Shellie version write identical numbers. Changes only with an app update. */
export const OFFICIAL_USD_TO_EUR = 0.92;

export const AppSettingsSchema = z.object({
  version: z.literal(1),
  receiverPort: z.number().int().min(1024).max(65535),
  hourlySync: z.boolean(),
  /**
   * Write AI cost to Azure DevOps work items (the Custom.AI* fields and a usage comment) and into draft PR
   * descriptions. Off by default: cost is still captured and priced locally (Usage tab, CSV export).
   */
  writeCostToAdo: z.boolean().default(false),
  /** Write booked time to Azure DevOps (Completed and Remaining Work) at Finish. Off by default. */
  writeTimeToAdo: z.boolean().default(false),
  /** Minutes without input before a terminal stops counting as active. */
  idleMinutes: z.number().int().min(1).max(60).default(5),
  workHours: WorkHoursSchema.default({
    start: '09:00',
    end: '17:00',
    days: [1, 2, 3, 4, 5],
  }),
  showSplash: z.boolean().default(true),
  /** Notify when an agent finishes its turn (blocked agents always notify). */
  notifyOnDone: z.boolean().default(true),
  /** The developer's monthly Claude budget (Home's Claude budget band). */
  claudeBudget: BudgetSettingsSchema.default(defaultBudgetSettings()),
  /** Send anonymous usage and error data (see docs/telemetry.md). */
  sendTelemetry: z.boolean().default(true),
  /** Which editor Open in editor uses, globally and per repo. */
  editor: EditorPrefsSchema.default(defaultEditorPrefs()),
  /** Auto-update (packaged Windows builds). No UI yet: set false in settings.json to turn it off. */
  autoUpdate: z.boolean().optional(),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;
/** The required fields; every other setting takes its schema default. */
export const defaultSettings = (): AppSettings =>
  AppSettingsSchema.parse({ version: 1, receiverPort: 4319, hourlySync: true });

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
