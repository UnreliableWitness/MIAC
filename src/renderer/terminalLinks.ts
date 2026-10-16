import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { api } from './api';
import { findLinks } from './docs/linkify';
import { useStore } from './store';
import { track } from './telemetry';

export type BufferLike = {
  getLine(
    y: number,
  ):
    | { isWrapped: boolean; translateToString(trimRight?: boolean): string }
    | undefined;
};
export type LinkTarget =
  | { type: 'md' | 'file'; path: string; line?: number; col?: number }
  | { type: 'url'; url: string };
type Resolve = (
  taskId: string,
  path: string,
) => Promise<{ path: string; kind: 'md' | 'file' } | null>;

/** findLinks is quadratic on long lines: only the first 2,000 characters are scanned. */
const MAX_SCAN = 2000;

/** The whole logical line a row belongs to (xterm splits long lines into wrapped rows). */
export function logicalLine(
  buf: BufferLike,
  y: number,
): { text: string; firstRow: number } {
  let first = y;
  while (first > 0 && buf.getLine(first)?.isWrapped) first--;
  let text = '';
  let row = first;
  for (;;) {
    const line = buf.getLine(row);
    if (!line) break;
    const continues = Boolean(buf.getLine(row + 1)?.isWrapped);
    text += line.translateToString(!continues);
    if (!continues) break;
    row++;
  }
  return { text, firstRow: first };
}

/** One cell per character: wide characters before a link shift it; acceptable for paths and URLs, which are ASCII in practice. */
export const cellAt = (cols: number, firstRow: number, index: number) => ({
  x: (index % cols) + 1,
  y: firstRow + Math.floor(index / cols) + 1,
});

export function openLink(taskId: string, target: LinkTarget): void {
  track('terminal.linkOpened', { type: target.type });
  if (target.type === 'url')
    void api()
      .invoke('links:open', target.url)
      .catch(() => undefined);
  else if (target.type === 'md')
    useStore.getState().openDoc(taskId, target.path, target.line);
  else
    void api()
      .invoke(
        'docs:openInEditor',
        taskId,
        target.path,
        ...(target.line
          ? [target.line, ...(target.col ? [target.col] : [])]
          : []),
      )
      .catch((e: unknown) =>
        useStore
          .getState()
          .notify('error', e instanceof Error ? e.message : String(e)),
      );
}

const LABELS = {
  md: 'Open in Docs',
  file: 'Open in VS Code',
  url: 'Open in browser',
} as const;

const tooltip = (label: string) => ({
  hover: (e: MouseEvent) => {
    (e.target as HTMLElement).title = label;
  },
  leave: (e: MouseEvent) => {
    (e.target as HTMLElement).title = '';
  },
});

export function createLinkProvider(
  term: Pick<Terminal, 'cols'> & { buffer: { active: BufferLike } },
  taskId: string,
  deps: { resolve?: Resolve; open?: (t: LinkTarget) => void } = {},
): ILinkProvider {
  const resolve: Resolve =
    deps.resolve ??
    ((t, p) =>
      api()
        .invoke('docs:resolve', t, p)
        .catch(() => null));
  const open = deps.open ?? ((t: LinkTarget) => openLink(taskId, t));
  const cache = new Map<string, Promise<ILink[]>>();
  return {
    provideLinks(lineNumber, callback) {
      const { text: full, firstRow } = logicalLine(
        term.buffer.active,
        lineNumber - 1,
      );
      const text = full.slice(0, MAX_SCAN);
      let pending = cache.get(text);
      if (!pending) {
        pending = Promise.all(
          findLinks(text).map(async (l): Promise<ILink | null> => {
            const range = {
              start: cellAt(term.cols, firstRow, l.start),
              end: cellAt(term.cols, firstRow, l.end - 1),
            };
            if (l.kind === 'url')
              return {
                range,
                text: l.text,
                activate: () => open({ type: 'url', url: l.url }),
                ...tooltip(LABELS.url),
              };
            const r = await resolve(taskId, l.path);
            if (!r) return null;
            return {
              range,
              text: l.text,
              activate: () =>
                open({ type: r.kind, path: r.path, line: l.line, col: l.col }),
              ...tooltip(LABELS[r.kind]),
            };
          }),
        ).then((ls) => ls.filter((x): x is ILink => x !== null));
        if (cache.size > 500) cache.clear();
        cache.set(text, pending);
      }
      void pending.then((links) => {
        callback(
          links.filter(
            (k) => k.range.start.y <= lineNumber && k.range.end.y >= lineNumber,
          ),
        );
      });
    },
  };
}
