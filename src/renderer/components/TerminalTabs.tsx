import { useEffect, useState } from 'react';
import type { TaskView } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { useRepoConfig } from '../hooks/useRepoConfig';
import { USAGE_TAB, useStore } from '../store';
import { IconButton, MindMark, modKey } from './instrument';
import { CostPill } from './TaskStrip';
import { TerminalView } from './TerminalView';
import { UsagePanel } from './UsagePanel';

const PLUS = String.fromCharCode(0xff0b);
const QUARTER = String.fromCharCode(0x25d4);
const EXPAND = String.fromCharCode(0x2922);
const COLLAPSE = String.fromCharCode(0x2921);

export function TerminalTabs({ task }: { task: TaskView }) {
  const notify = useStore((s) => s.notify);
  const config = useRepoConfig(task.repoId);
  const active = useStore((s) => s.activeTab(task.id));
  const setTab = useStore((s) => s.setTab);
  const focus = useStore((s) => s.focus);
  const toggleFocus = useStore((s) => s.toggleFocus);
  const [unseen, setUnseen] = useState(false);

  useEffect(
    () =>
      api().on('usage:changed', (p) => {
        if (
          (p.taskId === task.id || p.taskId === '*') &&
          useStore.getState().activeTab(task.id) !== USAGE_TAB
        )
          setUnseen(true);
      }),
    [task.id],
  );

  useEffect(() => {
    if (active === USAGE_TAB) setUnseen(false);
  }, [active]);

  const open = async (def: {
    kind: 'shell' | 'run' | 'copilot';
    label: string;
    command?: string;
  }) => {
    const created = await tryInvoke(
      () => api().invoke('terminals:open', task.id, def),
      notify,
    );
    if (created) setTab(task.id, created.id);
  };

  const runCommands = Object.entries(config?.config.run ?? {});

  return (
    <>
      <div
        role="tablist"
        aria-label="Terminals"
        className="tabrow"
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) toggleFocus();
        }}
      >
        {focus && (
          <span className="tabrow-brand">
            <MindMark size={14} />
            <span className="mono">{task.workItem?.id ?? task.name}</span>
          </span>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={active === USAGE_TAB}
          aria-label={unseen ? 'Usage, new usage' : 'Usage'}
          className="tab tab-pin"
          onClick={() => setTab(task.id, USAGE_TAB)}
        >
          <span className="mono tab-glyph" aria-hidden="true">
            {QUARTER}
          </span>
          Usage
          {unseen && <span className="tab-new" aria-hidden="true" />}
        </button>
        {task.terminals.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            className="tab"
            onClick={() => setTab(task.id, t.id)}
          >
            <span
              className="dot"
              style={{
                background:
                  t.kind === 'claude'
                    ? 'var(--blue)'
                    : t.kind === 'run'
                      ? 'var(--green)'
                      : t.kind === 'copilot'
                        ? 'var(--accent)'
                        : 'var(--idle)',
              }}
            />
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className="tab tab-add"
          aria-label="New terminal"
          onClick={() => open({ kind: 'shell', label: 'shell' })}
          disabled={task.worktreeMissing}
        >
          {PLUS}
        </button>
        <button
          type="button"
          className="tab tab-add"
          onClick={() => open({ kind: 'copilot', label: 'Copilot CLI' })}
          disabled={task.worktreeMissing}
        >
          Copilot CLI
        </button>
        <div className="tabrow-right">
          {runCommands.length > 0 && (
            <>
              <span className="ilabel">Run</span>
              {runCommands.map(([name, command]) => (
                <button
                  key={name}
                  type="button"
                  className="chip"
                  onClick={() => open({ kind: 'run', label: name, command })}
                  disabled={task.worktreeMissing}
                >
                  {name}
                </button>
              ))}
            </>
          )}
          {focus && <CostPill taskId={task.id} />}
          <IconButton
            label={focus ? 'Exit focus' : 'Focus'}
            shortcut={`${modKey}+Shift+F`}
            onClick={toggleFocus}
          >
            {focus ? COLLAPSE : EXPAND}
          </IconButton>
        </div>
      </div>
      <div className="termhost">
        {active === USAGE_TAB && <UsagePanel taskId={task.id} />}
        {task.terminals.map((t) => (
          <TerminalView key={t.id} terminalId={t.id} active={active === t.id} />
        ))}
      </div>
    </>
  );
}
