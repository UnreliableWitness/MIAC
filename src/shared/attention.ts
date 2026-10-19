import { z } from 'zod';

export const ATTENTION_STATES = [
  'working',
  'idle',
  'blocked',
  'done',
  'clear',
] as const;
export type AttentionState = (typeof ATTENTION_STATES)[number];

/** What an agent reported about one terminal. `kind` is the agent's own word (`permission`, `question`, `bell`). */
export type AttentionSignal = {
  state: AttentionState;
  kind?: string;
  message?: string;
};

/** A terminal that waits on the developer. */
export type AttentionEntry = {
  reason: 'blocked' | 'done';
  kind?: string;
  message?: string;
  since: number;
};

/** Terminal id → what it waits for; only terminals that need attention. */
export type AttentionSnapshot = Record<string, AttentionEntry>;

/** The terminal tab on screen in the renderer; null when no task page shows. */
export type AttentionView = { taskId: string; tabId: string } | null;

export const MESSAGE_MAX = 200;

/** One line without control or format characters (bidi overrides), at most MESSAGE_MAX code points. */
export const clampMessage = (s: string): string => {
  const line = s
    .replace(/\s+/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim();
  const points = Array.from(line);
  return points.length > MESSAGE_MAX
    ? `${points.slice(0, MESSAGE_MAX - 1).join('')}…`
    : line;
};

/** Body of POST /v1/attention (the OpenCode plugin). */
export const AttentionPostSchema = z.object({
  terminalId: z.string().min(1).max(100),
  state: z.enum(ATTENTION_STATES),
  kind: z.string().max(40).optional(),
  message: z.string().max(4000).optional(),
});
