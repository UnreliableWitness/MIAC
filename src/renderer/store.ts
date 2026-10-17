import { create } from 'zustand';
import type {
  Connection,
  Notice,
  Repo,
  TaskView,
  WorkItemRef,
} from '../shared/types';
import { api } from './api';
import { track, trackScreen } from './telemetry';
import { readPrefs, writePref } from './uiPrefs';

export const USAGE_TAB = 'usage';
export const DOCS_TAB = 'docs';

/** Every screen is a full page next to the nav; `task` shows the selected task. */
export type Screen =
  | { kind: 'home' }
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
  /** The current sprint's name once the Sprint page has loaded it, for the breadcrumb. */
  sprintName: string | null;
  notices: Notice[];
  tabByTask: Record<string, string>;
  /** A document a terminal link asked the Docs tab to open; the nonce makes repeats count. */
  docTarget: Record<
    string,
    { path: string; line?: number; workspaceId?: string; nonce: number }
  >;
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
  setSprintName(name: string | null): void;
  notify(level: Notice['level'], message: string): void;
  dismiss(id: string): void;
  load(): Promise<void>;
  setTab(taskId: string, tab: string): void;
  activeTab(taskId: string): string;
  openUsage(taskId: string): void;
  openDoc(
    taskId: string,
    path: string,
    line?: number,
    workspaceId?: string,
  ): void;
  toggleFocus(): void;
  setNavCollapsed(v: boolean): void;
};

let noticeSeq = 0;

/** Pages that are a step, not a place: Back never returns to them. */
const TRANSIENT = new Set<Screen['kind']>(['new-task', 'finish']);

export const useStore = create<Store>((set, get) => ({
  screen: { kind: 'home' },
  previous: null,
  repos: [],
  tasks: [],
  connections: [],
  connectionId: null,
  selectedTaskId: null,
  sprintName: null,
  notices: [],
  tabByTask: {},
  docTarget: {},
  ...readPrefs(),
  go: (screen) => {
    const current = get().screen;
    if (screen.kind !== current.kind) trackScreen(screen.kind);
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
      screen: previous && !gone ? previous : { kind: 'home' },
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
  setSprintName: (sprintName) => set({ sprintName }),
  setTasks: (tasks) => {
    // No auto-select: the app opens on Home and only the user picks a task.
    const selected = get().selectedTaskId;
    const stillThere = tasks.some((t) => t.id === selected);
    set({ tasks, selectedTaskId: stillThere ? selected : null });
  },
  notify: (level, message) => {
    // Main scrubs the message (paths, repo and work item names) before it is sent.
    if (level !== 'info')
      track('notice', { level, message: message.slice(0, 200) });
    const id = `n${++noticeSeq}`;
    set({ notices: [...get().notices, { id, level, message }] });
    if (level !== 'error') setTimeout(() => get().dismiss(id), 6000);
  },
  dismiss: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
  setTab: (taskId, tab) => {
    if (tab === USAGE_TAB && get().activeTab(taskId) !== USAGE_TAB)
      track('usage.opened', { via: 'tab' });
    set({ tabByTask: { ...get().tabByTask, [taskId]: tab } });
  },
  activeTab: (taskId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    const want = get().tabByTask[taskId];
    if (want === USAGE_TAB) return USAGE_TAB;
    if (want === DOCS_TAB) return DOCS_TAB;
    if (task && want && task.terminals.some((t) => t.id === want)) return want;
    return task?.terminals[0]?.id ?? USAGE_TAB;
  },
  openUsage: (taskId) => {
    track('usage.opened', { via: 'strip' });
    get().select(taskId);
    get().go({ kind: 'task' });
    set({ tabByTask: { ...get().tabByTask, [taskId]: USAGE_TAB } });
  },
  openDoc: (taskId, path, line, workspaceId) => {
    get().select(taskId);
    get().go({ kind: 'task' });
    set({
      tabByTask: { ...get().tabByTask, [taskId]: DOCS_TAB },
      docTarget: {
        ...get().docTarget,
        [taskId]: {
          path,
          line,
          workspaceId,
          nonce: Date.now() + Math.random(),
        },
      },
    });
  },
  toggleFocus: () => {
    const focus = !get().focus;
    track('focus.toggled', { on: focus });
    writePref('focus', focus);
    set({ focus });
  },
  setNavCollapsed: (navCollapsed) => {
    track('nav.toggled', { collapsed: navCollapsed });
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
    trackScreen(get().screen.kind);
  },
}));

/** The connection of a task's repo, for its work item icons and live state. */
export const useTaskConnectionId = (
  task: { repoId: string; connectionId?: string | null } | null,
) =>
  useStore((s) =>
    task
      ? (task.connectionId ??
        s.repos.find((r) => r.id === task.repoId)?.connectionId ??
        null)
      : null,
  );

type ConnectionState = Pick<
  Store,
  'connections' | 'connectionId' | 'repos' | 'tasks' | 'selectedTaskId'
> & { screen?: Screen };

/** The task a task, setup or finish page is about. */
const pageTaskId = (s: ConnectionState): string | null => {
  const screen = s.screen;
  if (!screen) return null;
  if (screen.kind === 'task') return s.selectedTaskId;
  if (screen.kind === 'setup' || screen.kind === 'finish') return screen.taskId;
  return null;
};

/**
 * The project the shell shows. On a task's own pages, the task's repo connection; otherwise the one picked in
 * the switcher, else the selected task's repo connection, else the first linked repo's, else the first connection.
 */
export function activeConnection(s: ConnectionState): Connection | null {
  const byId = (id: string | null | undefined) =>
    id ? (s.connections.find((c) => c.id === id) ?? null) : null;
  const repoOf = (taskId: string | null) => {
    const task = s.tasks.find((t) => t.id === taskId);
    return s.repos.find((r) => r.id === task?.repoId);
  };
  const taskConnection = (taskId: string | null) =>
    s.tasks.find((t) => t.id === taskId)?.connectionId;
  const taskRepo = repoOf(s.selectedTaskId);
  return (
    byId(taskConnection(pageTaskId(s))) ??
    byId(repoOf(pageTaskId(s))?.connectionId) ??
    byId(s.connectionId) ??
    byId(taskRepo?.connectionId) ??
    byId(s.repos.find((r) => r.connectionId)?.connectionId) ??
    s.connections[0] ??
    null
  );
}
