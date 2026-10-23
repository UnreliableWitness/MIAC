import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeTree, renameWithRetry, withRetry } from './fsRetry';

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

describe('removeTree', () => {
  it('deletes nested folders and read-only files, and leaves what a link points at', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'shellie-rm-'));
    try {
      const dir = path.join(root, 'wt');
      const outside = path.join(root, 'outside');
      mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
      mkdirSync(outside);
      writeFileSync(path.join(outside, 'keep.txt'), 'keep');
      writeFileSync(path.join(dir, 'a', 'b', 'f.txt'), 'x');
      writeFileSync(path.join(dir, 'ro.txt'), 'x');
      chmodSync(path.join(dir, 'ro.txt'), 0o444);
      symlinkSync(
        outside,
        path.join(dir, 'link'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await removeTree(dir, async () => {});
      expect(existsSync(dir)).toBe(false);
      expect(readFileSync(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep');
      await removeTree(dir, async () => {}); // already gone: no error
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('removeTree with a file a process holds (#115)', () => {
  /** A fake tree: /w with a.dll (held: unlink EPERM, rmdir ENOENT as libuv reports a file) and b.txt. */
  const fakeFs = () => {
    const entries = new Map<string, 'dir' | 'file'>([
      ['/w', 'dir'],
      ['/w/a.dll', 'file'],
      ['/w/b.txt', 'file'],
    ]);
    const norm = (p: string) =>
      p.replace(/\\/g, '/').replace(/^\/\/\?\/[A-Za-z]:/, '');
    const children = (p: string) =>
      [...entries.keys()]
        .filter((k) => k !== p && path.posix.dirname(k) === p)
        .map((k) => path.posix.basename(k));
    return {
      entries,
      ops: {
        lstat: async (p: string) => {
          const k = entries.get(norm(p));
          if (!k) throw err('ENOENT');
          return {
            isDirectory: () => k === 'dir',
            isSymbolicLink: () => false,
          };
        },
        readdir: async (p: string) => children(norm(p)),
        unlink: async (p: string) => {
          if (norm(p) === '/w/a.dll') throw err('EPERM');
          entries.delete(norm(p));
        },
        chmod: async () => undefined,
        rmdir: async (p: string) => {
          const k = entries.get(norm(p));
          if (k !== 'dir') throw err('ENOENT');
          if (children(norm(p)).length > 0) throw err('ENOTEMPTY');
          entries.delete(norm(p));
        },
      },
    };
  };

  it('reports the lock (EPERM) after retrying it, not what rmdir says about a file', async () => {
    const f = fakeFs();
    const waits: number[] = [];
    const e = await removeTree(
      '/w',
      async (ms) => {
        waits.push(ms);
      },
      f.ops,
    ).catch((x: unknown) => x as NodeJS.ErrnoException);
    expect(e).toBeInstanceOf(Error);
    expect((e as NodeJS.ErrnoException).code).toBe('EPERM');
    expect(waits.length).toBeGreaterThan(0);
  });

  it('deletes everything else before it gives up', async () => {
    const f = fakeFs();
    await removeTree('/w', async () => {}, f.ops).catch(() => undefined);
    expect([...f.entries.keys()].sort()).toEqual(['/w', '/w/a.dll']);
  });
});
