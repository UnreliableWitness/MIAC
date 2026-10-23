import { describe, expect, it } from 'vitest';
import type { Found } from '../../shared/secrets';
import { denyRulesFor, opencodePermission, untrackedSecretFiles } from './deny';

const f = (source: string, tracked = false): Found => ({
  name: 'N',
  value: 'v',
  env: null,
  source,
  tracked,
  secretLike: true,
});

describe('untrackedSecretFiles', () => {
  it('lists each untracked file once and skips tracked files and non-file sources', () => {
    expect(
      untrackedSecretFiles([
        f('.env'),
        f('.env'),
        f('api/appsettings.json', true),
        f('user secrets'),
        f('launch profile Prd'),
        f('secrets/a b.json'),
      ]),
    ).toEqual(['.env', 'secrets/a b.json']);
  });
});

describe('denyRulesFor', () => {
  it('denies reads and the three print commands for a relative path', () => {
    expect(denyRulesFor(['.env'])).toEqual([
      'Read(./.env)',
      'Bash(cat .env)',
      'Bash(type .env)',
      'Bash(Get-Content .env)',
    ]);
  });
  it('quotes paths with spaces in the commands', () => {
    expect(denyRulesFor(['secrets/a b.json'])).toContain(
      'Bash(cat "secrets/a b.json")',
    );
    expect(denyRulesFor(['secrets/a b.json'])).toContain(
      'Read(./secrets/a b.json)',
    );
  });
  it('uses // for an absolute path, with a Windows drive as /c', () => {
    expect(denyRulesFor(['/w/other/.env'])[0]).toBe('Read(//w/other/.env)');
    expect(denyRulesFor(['C:\\w\\other\\.env'])[0]).toBe(
      'Read(//c/w/other/.env)',
    );
  });
  it('is empty without paths', () => {
    expect(denyRulesFor([])).toEqual([]);
  });
});

describe('opencodePermission', () => {
  it('denies read and the print commands per path', () => {
    expect(opencodePermission(['.env', 'a b/.env'])).toEqual({
      read: { '.env': 'deny', 'a b/.env': 'deny' },
      bash: {
        'cat .env*': 'deny',
        'type .env*': 'deny',
        'Get-Content .env*': 'deny',
        'cat "a b/.env"*': 'deny',
        'type "a b/.env"*': 'deny',
        'Get-Content "a b/.env"*': 'deny',
      },
    });
  });
});
