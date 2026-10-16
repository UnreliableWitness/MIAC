import { describe, expect, it } from 'vitest';
import type { Repo } from '../shared/types';
import { startRepos } from './startTask';

const repo = (id: string, connectionId: string | null): Repo => ({
  id,
  name: id,
  path: `/src/${id}`,
  baseBranch: 'main',
  connectionId,
  miacYmlFound: true,
  workItemOnStart: {
    moveToInProgress: true,
    assignToMe: true,
    stateOverrides: {},
  },
});

describe('startRepos', () => {
  const repos = [repo('a', 'c1'), repo('b', null), repo('c', 'c1')];
  it('lists the repos of the connection and picks the first without a remembered one', () => {
    const r = startRepos(repos, 'c1', null);
    expect(r.choices.map((x) => x.id)).toEqual(['a', 'c']);
    expect(r.repo?.id).toBe('a');
  });
  it('picks the remembered repo while it is linked to the connection', () => {
    expect(startRepos(repos, 'c1', 'c').repo?.id).toBe('c');
  });
  it('falls back to the first when the remembered repo is gone or unlinked', () => {
    expect(startRepos(repos, 'c1', 'b').repo?.id).toBe('a');
    expect(startRepos(repos, 'c1', 'zz').repo?.id).toBe('a');
  });
  it('has nothing for a connection without repos', () => {
    expect(startRepos(repos, 'c2', null)).toEqual({ repo: null, choices: [] });
  });
});
