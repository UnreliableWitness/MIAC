import {
  Add16Regular,
  Branch16Regular,
  Code16Regular,
  DataPie16Regular,
  Document16Regular,
  FullScreenMaximize16Regular,
  FullScreenMinimize16Regular,
} from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import type { TaskView } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { eur } from '../format';
import { useGitSummary } from '../hooks/useGitSummary';
import { useRepoConfig } from '../hooks/useRepoConfig';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { DOCS_TAB, USAGE_TAB, useStore } from '../store';
import { DocsTab } from './docs/DocsTab';
import { TerminalView } from './TerminalView';
import { IconButton, MindMark, modKey } from './ui';
import { UsagePanel } from './UsagePanel';

const MARKDOWN = /\.(md|markdown)$/i;
const UP = String.fromCharCode(0x2191);
const DOWN = String.fromCharCode(0x2193);
const DOT = String.fromCharCode(0xb7);
const DELTA = String.fromCharCode(0x394);
const DASH = String.fromCharCode(0x2014);

/** The task's AI cost; opens the Usage tab. */
export function CostButton({ taskId }: { taskId: string }) {
  const openUsage = useStore((s) => s.openUsage);
  const usage = useTaskUsage(taskId);
  const cost = usage?.billable.costEur ?? 0;
  return (
    <button
      type="button"
      className="btn btn-subtle btn-sm taskbar-cost"
      aria-label={`AI cost ${usage ? eur(cost) : 'unknown'}, open usage`}
      title="AI cost, open usage"
      onClick={() => openUsage(taskId)}
    >
      <span className="mono">{usage ? eur(cost) : DASH}</span>
    </button>
  );
}

/** The 36 px task row: pivots per terminal and Usage on the left, git state and task commands on the right. */
export function TerminalTabs({
  task,
  visible = true,
}: {
  task: TaskView;
  /** False while kept mounted behind another page: terminals stay alive but are not active, git is not polled. */
  visible?: boolean;
}) {
  const notify = useStore((s) => s.notify);
  const go = useStore((s) => s.go);
  const config = useRepoConfig(task.repoId);
  const git = useGitSummary(task.id, task.worktreeMissing, visible);
  const active = useStore((s) => s.activeTab(task.id));
  const setTab = useStore((s) => s.setTab);
  // Same rule as the shell: Focus chrome only for a ready task.
  const ready = task.status === 'ready';
  const inFocus = useStore((s) => s.focus) && ready;
  const toggleFocus = useStore((s) => s.toggleFocus);
  const [unseen, setUnseen] = useState(false);
  const [docsUnseen, setDocsUnseen] = useState(false);

  useEffect(
    () =>
      api().on('docs:changed', (p) => {
        if (
          p.taskId === task.id &&
          p.paths.some((f) => MARKDOWN.test(f)) &&
          useStore.getState().activeTab(task.id) !== DOCS_TAB
        )
          setDocsUnseen(true);
      }),
    [task.id],
  );

  useEffect(() => {
    if (active === DOCS_TAB) setDocsUnseen(false);
  }, [active]);

  useEffect(() => {
    if (!visible || !ready || task.worktreeMissing) return;
    void api()
      .invoke('docs:watch', task.id, true)
      .catch(() => undefined);
    return () => {
      void api()
        .invoke('docs:watch', task.id, false)
        .catch(() => undefined);
    };
  }, [task.id, visible, ready, task.worktreeMissing]);

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
      <div className="taskbar">
        <div
          role="tablist"
          aria-label="Terminals"
          className="tabrow"
          onDoubleClick={(e) => {
            if (ready && e.target === e.currentTarget) toggleFocus();
          }}
        >
          {inFocus && (
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
            className="pivot"
            onClick={() => setTab(task.id, USAGE_TAB)}
          >
            <DataPie16Regular aria-hidden="true" />
            Usage
            {unseen && <span className="tab-new" aria-hidden="true" />}
          </button>
          {ready && !task.worktreeMissing && (
            <button
              type="button"
              role="tab"
              aria-selected={active === DOCS_TAB}
              aria-label={docsUnseen ? 'Docs, changed' : 'Docs'}
              className="pivot"
              title={`Docs (${modKey}+Shift+D)`}
              onClick={() => setTab(task.id, DOCS_TAB)}
            >
              <Document16Regular aria-hidden="true" />
              Docs
              {docsUnseen && <span className="tab-new" aria-hidden="true" />}
            </button>
          )}
          {task.terminals.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active === t.id}
              className="pivot"
              onClick={() => setTab(task.id, t.id)}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-subtle btn-sm tab-add"
            aria-label="New terminal"
            title="New terminal"
            onClick={() => open({ kind: 'shell', label: 'shell' })}
            disabled={task.worktreeMissing}
          >
            <Add16Regular />
          </button>
          <button
            type="button"
            className="btn btn-subtle btn-sm tab-add"
            onClick={() => open({ kind: 'copilot', label: 'Copilot CLI' })}
            disabled={task.worktreeMissing}
          >
            Copilot CLI
          </button>
          {runCommands.length > 0 && (
            <span className="tabrow-run">
              <span className="small muted">Run</span>
              {runCommands.map(([name, command]) => (
                <button
                  key={name}
                  type="button"
                  className="btn btn-sm chip"
                  onClick={() => open({ kind: 'run', label: name, command })}
                  disabled={task.worktreeMissing}
                >
                  {name}
                </button>
              ))}
            </span>
          )}
        </div>
        <div className="taskbar-right">
          <span className="mono taskbar-git" title={task.branch}>
            <Branch16Regular aria-hidden="true" />
            <span className="taskbar-branch">{task.branch}</span>
            {git &&
              ` ${UP}${git.ahead}${git.behind ? ` ${DOWN}${git.behind}` : ''} ${DOT} ${git.files.length ? `${git.files.length}${DELTA}` : 'clean'}`}
          </span>
          <CostButton taskId={task.id} />
          {ready && (
            <>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                disabled={task.worktreeMissing}
                onClick={() =>
                  tryInvoke(
                    () => api().invoke('tasks:openInEditor', task.id),
                    notify,
                  )
                }
              >
                <Code16Regular aria-hidden="true" />
                Open in VS Code
              </button>
              <button
                type="button"
                className="btn btn-sm"
                aria-label="Finish task"
                onClick={() => go({ kind: 'finish', taskId: task.id })}
              >
                Finish
              </button>
              <IconButton
                label={inFocus ? 'Exit focus' : 'Focus'}
                shortcut={`${modKey}+Shift+F`}
                onClick={toggleFocus}
              >
                {inFocus ? (
                  <FullScreenMinimize16Regular />
                ) : (
                  <FullScreenMaximize16Regular />
                )}
              </IconButton>
            </>
          )}
        </div>
      </div>
      <div className="termhost">
        {visible && active === USAGE_TAB && <UsagePanel taskId={task.id} />}
        {visible && active === DOCS_TAB && !task.worktreeMissing && (
          <DocsTab task={task} />
        )}
        {task.terminals.map((t) => (
          <TerminalView
            key={t.id}
            terminalId={t.id}
            active={visible && active === t.id}
          />
        ))}
      </div>
    </>
  );
}
