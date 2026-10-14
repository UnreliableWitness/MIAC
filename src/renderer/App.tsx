import { useEffect } from 'react';
import { api } from './api';
import { Notices } from './components/Notices';
import { NewTaskScreen } from './screens/NewTaskScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WorkspaceScreen } from './screens/WorkspaceScreen';
import { useStore } from './store';

export function App() {
  const screen = useStore((s) => s.screen);
  const load = useStore((s) => s.load);
  const setTasks = useStore((s) => s.setTasks);
  const setRepos = useStore((s) => s.setRepos);
  const notify = useStore((s) => s.notify);

  useEffect(() => {
    void load().catch((e: Error) => notify('error', e.message));
    const offs = [
      api().on('tasks:changed', setTasks),
      api().on('repos:changed', setRepos),
      api().on('notice', (n) => notify(n.level, n.message)),
    ];
    return () => offs.forEach((off) => off());
  }, [load, setTasks, setRepos, notify]);

  return (
    <div className="app">
      {screen.kind === 'settings' ? <SettingsScreen /> : <WorkspaceScreen />}
      {screen.kind === 'new-task' && <NewTaskScreen />}
      <Notices />
    </div>
  );
}
