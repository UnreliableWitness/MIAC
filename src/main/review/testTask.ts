// src/main/review/testTask.ts
import { type Task, TaskSchema } from '../../shared/types';

/** A ready task on `worktreePath` for review tests; fields override the defaults. */
export function testTask(over: Partial<Task> & { worktreePath: string }): Task {
  return TaskSchema.parse({
    id: 't1',
    repoId: 'r1',
    name: 'Task',
    workItem: null,
    slug: 'task',
    branch: 'task',
    baseRef: 'main',
    status: 'ready',
    setup: { copy: false, commands: [], startClaude: false, openShell: false },
    terminals: [],
    createdAt: '2026-10-17T08:00:00.000Z',
    finishedAt: null,
    ...over,
  });
}
