import type { Task } from '../../shared/types';
import {
  AI_FIELDS,
  type AiField,
  type FieldsStatus,
  type SyncResult,
  type TaskUsage,
} from '../../shared/usage';
import type { AdoClient } from '../services/AdoClient';
import { aiFieldValues, renderUsageComment } from '../../shared/workItemUsage';

export type UsageSyncDeps = {
  task: (taskId: string) => Task;
  tasks: () => Task[];
  target: (task: Task) => { connectionId: string; project: string } | null;
  client: (
    connectionId: string,
  ) => Pick<
    AdoClient,
    'workItemTypeFields' | 'updateWorkItemFields' | 'addComment'
  >;
  run: <T>(connectionId: string, fn: () => Promise<T>) => Promise<T>;
  usage: (taskId: string) => TaskUsage;
  changedSince: (iso: string) => string[];
  patchTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
};

type TypeFields = { type: string; fields: string[] }[];
const NO_TARGET =
  'This task has no work item in a connected Azure DevOps project';

/** Writes usage totals to work items: the AI fields that exist on the type, and the usage comment at most once. */
export class UsageSync {
  private readonly types = new Map<string, TypeFields>();
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly d: UsageSyncDeps) {}

  syncTask(
    taskId: string,
    opts: { comment?: boolean; refreshFields?: boolean } = {},
  ): Promise<SyncResult> {
    const prev = this.chains.get(taskId) ?? Promise.resolve();
    const next = prev.then(() => this.syncNow(taskId, opts));
    const tail = next.catch(() => undefined);
    this.chains.set(taskId, tail);
    void tail.then(() => {
      if (this.chains.get(taskId) === tail) this.chains.delete(taskId);
    });
    return next;
  }

  async syncChanged(): Promise<void> {
    for (const t of this.d.tasks()) {
      if (!t.workItem || !this.d.target(t)) continue;
      if (!this.d.changedSince(t.usageSyncedAt ?? '').includes(t.id)) continue;
      await this.syncTask(t.id);
    }
  }

  async fieldsStatus(
    connectionId: string,
    project: string,
  ): Promise<FieldsStatus> {
    const types = await this.d.run(connectionId, () =>
      this.loadTypes(connectionId, project, true),
    );
    return {
      connectionId,
      types: types.map((t) => ({
        type: t.type,
        present: AI_FIELDS.filter((f) => t.fields.includes(f)),
        missing: AI_FIELDS.filter((f) => !t.fields.includes(f)),
      })),
    };
  }

  /** The fields of each work item type, from the per-connection cache (loaded on first use). Call it inside `run`. */
  typeFields(connectionId: string, project: string): Promise<TypeFields> {
    return this.loadTypes(connectionId, project, false);
  }

  private async loadTypes(
    connectionId: string,
    project: string,
    refresh: boolean,
  ): Promise<TypeFields> {
    const hit = this.types.get(connectionId);
    if (hit && !refresh) return hit;
    const types = await this.d.client(connectionId).workItemTypeFields(project);
    this.types.set(connectionId, types);
    return types;
  }

  private async syncNow(
    taskId: string,
    opts: { comment?: boolean; refreshFields?: boolean },
  ): Promise<SyncResult> {
    const fail = (error: string, missing: AiField[] = []): SyncResult => ({
      ok: false,
      fieldsWritten: [],
      fieldsMissing: missing,
      commentPosted: false,
      error,
    });
    const task = this.d.task(taskId);
    const target = task.workItem ? this.d.target(task) : null;
    if (!task.workItem || !target) return fail(NO_TARGET);
    const workItem = task.workItem;
    const workItemId = Number(workItem.id);
    const usage = this.d.usage(taskId);
    try {
      const outcome = await this.d.run(target.connectionId, async () => {
        const client = this.d.client(target.connectionId);
        const types = await this.loadTypes(
          target.connectionId,
          target.project,
          opts.refreshFields ?? false,
        );
        const have = new Set(
          types.find(
            (t) => t.type.toLowerCase() === workItem.type.toLowerCase(),
          )?.fields ?? [],
        );
        const present = AI_FIELDS.filter((f) => have.has(f));
        const missing = AI_FIELDS.filter((f) => !have.has(f));
        if (present.length > 0) {
          const values = aiFieldValues(usage);
          await client.updateWorkItemFields(
            workItemId,
            Object.fromEntries(present.map((f) => [f, values[f]])),
          );
        }
        let commentPosted = false;
        if (opts.comment && this.d.task(taskId).usageCommentId === null) {
          const { id } = await client.addComment(
            target.project,
            workItemId,
            renderUsageComment(usage, task.branch),
          );
          await this.d.patchTask(taskId, { usageCommentId: id });
          commentPosted = true;
        }
        return { present, missing, commentPosted };
      });
      const wrote = outcome.present.length > 0 || outcome.commentPosted;
      await this.d.patchTask(
        taskId,
        wrote
          ? { usageSyncedAt: new Date().toISOString(), usageSyncError: null }
          : { usageSyncError: null },
      );
      return {
        ok: true,
        fieldsWritten: outcome.present,
        fieldsMissing: outcome.missing,
        commentPosted: outcome.commentPosted,
        error: null,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      try {
        await this.d.patchTask(taskId, { usageSyncError: message });
      } catch {
        // the store is failing; the result still carries the error
      }
      return fail(message);
    }
  }
}
