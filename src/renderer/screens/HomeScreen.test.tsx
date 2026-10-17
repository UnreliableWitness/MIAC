import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeSnapshot } from '../../shared/home';
import type { Connection } from '../../shared/types';
import { Shell } from '../App';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';

vi.mock('../components/TerminalView', () => ({ TerminalView: () => null }));

export const connection: Connection = {
  id: 'c1',
  name: 'uw',
  organizationUrl: 'https://dev.azure.com/uw',
  project: 'MIAC',
  user: 'D',
  status: 'ok',
  checkedAt: null,
  userUniqueName: null,
};

export const snapshot = (over: Partial<HomeSnapshot> = {}): HomeSnapshot => ({
  version: 1,
  builtAt: new Date().toISOString(),
  connections: [
    {
      connectionId: 'c1',
      name: 'uw',
      project: 'MIAC',
      status: 'ok',
      error: null,
      fetchedAt: new Date().toISOString(),
      sprints: [],
      sprintsError: null,
      reviews: [],
      teamReviews: [],
      myPrs: [],
      prsError: null,
    },
  ],
  ...over,
});

beforeEach(() =>
  useStore.setState({
    repos: [],
    tasks: [],
    connections: [connection],
    connectionId: null,
    notices: [],
    selectedTaskId: null,
    previous: null,
    screen: { kind: 'home' },
  }),
);

describe('Home page', () => {
  it('shows the cached snapshot without waiting for a rebuild', async () => {
    const { calls } = installFakeApi({ 'home:get': () => snapshot() });
    render(<Shell />);
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'uw: MIAC, connected' }),
    ).toBeTruthy();
    // Fresh snapshot: no rebuild on open.
    expect(calls.some((c) => c.channel === 'home:refresh')).toBe(false);
  });

  it('rebuilds a snapshot older than a minute, and with none', async () => {
    const old = snapshot({
      builtAt: new Date(Date.now() - 120_000).toISOString(),
    });
    const { calls } = installFakeApi({ 'home:get': () => old });
    render(<Shell />);
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'home:refresh')).toBe(true),
    );
  });

  it('shows Loading in the PR and sprint bands until a snapshot exists', async () => {
    installFakeApi({
      'home:get': () => null,
      'home:refresh': () => new Promise(() => {}),
    });
    render(<Shell />);
    expect(await screen.findAllByText('Loading')).toHaveLength(2);
    expect(screen.queryByText('No reviews waiting.')).toBeNull();
  });

  it('the refresh button rebuilds', async () => {
    const { calls } = installFakeApi({ 'home:get': () => snapshot() });
    render(<Shell />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Refresh' }),
    );
    expect(calls.filter((c) => c.channel === 'home:refresh')).toHaveLength(1);
  });

  it('takes the snapshot from home:updated', async () => {
    const { emit } = installFakeApi({ 'home:get': () => snapshot() });
    render(<Shell />);
    await screen.findByRole('heading', { name: 'Home' });
    act(() =>
      emit(
        'home:updated',
        snapshot({
          connections: [
            { ...snapshot().connections[0], status: 'stale', error: 'refused' },
          ],
        }),
      ),
    );
    expect(
      await screen.findByRole('button', { name: 'uw: MIAC, stale: refused' }),
    ).toBeTruthy();
  });

  it('a chip opens Settings', async () => {
    installFakeApi({ 'home:get': () => snapshot() });
    render(<Shell />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'uw: MIAC, connected' }),
    );
    expect(useStore.getState().screen.kind).toBe('settings');
  });

  it('without connections it asks for one', async () => {
    useStore.setState({ connections: [] });
    installFakeApi();
    render(<Shell />);
    expect(
      await screen.findByRole('button', {
        name: 'Add an Azure DevOps connection',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: 'My tasks' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Stats' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'My sprints' })).toBeNull();
  });

  it('the nav has Home above Sprint and the app header goes Home', async () => {
    installFakeApi();
    useStore.setState({ screen: { kind: 'settings' } });
    render(<Shell />);
    await userEvent.click(
      screen.getByRole('button', { name: 'MIAC, go to Home' }),
    );
    expect(useStore.getState().screen.kind).toBe('home');
    await userEvent.click(screen.getByRole('button', { name: 'Sprint' }));
    expect(useStore.getState().screen.kind).toBe('sprint');
  });
});
