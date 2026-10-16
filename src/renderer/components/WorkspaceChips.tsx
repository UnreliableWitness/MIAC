import {
  Add16Regular,
  MoreHorizontal16Regular,
  Folder16Regular,
} from '@fluentui/react-icons';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { TaskView } from '../../shared/types';
import {
  activeWorkspaces,
  HOME_ID,
  type WorkspaceView,
} from '../../shared/workspaces';
import { api, tryInvoke } from '../api';
import { useGitSummary } from '../hooks/useGitSummary';
import { useStore } from '../store';

/** A button that opens a small menu under itself; fixed-positioned because the task row clips overflow. */
function PopMenu({
  label,
  trigger,
  className,
  children,
}: {
  label: string;
  trigger: ReactNode;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t))
        setAt(null);
    };
    const onResize = () => setAt(null);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onResize);
    };
  }, [at]);
  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={() => {
          if (at) return setAt(null);
          const r = button.current?.getBoundingClientRect();
          if (r) setAt({ left: r.left, top: r.bottom + 2 });
        }}
      >
        {trigger}
      </button>
      {at && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          className="menu terminal-menu"
          style={{ left: at.left, top: at.top }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setAt(null);
              button.current?.focus();
            }
          }}
        >
          {children(() => setAt(null))}
        </div>
      )}
    </>
  );
}

function Item({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className="menu-item"
      onClick={onClick}
    >
      <span className="menu-title">{children}</span>
    </button>
  );
}

const UP = String.fromCharCode(0x2191);
const DOWN = String.fromCharCode(0x2193);
const BULLET = String.fromCharCode(0x2022);

/** "↑ahead ↓behind •changes" of one repo's worktree, polled like the task's own git state. */
function ChipGit({
  task,
  w,
  visible,
}: {
  task: TaskView;
  w: WorkspaceView;
  visible: boolean;
}) {
  const git = useGitSummary(task.id, task.worktreeMissing, visible, w.id);
  if (!git) return null;
  return (
    <span className="mono small muted ws-chip-git">
      {`${UP}${git.ahead} ${DOWN}${git.behind} ${BULLET}${git.files.length}`}
    </span>
  );
}

/** One chip per repo of a task with more than one; shown only then, so a single-repo task looks as before. */
export function WorkspaceChips({
  task,
  visible = true,
}: {
  task: TaskView;
  /** False while the task page is hidden: git is not polled. */
  visible?: boolean;
}) {
  const notify = useStore((s) => s.notify);
  const repos = useStore((s) => s.repos);
  const setTab = useStore((s) => s.setTab);
  const workspaces = activeWorkspaces(task);
  if (workspaces.length < 2) return null;
  const ready = task.status === 'ready';
  return (
    <span className="ws-chips" role="group" aria-label="Repos of this task">
      {workspaces.map((w) => {
        const name = repos.find((r) => r.id === w.repoId)?.name ?? w.branch;
        return (
          <PopMenu
            key={w.id}
            label={`Repo ${name}`}
            className="btn btn-sm chip"
            trigger={
              <>
                <Folder16Regular aria-hidden="true" />
                {name} <ChipGit task={task} w={w} visible={visible} />
              </>
            }
          >
            {(close) => (
              <>
                <Item
                  onClick={() => {
                    close();
                    void tryInvoke(async () => {
                      const created = await api().invoke(
                        'terminals:open',
                        task.id,
                        { kind: 'shell', label: 'shell', workspaceId: w.id },
                      );
                      setTab(task.id, created.id);
                    }, notify);
                  }}
                >
                  New shell here
                </Item>
                <Item
                  onClick={() => {
                    close();
                    void tryInvoke(
                      () => api().invoke('tasks:openInEditor', task.id, w.id),
                      notify,
                    );
                  }}
                >
                  Open in editor
                </Item>
                {w.id !== HOME_ID && ready && (
                  <Item
                    onClick={() => {
                      close();
                      void tryInvoke(
                        () =>
                          api().invoke('tasks:removeWorkspace', task.id, w.id),
                        notify,
                      );
                    }}
                  >
                    Remove from task
                  </Item>
                )}
              </>
            )}
          </PopMenu>
        );
      })}
    </span>
  );
}

/** The task menu: look for other repos or join a worktree by hand. */
export function TaskMenu({ task }: { task: TaskView }) {
  const notify = useStore((s) => s.notify);
  const scan = async () => {
    const added = await tryInvoke(
      () => api().invoke('tasks:scanWorkspaces', task.id),
      notify,
    );
    // Main announces each repo it adds; only the empty result needs a word here.
    if (added && added.length === 0)
      notify('info', 'No other repos found for this task');
  };
  const add = async () => {
    const folder = await tryInvoke(
      () => api().invoke('repos:pickFolder'),
      notify,
    );
    if (!folder) return;
    await tryInvoke(
      () => api().invoke('tasks:addWorkspace', task.id, folder),
      notify,
    );
  };
  return (
    <PopMenu
      label="Task menu"
      className="ibtn"
      trigger={<MoreHorizontal16Regular aria-hidden="true" />}
    >
      {(close) => (
        <>
          <Item
            onClick={() => {
              close();
              void scan();
            }}
          >
            Scan for other repos
          </Item>
          <Item
            onClick={() => {
              close();
              void add();
            }}
          >
            <Add16Regular aria-hidden="true" /> Add a worktree{'…'}
          </Item>
        </>
      )}
    </PopMenu>
  );
}
