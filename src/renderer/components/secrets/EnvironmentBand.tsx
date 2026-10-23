import { Warning16Filled } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { ENVIRONMENT_LABEL, isGuarded } from '../../../shared/secrets';
import type { TaskView } from '../../../shared/types';
import { api, tryInvoke } from '../../api';
import { useStore } from '../../store';
import { joinAnd, secretTabs, tabNames } from './environment';

const MINUTE = 60_000;

/**
 * The band across the top of a task on UAT (amber) or Production (red, with the minutes left): which tabs have
 * the values, that agents never do, and a way back to Development.
 */
export function EnvironmentBand({
  task,
  now = Date.now,
}: {
  task: TaskView;
  now?: () => number;
}) {
  const notify = useStore((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const counting =
    task.environment === 'production' && task.environmentUntil !== null;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [counting]);

  if (!isGuarded(task.environment)) return null;
  const names = tabNames(secretTabs(task.terminals));
  const where =
    names.length > 0 ? `in ${joinAnd(names)}` : 'for the tabs you open';
  const left =
    counting && task.environmentUntil
      ? ` · ${Math.max(1, Math.ceil((Date.parse(task.environmentUntil) - now()) / MINUTE))} min left`
      : '';

  const back = async () => {
    setBusy(true);
    await tryInvoke(
      () => api().invoke('tasks:setEnvironment', task.id, 'development'),
      notify,
    );
    setBusy(false);
  };

  return (
    <div role="status" className={`env-band env-band-${task.environment}`}>
      <Warning16Filled aria-hidden="true" />
      <span className="env-band-text">
        {`${ENVIRONMENT_LABEL[task.environment]} secrets ${where}${left}`}
      </span>
      <span className="spacer" />
      <span className="env-band-note">Agents never get them</span>
      <button
        type="button"
        className="btn btn-sm env-band-back"
        disabled={busy || task.status !== 'ready'}
        onClick={() => void back()}
      >
        Back to Development
      </button>
    </div>
  );
}
