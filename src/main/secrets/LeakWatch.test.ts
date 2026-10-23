import { describe, expect, it, vi } from 'vitest';
import type { Environment, LeakState } from '../../shared/secrets';
import { LeakWatch } from './LeakWatch';

type V = { name: string; value: string; env: Environment };
const DEV = {
  name: 'STRIPE_SECRET_KEY',
  value: 'sk_test_51HxAbCdEf',
  env: 'development',
} as const;
const PROD = {
  name: 'DB_PASSWORD',
  value: 'prod-db-password-9f2c',
  env: 'production',
} as const;
const TRACKED = {
  name: 'APP_KEY',
  value: 'tracked-in-git-0001',
  env: 'development',
} as const;

function setup(o: { values?: V[]; tracked?: Record<string, string[]> } = {}) {
  const values = vi.fn(
    (_repoIds: string[]): V[] => o.values ?? [DEV, PROD, TRACKED],
  );
  const tracked = vi.fn(
    async (repoId: string) => new Set(o.tracked?.[repoId] ?? []),
  );
  const leaks: ({ id: string } & LeakState)[] = [];
  const detected: [Environment, boolean][] = [];
  let repos = ['repo-1'];
  const watch = new LeakWatch({
    values,
    tracked,
    repoIdsOf: () => repos,
    onLeak: (id, state) => leaks.push({ id, ...state }),
    detected: (env, paused) => detected.push([env, paused]),
  });
  const show = (id: string, data: string) =>
    watch.filter({ id, taskId: 'task' }, data, '', true).text;
  return {
    watch,
    values,
    tracked,
    leaks,
    detected,
    show,
    setRepos: (r: string[]) => (repos = r),
  };
}

describe('LeakWatch', () => {
  it('masks agent output, raises one notice per name per tab, and pauses on a Production value', async () => {
    const { watch, leaks, show } = setup();
    await watch.prepare('task');
    expect(show('t1', `key ${DEV.value}`)).toBe('key [STRIPE_SECRET_KEY]');
    expect(show('t1', `again ${DEV.value}`)).toBe('again [STRIPE_SECRET_KEY]');
    expect(leaks).toEqual([
      { id: 't1', names: ['STRIPE_SECRET_KEY'], paused: false },
    ]);
    expect(watch.isPaused('t1')).toBe(false);
    expect(show('t1', PROD.value)).toBe('[DB_PASSWORD]');
    expect(watch.isPaused('t1')).toBe(true);
    expect(leaks.at(-1)).toEqual({
      id: 't1',
      names: ['STRIPE_SECRET_KEY', 'DB_PASSWORD'],
      paused: true,
    });
    expect(watch.state('t1')).toEqual({
      names: ['STRIPE_SECRET_KEY', 'DB_PASSWORD'],
      paused: true,
    });
    watch.resume('t1');
    expect(watch.isPaused('t1')).toBe(false);
    expect(leaks.at(-1)).toEqual({
      id: 't1',
      names: ['STRIPE_SECRET_KEY', 'DB_PASSWORD'],
      paused: false,
    });
    expect(watch.state('t2')).toBeNull();
    watch.forget('t1');
    expect(watch.state('t1')).toBeNull();
    // The view clears its notice.
    expect(leaks.at(-1)).toEqual({ id: 't1', names: [], paused: false });
    const n = leaks.length;
    watch.forget('t1');
    expect(leaks).toHaveLength(n);
    // Nothing the renderer gets carries a value.
    expect(JSON.stringify(leaks)).not.toMatch(/sk_test|prod-db/);
  });

  it('reports each new name per tab once, with its environment and whether it paused the tab, never for tracked values', async () => {
    const { watch, detected, show } = setup({
      tracked: { 'repo-1': [TRACKED.value] },
    });
    await watch.prepare('task');
    show('t1', `${DEV.value} ${DEV.value} ${TRACKED.value}`);
    show('t1', DEV.value);
    show('t1', PROD.value);
    show('t1', PROD.value);
    show('t2', DEV.value);
    expect(detected).toEqual([
      ['development', false],
      ['production', true],
      ['development', false],
    ]);
  });

  it('masks values that are in a tracked file of the repo but raises nothing for them', async () => {
    const { watch, leaks, show, tracked } = setup({
      tracked: { 'repo-1': [TRACKED.value] },
    });
    await watch.prepare('task');
    expect(tracked).toHaveBeenCalledWith('repo-1');
    expect(show('t1', `cat appsettings: ${TRACKED.value}`)).toBe(
      'cat appsettings: [APP_KEY]',
    );
    expect(leaks).toEqual([]);
    expect(watch.state('t1')).toBeNull();
  });

  it('builds the matcher once per task and again after secrets change or the repos change', async () => {
    const { watch, values, tracked, show, setRepos } = setup();
    await watch.prepare('task');
    const before = values.mock.calls.length;
    show('t1', 'a');
    show('t2', 'b');
    expect(values).toHaveBeenCalledTimes(before + 1);
    watch.invalidate();
    show('t1', 'c');
    expect(values).toHaveBeenCalledTimes(before + 2);
    setRepos(['repo-1', 'repo-2']);
    show('t1', 'd');
    expect(values).toHaveBeenLastCalledWith(['repo-1', 'repo-2']);
    await vi.waitFor(() => expect(tracked).toHaveBeenCalledWith('repo-2'));
  });

  it("drops a finished task's matcher", async () => {
    const { watch, values, show } = setup();
    await watch.prepare('task');
    show('t1', 'a');
    const before = values.mock.calls.length;
    watch.dropTask('task');
    show('t1', 'b');
    expect(values).toHaveBeenCalledTimes(before + 1);
  });

  it('with nothing stored passes output through and never looks for tracked files', async () => {
    const { watch, tracked, show } = setup({ values: [] });
    await watch.prepare('task');
    expect(show('t1', 'hello')).toBe('hello');
    expect(
      watch.filter({ id: 't1', taskId: 'task' }, 'sk_', '', false),
    ).toEqual({
      text: 'sk_',
      carry: '',
    });
    expect(tracked).not.toHaveBeenCalled();
  });
});
