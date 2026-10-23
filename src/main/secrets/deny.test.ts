import { describe, expect, it } from 'vitest';
import { denyRulesFor, denyTargets, opencodePermission } from './deny';

describe('denyTargets', () => {
  it('lists untracked files once, each secrets folder as a glob, and skips tracked files', () => {
    expect(
      denyTargets({
        files: [
          { path: '.env', tracked: false },
          { path: '.env', tracked: false },
          { path: 'api/appsettings.json', tracked: true },
          {
            path: '/home/u/.microsoft/usersecrets/x/secrets.json',
            tracked: false,
          },
        ],
        secretDirs: ['secrets'],
      }),
    ).toEqual([
      '.env',
      '/home/u/.microsoft/usersecrets/x/secrets.json',
      'secrets/**',
    ]);
  });
});

describe('denyRulesFor', () => {
  it('denies reads and the three print commands for a relative path', () => {
    expect(denyRulesFor(['.env'])).toEqual([
      'Read(./.env)',
      'Bash(cat .env:*)',
      'Bash(type .env:*)',
      'Bash(Get-Content .env:*)',
    ]);
  });
  it('quotes paths with spaces in the commands', () => {
    expect(denyRulesFor(['secrets/a b.json'])).toContain(
      'Bash(cat "secrets/a b.json":*)',
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
  it('escapes gitignore characters in Read paths only', () => {
    expect(denyRulesFor(['secrets/[prod].json'])).toEqual([
      'Read(./secrets/\\[prod\\].json)',
      'Bash(cat secrets/[prod].json:*)',
      'Bash(type secrets/[prod].json:*)',
      'Bash(Get-Content secrets/[prod].json:*)',
    ]);
    expect(denyRulesFor(['a*?!#.env'])[0]).toBe('Read(./a\\*\\?\\!\\#.env)');
    expect(denyRulesFor([' x '])[0]).toBe('Read(./\\ x\\ )');
  });
  it('a folder glob is a Read rule only', () => {
    expect(denyRulesFor(['secrets/**'])).toEqual(['Read(./secrets/**)']);
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
  it('keeps a folder glob for read and leaves it out of bash', () => {
    expect(opencodePermission(['secrets/**'])).toEqual({
      read: { 'secrets/**': 'deny' },
      bash: {},
    });
  });
});
