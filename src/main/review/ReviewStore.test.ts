// src/main/review/ReviewStore.test.ts
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { emptyReviewState } from '../../shared/review';
import { ReviewStore } from './ReviewStore';

const dir = () => mkdtempSync(path.join(os.tmpdir(), 'miac-review-'));

describe('ReviewStore', () => {
  it('starts empty and keeps updates across instances', async () => {
    const d = dir();
    const a = new ReviewStore(d);
    expect(await a.get('t1')).toEqual(emptyReviewState());
    await a.update('t1', (s) => {
      s.viewed['home:a.ts'] = 'abc';
    });
    expect((await new ReviewStore(d).get('t1')).viewed).toEqual({
      'home:a.ts': 'abc',
    });
  });

  it('starts empty when the file is unreadable, keeps it aside, and reports it', async () => {
    const d = dir();
    writeFileSync(path.join(d, 't1.json'), '{not json');
    const onRecovered = vi.fn();
    expect(await new ReviewStore(d, onRecovered).get('t1')).toEqual(
      emptyReviewState(),
    );
    expect(onRecovered).toHaveBeenCalledWith('t1');
    expect(readdirSync(d).some((f) => f.startsWith('t1.json.corrupt-'))).toBe(
      true,
    );
  });

  it('refuses a task id that is not a plain name', async () => {
    await expect(new ReviewStore(dir()).get('../x')).rejects.toThrow(
      'Bad task id',
    );
  });
});
