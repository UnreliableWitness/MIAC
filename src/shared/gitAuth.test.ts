import { describe, expect, it } from 'vitest';
import {
  gitAuthAdvice,
  hostInText,
  isGitAuthFailure,
  remoteHost,
} from './gitAuth';

describe('isGitAuthFailure', () => {
  it.each([
    "fatal: could not read Password for 'https://org@dev.azure.com/org/p/_git/r': terminal prompts disabled",
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    "fatal: Authentication failed for 'https://dev.azure.com/org/p/_git/r/'",
    'remote: HTTP Basic: Access denied',
    "fatal: unable to access 'https://x/': The requested URL returned error: 401",
    "fatal: unable to access 'https://x/': The requested URL returned error: 403",
  ])('detects %s', (text) => expect(isGitAuthFailure(text)).toBe(true));

  it.each([
    "fatal: couldn't find remote ref main",
    "fatal: unable to access 'https://x/': The requested URL returned error: 404",
    'fatal: unable to access: Could not resolve host: dev.azure.com',
    'error: 401 files changed',
  ])('ignores %s', (text) => expect(isGitAuthFailure(text)).toBe(false));
});

describe('remoteHost', () => {
  it('reads https, ssh and scp-style remotes', () => {
    expect(
      remoteHost('https://LocinoxBE@dev.azure.com/LocinoxBE/DXP/_git/DXP'),
    ).toBe('dev.azure.com');
    expect(remoteHost('ssh://git@ssh.dev.azure.com/v3/o/p/r')).toBe(
      'ssh.dev.azure.com',
    );
    expect(remoteHost('git@github.com:me/repo.git')).toBe('github.com');
    expect(remoteHost('/local/path')).toBeNull();
  });
});

describe('hostInText', () => {
  it('finds the host of the URL git names', () => {
    expect(
      hostInText(
        "fatal: could not read Password for 'https://u@Org.VisualStudio.com/p/_git/r': terminal prompts disabled",
      ),
    ).toBe('org.visualstudio.com');
    expect(hostInText('remote: HTTP Basic: Access denied')).toBeNull();
  });
});

describe('gitAuthAdvice', () => {
  it('asks for a new token when an Azure DevOps connection signed in', () => {
    expect(
      gitAuthAdvice({ host: 'dev.azure.com', connectionId: 'c1', path: '/r' }),
    ).toBe(
      'Git could not sign in to dev.azure.com with your Azure DevOps token. Update the token, then Retry.',
    );
  });

  it('asks for a sign-in from a terminal for other remotes', () => {
    expect(
      gitAuthAdvice({
        host: 'github.com',
        connectionId: null,
        path: '/src/app',
      }),
    ).toBe(
      'Git could not sign in to github.com. Sign in once from a terminal (run `git fetch` in /src/app), then Retry.',
    );
    expect(
      gitAuthAdvice(
        { host: 'github.com', connectionId: null, path: '/w' },
        'git push',
      ),
    ).toContain('run `git push` in /w');
  });
});
