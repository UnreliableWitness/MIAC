import { renderBranch } from '../shared/naming';
import type { Repo, Task, WorkItemRef } from '../shared/types';
import { api, tryInvoke } from './api';

/**
 * The repos Start can use for a project (those linked to its connection) and the one it uses: the remembered
 * repo while it is still linked, else the first.
 */
export function startRepos(
  repos: Repo[],
  connectionId: string,
  remembered: string | null,
): { repo: Repo | null; choices: Repo[] } {
  const choices = repos.filter((r) => r.connectionId === connectionId);
  const repo = choices.find((r) => r.id === remembered) ?? choices[0] ?? null;
  return { repo, choices };
}

/** Creates a task for a work item with the repo's .miac.yml defaults, the same as New task with nothing changed. */
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
