import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Found } from '../../shared/secrets';
import { GitClient } from '../services/GitClient';
import { fakeCrypto } from '../test-helpers/fakeCrypto';
import { commitFile, makeRepo } from '../test-helpers/gitRepo';
import { DiscoveryHold } from './discover';
import {
  buildImportPlan,
  importSecrets,
  importSources,
  type KeyedFound,
} from './importPlan';
import { DEFAULT_GIVEN_TO } from './inject';
import { SecretStore } from './SecretStore';

let n = 0;
const f = (over: Partial<Found> & { name: string; value: string }) =>
  ({
    env: 'development',
    source: '.env',
    tracked: false,
    secretLike: true,
    key: `k${++n}`,
    ...over,
  }) as KeyedFound;

describe('buildImportPlan', () => {
  it('marks a conflict when two sources give different values for one environment', () => {
    const [row] = buildImportPlan(
      [
        f({
          name: 'DB',
          value: 'uat-one',
          env: 'uat',
          source: 'launch profile Uat',
        }),
        f({
          name: 'DB',
          value: 'uat-two',
          env: 'uat',
          source: 'appsettings.Uat.json',
        }),
      ],
      [],
    );
    expect(row!.cells.uat.state).toBe('new');
    expect(row!.cells.uat.candidates.map((c) => c.source)).toEqual([
      'launch profile Uat',
      'appsettings.Uat.json',
    ]);
    expect(row!.cells.development.state).toBe('missing');
    expect(row!.cells.development.candidates).toEqual([]);
  });

  it('does not make a conflict of one value found in two sources', () => {
    const [row] = buildImportPlan(
      [
        f({ name: 'KEY', value: 'same-value', source: '.env' }),
        f({ name: 'KEY', value: 'same-value', source: '.env.local' }),
      ],
      [],
    );
    expect(row!.cells.development.candidates).toHaveLength(1);
    expect(row!.cells.development.candidates[0]!.source).toBe('.env');
  });

  it('compares with stored values: same, changed (with the old source) and new', () => {
    const rows = buildImportPlan(
      [
        f({ name: 'A', value: 'stored-a' }),
        f({ name: 'B', value: 'new-b', env: 'test' }),
        f({ name: 'C', value: 'fresh' }),
        f({ name: 'B', value: 'stored-b' }),
      ],
      [
        {
          name: 'A',
          values: { development: { value: 'stored-a', source: '.env' } },
        },
        {
          name: 'B',
          values: {
            development: { value: 'stored-b', source: '.env' },
            test: { value: 'old-b', source: 'user secrets' },
          },
        },
      ],
    );
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.A!.cells.development.state).toBe('same');
    expect(by.B!.cells.development.state).toBe('same');
    expect(by.B!.cells.test).toMatchObject({
      state: 'changed',
      was: 'user secrets',
    });
    expect(by.C!.cells.development.state).toBe('new');
    expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });

  it('keeps only the differing candidates of a changed cell, and an unreadable stored value counts as changed', () => {
    const [row] = buildImportPlan(
      [
        f({ name: 'K', value: 'stored' }),
        f({ name: 'K', value: 'other', source: '.env.local' }),
        f({ name: 'K', value: 'x', env: 'uat' }),
      ],
      [
        {
          name: 'K',
          values: {
            development: { value: 'stored', source: '.env' },
            uat: { value: null, source: null },
          },
        },
      ],
    );
    expect(row!.cells.development.state).toBe('changed');
    expect(row!.cells.development.candidates.map((c) => c.source)).toEqual([
      '.env.local',
    ]);
    expect(row!.cells.uat.state).toBe('changed');
  });

  it('puts values without an environment in the unassigned lane, dropping ones stored already', () => {
    const [row] = buildImportPlan(
      [
        f({
          name: 'API_KEY',
          value: 'staging',
          env: null,
          source: 'launch profile Staging2',
        }),
        f({ name: 'API_KEY', value: 'kept', env: null, source: 'x.env' }),
      ],
      [{ name: 'API_KEY', values: { uat: { value: 'kept', source: null } } }],
    );
    expect(row!.unassigned.map((c) => c.source)).toEqual([
      'launch profile Staging2',
    ]);
  });

  it('a row is secret-like when any of its values is, and carries masks, never values', () => {
    const rows = buildImportPlan(
      [
        f({ name: 'PORT', value: '5001', secretLike: false }),
        f({
          name: 'STRIPE',
          value: 'sk_live_abcdefghijkl0b3d',
          env: 'production',
          secretLike: false,
        }),
        f({ name: 'STRIPE', value: 'sk_test_abcdefghijkl91c2' }),
      ],
      [],
    );
    expect(rows.map((r) => [r.name, r.secretLike])).toEqual([
      ['PORT', false],
      ['STRIPE', true],
    ]);
    expect(rows[1]!.cells.production.candidates[0]!.mask).toBe(
      'sk_live_••••0b3d',
    );
    expect(JSON.stringify(rows)).not.toContain('abcdefghijkl');
  });
});

describe('importSources', () => {
  it('offers removal only for untracked .env-style files', () => {
    const sources = importSources([
      f({ name: 'A', value: '1', source: '.env' }),
      f({ name: 'A', value: '1', source: 'api/.env.local' }),
      f({ name: 'B', value: '1', source: '.env.uat', tracked: true }),
      f({ name: 'C', value: '1', source: 'appsettings.Development.json' }),
      f({ name: 'D', value: '1', source: 'user secrets' }),
      f({ name: 'E', value: '1', source: 'launch profile http' }),
      f({ name: 'F', value: '1', source: 'secrets/stripe.json' }),
    ]);
    expect(sources.filter((s) => s.removable).map((s) => s.path)).toEqual([
      '.env',
      'api/.env.local',
    ]);
    expect(sources.find((s) => s.path === '.env.uat')).toMatchObject({
      tracked: true,
      removable: false,
    });
  });
});

describe('importSecrets', () => {
  async function setup() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'shellie-import-'));
    const store = new SecretStore(path.join(dir, 'secrets.json'), fakeCrypto());
    await store.load();
    const repo = makeRepo('import');
    const hold = new DiscoveryHold();
    const found: Found[] = [
      {
        name: 'STRIPE_KEY',
        value: 'sk_test_value"with=odd#chars',
        env: 'development',
        source: '.env',
        tracked: false,
        secretLike: true,
      },
      {
        name: 'STRIPE_KEY',
        value: 'sk_live_prod',
        env: 'production',
        source: '.env.production',
        tracked: false,
        secretLike: true,
      },
      {
        name: 'PORT',
        value: '5001',
        env: 'development',
        source: '.env',
        tracked: false,
        secretLike: false,
      },
      {
        name: 'DB',
        value: 'Server=x',
        env: 'development',
        source: 'appsettings.Development.json',
        tracked: true,
        secretLike: true,
      },
    ];
    const view = hold.hold('r1', found);
    const key = (name: string, env: string) =>
      view.found.find((x) => x.name === name && x.env === env)!.key;
    return { dir, store, repo, hold, key, git: new GitClient() };
  }

  it('saves the picked values with the default given-to and drops the held discovery', async () => {
    const { store, repo, hold, key, git } = await setup();
    const k = key('STRIPE_KEY', 'development');
    const result = await importSecrets(
      {
        repoId: 'r1',
        picks: [
          { name: 'STRIPE_KEY', env: 'development', key: k },
          {
            name: 'STRIPE_KEY',
            env: 'production',
            key: key('STRIPE_KEY', 'production'),
          },
          // The "same as Development" link-up: Development's key for Test.
          { name: 'STRIPE_KEY', env: 'test', key: k },
        ],
        rewriteWorktreeCopies: false,
        removeFromMainCheckout: [],
      },
      { hold, store, git, repoPath: repo, worktrees: () => [] },
    );
    expect(result).toEqual({
      values: 3,
      worktreesRewritten: 0,
      filesChanged: [],
    });
    const [saved] = store.list({ repoId: 'r1' });
    expect(saved).toMatchObject({
      name: 'STRIPE_KEY',
      scope: { repoId: 'r1' },
      givenTo: DEFAULT_GIVEN_TO,
    });
    expect(saved!.values.production?.source).toBe('.env.production');
    expect(store.valuesFor('r1', 'development').STRIPE_KEY!.value).toBe(
      'sk_test_value"with=odd#chars',
    );
    expect(store.valuesFor('r1', 'test').STRIPE_KEY!.value).toBe(
      'sk_test_value"with=odd#chars',
    );
    expect(hold.resolve('r1', k)).toBeUndefined();
  });

  it('adds to a stored secret and keeps its given-to', async () => {
    const { store, repo, hold, key, git } = await setup();
    await store.save({
      scope: { repoId: 'r1' },
      name: 'STRIPE_KEY',
      givenTo: ['shell'],
      values: { uat: { value: 'uat-kept' } },
    });
    await importSecrets(
      {
        repoId: 'r1',
        picks: [
          {
            name: 'STRIPE_KEY',
            env: 'development',
            key: key('STRIPE_KEY', 'development'),
          },
        ],
        rewriteWorktreeCopies: false,
        removeFromMainCheckout: [],
      },
      { hold, store, git, repoPath: repo, worktrees: () => [] },
    );
    const all = store.list({ repoId: 'r1' });
    expect(all).toHaveLength(1);
    expect(all[0]!.givenTo).toEqual(['shell']);
    expect(store.valuesFor('r1', 'uat').STRIPE_KEY!.value).toBe('uat-kept');
  });

  it('refuses unknown keys, a key under another name and two picks for one cell, saving nothing', async () => {
    const { store, repo, hold, key, git } = await setup();
    const run = (picks: { name: string; env: 'development'; key: string }[]) =>
      importSecrets(
        {
          repoId: 'r1',
          picks,
          rewriteWorktreeCopies: false,
          removeFromMainCheckout: [],
        },
        { hold, store, git, repoPath: repo, worktrees: () => [] },
      );
    const k = key('STRIPE_KEY', 'development');
    await expect(
      run([{ name: 'STRIPE_KEY', env: 'development', key: 'nope' }]),
    ).rejects.toThrow(/look again/);
    await expect(
      run([{ name: 'OTHER', env: 'development', key: k }]),
    ).rejects.toThrow(/look again/);
    await expect(
      run([
        { name: 'STRIPE_KEY', env: 'development', key: k },
        { name: 'STRIPE_KEY', env: 'development', key: k },
      ]),
    ).rejects.toThrow();
    expect(store.list()).toEqual([]);
  });

  it('removes imported keys from untracked .env files only, keeping the rest', async () => {
    const { store, repo, hold, key, git } = await setup();
    writeFileSync(
      path.join(repo, '.env'),
      'STRIPE_KEY="sk_test_value\\"with=odd#chars"\nPORT=5001\n',
    );
    commitFile(repo, 'appsettings.Development.json', '{"DB":"Server=x"}');
    const pick = {
      name: 'STRIPE_KEY',
      env: 'development' as const,
      key: key('STRIPE_KEY', 'development'),
    };
    const req = {
      repoId: 'r1',
      picks: [pick],
      rewriteWorktreeCopies: false,
      removeFromMainCheckout: ['appsettings.Development.json'],
    };
    await expect(
      importSecrets(req, {
        hold,
        store,
        git,
        repoPath: repo,
        worktrees: () => [],
      }),
    ).rejects.toThrow(/\.env-style/);
    expect(store.list()).toEqual([]);
    const result = await importSecrets(
      { ...req, removeFromMainCheckout: ['.env'] },
      { hold, store, git, repoPath: repo, worktrees: () => [] },
    );
    expect(result.filesChanged).toEqual(['.env']);
    expect(readFileSync(path.join(repo, '.env'), 'utf8')).toBe('PORT=5001\n');
  });

  it('does not remove a key whose value in the file is not the one imported', async () => {
    const { store, repo, git } = await setup();
    const hold = new DiscoveryHold();
    const view = hold.hold('r1', [
      {
        name: 'K',
        value: 'from-env',
        env: 'development',
        source: '.env',
        tracked: false,
        secretLike: true,
      },
      {
        name: 'K',
        value: 'from-local',
        env: 'development',
        source: '.env.local',
        tracked: false,
        secretLike: true,
      },
    ]);
    writeFileSync(path.join(repo, '.env'), 'K=from-env\n');
    writeFileSync(path.join(repo, '.env.local'), 'K=from-local\n');
    const local = view.found.find((x) => x.source === '.env.local')!.key;
    await importSecrets(
      {
        repoId: 'r1',
        picks: [{ name: 'K', env: 'development', key: local }],
        rewriteWorktreeCopies: false,
        removeFromMainCheckout: ['.env', '.env.local'],
      },
      { hold, store, git, repoPath: repo, worktrees: () => [] },
    );
    expect(readFileSync(path.join(repo, '.env'), 'utf8')).toBe('K=from-env\n');
    expect(readFileSync(path.join(repo, '.env.local'), 'utf8')).toBe('');
  });

  it('rewrites copied files in open worktrees without the imported keys, never tracked ones', async () => {
    const { store, repo, hold, key, git } = await setup();
    const wt = mkdtempSync(path.join(os.tmpdir(), 'shellie-import-wt-'));
    writeFileSync(path.join(wt, '.env'), 'STRIPE_KEY=x\nPORT=1\n');
    mkdirSync(path.join(wt, 'conf'));
    writeFileSync(path.join(wt, 'conf', 'app.env'), 'STRIPE_KEY=y\n');
    commitFile(repo, 'tracked.env', 'STRIPE_KEY=z\n');
    writeFileSync(path.join(wt, 'tracked.env'), 'STRIPE_KEY=z\n');
    const result = await importSecrets(
      {
        repoId: 'r1',
        picks: [
          {
            name: 'STRIPE_KEY',
            env: 'development',
            key: key('STRIPE_KEY', 'development'),
          },
        ],
        rewriteWorktreeCopies: true,
        removeFromMainCheckout: [],
      },
      {
        hold,
        store,
        git,
        repoPath: repo,
        worktrees: () => [
          {
            worktreePath: wt,
            copy: ['.env', 'conf', 'tracked.env', 'missing.env'],
          },
        ],
      },
    );
    expect(result.worktreesRewritten).toBe(1);
    expect(readFileSync(path.join(wt, '.env'), 'utf8')).toBe('PORT=1\n');
    expect(readFileSync(path.join(wt, 'conf', 'app.env'), 'utf8')).toBe('');
    expect(readFileSync(path.join(wt, 'tracked.env'), 'utf8')).toBe(
      'STRIPE_KEY=z\n',
    );
    expect(existsSync(path.join(wt, 'missing.env'))).toBe(false);
  });
});
