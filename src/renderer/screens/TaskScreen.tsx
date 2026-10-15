import { PageHeader, WorkItemTypeIcon } from '../components/ui';
import { TerminalTabs } from '../components/TerminalTabs';
import { useStore } from '../store';
import { DoneTaskPage } from './DoneTaskPage';

/** The selected task: terminals when it runs, a setup notice while it sets up, the Done page once finished. */
export function TaskScreen() {
  const go = useStore((s) => s.go);
  const task = useStore(
    (s) => s.tasks.find((t) => t.id === s.selectedTaskId) ?? null,
  );
  if (!task)
    return (
      <div className="page">
        <PageHeader title="No task selected" />
        <div className="page-body">
          <p className="muted">
            Pick a task in the navigation, or create one with New task.
          </p>
        </div>
      </div>
    );
  if (task.status === 'done') return <DoneTaskPage task={task} />;
  if (task.status === 'setting-up' || task.status === 'setup-failed')
    return (
      <div className="page">
        <PageHeader
          before={
            task.workItem && <WorkItemTypeIcon type={task.workItem.type} />
          }
          title={task.workItem?.title ?? task.name}
        />
        <div className="page-body">
          <p className="muted">
            {task.status === 'setting-up'
              ? 'This task is still setting up.'
              : 'Setup failed for this task.'}
          </p>
          <div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => go({ kind: 'setup', taskId: task.id })}
            >
              Open setup
            </button>
          </div>
        </div>
      </div>
    );
  return <TerminalTabs key={`tabs-${task.id}`} task={task} />;
}
