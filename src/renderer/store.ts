import { create } from 'zustand';
import type { Notice, Repo, TaskView } from '../shared/types';
import { api } from './api';

export type Screen =
  | { kind: 'workspace' }
  | { kind: 'new-task' }
  | { kind: 'setup'; taskId: string }
  | { kind: 'finish'; taskId: string }
  | { kind: 'settings' };

type Store = {
  screen: Screen;
  repos: Repo[];
  tasks: TaskView[];
  selectedTaskId: string | null;
  notices: Notice[];
  go(screen: Screen): void;
  select(taskId: string | null): void;
  setRepos(repos: Repo[]): void;
  setTasks(tasks: TaskView[]): void;
  notify(level: Notice['level'], message: string): void;
  dismiss(id: string): void;
  load(): Promise<void>;
};

let noticeSeq = 0;

export const useStore = create<Store>((set, get) => ({
  screen: { kind: 'workspace' },
  repos: [],
  tasks: [],
  selectedTaskId: null,
  notices: [],
  go: (screen) => set({ screen }),
  select: (selectedTaskId) => set({ selectedTaskId }),
  setRepos: (repos) => set({ repos }),
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
  load: async () => {
    const [repos, tasks] = await Promise.all([
      api().invoke('repos:list'),
      api().invoke('tasks:list'),
    ]);
    get().setRepos(repos);
    get().setTasks(tasks);
  },
}));
