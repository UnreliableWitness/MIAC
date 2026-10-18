import { api } from '../api';

export type FoundLink = { start: number; end: number; text: string } & (
  | { kind: 'url'; url: string }
  | { kind: 'path'; path: string; line?: number; col?: number }
);

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const PATH_RE =
  /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w@+~.-]+[\\/])*[\w@+~-][\w@+~.-]*\.([A-Za-z0-9]{1,10})(?::(\d+)(?::(\d+))?|\((\d+),(\d+)\))?/g;
const KNOWN_EXT = new Set(
  'md markdown ts tsx js jsx mjs cjs json jsonc yml yaml toml cs csproj sln fs vb py go rs java kt swift c h cpp hpp css scss less html htm xml svg txt sh ps1 psm1 bat cmd sql vue svelte lock env ini cfg conf gradle rb php'.split(
    ' ',
  ),
);

function trimUrl(u: string): string {
  let s = u;
  for (;;) {
    const last = s.at(-1);
    if (last && '.,;:!?\'"'.includes(last)) s = s.slice(0, -1);
    else if (last === ')' && count(s, '(') < count(s, ')')) s = s.slice(0, -1);
    else if (last === ']' && count(s, '[') < count(s, ']')) s = s.slice(0, -1);
    else return s;
  }
}
const count = (s: string, c: string) => s.split(c).length - 1;

/** File paths (with an optional :line[:col] or (line,col)) and http(s) URLs in one line of terminal text. */
export function findLinks(text: string): FoundLink[] {
  const out: FoundLink[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    out.push({
      kind: 'url',
      url,
      start: m.index,
      end: m.index + url.length,
      text: url,
    });
  }
  const inUrl = (i: number) =>
    out.some((l) => l.kind === 'url' && i >= l.start && i < l.end);
  for (const m of text.matchAll(PATH_RE)) {
    const start = m.index;
    if (inUrl(start)) continue;
    const before = text[start - 1];
    if (before && /[\w:/\\]/.test(before)) continue;
    const full = m[0];
    const suffixAt = full.search(/(:\d+(:\d+)?|\(\d+,\d+\))$/);
    const p = suffixAt >= 0 ? full.slice(0, suffixAt) : full;
    const hasSep = /[\\/]/.test(p);
    if (!hasSep && !KNOWN_EXT.has(m[1].toLowerCase())) continue;
    const line = Number(m[2] ?? m[4]) || undefined;
    const col = Number(m[3] ?? m[5]) || undefined;
    out.push({
      kind: 'path',
      path: p,
      line,
      col,
      start,
      end: start + full.length,
      text: full,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** A link in a document, resolved against that document's folder to a worktree-relative "/" path; null when it leaves the worktree. */
export function resolveRelative(fromDoc: string, href: string): string | null {
  const bare = href.split('#')[0].split('?')[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    decoded = bare;
  }
  const parts = decoded.startsWith('/') ? [] : fromDoc.split('/').slice(0, -1);
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length ? parts.join('/') : null;
}

/** A web link `links:open` accepts (http or https, no username or password), normalized; null for anything else. */
export function webLink(href: string): string | null {
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Opens a web link in the browser; a malformed or disallowed one does nothing. */
export function openWeb(href: string): void {
  const url = webLink(href);
  if (url)
    void api()
      .invoke('links:open', url)
      .catch(() => {});
}
