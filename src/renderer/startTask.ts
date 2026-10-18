import { renderBranch } from '../shared/naming';
import type { Task, WorkItemRef } from '../shared/types';
import { api, tryInvoke } from './api';

/** Creates a task for a work item with the repo's .shellie.yml defaults, the same as New task with nothing changed. */
export async function startTaskFor(
  repoId: string,
  workItem: WorkItemRef,
  notify: (level: 'error', message: string) => void,
): Promise<Task | undefined> {
  const result = await tryInvoke(
    () => api().invoke('repos:config', repoId),
    notify,
  );
  if (!result) return undefined;
  const { config } = result;
  return tryInvoke(
    () =>
      api().invoke('tasks:create', {
        repoId,
        baseRef: `origin/${config.base}`,
        name: '',
        workItem,
        branch: renderBranch(config.branch, { workItem, name: '' }),
        copy: true,
        commands: config.setup,
        startClaude: true,
        openShell: true,
        openCopilot: false,
      }),
    notify,
  );
}
