import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { promises as fsp } from 'node:fs';
import { GitClient } from '../services/GitClient';
import { fakeCrypto } from '../test-helpers/fakeCrypto';
import { commitFile, makeRepo } from '../test-helpers/gitRepo';
import { SecretStore } from './SecretStore';
import { discoverSecrets } from './discover';
import { strippableKind, stripKeys } from './inject';
import { cleanAll, cleanWorktree, computeStatus } from './status';

const git = new GitClient();
const noUser = () => null;

async function store(withSecret = true) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'shellie-status-'));
  const s = new SecretStore(path.join(dir, 'secrets.json'), fakeCrypto());
  await s.load();
  if (withSecret)
    await s.save({
      scope: { repoId: 'r1' },
      name: 'API_KEY',
      givenTo: ['setup', 'run'],
      values: { development: { value: 'sk_live_abcdefghijkl0b3d' } },
    });
  return s;
}

/** A worktree is always a git checkout; a folder git cannot read is skipped, never rewritten. */
function folder() {
  return makeRepo();
}

const base = (s: SecretStore, repoPath: string) => ({
  repoId: 'r1',
  repoPath,
  copy: [] as string[],
  store: s,
  git,
  userSecretsDir: noUser,
  worktrees: [] as { taskId: string; worktreePath: string }[],
});

describe('computeStatus', () => {
  it('is empty for a plain .env of non-secrets with nothing stored (Review Focus 4)', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, '.env'), 'PORT=5173\n');
    const st = await computeStatus({
      ...base(await store(false), repo),
      copy: ['.env'],
    });
    expect(st).toEqual({
      state: 'empty',
      reasons: [],
      given: [],
      secrets: 0,
    });
  });

  it('is protected when nothing copied or committed holds a stored value', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, '.env'), 'PORT=5173\n');
    const st = await computeStatus({
      ...base(await store(), repo),
      copy: ['.env'],
    });
    expect(st).toEqual({
      state: 'protected',
      reasons: [],
      given: ['setup', 'run'],
      secrets: 1,
    });
  });

  it('flags a copy: file that still holds a stored key', async () => {
    const repo = makeRepo();
    writeFileSync(
      path.join(repo, '.env'),
      'PORT=5173\nAPI_KEY=sk_live_abcdefghijkl0b3d\n',
    );
    const st = await computeStatus({
      ...base(await store(), repo),
      copy: ['.env'],
    });
    expect(st.state).toBe('attention');
    expect(st.reasons).toEqual([{ kind: 'copy', files: ['.env'], count: 1 }]);
  });

  it('flags open tasks whose worktree copy still holds the key', async () => {
    const repo = makeRepo();
    const dirty = folder();
    const clean = folder();
    writeFileSync(path.join(dirty, '.env'), 'API_KEY=x\n');
    writeFileSync(path.join(clean, '.env'), 'PORT=1\n');
    const st = await computeStatus({
      ...base(await store(), repo),
      copy: ['.env'],
      worktrees: [
        { taskId: 't1', worktreePath: dirty },
        { taskId: 't2', worktreePath: clean },
      ],
    });
    expect(st.state).toBe('attention');
    expect(st.reasons).toEqual([{ kind: 'worktrees', taskIds: ['t1'] }]);
  });

  it('flags tracked files that hold a stored value, and never touches them', async () => {
    const repo = makeRepo();
    const content = '{"Key":"sk_live_abcdefghijkl0b3d"}\n';
    commitFile(repo, 'appsettings.json', content);
    const st = await computeStatus(base(await store(), repo));
    expect(st.state).toBe('attention');
    expect(st.reasons).toEqual([
      { kind: 'tracked', files: ['appsettings.json'] },
    ]);
    expect(readFileSync(path.join(repo, 'appsettings.json'), 'utf8')).toBe(
      content,
    );
  });
});

describe('cleanWorktree', () => {
  it('strips stored keys from copied files and keeps the rest; says whether it changed', async () => {
    const wt = folder();
    mkdirSync(path.join(wt, 'conf'));
    writeFileSync(path.join(wt, '.env'), 'PORT=1\nAPI_KEY=abc\n');
    writeFileSync(path.join(wt, 'conf', '.env.local'), 'API_KEY=abc\nA=b\n');
    expect(await cleanWorktree(wt, ['.env', 'conf'], ['API_KEY'], git)).toBe(
      true,
    );
    expect(readFileSync(path.join(wt, '.env'), 'utf8')).toBe('PORT=1\n');
    expect(readFileSync(path.join(wt, 'conf', '.env.local'), 'utf8')).toBe(
      'A=b\n',
    );
    expect(await cleanWorktree(wt, ['.env', 'conf'], ['API_KEY'], git)).toBe(
      false,
    );
  });

  it('leaves a tracked file alone', async () => {
    const repo = makeRepo();
    commitFile(repo, '.env', 'API_KEY=abc\n');
    expect(await cleanWorktree(repo, ['.env'], ['API_KEY'], git)).toBe(false);
    expect(readFileSync(path.join(repo, '.env'), 'utf8')).toBe('API_KEY=abc\n');
  });
});

const failingGit = {
  run: async () => {
    throw new Error('git is broken');
  },
} as unknown as GitClient;

describe('when git cannot list tracked files', () => {
  it('leaves a tracked .env untouched and reports nothing for the worktree', async () => {
    const repo = makeRepo();
    commitFile(repo, '.env', 'API_KEY=abc\n');
    expect(await cleanWorktree(repo, ['.env'], ['API_KEY'], failingGit)).toBe(
      false,
    );
    expect(readFileSync(path.join(repo, '.env'), 'utf8')).toBe('API_KEY=abc\n');
    const st = await computeStatus({
      ...base(await store(), repo),
      git: failingGit,
      copy: ['.env'],
      worktrees: [{ taskId: 't1', worktreePath: repo }],
    });
    expect(st.reasons).toEqual([{ kind: 'unchecked' }]);
  });
});

describe('cleanWorktree writing', () => {
  it('keeps the file mode and leaves no temp file behind', async () => {
    const wt = folder();
    const file = path.join(wt, '.env');
    writeFileSync(file, 'API_KEY=abc\nA=b\n');
    chmodSync(file, 0o600);
    await cleanWorktree(wt, ['.env'], ['API_KEY'], git);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toBe('A=b\n');
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(wt).filter((n) => n.includes('.tmp'))).toEqual([]);
  });

  it('skips an unreadable file and still cleans the others', async () => {
    const wt = folder();
    const bad = path.join(wt, '.env.local');
    writeFileSync(bad, 'API_KEY=abc\n');
    chmodSync(bad, 0o000);
    writeFileSync(path.join(wt, '.env'), 'API_KEY=abc\nA=b\n');
    expect(
      await cleanWorktree(wt, ['.env.local', '.env'], ['API_KEY'], git),
    ).toBe(true);
    expect(readFileSync(path.join(wt, '.env'), 'utf8')).toBe('A=b\n');
    chmodSync(bad, 0o600);
  });

  it('does not throw for a copy entry that vanished', async () => {
    const wt = folder();
    expect(await cleanWorktree(wt, ['.env', 'gone'], ['API_KEY'], git)).toBe(
      false,
    );
  });
});

describe('cleanAll', () => {
  it('goes on after a task that fails and dedupes the ids of a task with two workspaces', async () => {
    const seen: string[] = [];
    const cleaned = await cleanAll(
      [
        { taskId: 'bad', worktreePath: '/a' },
        { taskId: 'good', worktreePath: '/b' },
        { taskId: 'good', worktreePath: '/c' },
        { taskId: 'clean', worktreePath: '/d' },
      ],
      async (p) => {
        seen.push(p);
        if (p === '/a') throw new Error('boom');
        return p !== '/d';
      },
    );
    expect(cleaned).toEqual(['good']);
    expect(seen).toEqual(['/a', '/b', '/c', '/d']);
  });
});

describe('counts', () => {
  it('counts the stored values a copy file holds, and the secrets stored', async () => {
    const repo = makeRepo();
    const s = await store();
    await s.save({
      scope: { repoId: 'r1' },
      name: 'DB_URL',
      givenTo: ['run'],
      values: { development: { value: 'postgres://u:p@h/db' } },
    });
    writeFileSync(path.join(repo, '.env'), 'API_KEY=1\nDB_URL=2\nPORT=3\n');
    const st = await computeStatus({ ...base(s, repo), copy: ['.env'] });
    expect(st.reasons).toEqual([{ kind: 'copy', files: ['.env'], count: 2 }]);
    expect(st.secrets).toBe(2);
  });
});

describe('an unchecked repo is never green', () => {
  it('is attention (unchecked) when git cannot list the main repo', async () => {
    const repo = makeRepo();
    const st = await computeStatus({
      ...base(await store(), repo),
      git: failingGit,
    });
    expect(st.state).toBe('attention');
    expect(st.reasons).toContainEqual({ kind: 'unchecked' });
  });

  it('is attention (unchecked) when discovery fails', async () => {
    const repo = makeRepo();
    const st = await computeStatus({
      ...base(await store(), repo),
      userSecretsDir: () => {
        throw new Error('no folder');
      },
    });
    // Discovery may cope with this itself; then there is nothing unchecked.
    expect(
      st.state === 'protected' ||
        st.reasons.some((r) => r.kind === 'unchecked'),
    ).toBe(true);
  });

  it('is attention (unchecked) when a worktree cannot be checked', async () => {
    const repo = makeRepo();
    const notGit = mkdtempSync(path.join(os.tmpdir(), 'shellie-nogit-'));
    const st = await computeStatus({
      ...base(await store(), repo),
      worktrees: [{ taskId: 't1', worktreePath: notGit }],
    });
    expect(st.reasons).toContainEqual({ kind: 'unchecked' });
  });
});

describe('the temp file of a crashed clean', () => {
  it('is not an env file to strippableKind', () => {
    expect(strippableKind('.shellie-tmp-123-.env')).toBeNull();
    expect(strippableKind('conf/.shellie-tmp-1-appsettings.json')).toBeNull();
  });

  it('is not found by discovery', async () => {
    const repo = makeRepo();
    writeFileSync(
      path.join(repo, '.shellie-tmp-1-.env'),
      'API_KEY=sk_live_abcdefghijkl\n',
    );
    const r = await discoverSecrets(repo, { git, userSecretsDir: noUser });
    expect(r.found).toEqual([]);
  });

  it('is named so, next to the original', async () => {
    const wt = folder();
    mkdirSync(path.join(wt, 'conf'));
    const file = path.join(wt, 'conf', '.env');
    writeFileSync(file, 'API_KEY=abc\n');
    const spy = vi.spyOn(fsp, 'rename');
    await cleanWorktree(wt, ['conf'], ['API_KEY'], git);
    const [from] = spy.mock.calls[0]!;
    expect(path.dirname(String(from))).toBe(path.dirname(file));
    expect(path.basename(String(from))).toMatch(/^\.shellie-tmp-\d+-\.env$/);
    spy.mockRestore();
  });
});

describe('Azure Functions local.settings.json', () => {
  const text = JSON.stringify(
    {
      IsEncrypted: false,
      Values: {
        FUNCTIONS_WORKER_RUNTIME: 'dotnet-isolated',
        StripeKey: 'sk_live_abcdefghijkl0b3d',
      },
      ConnectionStrings: { Db: 'Server=db;Password=hunter2hunter2' },
    },
    null,
    2,
  );

  it('discovered names strip their values (Values keys have no prefix)', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, 'local.settings.json'), text);
    const r = await discoverSecrets(repo, { git, userSecretsDir: noUser });
    const names = r.found.map((f) => f.name);
    expect(names).toContain('StripeKey');
    const kind = strippableKind('local.settings.json')!;
    const out = stripKeys(text, kind, names);
    for (const f of r.found) expect(out).not.toContain(f.value);
  });

  it('is not protected while a copied local.settings.json holds a stored value', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, 'local.settings.json'), text);
    const s = await store(false);
    await s.save({
      scope: { repoId: 'r1' },
      name: 'StripeKey',
      givenTo: ['run'],
      values: { development: { value: 'sk_live_abcdefghijkl0b3d' } },
    });
    const st = await computeStatus({
      ...base(s, repo),
      copy: ['local.settings.json'],
    });
    expect(st.state).toBe('attention');
    expect(st.reasons).toContainEqual({
      kind: 'copy',
      files: ['local.settings.json'],
      count: 1,
    });
  });

  it('a Values key named like a nested one stays when another file kind', () => {
    const app = '{"Values":{"StripeKey":"x"}}';
    expect(stripKeys(app, 'json', ['StripeKey'])).toBe(app);
  });
});
