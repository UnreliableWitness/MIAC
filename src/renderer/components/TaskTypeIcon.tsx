import type { TaskView } from '../../shared/types';
import { useTaskConnectionId } from '../store';
import { WorkItemTypeIcon } from './ui';

/** A task's work item type icon, the project's real one when the task's repo is linked; nothing for a blank task. */
export function TaskTypeIcon({
  task,
  size,
}: {
  task: Pick<TaskView, 'repoId' | 'workItem'>;
  size?: number;
}) {
  const connectionId = useTaskConnectionId(task);
  if (!task.workItem) return null;
  return (
    <WorkItemTypeIcon
      type={task.workItem.type}
      connectionId={connectionId}
      size={size}
    />
  );
}
