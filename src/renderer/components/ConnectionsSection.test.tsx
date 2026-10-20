import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Connection } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { ConnectionsSection } from './ConnectionsSection';

const ok: Connection = {
  id: 'c1',
  name: 'unreliablewitness',
  organizationUrl: 'https://dev.azure.com/unreliablewitness',
  project: 'Shellie',
  user: 'Dries Hoebeke',
  status: 'ok',
  checkedAt: '2026-10-14T10:00:00.000Z',
  userUniqueName: null,
};

beforeEach(() =>
  useStore.setState({
    repos: [],
    tasks: [],
    notices: [],
    connections: [],
    screen: { kind: 'settings' },
  }),
);

describe('ConnectionsSection', () => {
  it('lists connections with their status', () => {
    installFakeApi();
    useStore.setState({
      connections: [
        ok,
        {
          ...ok,
          id: 'c2',
          organizationUrl: 'https://dev.azure.com/client',
          name: 'client',
          status: 'unauthorized',
          user: null,
        },
      ],
    });
    render(<ConnectionsSection />);
    expect(screen.getByText('Connected as Dries Hoebeke')).toBeInTheDocument();
    expect(
      screen.getByText(
        `https://dev.azure.com/unreliablewitness ${String.fromCharCode(0xb7)} Shellie`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Token rejected, enter it again'),
    ).toBeInTheDocument();
  });

  it('tells which token scopes are needed', async () => {
    installFakeApi();
    render(<ConnectionsSection />);
    await userEvent.click(
      screen.getByRole('button', { name: /Add connection/ }),
    );
    expect(
      screen.getByText(/Work Items \(Read & write\) and Code \(Read & write\)/),
    ).toBeInTheDocument();
  });

  it('adds a connection and never echoes the token', async () => {
    const { calls } = installFakeApi({
      'connections:save': () => ok,
      'connections:list': () => [ok],
    });
    render(<ConnectionsSection />);
    await userEvent.click(
      screen.getByRole('button', { name: /Add connection/ }),
    );
    await userEvent.type(
      screen.getByLabelText('Organization URL'),
      'https://dev.azure.com/unreliablewitness/',
    );
    await userEvent.type(screen.getByLabelText('Project'), 'Shellie');
    await userEvent.type(
      screen.getByLabelText('Personal access token'),
      'secret-pat',
    );
    expect(document.body.textContent).not.toContain('secret-pat');
    expect(screen.getByLabelText('Personal access token')).toHaveAttribute(
      'type',
      'password',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.channel === 'connections:save')?.args[0],
      ).toEqual({
        organizationUrl: 'https://dev.azure.com/unreliablewitness/',
        project: 'Shellie',
        pat: 'secret-pat',
      }),
    );
    await waitFor(() => expect(useStore.getState().connections).toEqual([ok]));
    expect(
      screen.queryByLabelText('Personal access token'),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('secret-pat');
  });

  it('keeps the form open with the message when saving fails', async () => {
    installFakeApi({
      'connections:save': () => {
        throw new Error('Azure DevOps rejected the token');
      },
    });
    render(<ConnectionsSection />);
    await userEvent.click(
      screen.getByRole('button', { name: /Add connection/ }),
    );
    await userEvent.type(
      screen.getByLabelText('Organization URL'),
      'dev.azure.com/o',
    );
    await userEvent.type(screen.getByLabelText('Project'), 'P');
    await userEvent.type(screen.getByLabelText('Personal access token'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/rejected the token/)).toBeInTheDocument();
    expect(screen.getByLabelText('Personal access token')).toBeInTheDocument();
  });

  it('verifies and removes', async () => {
    const { calls } = installFakeApi({
      'connections:verify': () => ({ ...ok, checkedAt: 'later' }),
      'connections:remove': () => undefined,
      'connections:list': () => [ok],
    });
    useStore.setState({
      connections: [ok],
      repos: [
        {
          id: 'r1',
          name: 'webshop',
          path: '/w',
          baseBranch: 'main',
          connectionId: 'c1',
          configFound: true,
          discovered: false,
          workItemOnStart: {
            moveToInProgress: true,
            assignToMe: true,
            stateOverrides: {},
          },
        },
      ],
    });
    render(<ConnectionsSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'connections:verify')).toBe(true),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(
      screen.getByText(/1 repository uses this connection/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove anyway' }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.channel === 'connections:remove' && c.args[0] === 'c1',
        ),
      ).toBe(true),
    );
  });

  it('redacts the token from a save error', async () => {
    installFakeApi({
      'connections:save': () => {
        throw new Error('bad token secret-pat here');
      },
    });
    render(<ConnectionsSection />);
    await userEvent.click(
      screen.getByRole('button', { name: /Add connection/ }),
    );
    await userEvent.type(
      screen.getByLabelText('Organization URL'),
      'dev.azure.com/o',
    );
    await userEvent.type(screen.getByLabelText('Project'), 'P');
    await userEvent.type(
      screen.getByLabelText('Personal access token'),
      'secret-pat',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('***');
    expect(document.body.textContent).not.toContain('secret-pat');
  });

  it('removes an unused connection without a confirm row', async () => {
    const { calls } = installFakeApi({
      'connections:remove': () => undefined,
      'connections:list': () => [],
    });
    useStore.setState({ connections: [ok], repos: [] });
    render(<ConnectionsSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.channel === 'connections:remove' && c.args[0] === 'c1',
        ),
      ).toBe(true),
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('replaces the token of an existing connection, checked like a new one', async () => {
    useStore.setState({ connections: [{ ...ok, status: 'unauthorized' }] });
    const { calls } = installFakeApi({
      'connections:save': () => ok,
      'connections:list': () => [ok],
    });
    render(<ConnectionsSection />);
    expect(
      screen.queryByLabelText('New personal access token'),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Update token' }));
    await userEvent.type(
      screen.getByLabelText('New personal access token'),
      'fresh-pat',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save token' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.channel === 'connections:save')?.args[0],
      ).toEqual({
        id: 'c1',
        name: 'unreliablewitness',
        organizationUrl: 'https://dev.azure.com/unreliablewitness',
        project: 'Shellie',
        pat: 'fresh-pat',
      }),
    );
    await waitFor(() => expect(useStore.getState().connections).toEqual([ok]));
    expect(
      screen.queryByLabelText('New personal access token'),
    ).not.toBeInTheDocument();
  });

  it('keeps the token form open with a redacted error when the new token is refused', async () => {
    useStore.setState({ connections: [ok] });
    installFakeApi({
      'connections:save': () => {
        throw new Error('Azure DevOps rejected fresh-pat');
      },
    });
    render(<ConnectionsSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Update token' }));
    await userEvent.type(
      screen.getByLabelText('New personal access token'),
      'fresh-pat',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save token' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Azure DevOps rejected ***',
    );
    expect(
      screen.getByLabelText('New personal access token'),
    ).toBeInTheDocument();
  });

  it('opens the token form of the connection Settings was opened at', () => {
    installFakeApi();
    useStore.setState({
      connections: [ok, { ...ok, id: 'c2', name: 'client' }],
      screen: { kind: 'settings', section: 'conn-c2' },
    });
    const { container } = render(<ConnectionsSection />);
    const forms = container.querySelectorAll('.conn-form');
    expect(forms).toHaveLength(1);
    expect(container.querySelector('#conn-c2 + .conn-form')).not.toBeNull();
  });
});
