import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitClient } from '../services/GitClient';
import { fakeCrypto } from '../test-helpers/fakeCrypto';
import { commitFile, makeRepo } from '../test-helpers/gitRepo';
import { SecretStore } from './SecretStore';
import { cleanWorktree, computeStatus } from './status';

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

function folder() {
  return mkdtempSync(path.join(os.tmpdir(), 'shellie-wt-'));
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
    expect(st).toEqual({ state: 'empty', reasons: [], given: [] });
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
    expect(st.reasons).toEqual([{ kind: 'copy', files: ['.env'] }]);
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
