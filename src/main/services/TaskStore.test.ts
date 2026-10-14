import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TaskStore } from './TaskStore';

const tmp = () =>
  path.join(
    mkdtempSync(path.join(os.tmpdir(), 'miac-store-')),
    'nested',
    'state.json',
  );

describe('TaskStore', () => {
  it('starts empty when the file does not exist', async () => {
    const store = new TaskStore(tmp());
    const result = await store.load();
    expect(result).toEqual({ recovered: false });
    expect(store.state).toEqual({ version: 1, repos: [], tasks: [] });
  });

  it('persists updates and reads them back', async () => {
    const file = tmp();
    const store = new TaskStore(file);
    await store.load();
    await store.update((s) => {
      s.repos.push({
        id: 'r1',
        name: 'webshop',
        path: '/src/webshop',
        baseBranch: 'main',
        connectionId: null,
        miacYmlFound: true,
      });
    });
    const again = new TaskStore(file);
    await again.load();
    expect(again.state.repos).toHaveLength(1);
    expect(again.state.repos[0].name).toBe('webshop');
    expect(readdirSync(path.dirname(file))).toEqual(['state.json']);
  });

  it('does not change state when the mutation produces an invalid state', async () => {
    const store = new TaskStore(tmp());
    await store.load();
    await expect(
      store.update((s) => {
        (s as { version: number }).version = 9;
      }),
    ).rejects.toThrow();
    expect(store.state.version).toBe(1);
  });

  it('keeps a backup and starts empty when the file is corrupt', async () => {
    const file = tmp();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{ not json');
    const store = new TaskStore(file);
    const result = await store.load();
    expect(result.recovered).toBe(true);
    expect(result.backup).toMatch(/state\.json\.corrupt-\d+$/);
    expect(readFileSync(result.backup!, 'utf8')).toBe('{ not json');
    expect(store.state).toEqual({ version: 1, repos: [], tasks: [] });
  });

  it('serialises concurrent updates', async () => {
    const store = new TaskStore(tmp());
    await store.load();
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        store.update((s) => {
          s.repos.push({
            id: `r${i}`,
            name: `n${i}`,
            path: `/p${i}`,
            baseBranch: 'main',
            connectionId: null,
            miacYmlFound: false,
          });
        }),
      ),
    );
    expect(store.state.repos.map((r) => r.id).sort()).toEqual([
      'r0',
      'r1',
      'r2',
      'r3',
      'r4',
    ]);
  });
});
