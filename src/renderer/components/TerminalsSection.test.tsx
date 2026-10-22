import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { TerminalsSection } from './TerminalsSection';

beforeEach(() => useStore.setState({ notices: [] }));

describe('TerminalsSection', () => {
  it('shows the current choice', async () => {
    installFakeApi({});
    render(<TerminalsSection />);
    expect(
      await screen.findByRole('checkbox', { name: 'Claude Code' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'OpenCode' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Copilot CLI' }),
    ).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /shell/ })).toBeChecked();
  });

  it('saves a switch from Claude Code to OpenCode at once', async () => {
    const { calls } = installFakeApi({ 'settings:save': (s) => s });
    render(<TerminalsSection />);
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Claude Code' }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'OpenCode' }));
    await waitFor(() =>
      expect(
        calls.filter((c) => c.channel === 'settings:save').at(-1)?.args[0],
      ).toEqual(
        expect.objectContaining({
          defaultTerminals: {
            claude: false,
            copilot: false,
            opencode: true,
            shell: true,
          },
        }),
      ),
    );
  });
});
