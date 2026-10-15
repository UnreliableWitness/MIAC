import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskView } from '../shared/types';
import { USAGE_TAB, useStore } from './store';

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
});

beforeEach(() => {
  localStorage.clear();
  useStore.setState({
    ...base,
    tasks: [],
    tabByTask: {},
    focus: false,
    navCollapsed: false,
    screen: { kind: 'workspace' },
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
  it('openUsage selects the task, the workspace and the Usage tab', () => {
    useStore.setState({
      tasks: [task('a', ['t1'])],
      screen: { kind: 'settings' },
    });
    useStore.getState().openUsage('a');
    const s = useStore.getState();
    expect(s.selectedTaskId).toBe('a');
    expect(s.screen).toEqual({ kind: 'workspace' });
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
