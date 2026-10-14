import { TaskNav } from '../components/TaskNav';
import { UsagePanel } from '../components/UsagePanel';
import { TerminalTabs } from '../components/TerminalTabs';
import { IconButton } from '../components/instrument';
import { CrumbStrip, TaskStrip } from '../components/TaskStrip';
import { useShortcuts } from '../hooks/useShortcuts';
import { useStore } from '../store';

const PLUS = String.fromCharCode(0xff0b);
const GEAR = String.fromCharCode(0x2699);

export function WorkspaceScreen() {
  const go = useStore((s) => s.go);
  const task = useStore(
    (s) => s.tasks.find((t) => t.id === s.selectedTaskId) ?? null,
  );
  const focus = useStore((s) => s.focus);
  const navCollapsed = useStore((s) => s.navCollapsed);
  useShortcuts();
  const inFocus = focus && task?.status === 'ready';
  return (
    <>
      {inFocus ? null : task ? (
        <TaskStrip key={`strip-${task.id}`} task={task} />
      ) : (
        <CrumbStrip crumb="Tasks">
          <IconButton
            label="New task"
            tone="accent"
            onClick={() => go({ kind: 'new-task' })}
          >
            {PLUS}
          </IconButton>
          <IconButton label="Settings" onClick={() => go({ kind: 'settings' })}>
            {GEAR}
          </IconButton>
        </CrumbStrip>
      )}
      <div className="workspace">
        {(!inFocus || navCollapsed) && <TaskNav />}
        <main className="taskmain">
          {task &&
          (task.status === 'setting-up' || task.status === 'setup-failed') ? (
            <div className="empty">
              <h2>{task.workItem?.title ?? task.name}</h2>
              <p>
                {task.status === 'setting-up'
                  ? 'This task is still setting up.'
                  : 'Setup failed for this task.'}
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => go({ kind: 'setup', taskId: task.id })}
              >
                Open setup
              </button>
            </div>
          ) : task && task.status !== 'done' ? (
            <>
              <TerminalTabs key={`tabs-${task.id}`} task={task} />
            </>
          ) : task ? (
            <>
              <div className="done-banner">
                <p>
                  This task is done. Its worktree and branch were cleaned up on{' '}
                  {task.finishedAt}.
                </p>
              </div>
              <UsagePanel taskId={task.id} />
            </>
          ) : (
            <div className="empty">
              No task selected. Create one with New task.
            </div>
          )}
        </main>
      </div>
    </>
  );
}
