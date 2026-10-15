import { create } from 'zustand';
import type {
  Connection,
  Notice,
  Repo,
  TaskView,
  WorkItemRef,
} from '../shared/types';
import { api } from './api';
import { readPrefs, writePref } from './uiPrefs';

export const USAGE_TAB = 'usage';

/** Every screen is a full page next to the nav; `task` shows the selected task. */
export type Screen =
  | { kind: 'sprint' }
  | { kind: 'task' }
  | { kind: 'new-task'; workItem?: WorkItemRef; repoId?: string }
  | { kind: 'setup'; taskId: string }
  | { kind: 'finish'; taskId: string }
  | { kind: 'settings' };

type Store = {
  screen: Screen;
  /** Where Cancel and Escape on New task and Finish return to. */
  previous: Screen | null;
  repos: Repo[];
  tasks: TaskView[];
  connections: Connection[];
  /** The project chosen in the nav's project switcher; null follows the selection. */
  connectionId: string | null;
  selectedTaskId: string | null;
  notices: Notice[];
  tabByTask: Record<string, string>;
  focus: boolean;
  navCollapsed: boolean;
  go(screen: Screen): void;
  back(): void;
  select(taskId: string | null): void;
  openTask(taskId: string): void;
  setRepos(repos: Repo[]): void;
  setTasks(tasks: TaskView[]): void;
  setConnections(connections: Connection[]): void;
  setConnectionId(id: string | null): void;
  notify(level: Notice['level'], message: string): void;
  dismiss(id: string): void;
  load(): Promise<void>;
  setTab(taskId: string, tab: string): void;
  activeTab(taskId: string): string;
  openUsage(taskId: string): void;
  toggleFocus(): void;
  setNavCollapsed(v: boolean): void;
};

let noticeSeq = 0;

/** Pages that are a step, not a place: Back never returns to them. */
const TRANSIENT = new Set<Screen['kind']>(['new-task', 'finish']);

export const useStore = create<Store>((set, get) => ({
  screen: { kind: 'sprint' },
  previous: null,
  repos: [],
  tasks: [],
  connections: [],
  connectionId: null,
  selectedTaskId: null,
  notices: [],
  tabByTask: {},
  ...readPrefs(),
  go: (screen) => {
    const current = get().screen;
    set({
      screen,
      previous:
        current.kind === screen.kind || TRANSIENT.has(current.kind)
          ? get().previous
          : current,
    });
  },
  back: () => {
    const { previous, tasks, selectedTaskId } = get();
    const gone =
      previous?.kind === 'task' && !tasks.some((t) => t.id === selectedTaskId);
    set({
      screen: previous && !gone ? previous : { kind: 'sprint' },
      previous: null,
    });
  },
  select: (selectedTaskId) => set({ selectedTaskId }),
  openTask: (taskId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    get().select(taskId);
    if (task?.status === 'setting-up' || task?.status === 'setup-failed')
      get().go({ kind: 'setup', taskId });
    else get().go({ kind: 'task' });
  },
  setRepos: (repos) => set({ repos }),
  setConnections: (connections) => set({ connections }),
  setConnectionId: (connectionId) => set({ connectionId }),
  setTasks: (tasks) => {
    // No auto-select: the app opens on Sprint and only the user picks a task.
    const selected = get().selectedTaskId;
    const stillThere = tasks.some((t) => t.id === selected);
    set({ tasks, selectedTaskId: stillThere ? selected : null });
  },
  notify: (level, message) => {
    const id = `n${++noticeSeq}`;
    set({ notices: [...get().notices, { id, level, message }] });
    if (level !== 'error') setTimeout(() => get().dismiss(id), 6000);
  },
  dismiss: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
  setTab: (taskId, tab) =>
    set({ tabByTask: { ...get().tabByTask, [taskId]: tab } }),
  activeTab: (taskId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    const want = get().tabByTask[taskId];
    if (want === USAGE_TAB) return USAGE_TAB;
    if (task && want && task.terminals.some((t) => t.id === want)) return want;
    return task?.terminals[0]?.id ?? USAGE_TAB;
  },
  openUsage: (taskId) => {
    get().select(taskId);
    get().go({ kind: 'task' });
    set({ tabByTask: { ...get().tabByTask, [taskId]: USAGE_TAB } });
  },
  toggleFocus: () => {
    const focus = !get().focus;
    writePref('focus', focus);
    set({ focus });
  },
  setNavCollapsed: (navCollapsed) => {
    writePref('navCollapsed', navCollapsed);
    set({ navCollapsed });
  },
  load: async () => {
    const [repos, tasks, connections] = await Promise.all([
      api().invoke('repos:list'),
      api().invoke('tasks:list'),
      api().invoke('connections:list'),
    ]);
    get().setRepos(repos);
    get().setTasks(tasks);
    get().setConnections(connections);
  },
}));

type ConnectionState = Pick<
  Store,
  'connections' | 'connectionId' | 'repos' | 'tasks' | 'selectedTaskId'
>;

/**
 * The project the shell shows: the one picked in the switcher, else the selected task's repo connection,
 * else the first linked repo's, else the first connection.
 */
export function activeConnection(s: ConnectionState): Connection | null {
  const byId = (id: string | null | undefined) =>
    id ? (s.connections.find((c) => c.id === id) ?? null) : null;
  const task = s.tasks.find((t) => t.id === s.selectedTaskId);
  const taskRepo = s.repos.find((r) => r.id === task?.repoId);
  return (
    byId(s.connectionId) ??
    byId(taskRepo?.connectionId) ??
    byId(s.repos.find((r) => r.connectionId)?.connectionId) ??
    s.connections[0] ??
    null
  );
}
