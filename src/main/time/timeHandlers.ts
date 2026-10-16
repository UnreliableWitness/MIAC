import type { Handlers } from '../../shared/ipc';
import { AGENT_TOOLS, type LocalItemTime } from '../../shared/time';
import type { Task } from '../../shared/types';
import type { AppSettings } from '../../shared/usage';
import type { ActivityTracker } from './ActivityTracker';
import type { TimeStore } from './TimeStore';

type TimeChannels = 'time:focus' | 'time:task' | 'time:sprint';

export type TimeDeps = {
  time: TimeStore;
  tasks: () => Task[];
  task: (id: string) => Task;
  settings: () => AppSettings;
  /** The connection of the task's repo, null when the repo has none (or is gone). */
  connectionOf: (task: Task) => string | null;
  tracker?: Pick<ActivityTracker, 'setTask'>;
  now?: () => number;
};

/** The baseline key of a work item: estimates are per connection, since ids repeat across organizations. */
export const baselineKey = (connectionId: string, workItemId: string): string =>
  `${connectionId}:${workItemId}`;

export function createTimeHandlers(d: TimeDeps): Pick<Handlers, TimeChannels> {
  const now = d.now ?? Date.now;
  const summarize = (task: Task) =>
    d.time.summarize(task, d.settings().workHours, now());

  return {
    'time:focus': async (taskId) => {
      d.tracker?.setTask(taskId);
    },
    'time:task': async (taskId) => {
      const task = d.task(taskId);
      const connectionId = d.connectionOf(task);
      const hours =
        connectionId && task.workItem
          ? d.time.baseline(baselineKey(connectionId, task.workItem.id))
          : null;
      return {
        ...summarize(task),
        estimate: hours === null ? null : { hours, source: 'baseline' },
      };
    },
    'time:sprint': async (connectionId) => {
      const out: Record<string, LocalItemTime> = {};
      for (const task of d.tasks()) {
        if (!task.workItem || d.connectionOf(task) !== connectionId) continue;
        const id = task.workItem.id;
        const s = summarize(task);
        // Booked once finished; a reopened task adds what was measured since the reopen.
        const spent = !s.booking
          ? s.activeSeconds
          : task.status === 'done'
            ? s.booking.bookedSeconds
            : s.booking.bookedSeconds + s.measuredSinceReopenSeconds;
        const item = (out[id] ??= {
          spentSeconds: 0,
          measuredSeconds: 0,
          agentSeconds: 0,
          booked: false,
          baselineHours: d.time.baseline(baselineKey(connectionId, id)),
        });
        item.spentSeconds += spent;
        item.measuredSeconds += s.activeSeconds;
        item.agentSeconds += AGENT_TOOLS.reduce(
          (n, t) => n + s.agentSeconds[t],
          0,
        );
        item.booked ||= s.booking !== null;
      }
      return out;
    },
  };
}
