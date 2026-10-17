import { describe, expect, it } from 'vitest';
import { toHomePr } from './homePr';

const ctx = {
  organizationUrl: 'https://dev.azure.com/uw',
  project: 'MIAC',
  me: 'me-1',
};

describe('toHomePr', () => {
  it('maps the fields, my vote and the vote summary', () => {
    expect(
      toHomePr(
        {
          pullRequestId: 12,
          title: 'Add audit log',
          creationDate: '2026-10-15T08:00:00Z',
          isDraft: true,
          mergeStatus: 'conflicts',
          repository: { name: 'web' },
          createdBy: { id: 'anna', displayName: 'Anna' },
          reviewers: [
            { id: 'me-1', vote: 0 },
            { id: 'tom', vote: 10 },
            { id: 'eve', vote: 5 },
            { id: 'bob', vote: -5 },
            { id: 'team', vote: -10, isContainer: true },
          ],
        },
        ctx,
      ),
    ).toEqual({
      id: 12,
      repo: 'web',
      title: 'Add audit log',
      author: 'Anna',
      authorId: 'anna',
      createdAt: '2026-10-15T08:00:00Z',
      isDraft: true,
      conflicts: true,
      myVote: 0,
      votes: { approved: 2, waiting: 1, rejected: 1 },
      url: 'https://dev.azure.com/uw/MIAC/_git/web/pullrequest/12',
    });
  });
  it('has no vote of mine when I am not a named reviewer', () => {
    expect(
      toHomePr(
        { pullRequestId: 3, repository: { name: 'web' }, reviewers: [] },
        ctx,
      )?.myVote,
    ).toBeNull();
  });
  it('drops a PR without an id or repo', () => {
    expect(toHomePr({ title: 'x' }, ctx)).toBeNull();
  });
});
