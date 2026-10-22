import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RepoInspection } from '../../shared/repoInspection';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { AddRepoScreen } from './AddRepoScreen';

const PROPOSAL =
  'base: develop\nbranch: "{type}/{id}-{slug}"\nsetup:\n  - npm ci\n';
const inspection: RepoInspection = {
  folder: '/src/webshop',
  remote: {
    url: 'https://dev.azure.com/org/Shellie/_git/webshop',
    provider: 'azure-devops',
    connectionId: 'c1',
    project: 'Shellie',
  },
  baseBranch: 'develop',
  facts: {
    lockfile: 'npm',
    dotnet: [],
    devScript: 'dev',
    apm: true,
    envFiles: ['.env', '.env.local'],
    existing: null,
  },
  proposal: PROPOSAL,
};

function open(from: 'settings' | 'get-started', folder = '/src/webshop') {
  useStore.setState({
    screen: { kind: 'add-repo', from, folder },
    previous: null,
    notices: [],
  });
}
const addCall = (calls: { channel: string; args: unknown[] }[]) =>
  calls.find((c) => c.channel === 'repos:add');

beforeEach(() => open('settings'));

describe('AddRepoScreen', () => {
  it('inspects the folder and shows what Shellie found and the proposal', async () => {
    const { calls } = installFakeApi({ 'repos:inspect': () => inspection });
    render(<AddRepoScreen folder="/src/webshop" />);
    expect(await screen.findByText('Linked to project Shellie')).toBeTruthy();
    expect(calls.find((c) => c.channel === 'repos:inspect')?.args).toEqual([
      '/src/webshop',
    ]);
    expect(screen.getByText('develop')).toBeTruthy();
    expect(screen.getByText('Scripts')).toBeTruthy();
    expect(screen.getByText('Agent packages')).toBeTruthy();
    expect(screen.getByText('Env files')).toBeTruthy();
    expect(screen.getByText(/package-lock\.json/)).toBeTruthy();
    expect(document.querySelector('pre')?.textContent).toBe(PROPOSAL);
    expect(screen.queryByText('Get started')).toBeNull();
  });

  it('writes the edited proposal and the base branch by default', async () => {
    const { calls } = installFakeApi({
      'repos:inspect': () => inspection,
      'repos:add': () => ({}) as never,
    });
    render(<AddRepoScreen folder="/src/webshop" />);
    await screen.findByText('Linked to project Shellie');
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const box = screen.getByRole('textbox', { name: 'Proposed .shellie.yml' });
    fireEvent.change(box, {
      target: { value: 'base: develop\ncopy: [.env]\n' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Add repository' }),
    );
    await waitFor(() => expect(addCall(calls)).toBeTruthy());
    expect(addCall(calls)?.args).toEqual([
      '/src/webshop',
      {
        writeConfig: 'base: develop\ncopy: [.env]\n',
        baseBranch: 'develop',
        connectionId: 'c1',
      },
    ]);
    await waitFor(() =>
      expect(useStore.getState().screen).toEqual({
        kind: 'settings',
        section: 'repos',
      }),
    );
  });

  it('shows an error under an invalid edit and disables Add', async () => {
    installFakeApi({ 'repos:inspect': () => inspection });
    render(<AddRepoScreen folder="/src/webshop" />);
    await screen.findByText('Linked to project Shellie');
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Proposed .shellie.yml' }),
      {
        target: { value: 'nonsense: [' },
      },
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Add repository',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Proposed .shellie.yml' }),
      {
        target: { value: 'bogus: 1\n' },
      },
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('keeps the defaults in Shellie only without writeConfig', async () => {
    const { calls } = installFakeApi({
      'repos:inspect': () => inspection,
      'repos:add': () => ({}) as never,
    });
    render(<AddRepoScreen folder="/src/webshop" />);
    await screen.findByText('Linked to project Shellie');
    await userEvent.click(
      screen.getByRole('radio', {
        name: /Keep these defaults in Shellie only/,
      }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Add repository' }),
    );
    await waitFor(() => expect(addCall(calls)).toBeTruthy());
    expect(addCall(calls)?.args).toEqual([
      '/src/webshop',
      { baseBranch: 'develop', connectionId: 'c1' },
    ]);
  });

  it('shows an existing .shellie.yml and no radios', async () => {
    installFakeApi({
      'repos:inspect': () => ({
        ...inspection,
        proposal: null,
        facts: { ...inspection.facts, existing: 'base: trunk\n' },
      }),
    });
    render(<AddRepoScreen folder="/src/webshop" />);
    await screen.findByText('Linked to project Shellie');
    expect(screen.queryByRole('radio')).toBeNull();
    expect(document.querySelector('pre')?.textContent).toBe('base: trunk\n');
    expect(screen.getByText(/already has a \.shellie\.yml/)).toBeTruthy();
  });

  it('adds an existing-config repo without writeConfig', async () => {
    const { calls } = installFakeApi({
      'repos:inspect': () => ({
        ...inspection,
        proposal: null,
        facts: { ...inspection.facts, existing: 'base: trunk\n' },
      }),
      'repos:add': () => ({}) as never,
    });
    render(<AddRepoScreen folder="/src/webshop" />);
    await screen.findByText('Linked to project Shellie');
    await userEvent.click(
      screen.getByRole('button', { name: 'Add repository' }),
    );
    await waitFor(() => expect(addCall(calls)).toBeTruthy());
    expect(addCall(calls)?.args[1]).toEqual({
      baseBranch: 'develop',
      connectionId: 'c1',
    });
  });

  it('notes a GitHub remote', async () => {
    installFakeApi({
      'repos:inspect': () => ({
        ...inspection,
        remote: {
          url: 'https://github.com/o/r',
          provider: 'github',
          connectionId: null,
          project: null,
        },
      }),
    });
    render(<AddRepoScreen folder="/src/webshop" />);
    expect(await screen.findByText(/A GitHub remote\?/)).toBeTruthy();
  });

  it('shows the error for a folder that is not a git repository', async () => {
    installFakeApi({
      'repos:inspect': () => {
        throw new Error('/tmp/x is not a git repository');
      },
    });
    render(<AddRepoScreen folder="/tmp/x" />);
    expect(
      await screen.findByText('/tmp/x is not a git repository'),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Add repository',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('browses for a folder and inspects it', async () => {
    const { calls } = installFakeApi({
      'repos:pickFolder': () => '/src/other',
      'repos:inspect': () => inspection,
    });
    render(<AddRepoScreen />);
    await userEvent.click(screen.getByRole('button', { name: /Browse/ }));
    await screen.findByText('Linked to project Shellie');
    expect(calls.find((c) => c.channel === 'repos:inspect')?.args).toEqual([
      '/src/other',
    ]);
  });

  it('from Settings: no step strip, Back goes to Settings', async () => {
    installFakeApi({ 'repos:inspect': () => inspection });
    render(<AddRepoScreen folder="/src/webshop" />);
    await screen.findByText('Linked to project Shellie');
    expect(screen.queryByLabelText('Setup steps')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(useStore.getState().screen).toEqual({
      kind: 'settings',
      section: 'repos',
    });
  });

  it('from get started: strip with Repository current, Add goes to Home', async () => {
    open('get-started');
    installFakeApi({
      'repos:inspect': () => inspection,
      'repos:add': () => ({}) as never,
    });
    render(<AddRepoScreen folder="/src/webshop" />);
    await screen.findByText('Linked to project Shellie');
    const strip = screen.getByLabelText('Setup steps');
    expect(strip.querySelector('[aria-current="step"]')?.textContent).toContain(
      'Repository',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Add repository' }),
    );
    await waitFor(() =>
      expect(useStore.getState().screen).toEqual({ kind: 'home' }),
    );
  });
});
