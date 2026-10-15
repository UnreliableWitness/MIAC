import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskView } from '../shared/types';
import { activeConnection, USAGE_TAB, useStore } from './store';

const base = useStore.getState();
const task = (id: string, terms: string[]): TaskView => ({
  id,
  repoId: 'r',
  name: id,
  workItem: null,
  slug: id,
  branch: 'b',
  worktreePath: '/w',
  baseRef: 'main',
  baseSha: null,
  status: 'ready',
  setup: {
    copy: false,
    commands: [],
    startClaude: false,
    openShell: false,
    openCopilot: false,
  },
  terminals: terms.map((t) => ({ id: t, kind: 'shell' as const, label: t })),
  createdAt: 'now',
  finishedAt: null,
  worktreeMissing: false,
  usageSyncedAt: null,
  usageSyncError: null,
  usageCommentId: null,
  summary: null,
});

beforeEach(() => {
  localStorage.clear();
  useStore.setState({
    ...base,
    tasks: [],
    tabByTask: {},
    focus: false,
    navCollapsed: false,
    screen: { kind: 'sprint' },
    previous: null,
    selectedTaskId: null,
  });
});

describe('tabs', () => {
  it('defaults to the first terminal, or Usage without terminals', () => {
    useStore.setState({ tasks: [task('a', ['t1', 't2']), task('b', [])] });
    expect(useStore.getState().activeTab('a')).toBe('t1');
    expect(useStore.getState().activeTab('b')).toBe(USAGE_TAB);
  });
  it('falls back when the selected terminal is gone', () => {
    useStore.setState({ tasks: [task('a', ['t1', 't2'])] });
    useStore.getState().setTab('a', 't2');
    useStore.setState({ tasks: [task('a', ['t1'])] });
    expect(useStore.getState().activeTab('a')).toBe('t1');
    useStore.setState({ tasks: [task('a', [])] });
    expect(useStore.getState().activeTab('a')).toBe(USAGE_TAB);
  });
  it('openUsage selects the task, its page and the Usage tab', () => {
    useStore.setState({
      tasks: [task('a', ['t1'])],
      screen: { kind: 'settings' },
    });
    useStore.getState().openUsage('a');
    const s = useStore.getState();
    expect(s.selectedTaskId).toBe('a');
    expect(s.screen).toEqual({ kind: 'task' });
    expect(s.activeTab('a')).toBe(USAGE_TAB);
  });
});

describe('focus and rail', () => {
  it('persist through uiPrefs', () => {
    useStore.getState().toggleFocus();
    useStore.getState().setNavCollapsed(true);
    expect(useStore.getState().focus).toBe(true);
    expect(localStorage.getItem('miac.ui.focus')).toBe('true');
    expect(localStorage.getItem('miac.ui.navCollapsed')).toBe('true');
  });
});

describe('navigation', () => {
  it('starts on Sprint and does not auto-select a task', () => {
    expect(useStore.getState().screen).toEqual({ kind: 'sprint' });
    useStore.getState().setTasks([task('a', []), task('b', [])]);
    expect(useStore.getState().selectedTaskId).toBeNull();
  });
  it('keeps the selection while the task exists and drops it when it goes', () => {
    useStore.getState().setTasks([task('a', [])]);
    useStore.getState().select('a');
    useStore.getState().setTasks([task('a', []), task('b', [])]);
    expect(useStore.getState().selectedTaskId).toBe('a');
    useStore.getState().setTasks([task('b', [])]);
    expect(useStore.getState().selectedTaskId).toBeNull();
  });
  it('back returns to the page before New task or Finish', () => {
    useStore.setState({ tasks: [task('a', [])] });
    useStore.getState().openTask('a');
    useStore.getState().go({ kind: 'new-task' });
    useStore.getState().back();
    expect(useStore.getState().screen).toEqual({ kind: 'task' });
    useStore.getState().go({ kind: 'settings' });
    useStore.getState().go({ kind: 'finish', taskId: 'a' });
    useStore.getState().back();
    expect(useStore.getState().screen).toEqual({ kind: 'settings' });
  });
  it('back goes to Sprint when there is nothing to return to', () => {
    useStore.getState().go({ kind: 'new-task' });
    useStore.getState().back();
    expect(useStore.getState().screen).toEqual({ kind: 'sprint' });
  });
  it('openTask routes a task that is setting up to its setup page', () => {
    useStore.setState({ tasks: [{ ...task('a', []), status: 'setting-up' }] });
    useStore.getState().openTask('a');
    expect(useStore.getState().screen).toEqual({ kind: 'setup', taskId: 'a' });
    expect(useStore.getState().selectedTaskId).toBe('a');
  });
});

describe('activeConnection', () => {
  const conn = (id: string) => ({
    id,
    name: `org-${id}`,
    organizationUrl: `https://dev.azure.com/org-${id}`,
    project: `P${id}`,
    user: null,
    status: 'ok' as const,
    checkedAt: null,
  });
  const repo = (id: string, connectionId: string | null) => ({
    id,
    name: id,
    path: `/${id}`,
    baseBranch: 'main',
    connectionId,
    miacYmlFound: true,
  });
  it('prefers the switcher choice, then the selected task, then the first linked repo', () => {
    const s = {
      connections: [conn('1'), conn('2'), conn('3')],
      repos: [repo('r', null), repo('a', '2'), repo('b', '3')],
      tasks: [{ ...task('t', []), repoId: 'b' }],
      selectedTaskId: null as string | null,
      connectionId: null as string | null,
    };
    expect(activeConnection(s)?.id).toBe('2');
    expect(activeConnection({ ...s, selectedTaskId: 't' })?.id).toBe('3');
    expect(
      activeConnection({ ...s, selectedTaskId: 't', connectionId: '1' })?.id,
    ).toBe('1');
    expect(
      activeConnection({ ...s, repos: [], connections: [conn('9')] })?.id,
    ).toBe('9');
    expect(activeConnection({ ...s, connections: [] })).toBeNull();
  });
});
