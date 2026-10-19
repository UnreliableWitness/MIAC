import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { useAttention } from './useAttention';

const task = (id: string, terminals: string[]) =>
  ({
    id,
    status: 'active',
    terminals: terminals.map((t) => ({
      id: t,
      kind: 'claude',
      label: 'Claude Code',
    })),
  }) as never;

describe('useAttention', () => {
  beforeEach(() => {
    useStore.setState({
      tasks: [task('A', ['a1', 'a2'])],
      selectedTaskId: null,
      screen: { kind: 'home' },
      tabByTask: {},
      attention: {},
    });
  });

  it('reports the terminal tab on screen, and null elsewhere', async () => {
    const fake = installFakeApi();
    renderHook(() => useAttention());
    await act(async () => {
      useStore.setState({ selectedTaskId: 'A', screen: { kind: 'task' } });
    });
    await act(async () => useStore.getState().setTab('A', 'a2'));
    await act(async () => useStore.setState({ screen: { kind: 'home' } }));
    const views = fake.calls
      .filter((c) => c.channel === 'attention:view')
      .map((c) => c.args[0]);
    expect(views).toEqual([
      null,
      { taskId: 'A', tabId: 'a1' },
      { taskId: 'A', tabId: 'a2' },
      null,
    ]);
  });

  it('loads and follows the snapshot, and opens the tab on click-through', async () => {
    const fake = installFakeApi({
      'attention:get': () => ({ a1: { reason: 'done', since: 1 } }),
    });
    renderHook(() => useAttention());
    await act(async () => undefined);
    expect(useStore.getState().attention).toEqual({
      a1: { reason: 'done', since: 1 },
    });
    act(() => fake.emit('attention:changed', {}));
    expect(useStore.getState().attention).toEqual({});
    act(() => fake.emit('attention:open', { taskId: 'A', terminalId: 'a2' }));
    const s = useStore.getState();
    expect([s.screen.kind, s.selectedTaskId, s.activeTab('A')]).toEqual([
      'task',
      'A',
      'a2',
    ]);
  });

  it('never reports the previous tab while a click-through switches', async () => {
    const fake = installFakeApi();
    useStore.setState({ tabByTask: { A: 'a1' } });
    renderHook(() => useAttention());
    await act(async () => undefined);
    fake.calls.length = 0;
    act(() => fake.emit('attention:open', { taskId: 'A', terminalId: 'a2' }));
    const views = fake.calls
      .filter((c) => c.channel === 'attention:view')
      .map((c) => c.args[0]);
    expect(views).toEqual([{ taskId: 'A', tabId: 'a2' }]);
  });
});
