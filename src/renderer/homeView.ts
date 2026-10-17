import type { HomeConnection } from '../shared/home';
import type { Connection } from '../shared/types';

/** The health chip of a connection: red when its token was refused or it never loaded, amber when Home shows old data. */
export function chipState(
  home: HomeConnection | undefined,
  connection: Connection,
): 'ok' | 'stale' | 'error' {
  if (connection.status !== 'ok' || home?.status === 'error') return 'error';
  if (home?.status === 'stale') return 'stale';
  return 'ok';
}
