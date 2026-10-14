import { promises as fs } from 'node:fs';

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const WAITS = [50, 100, 200, 400, 800];

/** fs.rename that rides out short locks held by antivirus or indexers (common on Windows). */
export async function renameWithRetry(
  from: string,
  to: string,
  rename: (a: string, b: string) => Promise<void> = fs.rename,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (!RETRYABLE.has(code) || attempt >= WAITS.length) throw e;
      await wait(WAITS[attempt]);
    }
  }
}
