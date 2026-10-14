import { TaskHeader } from '../components/TaskHeader';
import { TaskNav } from '../components/TaskNav';
import { TerminalTabs } from '../components/TerminalTabs';
import { TopBar } from '../components/TopBar';
import { useStore } from '../store';

const PLUS = String.fromCharCode(0xff0b);
const GEAR = String.fromCharCode(0x2699);

export function WorkspaceScreen() {
  const go = useStore((s) => s.go);
  const task = useStore(
    (s) => s.tasks.find((t) => t.id === s.selectedTaskId) ?? null,
  );
  return (
    <>
      <TopBar>
        <div className="spacer" />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => go({ kind: 'new-task' })}
        >
          {PLUS} New task
        </button>
        <button
          type="button"
          className="btn"
          aria-label="Settings"
          onClick={() => go({ kind: 'settings' })}
        >
          {GEAR}
        </button>
      </TopBar>
      <div className="workspace">
        <TaskNav />
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
              <TaskHeader key={`head-${task.id}`} task={task} />
              <TerminalTabs key={`tabs-${task.id}`} task={task} />
            </>
          ) : task ? (
            <div className="empty">
              This task is done. Its worktree and branch were cleaned up on{' '}
              {task.finishedAt}.
            </div>
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
