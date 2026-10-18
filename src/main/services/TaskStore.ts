import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StateSchema, type State } from '../../shared/types';
import { renameWithRetry } from '../fsRetry';
import { errorMessage } from '../../shared/errors';

export type LoadResult = { recovered: boolean; backup?: string };

export const emptyState = (): State => ({ version: 1, repos: [], tasks: [] });

/** Persists repos and tasks to one JSON file. Writes are atomic (temp file, then rename) and serialised. */
export class TaskStore {
  private current: State = emptyState();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  get state(): State {
    return this.current;
  }

  async load(): Promise<LoadResult> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.current = emptyState();
        return { recovered: false };
      }
      throw e;
    }
    try {
      this.current = StateSchema.parse(JSON.parse(raw));
      return { recovered: false };
    } catch {
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        await renameWithRetry(this.filePath, backup);
      } catch {
        // Rename can fail on Windows when the file is locked; keep a copy instead.
        try {
          await fs.copyFile(this.filePath, backup);
        } catch (e) {
          const message = errorMessage(e);
          throw new Error(
            `state.json is corrupt and could not be backed up to ${backup}: ${message}`,
          );
        }
      }
      this.current = emptyState();
      return { recovered: true, backup };
    }
  }

  update(mutate: (s: State) => void): Promise<State> {
    const run = async () => {
      const next = structuredClone(this.current);
      mutate(next);
      const valid = StateSchema.parse(next);
      await this.write(valid);
      this.current = valid;
      return valid;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async write(s: State): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(s, null, 2), 'utf8');
    await renameWithRetry(tmp, this.filePath);
  }
}
