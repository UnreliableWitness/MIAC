import { describe, expect, it } from 'vitest';
import { renameWithRetry } from './fsRetry';

const err = (code: string) => Object.assign(new Error(code), { code });

describe('renameWithRetry', () => {
  it('retries EBUSY/EPERM/EACCES with backoff, then succeeds', async () => {
    const waits: number[] = [];
    let calls = 0;
    await renameWithRetry(
      'a',
      'b',
      async () => {
        calls++;
        if (calls < 3) throw err(calls === 1 ? 'EBUSY' : 'EPERM');
      },
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(calls).toBe(3);
    expect(waits).toEqual([50, 100]);
  });
  it('rethrows after five retries', async () => {
    const waits: number[] = [];
    await expect(
      renameWithRetry(
        'a',
        'b',
        async () => {
          throw err('EACCES');
        },
        async (ms) => {
          waits.push(ms);
        },
      ),
    ).rejects.toThrow('EACCES');
    expect(waits).toEqual([50, 100, 200, 400, 800]);
  });
  it('does not retry other errors', async () => {
    let calls = 0;
    await expect(
      renameWithRetry(
        'a',
        'b',
        async () => {
          calls++;
          throw err('ENOENT');
        },
        async () => {},
      ),
    ).rejects.toThrow('ENOENT');
    expect(calls).toBe(1);
  });
});
