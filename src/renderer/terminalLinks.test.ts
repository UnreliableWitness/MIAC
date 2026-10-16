import type { ILink } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vitest';
import { installFakeApi } from './test-helpers/fakeApi';
import { useStore } from './store';
import {
  cellAt,
  createLinkProvider,
  logicalLine,
  openLink,
} from './terminalLinks';

const buffer = (rows: { text: string; wrapped: boolean }[], cols: number) => ({
  cols,
  getLine: (y: number) =>
    rows[y] && {
      isWrapped: rows[y].wrapped,
      translateToString: (trim?: boolean) =>
        trim ? rows[y].text.trimEnd() : rows[y].text.padEnd(cols),
    },
});

describe('logicalLine', () => {
  it('joins wrapped rows from any row of the line', () => {
    const b = buffer(
      [
        { text: 'see docs/pl', wrapped: false },
        { text: 'an.md:12 ok', wrapped: true },
        { text: 'next', wrapped: false },
      ],
      11,
    );
    expect(logicalLine(b, 1)).toEqual({
      text: 'see docs/plan.md:12 ok',
      firstRow: 0,
    });
    expect(logicalLine(b, 2)).toEqual({ text: 'next', firstRow: 2 });
  });
  it('maps string indices back to 1-based cells', () => {
    expect(cellAt(11, 0, 4)).toEqual({ x: 5, y: 1 });
    expect(cellAt(11, 0, 12)).toEqual({ x: 2, y: 2 });
  });
});

describe('createLinkProvider', () => {
  it('offers validated path links and URLs, and routes activation', async () => {
    const b = buffer(
      [
        {
          text: 'x docs/a.md:3 y nope/z.ts http://localhost:3000',
          wrapped: false,
        },
      ],
      80,
    );
    const term = { cols: 80, buffer: { active: b } } as never;
    const resolve = vi.fn(async (_t: string, p: string) =>
      p === 'docs/a.md' ? { path: 'docs/a.md', kind: 'md' as const } : null,
    );
    const open = vi.fn();
    const provider = createLinkProvider(term, 't1', { resolve, open });
    const links = await new Promise<
      { text: string; activate(e: MouseEvent, t: string): void }[] | undefined
    >((r) => provider.provideLinks(1, r));
    expect(links?.map((l) => l.text)).toEqual([
      'docs/a.md:3',
      'http://localhost:3000',
    ]);
    links![0].activate(new MouseEvent('click'), links![0].text);
    expect(open).toHaveBeenCalledWith({
      type: 'md',
      path: 'docs/a.md',
      line: 3,
      col: undefined,
    });
    links![1].activate(new MouseEvent('click'), links![1].text);
    expect(open).toHaveBeenCalledWith({
      type: 'url',
      url: 'http://localhost:3000',
    });
  });
  it('caches resolution per line text', async () => {
    const b = buffer([{ text: 'docs/a.md', wrapped: false }], 80);
    const term = { cols: 80, buffer: { active: b } } as never;
    const resolve = vi.fn(async () => ({
      path: 'docs/a.md',
      kind: 'md' as const,
    }));
    const p = createLinkProvider(term, 't1', { resolve, open: vi.fn() });
    await new Promise((r) => p.provideLinks(1, r));
    await new Promise((r) => p.provideLinks(1, r));
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it('gives links on repeated text at other rows their own ranges', async () => {
    const b = buffer(
      [
        { text: 'docs/a.md', wrapped: false },
        { text: 'other', wrapped: false },
        { text: 'docs/a.md', wrapped: false },
      ],
      80,
    );
    const term = { cols: 80, buffer: { active: b } } as never;
    const resolve = vi.fn(async () => ({
      path: 'docs/a.md',
      kind: 'md' as const,
    }));
    const p = createLinkProvider(term, 't1', { resolve, open: vi.fn() });
    const at = (row: number) =>
      new Promise<{ range: { start: { y: number }; end: { y: number } } }[]>(
        (r) => p.provideLinks(row, r as never),
      );
    expect((await at(1))[0].range.start.y).toBe(1);
    const third = await at(3);
    expect(third).toHaveLength(1);
    expect(third[0].range.start.y).toBe(3);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it('does not cache a failed resolution', async () => {
    const b = buffer([{ text: 'docs/a.md', wrapped: false }], 80);
    const term = { cols: 80, buffer: { active: b } } as never;
    const resolve = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ path: 'docs/a.md', kind: 'md' as const });
    const p = createLinkProvider(term, 't1', { resolve, open: vi.fn() });
    expect(await new Promise((r) => p.provideLinks(1, r))).toEqual([]);
    const again = await new Promise<ILink[] | undefined>((r) =>
      p.provideLinks(1, r),
    );
    expect(again).toHaveLength(1);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it('handles a link ending exactly at the last column', async () => {
    const b = buffer([{ text: 'ab docs/a.md', wrapped: false }], 12);
    const term = { cols: 12, buffer: { active: b } } as never;
    const resolve = vi.fn(async () => ({
      path: 'docs/a.md',
      kind: 'md' as const,
    }));
    const p = createLinkProvider(term, 't1', { resolve, open: vi.fn() });
    const links = await new Promise<ILink[] | undefined>((r) =>
      p.provideLinks(1, r),
    );
    expect(links![0].range).toEqual({
      start: { x: 4, y: 1 },
      end: { x: 12, y: 1 },
    });
  });
  it('only scans the first 2,000 characters of a line', async () => {
    const b = buffer(
      [{ text: `${'x'.repeat(2100)} docs/a.md`, wrapped: false }],
      3000,
    );
    const term = { cols: 3000, buffer: { active: b } } as never;
    const resolve = vi.fn(async () => ({
      path: 'docs/a.md',
      kind: 'md' as const,
    }));
    const p = createLinkProvider(term, 't1', { resolve, open: vi.fn() });
    const links = await new Promise((r) => p.provideLinks(1, r));
    expect(links).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });
  it('sets and clears a tooltip on hover', async () => {
    const b = buffer([{ text: 'docs/a.md', wrapped: false }], 80);
    const term = { cols: 80, buffer: { active: b } } as never;
    const resolve = vi.fn(async () => ({
      path: 'docs/a.md',
      kind: 'md' as const,
    }));
    const p = createLinkProvider(term, 't1', { resolve, open: vi.fn() });
    const links = await new Promise<
      | {
          hover?(e: MouseEvent, t: string): void;
          leave?(e: MouseEvent, t: string): void;
        }[]
      | undefined
    >((r) => p.provideLinks(1, r));
    const el = document.createElement('div');
    const ev = { target: el } as unknown as MouseEvent;
    links![0].hover!(ev, '');
    expect(el.title).toBe('Open in Docs');
    links![0].leave!(ev, '');
    expect(el.title).toBe('');
  });
});

describe('openLink', () => {
  it('opens Markdown in the Docs tab', () => {
    const { tracked } = installFakeApi();
    const openDoc = vi.fn();
    useStore.setState({ openDoc });
    openLink('t1', { type: 'md', path: 'docs/a.md', line: 3 });
    expect(openDoc).toHaveBeenCalledWith('t1', 'docs/a.md', 3, undefined);
    expect(JSON.stringify(tracked)).toContain('terminal.linkOpened');
  });
  it('opens Markdown of another workspace and sends the editor its target', () => {
    const { calls } = installFakeApi({ 'docs:openInEditor': () => undefined });
    const openDoc = vi.fn();
    useStore.setState({ openDoc });
    openLink('t1', { type: 'md', path: 'a.md', workspaceId: 'w2' });
    expect(openDoc).toHaveBeenCalledWith('t1', 'a.md', undefined, 'w2');
    openLink('t1', { type: 'file', path: 'a.ts', workspaceId: 'w2' });
    expect(calls).toContainEqual({
      channel: 'docs:openInEditor',
      args: ['t1#w2', 'a.ts'],
    });
  });
  it('opens other files in the editor', () => {
    const { calls } = installFakeApi({ 'docs:openInEditor': () => undefined });
    openLink('t1', { type: 'file', path: 'src/a.ts', line: 4, col: 2 });
    expect(calls).toContainEqual({
      channel: 'docs:openInEditor',
      args: ['t1', 'src/a.ts', 4, 2],
    });
  });
  it('opens URLs in the browser', () => {
    const { calls } = installFakeApi({ 'links:open': () => undefined });
    openLink('t1', { type: 'url', url: 'https://example.com' });
    expect(calls).toContainEqual({
      channel: 'links:open',
      args: ['https://example.com'],
    });
  });
});
