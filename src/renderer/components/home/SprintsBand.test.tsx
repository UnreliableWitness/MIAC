import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { HomeConnection, HomeSnapshot } from '../../../shared/home';
import type { Repo } from '../../../shared/types';
import { useStore } from '../../store';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { SprintsBand } from './SprintsBand';

const item = (id: string, state: string) => ({
  id,
  type: 'Issue',
  title: id,
  state,
  areaPath: 'MIAC',
  iterationPath: 'MIAC\\Sprint 1',
  assignedTo: 'Me',
  url: 'u',
  remainingWork: null,
  originalEstimate: 2,
  completedWork: null,
});
const conn = (over: Partial<HomeConnection>): HomeConnection => ({
  connectionId: 'c1',
  name: 'uw',
  project: 'MIAC',
  status: 'ok',
  error: null,
  fetchedAt: '',
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
const finish = new Date(Date.now() + 4 * 86_400_000).toISOString();

beforeEach(() =>
  useStore.setState({
    repos: [
      { id: 'r1', connectionId: 'c1', discovered: false },
      { id: 'r2', connectionId: 'c2', discovered: false },
    ] as Repo[],
    connectionId: null,
    screen: { kind: 'home' },
  }),
);

describe('SprintsBand', () => {
  it('a card per sprint with my items by state and days left', async () => {
    installFakeApi();
    render(
      <SprintsBand
        snapshot={snap(
          conn({
            sprints: [
              {
                iterationId: 'i',
                name: 'Sprint 1',
                path: 'MIAC\\Sprint 1',
                startDate: null,
                finishDate: finish,
                items: [
                  item('1', 'To Do'),
                  item('2', 'Doing'),
                  item('3', 'Done'),
                ],
              },
            ],
          }),
        )}
      />,
    );
    const card = await screen.findByRole('button', {
      name: /uw\/MIAC, Sprint 1/,
    });
    expect(card.textContent).toContain('1 to do · 1 in progress · 1 done');
    expect(card.textContent).toMatch(/4 days left/);
    expect(card.textContent).toContain('/ 6h');
  });

  it('a click opens that project on the Sprint page', async () => {
    installFakeApi();
    render(
      <SprintsBand
        snapshot={snap(
          conn({
            sprints: [
              {
                iterationId: 'i',
                name: 'Sprint 1',
                path: 'p',
                startDate: null,
                finishDate: null,
                items: [item('1', 'To Do')],
              },
            ],
          }),
        )}
      />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /Sprint 1/ }),
    );
    expect(useStore.getState().connectionId).toBe('c1');
    expect(useStore.getState().screen.kind).toBe('sprint');
  });

  it('a linked project without my items gets a slim card', () => {
    installFakeApi();
    render(
      <SprintsBand
        snapshot={snap(
          conn({ connectionId: 'c2', name: 'fab', project: 'Api' }),
        )}
      />,
    );
    expect(screen.getByText('fab/Api: nothing assigned')).toBeTruthy();
  });

  it('names a failed sprint load', () => {
    installFakeApi();
    render(<SprintsBand snapshot={snap(conn({ sprintsError: 'boom' }))} />);
    expect(screen.getByText("Couldn't load sprints for uw/MIAC")).toBeTruthy();
  });

  it('empty state', () => {
    installFakeApi();
    useStore.setState({ repos: [] });
    render(<SprintsBand snapshot={snap(conn({}))} />);
    expect(
      screen.getByText('Nothing assigned to you in a current sprint.'),
    ).toBeTruthy();
  });
});
