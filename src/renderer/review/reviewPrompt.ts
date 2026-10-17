import type { ReviewSide } from '../../shared/review';
import { cleanPasteText } from '../docs/quote';

export type PromptComment = {
  path: string;
  /** The base path of a renamed file, used for a before-side location. */
  oldPath?: string;
  side: ReviewSide;
  startLine: number;
  endLine: number;
  snippet: string;
  text: string;
};

const HEAD = 'Review comments on the changes in this task:';
const MAX_SNIPPET_LINES = 12;
const cleanPath = (p: string) => cleanPasteText(p).replace(/\s+/g, ' ');
/** `path:N` for the working tree; a before-side line is a base line, so it says so (and names a rename). */
const loc = (c: PromptComment) => {
  const one = c.startLine === c.endLine;
  const lines = one ? `${c.startLine}` : `${c.startLine}-${c.endLine}`;
  const path = cleanPath(c.path);
  if (c.side === 'after') return `${path}:${lines}`;
  const old = c.oldPath && c.oldPath !== c.path ? cleanPath(c.oldPath) : null;
  const what = `${one ? 'removed line' : 'removed lines'}, base version`;
  return old
    ? `${old}:${lines} (${what}; now ${path})`
    : `${path}:${lines} (${what})`;
};

/**
 * The text pasted into the agent's terminal. Never ends in Enter alone: the developer can add a sentence and
 * send it. `singleLine` is for terminals without bracketed paste, where each line break would submit.
 */
export function buildReviewPrompt(
  items: PromptComment[],
  opts: { singleLine?: boolean } = {},
): string {
  if (opts.singleLine) {
    const flat = (s: string) => cleanPasteText(s).replace(/\s+/g, ' ').trim();
    return `${HEAD} ${items.map((c, i) => `${i + 1}. ${loc(c)}: ${flat(c.text)}`).join(' ')} `;
  }
  const blocks = items.map((c, i) => {
    const snippet = cleanPasteText(c.snippet).split('\n');
    const shown =
      snippet.length > MAX_SNIPPET_LINES
        ? [...snippet.slice(0, MAX_SNIPPET_LINES), '…']
        : snippet;
    const quote = shown.map((l) => (l ? `   > ${l}` : '   >')).join('\n');
    const text = cleanPasteText(c.text)
      .split('\n')
      .map((l) => `   ${l}`)
      .join('\n');
    return `${i + 1}. ${loc(c)}\n${quote}\n${text}`;
  });
  return `${HEAD}\n\n${blocks.join('\n\n')}\n\n`;
}
