import type { TaskStatus } from '../shared/types';

export const TASK_STATUS: Record<TaskStatus, { label: string; color: string }> =
  {
    'setting-up': { label: 'Setting up', color: 'var(--accent)' },
    ready: { label: 'Open', color: 'var(--green)' },
    'setup-failed': { label: 'Setup failed', color: 'var(--red)' },
    finishing: { label: 'Finishing', color: 'var(--accent)' },
    done: { label: 'Done', color: 'var(--muted)' },
  };
