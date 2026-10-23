import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { WhatsNew } from '../../../shared/ipc';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { WhatsNewBand } from './WhatsNewBand';

const card = (over: Partial<WhatsNew> = {}): WhatsNew => ({
  version: '1.46.0',
  url: 'https://github.com/UnreliableWitness/Shellie/releases/tag/v1.46.0',
  fetched: true,
  releases: [
    {
      version: '1.46.0',
      url: 'https://github.com/UnreliableWitness/Shellie/releases/tag/v1.46.0',
      items: ['Keep checking for updates'],
    },
  ],
  ...over,
});

describe('WhatsNewBand', () => {
  it('shows nothing when no card is due', async () => {
    const { calls } = installFakeApi({ 'app:whatsNew': () => null });
    const { container } = render(<WhatsNewBand />);
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'app:whatsNew')).toBe(true),
    );
    expect(container.innerHTML).toBe('');
  });

  it('lists the short notes and opens the long ones on GitHub', async () => {
    const { calls } = installFakeApi({
      'app:whatsNew': () => card(),
      'shell:openExternal': () => undefined,
    });
    render(<WhatsNewBand />);
    expect(
      await screen.findByRole('heading', {
        name: "What's new in Shellie 1.46.0",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Keep checking for updates')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Release notes on GitHub' }),
    );
    expect(calls.find((c) => c.channel === 'shell:openExternal')?.args).toEqual(
      ['https://github.com/UnreliableWitness/Shellie/releases/tag/v1.46.0'],
    );
  });

  it('labels each release when the update covers several, and caps the list', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `Change ${i}`);
    installFakeApi({
      'app:whatsNew': () =>
        card({
          url: 'https://github.com/UnreliableWitness/Shellie/releases',
          releases: [
            { version: '1.46.0', url: 'u1', items: many.slice(0, 6) },
            { version: '1.45.0', url: 'u2', items: many.slice(6) },
          ],
        }),
    });
    render(<WhatsNewBand />);
    expect(await screen.findByText('1.45.0')).toBeInTheDocument();
    expect(screen.getByText('Change 0')).toBeInTheDocument();
    expect(screen.queryByText('Change 9')).toBeNull();
    expect(screen.getByText('and 2 more')).toBeInTheDocument();
  });

  it('says where to read the notes when GitHub could not be reached', async () => {
    installFakeApi({
      'app:whatsNew': () => card({ fetched: false, releases: [] }),
    });
    render(<WhatsNewBand />);
    expect(
      await screen.findByText(/Shellie was updated to 1\.46\.0/),
    ).toBeInTheDocument();
  });

  it('Dismiss saves the version as seen and hides the card', async () => {
    let saved: unknown = null;
    installFakeApi({
      'app:whatsNew': () => card(),
      'settings:save': (s) => {
        saved = s;
        return s;
      },
    });
    render(<WhatsNewBand />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dismiss' }),
    );
    expect(saved).toMatchObject({ whatsNewSeen: '1.46.0' });
    expect(screen.queryByText('Keep checking for updates')).toBeNull();
  });
});
