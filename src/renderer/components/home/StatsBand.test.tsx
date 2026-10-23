import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { HomeStats } from '../../../shared/home';
import { useStore } from '../../store';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { StatsBand } from './StatsBand';

const stats = (over: Partial<HomeStats> = {}): HomeStats => ({
  period: 'week',
  from: '',
  to: '',
  costEur: 41.2,
  costByTool: { 'claude-code': 30, 'copilot-cli': 11.2, opencode: 0 },
  costByConnection: [{ connectionId: 'c1', costEur: 41.2 }],
  activeSeconds: 18 * 3600,
  agentSeconds: 11 * 3600,
  accuracy: 1.12,
  accuracyTasks: 3,
  tasksFinished: 6,
  prsOpened: 4,
  ...over,
});

beforeEach(() =>
  useStore.setState({
    connections: [{ id: 'c1', name: 'uw', project: 'Shellie' } as never],
  }),
);

describe('StatsBand', () => {
  it('shows the week tiles', async () => {
    installFakeApi({ 'home:stats': (period) => stats({ period }) });
    render(<StatsBand />);
    expect(await screen.findByText('€41.20')).toBeTruthy();
    expect(screen.getByText('112%')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('18h')).toBeTruthy();
    expect(
      screen.getByTitle(
        /Claude Code €30.00.*Copilot CLI €11.20.*uw\/Shellie €41.20/s,
      ),
    ).toBeTruthy();
  });

  it('the month toggle asks for the month', async () => {
    const { calls } = installFakeApi({
      'home:stats': (period) => stats({ period }),
    });
    render(<StatsBand />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'This month' }),
    );
    expect(
      calls.filter((c) => c.channel === 'home:stats').map((c) => c.args[0]),
    ).toEqual(['week', 'month']);
    expect(
      screen
        .getByRole('button', { name: 'This month' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('shows a dash without accuracy', async () => {
    installFakeApi({
      'home:stats': () => stats({ accuracy: null, accuracyTasks: 0 }),
    });
    render(<StatsBand />);
    expect(await screen.findByText('–')).toBeTruthy();
  });
});
