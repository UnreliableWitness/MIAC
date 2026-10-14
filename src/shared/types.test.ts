import { describe, expect, it } from 'vitest';
import { StateSchema } from './types';

describe('StateSchema', () => {
  it('accepts an empty state', () => {
    expect(StateSchema.parse({ version: 1, repos: [], tasks: [] })).toEqual({
      version: 1,
      repos: [],
      tasks: [],
    });
  });
  it('rejects an unknown task status', () => {
    const bad = {
      version: 1,
      repos: [],
      tasks: [
        {
          id: 't',
          repoId: 'r',
          name: 'x',
          workItem: null,
          slug: 'x',
          branch: 'b',
          worktreePath: '/w',
          baseRef: 'main',
          status: 'weird',
          setup: {
            copy: false,
            commands: [],
            startClaude: false,
            openShell: false,
          },
          terminals: [],
          createdAt: 'now',
          finishedAt: null,
        },
      ],
    };
    expect(() => StateSchema.parse(bad)).toThrow();
  });
  it('rejects a future version', () => {
    expect(() =>
      StateSchema.parse({ version: 2, repos: [], tasks: [] }),
    ).toThrow();
  });
});
