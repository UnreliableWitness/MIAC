import type { Environment } from '../../../shared/secrets';
import type { Item } from './types';

const LINE = /^\s*(?:export\s+)?([^\s=#]+)\s*=\s?(.*)$/;

/**
 * `KEY=value` lines. Quotes may span lines (a PEM key); `\n`, `\r`, `\"` and `\\` are escapes in double quotes only;
 * unquoted values stop at a ` #` comment. Nothing is expanded, so `$` stays.
 */
export function parseDotenv(
  text: string,
  source: string,
  env: Environment | null,
): Item[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const items: Item[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*#/.test(line)) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    const name = m[1]!;
    const rest = m[2]!.replace(/^\s+/, '');
    const q = rest[0];
    let value: string | null = null;
    if (q === '"' || q === "'" || q === '`') {
      let body = rest.slice(1);
      let n = i;
      for (;;) {
        const end = closing(body, q);
        if (end !== -1) {
          value = body.slice(0, end);
          i = n;
          break;
        }
        n++;
        if (n >= lines.length) break;
        body += `\n${lines[n]!}`;
      }
      if (value !== null && q === '"') value = unescape(value);
    }
    if (value === null) value = rest.replace(/\s+#.*$/, '').trimEnd();
    items.push({ name, value, env, source });
  }
  return items;
}

function closing(body: string, q: string): number {
  for (let j = 0; j < body.length; j++) {
    if (q === '"' && body[j] === '\\') j++;
    else if (body[j] === q) return j;
  }
  return -1;
}

function unescape(s: string): string {
  return s.replace(/\\([nr"\\])/g, (_, c: string) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c,
  );
}
