import { describe, expect, it, vi } from 'vitest';
import { defaultSettings, type AppSettings } from '../shared/usage';
import {
  compareVersions,
  createWhatsNew,
  pickReleases,
  seenAtBoot,
  shortNotes,
  whatsNewFrom,
  type GitHubRelease,
} from './releaseNotes';

const generated = (title: string, pr: number, prev = 'v1.44.0') =>
  [
    "## What's Changed",
    `* ${title} by @UnreliableWitness in https://github.com/UnreliableWitness/Shellie/pull/${pr}`,
    '',
    '## New Contributors',
    '* @someone made their first contribution in https://github.com/UnreliableWitness/Shellie/pull/1',
    '',
    `**Full Changelog**: https://github.com/UnreliableWitness/Shellie/compare/${prev}...v1.45.0`,
  ].join('\n');

const rel = (
  version: string,
  body: string,
  over: Partial<GitHubRelease> = {},
): GitHubRelease => ({
  tag_name: `v${version}`,
  html_url: `https://github.com/UnreliableWitness/Shellie/releases/tag/v${version}`,
  body,
  draft: false,
  prerelease: false,
  ...over,
});

const settings = (over: Partial<AppSettings> = {}): AppSettings => ({
  ...defaultSettings(),
  ...over,
});
const dismissed = (s: AppSettings): AppSettings => ({
  ...s,
  onboarding: { ...s.onboarding, dismissedAt: '2026-10-20T00:00:00Z' },
});

describe('shortNotes', () => {
  it('takes the PR titles of GitHub generated notes, without author, link or issue numbers', () => {
    expect(
      shortNotes(
        generated(
          'Copy untracked agent config into new worktrees (#119) (#122)',
          122,
        ),
      ),
    ).toEqual(['Copy untracked agent config into new worktrees']);
  });

  it('reads hand-written bullets and ignores everything else', () => {
    expect(shortNotes('Intro\n\n- First thing\n- Second thing\n')).toEqual([
      'First thing',
      'Second thing',
    ]);
    expect(shortNotes('')).toEqual([]);
    expect(shortNotes(null)).toEqual([]);
  });
});

describe('compareVersions', () => {
  it('orders by number, not text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3', '2.0.0')).toBeLessThan(0);
  });
});

describe('pickReleases', () => {
  const list = [
    rel('1.47.0', generated('Not yet installed', 5)),
    rel('1.46.0', generated('Newest installed', 4)),
    rel('1.45.5', '', { prerelease: true }),
    rel('1.45.0', generated('Middle', 3)),
    rel('1.44.0', generated('Already seen', 2)),
    rel('1.43.0', generated('Older', 1), { draft: true }),
  ];

  it('gives the releases after the seen version up to the running one, newest first', () => {
    expect(pickReleases(list, '1.44.0', '1.46.0')).toEqual([
      {
        version: '1.46.0',
        url: 'https://github.com/UnreliableWitness/Shellie/releases/tag/v1.46.0',
        items: ['Newest installed'],
      },
      {
        version: '1.45.0',
        url: 'https://github.com/UnreliableWitness/Shellie/releases/tag/v1.45.0',
        items: ['Middle'],
      },
    ]);
  });

  it('gives only the running version without a seen one', () => {
    expect(pickReleases(list, null, '1.46.0').map((r) => r.version)).toEqual([
      '1.46.0',
    ]);
  });
});

describe('whatsNewFrom', () => {
  it('shows nothing when the running version was seen, or is older than the seen one', () => {
    expect(whatsNewFrom(settings({ whatsNewSeen: '1.46.0' }), '1.46.0')).toBe(
      undefined,
    );
    expect(whatsNewFrom(settings({ whatsNewSeen: '1.47.0' }), '1.46.0')).toBe(
      undefined,
    );
  });

  it('shows the releases since the seen version', () => {
    expect(whatsNewFrom(settings({ whatsNewSeen: '1.44.0' }), '1.46.0')).toBe(
      '1.44.0',
    );
  });

  it('shows the running version alone for an install from before the card (seen unset)', () => {
    expect(whatsNewFrom(dismissed(settings()), '1.46.0')).toBeNull();
  });
});

describe('seenAtBoot', () => {
  it('marks a fresh install as having seen its version, so it gets no card', () => {
    expect(seenAtBoot(settings(), '1.46.0')).toBe('1.46.0');
  });

  it('leaves installs past Get started and installs with a seen version alone', () => {
    expect(seenAtBoot(dismissed(settings()), '1.46.0')).toBeNull();
    expect(seenAtBoot(settings({ whatsNewSeen: '1.40.0' }), '1.46.0')).toBe(
      null,
    );
  });
});

describe('createWhatsNew', () => {
  const ok = (list: GitHubRelease[]) =>
    vi.fn(async () => new Response(JSON.stringify(list), { status: 200 }));

  it('fetches the releases once per launch and gives the card', async () => {
    const fetch = ok([
      rel('1.46.0', generated('Newest', 4)),
      rel('1.45.0', generated('Middle', 3)),
    ]);
    const s = settings({ whatsNewSeen: '1.44.0' });
    const w = createWhatsNew({ version: '1.46.0', settings: () => s, fetch });
    const card = await w.get();
    expect(card).toEqual({
      version: '1.46.0',
      url: 'https://github.com/UnreliableWitness/Shellie/releases',
      fetched: true,
      releases: [
        expect.objectContaining({ version: '1.46.0', items: ['Newest'] }),
        expect.objectContaining({ version: '1.45.0', items: ['Middle'] }),
      ],
    });
    await w.get();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(
      'https://api.github.com/repos/UnreliableWitness/Shellie/releases?per_page=30',
    );
  });

  it('links to the release itself when there is one', async () => {
    const fetch = ok([rel('1.46.0', generated('Newest', 4))]);
    const s = dismissed(settings());
    const w = createWhatsNew({ version: '1.46.0', settings: () => s, fetch });
    expect((await w.get())?.url).toBe(
      'https://github.com/UnreliableWitness/Shellie/releases/tag/v1.46.0',
    );
  });

  it('gives a card with only the GitHub link when the fetch fails', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 403 }));
    const s = settings({ whatsNewSeen: '1.44.0' });
    const w = createWhatsNew({ version: '1.46.0', settings: () => s, fetch });
    expect(await w.get()).toEqual({
      version: '1.46.0',
      url: 'https://github.com/UnreliableWitness/Shellie/releases/tag/v1.46.0',
      fetched: false,
      releases: [],
    });
  });

  it('gives null once the version is seen, without fetching', async () => {
    const fetch = ok([]);
    let s = settings({ whatsNewSeen: '1.44.0' });
    const w = createWhatsNew({ version: '1.46.0', settings: () => s, fetch });
    s = settings({ whatsNewSeen: '1.46.0' });
    expect(await w.get()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
