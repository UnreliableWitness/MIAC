import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskView } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { useTimeFocus } from './useTimeFocus';

const task = { id: 'a', status: 'ready' } as TaskView;

beforeEach(() => {
  useStore.setState({
    tasks: [task],
    screen: { kind: 'task' },
    selectedTaskId: 'a',
  });
});

const focusCalls = (calls: { channel: string; args: unknown[] }[]) =>
  calls.filter((c) => c.channel === 'time:focus').map((c) => c.args[0]);

describe('useTimeFocus', () => {
  it('sends the task on screen once on mount', () => {
    const { calls } = installFakeApi();
    renderHook(() => useTimeFocus());
    expect(focusCalls(calls)).toEqual(['a']);
  });

  it('sends again when the screen changes, not for unrelated updates', () => {
    const { calls } = installFakeApi();
    renderHook(() => useTimeFocus());
    act(() => useStore.setState({ notices: [] }));
    act(() => useStore.setState({ screen: { kind: 'sprint' } }));
    expect(focusCalls(calls)).toEqual(['a', null]);
  });

  it('sends again when the task on screen finishes or is reopened', () => {
    const { calls } = installFakeApi();
    renderHook(() => useTimeFocus());
    act(() => useStore.setState({ tasks: [{ ...task, status: 'done' }] }));
    act(() => useStore.setState({ tasks: [{ ...task, status: 'ready' }] }));
    expect(focusCalls(calls)).toEqual(['a', 'a', 'a']);
  });
});
