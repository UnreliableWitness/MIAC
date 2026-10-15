import type { TaskView } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { PageHeader, WorkItemTypeIcon } from '../components/ui';
import { UsagePanel } from '../components/UsagePanel';
import { dateTime } from '../format';
import { useStore } from '../store';

/** A finished task: what it was, when it finished, and its AI usage. */
export function DoneTaskPage({ task }: { task: TaskView }) {
  const notify = useStore((s) => s.notify);
  const wi = task.workItem;
  return (
    <div className="page page-done">
      <PageHeader
        before={
          wi && (
            <>
              <WorkItemTypeIcon type={wi.type} size={20} />
              {wi.url ? (
                <button
                  type="button"
                  className="link pagehead-id"
                  aria-label={`Open ${wi.type} ${wi.id} in Azure DevOps`}
                  onClick={() =>
                    tryInvoke(
                      () => api().invoke('shell:openExternal', wi.url!),
                      notify,
                    )
                  }
                >
                  {wi.type} {wi.id}
                </button>
              ) : (
                <span className="pagehead-id">
                  {wi.type} {wi.id}
                </span>
              )}
            </>
          )
        }
        title={wi?.title ?? task.name}
      />
      <dl className="facts">
        <div>
          <dt>Finished</dt>
          <dd>{task.finishedAt ? dateTime(task.finishedAt) : 'Unknown'}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd className="mono">{task.branch}</dd>
        </div>
      </dl>
      <UsagePanel taskId={task.id} />
    </div>
  );
}
