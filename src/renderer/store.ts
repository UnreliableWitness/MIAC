import { create } from 'zustand';
import type { Connection, Notice, Repo, TaskView } from '../shared/types';
import { api } from './api';
import { readPrefs, writePref } from './uiPrefs';

export const USAGE_TAB = 'usage';

export type Screen =
  | { kind: 'workspace' }
  | { kind: 'new-task' }
  | { kind: 'setup'; taskId: string }
  | { kind: 'finish'; taskId: string }
  | { kind: 'settings' }
  | { kind: 'usage'; taskId: string };

type Store = {
  screen: Screen;
  repos: Repo[];
  tasks: TaskView[];
  connections: Connection[];
  selectedTaskId: string | null;
  notices: Notice[];
  tabByTask: Record<string, string>;
  focus: boolean;
  navCollapsed: boolean;
  go(screen: Screen): void;
  select(taskId: string | null): void;
  setRepos(repos: Repo[]): void;
  setTasks(tasks: TaskView[]): void;
  setConnections(connections: Connection[]): void;
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

export const useStore = create<Store>((set, get) => ({
  screen: { kind: 'workspace' },
  repos: [],
  tasks: [],
  connections: [],
  selectedTaskId: null,
  notices: [],
  tabByTask: {},
  ...readPrefs(),
  go: (screen) => set({ screen }),
  select: (selectedTaskId) => set({ selectedTaskId }),
  setRepos: (repos) => set({ repos }),
  setConnections: (connections) => set({ connections }),
  setTasks: (tasks) => {
    const selected = get().selectedTaskId;
    const stillThere = tasks.some((t) => t.id === selected);
    const firstOpen = tasks.find((t) => t.status !== 'done')?.id ?? null;
    set({ tasks, selectedTaskId: stillThere ? selected : firstOpen });
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
  openUsage: (taskId) =>
    set({
      selectedTaskId: taskId,
      screen: { kind: 'workspace' },
      tabByTask: { ...get().tabByTask, [taskId]: USAGE_TAB },
    }),
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
