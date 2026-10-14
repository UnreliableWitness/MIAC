import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';

/** One JSON document on disk, zod-validated, written atomically and serially; a corrupt file is backed up. */
export class JsonFileStore<T> {
  private current: T;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly schema: z.ZodType<T>,
    private readonly empty: () => T,
  ) {
    this.current = empty();
  }

  get value(): T {
    return this.current;
  }

  async load(): Promise<{ recovered: boolean; backup?: string }> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        return { recovered: false };
      throw e;
    }
    try {
      this.current = this.schema.parse(JSON.parse(raw));
      return { recovered: false };
    } catch {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      await fs.rename(this.file, backup);
      this.current = this.empty();
      return { recovered: true, backup };
    }
  }

  update(mutate: (v: T) => T | void): Promise<T> {
    const run = async () => {
      const draft = structuredClone(this.current);
      const next = this.schema.parse(mutate(draft) ?? draft);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
      await fs.rename(tmp, this.file);
      this.current = next;
      return next;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
