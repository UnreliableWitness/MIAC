import { describe, expect, it } from 'vitest';
import type { HomeConnection } from '../shared/home';
import type { Connection } from '../shared/types';
import { chipState } from './homeView';

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
