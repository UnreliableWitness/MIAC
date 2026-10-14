import { useEffect, useState } from 'react';
import type { TaskView } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { useRepoConfig } from '../hooks/useRepoConfig';
import { useStore } from '../store';
import { TerminalView } from './TerminalView';

const PLUS = String.fromCharCode(0xff0b);

export function TerminalTabs({ task }: { task: TaskView }) {
  const notify = useStore((s) => s.notify);
  const config = useRepoConfig(task.repoId);
  const [active, setActive] = useState<string | null>(
    task.terminals[0]?.id ?? null,
  );

  useEffect(() => {
    if (!task.terminals.some((t) => t.id === active))
      setActive(task.terminals[0]?.id ?? null);
  }, [task.terminals, active]);

  const open = async (def: {
    kind: 'shell' | 'run';
    label: string;
    command?: string;
  }) => {
    const created = await tryInvoke(
      () => api().invoke('terminals:open', task.id, def),
      notify,
    );
    if (created) setActive(created.id);
  };

  const runCommands = Object.entries(config?.config.run ?? {});

  return (
    <>
      <div role="tablist" aria-label="Terminals" className="tabs">
        {task.terminals.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            className="tab"
            onClick={() => setActive(t.id)}
          >
            <span
              className="dot"
              style={{
                background:
                  t.kind === 'claude'
                    ? 'var(--blue)'
                    : t.kind === 'run'
                      ? 'var(--green)'
                      : 'var(--idle)',
              }}
            />
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label="New terminal"
          onClick={() => open({ kind: 'shell', label: 'shell' })}
          disabled={task.worktreeMissing}
        >
          {PLUS}
        </button>
        {runCommands.length > 0 && (
          <div className="run">
            <span className="small muted">Run:</span>
            {runCommands.map(([name, command]) => (
              <button
                key={name}
                type="button"
                className="btn btn-sm"
                onClick={() => open({ kind: 'run', label: name, command })}
                disabled={task.worktreeMissing}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="termhost">
        {task.terminals.length === 0 && (
          <div className="empty">
            No terminals. Open one with {PLUS} or a Run button.
          </div>
        )}
        {task.terminals.map((t) => (
          <TerminalView key={t.id} terminalId={t.id} active={active === t.id} />
        ))}
      </div>
    </>
  );
}
