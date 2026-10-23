import { renderBranch } from '../shared/naming';
import { isGuarded } from '../shared/secrets';
import { setupTabsFrom } from '../shared/terminals';
import type { Task, WorkItemRef } from '../shared/types';
import { api, tryInvoke } from './api';

/**
 * Creates a task for a work item with the repo's .shellie.yml defaults, the tabs chosen in Settings and the repo's
 * default environment, the same as New task with nothing changed.
 */
export async function startTaskFor(
  repoId: string,
  workItem: WorkItemRef,
  notify: (level: 'error', message: string) => void,
): Promise<Task | undefined> {
  const loaded = await tryInvoke(
    () =>
      Promise.all([
        api().invoke('repos:config', repoId),
        api().invoke('settings:get'),
        api().invoke('secrets:repoDefault', repoId),
      ]),
    notify,
  );
  if (!loaded) return undefined;
  const [{ config }, settings, repoDefault] = loaded;
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
        ...setupTabsFrom(settings.defaultTerminals),
        // Start never puts a task on UAT or Production: those take New task and a confirm.
        environment: isGuarded(repoDefault) ? 'development' : repoDefault,
      }),
    notify,
  );
}
