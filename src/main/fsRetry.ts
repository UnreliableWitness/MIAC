import { promises as fs } from 'node:fs';
import path from 'node:path';

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

/**
 * Deletes a folder and everything in it without following links. On Windows every path goes through the
 * `\\?\` namespace, so names the Win32 layer rejects (`nul`, `con`, a trailing dot or space) and long
 * paths can be deleted too; read-only files are made writable first. Locks are retried like a rename.
 */
export async function removeTree(
  dir: string,
  wait: Wait = realWait,
): Promise<void> {
  const ns = (p: string) => path.toNamespacedPath(path.resolve(p));
  const retry = <T>(fn: () => Promise<T>) =>
    withRetry(
      fn,
      (e) => RETRYABLE.has((e as NodeJS.ErrnoException).code ?? ''),
      wait,
    );
  const unlink = async (p: string) => {
    try {
      await fs.unlink(ns(p));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e;
      // A read-only file on Windows; a link to a folder is removed with rmdir.
      await fs.chmod(ns(p), 0o666).catch(() => undefined);
      await fs.unlink(ns(p)).catch(() => fs.rmdir(ns(p)));
    }
  };
  const walk = async (p: string): Promise<void> => {
    const st = await fs.lstat(ns(p)).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (!st) return;
    if (!st.isDirectory() || st.isSymbolicLink()) return retry(() => unlink(p));
    for (const name of await fs.readdir(ns(p))) await walk(path.join(p, name));
    await retry(() => fs.rmdir(ns(p)));
  };
  await walk(dir);
}
