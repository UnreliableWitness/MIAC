import type { ReviewComment } from './review';

const CONTEXT = 3;
const toLines = (text: string): string[] =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd());
const fromLines = (lines: string[]): string => lines.join('\n');

/** The lines a new comment covers, with context, from the text it was made on. */
export function captureAnchor(
  text: string,
  startLine: number,
  endLine: number,
): {
  snippet: string;
  contextBefore: string;
  contextAfter: string;
  startLine: number;
  endLine: number;
} {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  const last = Math.max(1, lines.length);
  const s = Math.min(Math.max(1, startLine), last);
  const e = Math.min(Math.max(s, endLine), last);
  return {
    snippet: fromLines(lines.slice(s - 1, e)),
    contextBefore: fromLines(lines.slice(Math.max(0, s - 1 - CONTEXT), s - 1)),
    contextAfter: fromLines(lines.slice(e, e + CONTEXT)),
    startLine: s,
    endLine: e,
  };
}

/**
 * Finds a comment's lines again in new text: every place the snippet occurs exactly (ignoring trailing
 * whitespace and line endings), scored by matching context lines, ties broken by distance to the old line.
 * Null when the snippet is no longer there.
 */
export function anchorComment(
  c: Pick<
    ReviewComment,
    'startLine' | 'snippet' | 'contextBefore' | 'contextAfter'
  >,
  text: string,
): { startLine: number; endLine: number } | null {
  const lines = toLines(text);
  const want = toLines(c.snippet);
  const before = c.contextBefore ? toLines(c.contextBefore) : [];
  const after = c.contextAfter ? toLines(c.contextAfter) : [];
  const n = want.length;
  let best: { start: number; score: number; dist: number } | null = null;
  for (let i = 0; i + n <= lines.length; i++) {
    let same = true;
    for (let k = 0; k < n && same; k++) same = lines[i + k] === want[k];
    if (!same) continue;
    let score = 0;
    for (let k = 1; k <= before.length; k++)
      if (lines[i - k] === before[before.length - k]) score++;
    for (let k = 0; k < after.length; k++)
      if (lines[i + n + k] === after[k]) score++;
    const dist = Math.abs(i + 1 - c.startLine);
    if (
      !best ||
      score > best.score ||
      (score === best.score && dist < best.dist)
    )
      best = { start: i, score, dist };
  }
  return best ? { startLine: best.start + 1, endLine: best.start + n } : null;
}
