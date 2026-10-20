// Independent check of Shellie's Claude budget numbers.
// Usage: node tools/budget-check.mjs 2026-10-19
// Sums one local day of Claude Code tokens per model straight from the transcripts.
// Claude Code writes several lines per message id; the copy with the most tokens is kept.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const day = process.argv[2];
if (!day) {
  console.error('Usage: node tools/budget-check.mjs YYYY-MM-DD');
  process.exit(1);
}
const root = path.join(
  process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'),
  'projects',
);
const best = new Map(); // message id -> { total, model, local, u }
const total = (u) =>
  (u.input_tokens ?? 0) +
  (u.output_tokens ?? 0) +
  (u.cache_read_input_tokens ?? 0) +
  (u.cache_creation_input_tokens ?? 0);
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (
      e.name.endsWith('.jsonl') &&
      statSync(p).mtimeMs > Date.parse(day) - 864e5
    ) {
      for (const l of readFileSync(p, 'utf8').split('\n')) {
        if (!l.includes('"usage"')) continue;
        let o;
        try {
          o = JSON.parse(l);
        } catch {
          continue;
        }
        const m = o.message;
        if (
          o.type !== 'assistant' ||
          !m?.usage ||
          !m.id ||
          m.model === '<synthetic>'
        )
          continue;
        const t = new Date(o.timestamp);
        const local = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        const tot = total(m.usage);
        const prev = best.get(m.id);
        if (!prev || tot > prev.total)
          best.set(m.id, { total: tot, model: m.model, local, u: m.usage });
      }
    }
  }
};
walk(root);
const totals = {};
for (const b of best.values()) {
  if (b.local !== day) continue;
  const x = (totals[b.model] ??= { requests: 0, input: 0, output: 0 });
  x.requests++;
  x.input += b.u.input_tokens ?? 0;
  x.output += b.u.output_tokens ?? 0;
}
console.log(JSON.stringify(totals, null, 2));
