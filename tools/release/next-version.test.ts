import { describe, expect, it } from 'vitest';
import { nextMinorVersion } from './next-version.mjs';

const line = (tag: string) => `0123abcd\trefs/tags/${tag}`;

describe('nextMinorVersion', () => {
  it('bumps the minor of the highest vX.Y.Z tag and resets the patch', () => {
    expect(
      nextMinorVersion(
        [line('v1.0.1'), line('v1.0.2'), line('v1.0.2^{}')].join('\n'),
      ),
    ).toBe('1.1.0');
  });

  it('compares numerically, not as text', () => {
    expect(nextMinorVersion([line('v1.9.0'), line('v1.10.0')].join('\n'))).toBe(
      '1.11.0',
    );
    expect(nextMinorVersion([line('v2.0.0'), line('v1.12.3')].join('\n'))).toBe(
      '2.1.0',
    );
  });

  it('ignores tags that are not vX.Y.Z', () => {
    expect(
      nextMinorVersion(
        [
          line('v1.2.0'),
          line('v9.0.0-beta.1'),
          line('v10'),
          line('release'),
        ].join('\n'),
      ),
    ).toBe('1.3.0');
  });

  it('starts at 1.0.0 without tags', () => {
    expect(nextMinorVersion('')).toBe('1.0.0');
  });
});
