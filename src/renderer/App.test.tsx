import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from './store';
import { installFakeApi } from './test-helpers/fakeApi';
import { App } from './App';

vi.mock('./components/TerminalView', () => ({ TerminalView: () => null }));

beforeEach(() =>
  useStore.setState({
    repos: [],
    tasks: [],
    connections: [],
    notices: [],
    screen: { kind: 'workspace' },
  }),
);

describe('App', () => {
  it('loads repos and tasks on start and shows notices pushed from main', async () => {
    const { calls, emit } = installFakeApi();
    render(<App />);
    expect(screen.getByText('MIAC')).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.map((c) => c.channel).sort()).toEqual([
        'connections:list',
        'repos:list',
        'tasks:list',
      ]),
    );
    emit('notice', { level: 'warn', message: 'state.json was unreadable' });
    expect(
      await screen.findByText('state.json was unreadable'),
    ).toBeInTheDocument();
  });
});
