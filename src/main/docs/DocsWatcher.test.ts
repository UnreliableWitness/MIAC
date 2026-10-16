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
    const dir = mkdtempSync(path.join(os.tmpdir(), 'miac-watch-'));
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
  it('is reference-counted, and stopTask closes regardless', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'miac-watch-'));
    const w = new DocsWatcher(() => undefined, 10);
    w.start('t', dir);
    w.start('t', dir);
    w.stop('t');
    expect(w.active('t')).toBe(true);
    w.stopTask('t');
    expect(w.active('t')).toBe(false);
  });
});
