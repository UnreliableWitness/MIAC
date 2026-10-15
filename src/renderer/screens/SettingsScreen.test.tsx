import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { SettingsScreen } from './SettingsScreen';

const DOT = String.fromCharCode(183);
const ADD_FOLDER = `Add folder${String.fromCharCode(8230)}`;

const webshop: Repo = {
  id: 'r1',
  name: 'webshop',
  path: '/src/webshop',
  baseBranch: 'main',
  connectionId: null,
  miacYmlFound: true,
};

beforeEach(() => {
  useStore.setState({
    repos: [],
    tasks: [],
    connections: [],
    notices: [],
    screen: { kind: 'settings' },
  });
});

describe('SettingsScreen', () => {
  it('lists repos with their base branch and .miac.yml status', () => {
    installFakeApi();
    useStore.setState({
      repos: [
        webshop,
        {
          ...webshop,
          id: 'r2',
          name: 'api',
          path: '/src/api',
          baseBranch: 'develop',
          miacYmlFound: false,
        },
      ],
    });
    render(<SettingsScreen />);
    expect(screen.getByText('webshop')).toBeInTheDocument();
    expect(
      screen.getByText(`/src/webshop ${DOT} base main`),
    ).toBeInTheDocument();
    expect(screen.getByText('.miac.yml found')).toBeInTheDocument();
    expect(
      screen.getByText('No .miac.yml, using defaults'),
    ).toBeInTheDocument();
  });

  it('adds a folder through the native picker', async () => {
    const picked: Repo = {
      ...webshop,
      id: 'r9',
      name: 'picked',
      path: '/src/picked',
    };
    const { calls } = installFakeApi({
      'repos:pickFolder': () => '/src/picked',
      'repos:add': () => picked,
      'repos:list': () => [picked],
    });
    render(<SettingsScreen />);
    await userEvent.click(screen.getByRole('button', { name: ADD_FOLDER }));
    await waitFor(() =>
      expect(
        calls
          .map((c) => c.channel)
          .filter((c) => c.startsWith('repos:'))
          .slice(0, 2),
      ).toEqual(['repos:pickFolder', 'repos:add']),
    );
    expect(calls.find((c) => c.channel === 'repos:add')?.args).toEqual([
      '/src/picked',
    ]);
    expect(useStore.getState().repos.map((r) => r.name)).toEqual(['picked']);
  });

  it('shows an error notice when adding fails', async () => {
    installFakeApi({
      'repos:pickFolder': () => '/nope',
      'repos:add': () => {
        throw new Error('/nope is not a git repository');
      },
    });
    render(<SettingsScreen />);
    await userEvent.click(screen.getByRole('button', { name: ADD_FOLDER }));
    await waitFor(() =>
      expect(useStore.getState().notices[0]?.message).toBe(
        '/nope is not a git repository',
      ),
    );
  });

  it('shows the effective config for a repo', async () => {
    installFakeApi({
      'repos:config': () => ({
        worktreeRoot: '/src/webshop.worktrees',
        config: {
          base: 'main',
          branch: '{type}/{id}-{slug}',
          copy: ['.env'],
          setup: ['npm ci'],
          run: { dev: 'npm run dev' },
          found: true,
        },
      }),
    });
    useStore.setState({ repos: [webshop] });
    render(<SettingsScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Show setup' }));
    await waitFor(() =>
      expect(screen.getByText(/dev: npm run dev/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/copy: \[\.env\]/)).toBeInTheDocument();
  });

  it('links a repo to a connection', async () => {
    const { calls } = installFakeApi({
      'repos:setConnection': () => ({ ...webshop, connectionId: 'c1' }),
      'repos:list': () => [{ ...webshop, connectionId: 'c1' }],
    });
    useStore.setState({
      repos: [webshop],
      connections: [
        {
          id: 'c1',
          name: 'unreliablewitness',
          organizationUrl: 'https://dev.azure.com/unreliablewitness',
          project: 'MIAC',
          user: null,
          status: 'ok',
          checkedAt: null,
        },
      ],
    });
    render(<SettingsScreen />);
    await userEvent.selectOptions(
      screen.getByLabelText('Connection for webshop'),
      'c1',
    );
    await waitFor(() =>
      expect(
        calls.find((c) => c.channel === 'repos:setConnection')?.args,
      ).toEqual(['r1', 'c1']),
    );
  });

  it('toggles the splash setting', async () => {
    const { calls } = installFakeApi({ 'settings:save': (next) => next });
    render(<SettingsScreen />);
    const box = await screen.findByRole('checkbox', {
      name: 'Show splash on start',
    });
    await waitFor(() => expect(box).toBeChecked());
    await userEvent.click(box);
    expect(calls.find((c) => c.channel === 'settings:save')?.args[0]).toEqual({
      version: 1,
      receiverPort: 4319,
      hourlySync: true,
      showSplash: false,
    });
  });

  it('keeps fields saved by the other section', async () => {
    let stored = {
      version: 1 as const,
      receiverPort: 4319,
      hourlySync: true,
      showSplash: true,
    };
    const { calls } = installFakeApi({
      'settings:get': () => stored,
      'settings:save': (next) => {
        stored = next;
        return next;
      },
    });
    render(<SettingsScreen />);
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Show splash on start' }),
    );
    await userEvent.click(
      await screen.findByRole('checkbox', { name: /every hour/ }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Save settings' }),
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.channel === 'settings:save')).toHaveLength(
        2,
      ),
    );
    expect(
      calls.filter((c) => c.channel === 'settings:save')[1]?.args[0],
    ).toEqual({
      version: 1,
      receiverPort: 4319,
      hourlySync: false,
      showSplash: false,
    });
  });

  it('shows the About panel with the version', async () => {
    installFakeApi();
    render(<SettingsScreen />);
    const about = await screen.findByRole('region', { name: 'About' });
    expect(about).toHaveTextContent("Me, I'm Counting");
    expect(about).toHaveTextContent(
      'General Systems Vehicle (accounting division)',
    );
    await waitFor(() => expect(about).toHaveTextContent('1.0.0'));
  });
});
