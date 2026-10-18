import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DocsWatcher } from './DocsWatcher';

const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end)
    await new Promise((r) => setTimeout(r, 25));
};

describe('DocsWatcher', () => {
  it('debounces changes into one event with / paths and ignores node_modules', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'shellie-watch-'));
    mkdirSync(path.join(dir, 'docs'));
    mkdirSync(path.join(dir, 'node_modules'));
    const events: { taskId: string; paths: string[] }[] = [];
    const w = new DocsWatcher(
      (taskId, paths) => events.push({ taskId, paths }),
      50,
    );
    expect(w.start('t1', dir)).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(path.join(dir, 'docs', 'a.md'), '1');
    writeFileSync(path.join(dir, 'node_modules', 'x.md'), '1');
    // FSEvents may replay the folder creation first, so wait for the file itself.
    await waitFor(() => events.some((e) => e.paths.includes('docs/a.md')));
    w.stopAll();
    expect(events[0].taskId).toBe('t1');
    expect(events.flatMap((e) => e.paths)).toContain('docs/a.md');
    expect(
      events.flatMap((e) => e.paths).some((p) => p.startsWith('node_modules')),
    ).toBe(false);
  });
  it('stopTask stops every target of the task and no other', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'shellie-watch-'));
    const stopped: string[] = [];
    const w = new DocsWatcher(
      () => undefined,
      10,
      (id) => stopped.push(id),
    );
    w.start('t', dir);
    w.start('t#w2', dir);
    w.start('t2#w2', dir);
    w.stopTask('t');
    expect(w.active('t')).toBe(false);
    expect(w.active('t#w2')).toBe(false);
    expect(w.active('t2#w2')).toBe(true);
    expect(stopped.sort()).toEqual(['t', 't#w2']);
    w.stopAll();
  });
  it('is reference-counted, and stopTask closes regardless', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'shellie-watch-'));
    const w = new DocsWatcher(() => undefined, 10);
    w.start('t', dir);
    w.start('t', dir);
    w.stop('t');
    expect(w.active('t')).toBe(true);
    w.stopTask('t');
    expect(w.active('t')).toBe(false);
  });

  it('reports a watcher stopped by an error or by stopTask, not one released by its holders', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'shellie-watch-'));
    const stopped: string[] = [];
    const w = new DocsWatcher(
      () => undefined,
      10,
      (id) => stopped.push(id),
    );
    w.start('a', dir);
    w.stop('a');
    expect(w.active('a')).toBe(false);
    expect(stopped).toEqual([]);
    w.start('b', dir);
    w.stopTask('b');
    expect(stopped).toEqual(['b']);
    w.start('c', dir);
    const entry = (
      w as unknown as {
        entries: Map<string, { w: { emit(e: string, x: unknown): void } }>;
      }
    ).entries.get('c')!;
    entry.w.emit('error', new Error('EMFILE'));
    expect(w.active('c')).toBe(false);
    expect(stopped).toEqual(['b', 'c']);
    w.stopTask('c');
    w.stopAll();
    expect(stopped).toEqual(['b', 'c']);
  });

  it('stopTarget closes one key, reports it and leaves other keys of the task', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'shellie-watch-'));
    const stopped: string[] = [];
    const w = new DocsWatcher(
      () => undefined,
      50,
      (t) => stopped.push(t),
    );
    w.start('t1', dir);
    w.start('t1#ws2', dir);
    w.stopTarget('t1#ws2');
    w.stopTarget('t1#ws2');
    expect(stopped).toEqual(['t1#ws2']);
    expect(w.active('t1')).toBe(true);
    expect(w.active('t1#ws2')).toBe(false);
    w.stopAll();
  });
});
