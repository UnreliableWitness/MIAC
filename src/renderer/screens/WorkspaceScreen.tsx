import { TopBar } from '../components/TopBar';
import { useStore } from '../store';

export function WorkspaceScreen() {
  const go = useStore((s) => s.go);
  const tasks = useStore((s) => s.tasks);
  return (
    <>
      <TopBar>
        <div className="spacer" />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => go({ kind: 'new-task' })}
        >
          New task
        </button>
        <button
          type="button"
          className="btn"
          aria-label="Settings"
          onClick={() => go({ kind: 'settings' })}
        >
          &#9881;
        </button>
      </TopBar>
      <div className="workspace">
        <div className="empty">
          {tasks.length === 0 ? 'No tasks yet.' : `${tasks.length} task(s).`}
        </div>
      </div>
    </>
  );
}
