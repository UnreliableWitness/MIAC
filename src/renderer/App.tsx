import { useEffect } from 'react';
import { api } from './api';
import { invalidateRepoConfig } from './hooks/useRepoConfig';
import { Notices } from './components/Notices';
import { FinishScreen } from './screens/FinishScreen';
import { NewTaskScreen } from './screens/NewTaskScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { UsageScreen } from './screens/UsageScreen';
import { SetupScreen } from './screens/SetupScreen';
import { WorkspaceScreen } from './screens/WorkspaceScreen';
import { useStore } from './store';

export function App() {
  const screen = useStore((s) => s.screen);
  const load = useStore((s) => s.load);
  const setTasks = useStore((s) => s.setTasks);
  const setRepos = useStore((s) => s.setRepos);
  const setConnections = useStore((s) => s.setConnections);
  const notify = useStore((s) => s.notify);

  useEffect(() => {
    void load().catch((e: Error) => notify('error', e.message));
    const offs = [
      api().on('tasks:changed', setTasks),
      api().on('repos:changed', (repos) => {
        invalidateRepoConfig();
        setRepos(repos);
      }),
      api().on('connections:changed', setConnections),
      api().on('notice', (n) => notify(n.level, n.message)),
    ];
    return () => offs.forEach((off) => off());
  }, [load, setTasks, setRepos, setConnections, notify]);

  return (
    <div className="app">
      {screen.kind === 'settings' ? (
        <SettingsScreen />
      ) : screen.kind === 'usage' ? (
        <UsageScreen taskId={screen.taskId} />
      ) : screen.kind === 'setup' ? (
        <SetupScreen taskId={screen.taskId} />
      ) : (
        <WorkspaceScreen />
      )}
      {screen.kind === 'new-task' && <NewTaskScreen />}
      {screen.kind === 'finish' && <FinishScreen taskId={screen.taskId} />}
      <Notices />
    </div>
  );
}
