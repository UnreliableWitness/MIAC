import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BudgetRecord } from '../../shared/budget';

const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

/** One OpenCode `message` row as a budget record; null unless it is a finished assistant message. */
export function parseOpenCodeMessage(
  id: string,
  sessionId: string,
  data: string,
): BudgetRecord | null {
  let d: {
    role?: string;
    modelID?: string;
    providerID?: string;
    path?: { cwd?: string };
    tokens?: {
      input?: number;
      output?: number;
      cache?: { read?: number; write?: number };
    };
    time?: { created?: number; completed?: number | null };
  };
  try {
    d = JSON.parse(data);
  } catch {
    return null;
  }
  if (
    d.role !== 'assistant' ||
    !d.time?.completed ||
    !d.time.created ||
    !d.modelID
  )
    return null;
  return {
    id: `oc:${id}`,
    tool: 'opencode',
    sessionId,
    model: d.modelID,
    provider: d.providerID ?? '',
    at: new Date(d.time.created).toISOString(),
    cwd: d.path?.cwd ?? null,
    fast: false,
    inputTokens: n(d.tokens?.input),
    outputTokens: n(d.tokens?.output),
    cacheReadTokens: n(d.tokens?.cache?.read),
    // OpenCode does not say which cache TTL it wrote; priced as 5-minute writes (spec, our call).
    cacheWrite5mTokens: n(d.tokens?.cache?.write),
    cacheWrite1hTokens: 0,
  };
}

export function openCodeDbPath(
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): string {
  const base = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(base, 'opencode', 'opencode.db');
}

/** Reads OpenCode's SQLite database read-only; OpenCode may be writing (WAL), so a busy database waits briefly. */
export class OpenCodeReader {
  constructor(private readonly file: string) {}

  read(cursor: number): {
    records: BudgetRecord[];
    cursor: number;
    found: boolean;
  } {
    if (!existsSync(this.file)) return { records: [], cursor, found: false };
    const db = new DatabaseSync(this.file, { readOnly: true, timeout: 2000 });
    try {
      const rows = db
        .prepare(
          'SELECT id, session_id, time_updated, data FROM message WHERE time_updated > ? ORDER BY time_updated',
        )
        .all(cursor) as {
        id: string;
        session_id: string;
        time_updated: number;
        data: string;
      }[];
      const records: BudgetRecord[] = [];
      let next = cursor;
      for (const r of rows) {
        next = Math.max(next, r.time_updated);
        const rec = parseOpenCodeMessage(r.id, r.session_id, r.data);
        if (rec) records.push(rec);
      }
      return { records, cursor: next, found: true };
    } finally {
      db.close();
    }
  }
}
