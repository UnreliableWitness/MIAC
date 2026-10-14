import { describe, expect, it } from 'vitest';
import { renameWithRetry, withRetry } from './fsRetry';

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

describe('withRetry', () => {
  it('retries while the error is retryable, with the same backoff', async () => {
    const waits: number[] = [];
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls++;
        if (calls < 4) throw new Error('busy');
        return 'ok';
      },
      (e) => (e as Error).message === 'busy',
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(out).toBe('ok');
    expect(waits).toEqual([50, 100, 200]);
  });

  it('rethrows a non-retryable error at once', async () => {
    const waits: number[] = [];
    await expect(
      withRetry(
        async () => {
          throw new Error('other');
        },
        () => false,
        async (ms) => {
          waits.push(ms);
        },
      ),
    ).rejects.toThrow('other');
    expect(waits).toEqual([]);
  });

  it('takes its own list of waits', async () => {
    const waits: number[] = [];
    await expect(
      withRetry(
        async () => {
          throw new Error('busy');
        },
        () => true,
        async (ms) => {
          waits.push(ms);
        },
        [10, 20, 30],
      ),
    ).rejects.toThrow('busy');
    expect(waits).toEqual([10, 20, 30]);
  });
});
