// src/main/review/ReviewStore.ts
import path from 'node:path';
import {
  emptyReviewState,
  type ReviewState,
  ReviewStateSchema,
} from '../../shared/review';
import { JsonFileStore } from '../usage/JsonFileStore';

/** One `<taskId>.json` per task under `dir`, loaded on first use; writes are queued and atomic (JsonFileStore). */
export class ReviewStore {
  private readonly open = new Map<
    string,
    Promise<JsonFileStore<ReviewState>>
  >();

  constructor(
    private readonly dir: string,
    private readonly onRecovered: (taskId: string) => void = () => {},
  ) {}

  private store(taskId: string): Promise<JsonFileStore<ReviewState>> {
    if (!/^[\w-]+$/.test(taskId))
      return Promise.reject(new Error('Bad task id'));
    let p = this.open.get(taskId);
    if (!p) {
      p = (async () => {
        const s = new JsonFileStore(
          path.join(this.dir, `${taskId}.json`),
          ReviewStateSchema,
          emptyReviewState,
        );
        if ((await s.load()).recovered) this.onRecovered(taskId);
        return s;
      })();
      // A failed load is retried on the next call.
      p.catch(() => this.open.delete(taskId));
      this.open.set(taskId, p);
    }
    return p;
  }

  async get(taskId: string): Promise<ReviewState> {
    return (await this.store(taskId)).value;
  }

  async update(
    taskId: string,
    mutate: (s: ReviewState) => void,
  ): Promise<ReviewState> {
    return (await this.store(taskId)).update((s) => {
      mutate(s);
    });
  }
}
