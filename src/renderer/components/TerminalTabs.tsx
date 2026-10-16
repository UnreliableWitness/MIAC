import {
  Branch16Regular,
  Dismiss12Regular,
  Code16Regular,
  DataPie16Regular,
  Document16Regular,
  FolderOpen16Regular,
  FullScreenMaximize16Regular,
  FullScreenMinimize16Regular,
} from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { isFolderTask, worktreesOf } from '../../shared/tasks';
import type { NewTerminal, TaskView } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { eur } from '../format';
import { useGitSummary } from '../hooks/useGitSummary';
import { useRepoConfigs } from '../hooks/useRepoConfig';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { holdDocsWatch } from '../docs/holdDocsWatch';
import { DOCS_TAB, USAGE_TAB, useStore } from '../store';
import { DocsTab } from './docs/DocsTab';
import { NewTerminalMenu } from './NewTerminalMenu';
import { TerminalView } from './TerminalView';
import { IconButton, MindMark, modKey } from './ui';
import { UsagePanel } from './UsagePanel';

const MARKDOWN = /\.(md|markdown)$/i;
/** Build output and dependencies: Markdown there is not the task's documentation. */
const OUTPUT_DIR = /^(dist|build|out|node_modules)\//;
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
  const folder = isFolderTask(task);
  const repos = worktreesOf(task).filter((w) => w.status === 'ready');
  const several = folder && repos.length > 1;
  const dirOf = (repoId?: string) =>
    repoId ? repos.find((w) => w.repoId === repoId)?.dir : undefined;
  // Run chips come from every repo's .miac.yml; in a task folder they run in that repo's worktree.
  const runRepos = folder
    ? repos.map((w) => ({ repoId: w.repoId, dir: w.dir }))
    : [{ repoId: task.repoId, dir: '' }];
  const configs = useRepoConfigs(runRepos.map((r) => r.repoId));
  const runCommands = runRepos.flatMap((r, i) =>
    Object.entries(configs[i]?.config.run ?? {}).map(([name, command]) => ({
      label: several ? `${r.dir}: ${name}` : name,
      command,
      repoId: folder ? r.repoId : undefined,
    })),
  );
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
          p.paths.some((f) => MARKDOWN.test(f) && !OUTPUT_DIR.test(f)) &&
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
    return holdDocsWatch(task.id);
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

  const open = async (def: NewTerminal) => {
    const created = await tryInvoke(
      () => api().invoke('terminals:open', task.id, def),
      notify,
    );
    if (created) setTab(task.id, created.id);
  };

  const closeTerminal = (id: string) =>
    tryInvoke(() => api().invoke('terminals:kill', id), notify);

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
            <span key={t.id} className="term-tab">
              <button
                type="button"
                role="tab"
                aria-selected={active === t.id}
                className="pivot"
                onClick={() => setTab(task.id, t.id)}
                // Middle click closes, as in browsers and VS Code.
                onAuxClick={(e) => {
                  if (e.button === 1) void closeTerminal(t.id);
                }}
              >
                {several && dirOf(t.repoId)
                  ? `${t.label} · ${dirOf(t.repoId)}`
                  : t.label}
              </button>
              <button
                type="button"
                className="term-tab-close"
                aria-label={`Close ${t.label}`}
                title={`Close ${t.label}`}
                onClick={() => void closeTerminal(t.id)}
              >
                <Dismiss12Regular aria-hidden="true" />
              </button>
            </span>
          ))}
          <NewTerminalMenu
            disabled={task.worktreeMissing}
            onOpen={(def) => void open(def)}
            // In a task folder a shell runs in a repo, where git and the dev tools work.
            shellRepos={
              folder
                ? repos.map((w) => ({ repoId: w.repoId, dir: w.dir }))
                : undefined
            }
          />
          {runCommands.length > 0 && (
            <span className="tabrow-run">
              <span className="small muted">Run</span>
              {runCommands.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  className="btn btn-sm chip"
                  onClick={() =>
                    open({
                      kind: 'run',
                      label: r.label,
                      command: r.command,
                      ...(r.repoId ? { repoId: r.repoId } : {}),
                    })
                  }
                  disabled={task.worktreeMissing}
                >
                  {r.label}
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
          {ready && folder && (
            <button
              type="button"
              className="btn btn-subtle btn-sm"
              aria-label={`Repos, ${worktreesOf(task).length} in this task`}
              title="Add, remove or replace the task's repos"
              onClick={() => go({ kind: 'repos', taskId: task.id })}
            >
              <FolderOpen16Regular aria-hidden="true" />
              {`Repos ${worktreesOf(task).length}`}
            </button>
          )}
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
            taskId={task.id}
            resumes={t.kind === 'claude'}
            autoStart={t.kind === 'claude' || t.kind === 'shell'}
            active={visible && active === t.id}
          />
        ))}
      </div>
    </>
  );
}
