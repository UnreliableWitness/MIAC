import { promises as fs } from 'node:fs';

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const WAITS = [50, 100, 200, 400, 800];

export type Wait = (ms: number) => Promise<void>;
export const realWait: Wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs `fn`, retrying with a backoff (default 50/100/200/400/800 ms) while `retryable(error)` holds. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retryable: (e: unknown) => boolean,
  wait: Wait = realWait,
  waits: readonly number[] = WAITS,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!retryable(e) || attempt >= waits.length) throw e;
      await wait(waits[attempt]);
    }
  }
}

/** True when `p` exists (any kind of entry). */
export const pathExists = (p: string): Promise<boolean> =>
  fs.access(p).then(
    () => true,
    () => false,
  );

/** fs.rename that rides out short locks held by antivirus or indexers (common on Windows). */
export async function renameWithRetry(
  from: string,
  to: string,
  rename: (a: string, b: string) => Promise<void> = fs.rename,
  wait: Wait = realWait,
): Promise<void> {
  await withRetry(
    () => rename(from, to),
    (e) => RETRYABLE.has((e as NodeJS.ErrnoException).code ?? ''),
    wait,
  );
}
