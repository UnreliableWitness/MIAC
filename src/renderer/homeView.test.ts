import { describe, expect, it } from 'vitest';
import type { HomeConnection, HomeItem, HomeSnapshot } from '../shared/home';
import type { Connection, Repo, TaskView } from '../shared/types';
import { chipState, upNext } from './homeView';

const connection = { id: 'c1', status: 'ok' } as Connection;
const home = (status: HomeConnection['status']) =>
  ({ status }) as HomeConnection;

describe('chipState', () => {
  it('is error when the connection or the build says so', () => {
    expect(
      chipState(home('ok'), { ...connection, status: 'unauthorized' }),
    ).toBe('error');
    expect(chipState(home('error'), connection)).toBe('error');
  });
  it('is stale when the last build failed but data is kept', () => {
    expect(chipState(home('stale'), connection)).toBe('stale');
  });
  it('is ok otherwise, also before the first build', () => {
    expect(chipState(home('ok'), connection)).toBe('ok');
    expect(chipState(undefined, connection)).toBe('ok');
  });
});

const hi = (id: string, state = 'To Do'): HomeItem => ({
  id,
  type: 'Issue',
  title: `Item ${id}`,
  state,
  areaPath: 'P',
  iterationPath: 'P\\S1',
  assignedTo: 'Me',
  url: `https://x/${id}`,
  remainingWork: null,
  originalEstimate: null,
  completedWork: null,
});
const snap = (items: HomeItem[]): HomeSnapshot => ({
  version: 1,
  builtAt: '',
  connections: [
    {
      connectionId: 'c1',
      name: 'uw',
      project: 'P',
      status: 'ok',
      error: null,
      fetchedAt: '',
      sprints: [
        {
          iterationId: 'i',
          name: 'S1',
          path: 'P\\S1',
          startDate: null,
          finishDate: null,
          items,
        },
      ],
      sprintsError: null,
      reviews: [],
      teamReviews: [],
      myPrs: [],
      prsError: null,
    },
  ],
});
const repos = [{ id: 'r1', connectionId: 'c1' }] as Repo[];
const noMeta = () => undefined;

describe('upNext', () => {
  it('takes not-started items, at most three', () => {
    const s = snap([hi('1'), hi('2', 'Doing'), hi('3'), hi('4'), hi('5')]);
    expect(upNext(s, [], repos, noMeta).map((u) => u.item.id)).toEqual([
      '1',
      '3',
      '4',
    ]);
  });
  it('drops an item once it has a task', () => {
    const s = snap([hi('1'), hi('3')]);
    const tasks = [
      {
        id: 't',
        repoId: 'r1',
        connectionId: null,
        workItem: { id: '1' },
        status: 'setting-up',
      },
    ] as TaskView[];
    expect(upNext(s, tasks, repos, noMeta).map((u) => u.item.id)).toEqual([
      '3',
    ]);
  });
  it('an item with the same id on another connection still counts', () => {
    const s = snap([hi('1')]);
    const tasks = [
      {
        id: 't',
        repoId: 'r2',
        connectionId: 'c2',
        workItem: { id: '1' },
        status: 'ready',
      },
    ] as TaskView[];
    expect(upNext(s, tasks, repos, noMeta)).toHaveLength(1);
  });
  it('uses the type metadata category', () => {
    const s = snap([hi('1', 'Approved by PO')]);
    expect(upNext(s, [], repos, () => 'Proposed')).toHaveLength(1);
    expect(upNext(s, [], repos, () => 'InProgress')).toHaveLength(0);
  });
});
