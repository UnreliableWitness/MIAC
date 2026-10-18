import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('migratePrefsNow', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('copies the prefs before the store reads them', async () => {
    localStorage.setItem('miac.ui.focus', 'true');
    await import('./migratePrefsNow');
    const { useStore } = await import('./store');
    expect(useStore.getState().focus).toBe(true);
  });

  it('is the first import of the renderer entry', () => {
    const src = readFileSync(
      path.join(__dirname, '..', 'renderer.tsx'),
      'utf8',
    );
    const first = src.split('\n').find((l) => l.startsWith('import'));
    expect(first).toBe("import './renderer/migratePrefsNow';");
  });
});
