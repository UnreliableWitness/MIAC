import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BudgetRecord } from '../../shared/budget';

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  speed?: string;
};
const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

/** One Claude Code transcript line as a budget record; null for anything that is not a priced response. */
export function parseTranscriptLine(line: string): BudgetRecord | null {
  let d: {
    type?: string;
    timestamp?: string;
    sessionId?: string;
    cwd?: string;
    message?: { id?: string; model?: string; usage?: Usage };
  };
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  const m = d?.message;
  if (
    d.type !== 'assistant' ||
    !m?.usage ||
    !m.id ||
    !m.model ||
    m.model === '<synthetic>' ||
    !d.timestamp
  )
    return null;
  const u = m.usage;
  const split = u.cache_creation;
  const w1h = n(split?.ephemeral_1h_input_tokens);
  const w5m = split
    ? n(split.ephemeral_5m_input_tokens)
    : n(u.cache_creation_input_tokens);
  return {
    id: `cc:${m.id}`,
    tool: 'claude-code',
    sessionId: d.sessionId ?? '',
    model: m.model,
    provider: 'anthropic',
    at: d.timestamp,
    cwd: d.cwd ?? null,
    fast: u.speed === 'fast',
    inputTokens: n(u.input_tokens),
    outputTokens: n(u.output_tokens),
    cacheReadTokens: n(u.cache_read_input_tokens),
    cacheWrite5mTokens: w5m,
    cacheWrite1hTokens: w1h,
  };
}

export function claudeProjectsDir(
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): string {
  return env.CLAUDE_CONFIG_DIR
    ? path.join(env.CLAUDE_CONFIG_DIR, 'projects')
    : path.join(home, '.claude', 'projects');
}

export type FileCursor = {
  offset: number;
  size: number;
  mtimeMs: number;
  ino: number;
};

async function* jsonlFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFiles(p);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield p;
  }
}

const tick = () => new Promise<void>((r) => setImmediate(r));

/** Follows every Claude Code transcript under `root`, reading only bytes appended since the last pass. */
export class ClaudeTranscriptReader {
  constructor(
    private readonly root: string,
    private readonly opts: { since?: number } = {},
  ) {}

  async read(cursors: Record<string, FileCursor>) {
    try {
      await fs.access(this.root);
    } catch {
      return {
        records: [] as BudgetRecord[],
        cursors: {} as Record<string, FileCursor>,
        found: false,
      };
    }
    const next: Record<string, FileCursor> = {};
    const records: BudgetRecord[] = [];
    for await (const file of jsonlFiles(this.root)) {
      let st;
      try {
        st = await fs.stat(file);
      } catch {
        continue;
      }
      const prev = cursors[file];
      if (
        !prev &&
        this.opts.since !== undefined &&
        st.mtimeMs < this.opts.since
      ) {
        next[file] = {
          offset: st.size,
          size: st.size,
          mtimeMs: st.mtimeMs,
          ino: st.ino,
        };
        continue;
      }
      const reset = !prev || st.size < prev.offset || st.ino !== prev.ino;
      const from = reset ? 0 : prev.offset;
      if (!reset && st.size === prev.size && st.mtimeMs === prev.mtimeMs) {
        next[file] = prev;
        continue;
      }
      const fh = await fs.open(file, 'r');
      try {
        const buf = Buffer.alloc(st.size - from);
        await fh.read(buf, 0, buf.length, from);
        const end = buf.lastIndexOf(0x0a);
        const complete = end < 0 ? '' : buf.subarray(0, end).toString('utf8');
        for (const l of complete.split('\n')) {
          const r = l && parseTranscriptLine(l);
          if (r) records.push(r);
        }
        next[file] = {
          offset: from + end + 1,
          size: st.size,
          mtimeMs: st.mtimeMs,
          ino: st.ino,
        };
      } finally {
        await fh.close();
      }
      await tick();
    }
    return { records, cursors: next, found: true };
  }
}
