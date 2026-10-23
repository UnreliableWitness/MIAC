import { describe, expect, it } from 'vitest';
import { nouns } from './trackers';

describe('nouns', () => {
  it('names the tracker nouns per provider', () => {
    expect(nouns('azure-devops')).toEqual({
      item: 'work item',
      iteration: 'sprint',
      pullRequest: 'pull request',
    });
    expect(nouns('github')).toEqual({
      item: 'issue',
      iteration: 'iteration',
      pullRequest: 'pull request',
    });
  });
});
