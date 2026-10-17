import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  HomeConnection,
  HomePr,
  HomeSnapshot,
} from '../../../shared/home';
import { useStore } from '../../store';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { PrBand } from './PrBand';

const pr = (id: number, over: Partial<HomePr> = {}): HomePr => ({
  id,
  repo: 'web',
  title: `PR ${id}`,
  author: 'Anna',
  authorId: 'anna',
  createdAt: `2026-10-1${id}T08:00:00Z`,
  isDraft: false,
  conflicts: false,
  myVote: 0,
  votes: { approved: 0, waiting: 0, rejected: 0 },
  url: `https://x/pr/${id}`,
  ...over,
});
const conn = (over: Partial<HomeConnection>): HomeConnection => ({
  connectionId: 'c1',
  name: 'uw',
  project: 'MIAC',
  status: 'ok',
  error: null,
  fetchedAt: '2026-10-17T09:12:00Z',
  sprints: [],
  sprintsError: null,
  reviews: [],
  teamReviews: [],
  myPrs: [],
  prsError: null,
  ...over,
});
const snap = (...connections: HomeConnection[]): HomeSnapshot => ({
  version: 1,
  builtAt: '',
  connections,
});

beforeEach(() => useStore.setState({ notices: [] }));

describe('PrBand', () => {
  it('lists named reviews oldest first over all connections', () => {
    installFakeApi();
    render(
      <PrBand
        snapshot={snap(
          conn({ reviews: [pr(3)] }),
          conn({
            connectionId: 'c2',
            name: 'fab',
            reviews: [pr(1, { isDraft: true, conflicts: true })],
          }),
        )}
      />,
    );
    const list = screen.getByRole('region', { name: 'Reviews for me' });
    const rows = within(list).getAllByRole('button', { name: /^!/ });
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^!1 PR 1/),
      expect.stringMatching(/^!3 PR 3/),
    ]);
    expect(within(rows[0]).getByText('Draft')).toBeTruthy();
    expect(within(rows[0]).getByText('Conflicts')).toBeTruthy();
  });

  it('team requests are collapsed until opened', async () => {
    installFakeApi();
    render(<PrBand snapshot={snap(conn({ teamReviews: [pr(4), pr(5)] }))} />);
    const toggle = screen.getByRole('button', { name: 'Team requests (2)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: /^!4/ })).toBeNull();
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: /^!4/ })).toBeTruthy();
  });

  it('a row opens the PR in the browser', async () => {
    const { calls } = installFakeApi({
      'shell:openExternal': () => undefined,
    });
    render(
      <PrBand
        snapshot={snap(
          conn({
            myPrs: [pr(9, { votes: { approved: 2, waiting: 1, rejected: 0 } })],
          }),
        )}
      />,
    );
    const mine = screen.getByRole('region', { name: 'My pull requests' });
    const row = within(mine).getByRole('button', { name: /^!9/ });
    expect(row.textContent).toContain('2 approved, 1 waiting');
    await userEvent.click(row);
    expect(calls.find((c) => c.channel === 'shell:openExternal')?.args).toEqual(
      ['https://x/pr/9'],
    );
  });

  it('greys rows of a stale connection and names a failed PR load', () => {
    installFakeApi();
    render(
      <PrBand
        snapshot={snap(
          conn({ status: 'stale', reviews: [pr(1)] }),
          conn({
            connectionId: 'c2',
            name: 'fab',
            project: 'Api',
            prsError: 'no code scope',
          }),
        )}
      />,
    );
    expect(screen.getByRole('button', { name: /^!1/ }).className).toContain(
      'is-stale-data',
    );
    expect(
      screen.getAllByText("Couldn't load pull requests for fab/Api"),
    ).toHaveLength(2);
  });

  it('names a stale connection in both columns and hides the empty lines', () => {
    installFakeApi();
    render(
      <PrBand
        snapshot={snap(
          conn({
            status: 'stale',
            error: 'down',
            fetchedAt: '2026-10-17T09:12:00Z',
          }),
        )}
      />,
    );
    expect(
      screen.getAllByText(/^Stale since \d\d:\d\d for uw\/MIAC: down$/),
    ).toHaveLength(2);
    expect(screen.queryByText('No reviews waiting.')).toBeNull();
    expect(screen.queryByText('No open pull requests.')).toBeNull();
  });

  it('names a connection that could not load', () => {
    installFakeApi();
    render(
      <PrBand
        snapshot={snap(
          conn({ status: 'error', error: 'refused', fetchedAt: null }),
        )}
      />,
    );
    expect(screen.getAllByText("Couldn't load uw/MIAC: refused")).toHaveLength(
      2,
    );
    expect(screen.queryByText('No reviews waiting.')).toBeNull();
  });

  it('empty states', () => {
    installFakeApi();
    render(<PrBand snapshot={snap(conn({}))} />);
    expect(screen.getByText('No reviews waiting.')).toBeTruthy();
    expect(screen.getByText('No open pull requests.')).toBeTruthy();
  });
});
