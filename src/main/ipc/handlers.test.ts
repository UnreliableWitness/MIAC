import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Events } from '../../shared/ipc';
import type { CreateTaskInput, SetupEvent, Task } from '../../shared/types';
import { darwinPlatform } from '../platform/darwin';
import { GitClient } from '../services/GitClient';
import { loadMiacConfig } from '../services/MiacConfig';
import { RepoRegistry } from '../services/RepoRegistry';
import { SetupRunner } from '../services/SetupRunner';
import { TaskStore } from '../services/TaskStore';
import { TerminalManager } from '../services/TerminalManager';
import { cleanupTempRepos, makeRepo } from '../test-helpers/gitRepo';
import {
  createHandlers,
  recoverInterruptedTasks,
  type Services,
} from './handlers';

type Finished = Extract<SetupEvent, { type: 'finished' }>;
type Broadcast = { event: keyof Events; payload: unknown };

const allTerminals: TerminalManager[] = [];
afterAll(() => {
  for (const t of allTerminals) for (const id of t.ids()) t.kill(id);
  cleanupTempRepos();
});

async function harness() {
  const store = new TaskStore(
    path.join(mkdtempSync(path.join(os.tmpdir(), 'miac-ipc-')), 'state.json'),
  );
  await store.load();
  const git = new GitClient();
  const platform = darwinPlatform({ SHELL: '/bin/sh' });
  const terminals = new TerminalManager();
  allTerminals.push(terminals);
  const broadcasts: Broadcast[] = [];
  const waiters: ((e: Events['setup']) => void)[] = [];
  const services: Services = {
    store,
    git,
    platform,
    terminals,
    repos: new RepoRegistry(store, git),
    runner: new SetupRunner(git, platform),
    loadConfig: loadMiacConfig,
    pickFolder: async () => '/picked',
    launch: async () => {},
    broadcast: (event, payload) => {
      broadcasts.push({ event, payload });
      if (event === 'setup')
        waiters.splice(0).forEach((w) => w(payload as Events['setup']));
    },
  };
  const h = createHandlers(services);
  const repo = makeRepo('webshop');
  writeFileSync(path.join(repo, '.env'), 'X=1');
  writeFileSync(path.join(repo, '.miac.yml'), 'copy: [.env]\n');
  const added = await h['repos:add'](repo);
  const setupDone = () =>
    new Promise<Finished>((resolve) => {
      const check = (e: Events['setup']) =>
        e.type === 'finished' ? resolve(e) : waiters.push(check);
      waiters.push(check);
    });
  const input = (over: Partial<CreateTaskInput> = {}): CreateTaskInput => ({
    repoId: added.id,
    baseRef: 'main',
    name: '',
    workItem: {
      id: '48231',
      type: 'User Story',
      title: 'Show estimated delivery date',
    },
    branch: 'feature/48231-show-estimated-delivery-date',
    copy: true,
    commands: ['echo ok > ok.txt'],
    startClaude: false,
    openShell: true,
    ...over,
  });
  return {
    h,
    store,
    terminals,
    broadcasts,
    repo,
    added,
    setupDone,
    input,
    services,
  };
}

describe('handlers: repos', () => {
  it('lists, picks and removes repos', async () => {
    const { h, added } = await harness();
    expect(await h['repos:list']()).toEqual([added]);
    expect(await h['repos:pickFolder']()).toBe('/picked');
    const cfg = await h['repos:config'](added.id);
    expect(cfg.worktreeRoot).toBe(`${added.path}.worktrees`);
    expect(cfg.config).toMatchObject({
      found: true,
      copy: ['.env'],
      setup: [],
    });
    await h['repos:remove'](added.id);
    expect(await h['repos:list']()).toEqual([]);
  });
});

describe('handlers: create task', () => {
  it('creates the task, runs setup, starts a shell and ends ready', async () => {
    const { h, terminals, setupDone, input, added, broadcasts } =
      await harness();
    const finished = setupDone();
    const task = await h['tasks:create'](input());
    expect(task.status).toBe('setting-up');
    expect(task.slug).toBe('48231-show-estimated-delivery-date');
    expect(task.worktreePath).toBe(
      path.join(
        `${added.path}.worktrees`,
        '48231-show-estimated-delivery-date',
      ),
    );
    expect((await finished).ok).toBe(true);
    const [view] = await h['tasks:list']();
    expect(view.status).toBe('ready');
    expect(view.worktreeMissing).toBe(false);
    expect(view.terminals).toHaveLength(1);
    expect(view.terminals[0].kind).toBe('shell');
    expect(terminals.runningCount(task.id)).toBe(1);
    expect(existsSync(path.join(task.worktreePath, '.env'))).toBe(true);
    expect(existsSync(path.join(task.worktreePath, 'ok.txt'))).toBe(true);
    const state = await h['tasks:setupState'](task.id);
    expect(state?.finished).toBe(true);
    expect(state?.steps.map((s) => s.status)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
      'done',
    ]);
    expect(broadcasts.some((b) => b.event === 'tasks:changed')).toBe(true);
    terminals.killAllForTask(task.id);
  });

  it('rejects an invalid branch name', async () => {
    const { h, input } = await harness();
    await expect(
      h['tasks:create'](input({ branch: 'feature/bad name' })),
    ).rejects.toThrow(/not a valid branch name/);
  });

  it('rejects an existing branch and an existing worktree folder', async () => {
    const { h, input, setupDone, terminals } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input());
    await done;
    terminals.killAllForTask(t.id);
    await expect(
      h['tasks:create'](
        input({ workItem: { id: '1', type: 'Bug', title: 'other' } }),
      ),
    ).rejects.toThrow(/already exists/);
    await expect(
      h['tasks:create'](input({ branch: 'feature/other' })),
    ).rejects.toThrow(/already exists/);
  });

  it('marks the task setup-failed when a command fails, then retries from that step', async () => {
    const { h, input, setupDone, terminals, store } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ commands: ['exit 7'] }));
    expect((await done).ok).toBe(false);
    expect(store.state.tasks[0].status).toBe('setup-failed');
    const state = await h['tasks:setupState'](t.id);
    expect(state?.failedStep).toBe(4);
    writeFileSync(path.join(t.worktreePath, 'fix.txt'), 'fixed');
    await store.update((s) => {
      s.tasks[0].setup.commands = ['cat fix.txt'];
    });
    const retry = setupDone();
    await h['tasks:retrySetup'](t.id);
    expect((await retry).ok).toBe(true);
    expect(store.state.tasks[0].status).toBe('ready');
    terminals.killAllForTask(t.id);
  });

  it('cancels a failed setup: removes worktree, branch and task', async () => {
    const { h, input, setupDone, store, repo } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](
      input({ commands: ['exit 1'], openShell: false }),
    );
    await done;
    await h['tasks:cancelSetup'](t.id);
    expect(store.state.tasks).toHaveLength(0);
    expect(existsSync(t.worktreePath)).toBe(false);
    expect(await new GitClient().branchExists(repo, t.branch)).toBe(false);
  });
});

describe('handlers: missing worktree folder', () => {
  it('cancelSetup succeeds on a setup-failed task whose folder was deleted', async () => {
    const { h, input, setupDone, store, repo } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](
      input({ commands: ['exit 1'], openShell: false }),
    );
    await done;
    rmSync(t.worktreePath, { recursive: true, force: true });
    await h['tasks:cancelSetup'](t.id);
    expect(store.state.tasks).toHaveLength(0);
    expect(await new GitClient().branchExists(repo, t.branch)).toBe(false);
  });

  it('finish cleans up a task whose folder was deleted', async () => {
    const { h, input, setupDone, terminals, repo } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ openShell: false }));
    await done;
    rmSync(t.worktreePath, { recursive: true, force: true });
    await h['tasks:finish'](t.id, {
      closeTerminals: true,
      removeWorktree: true,
      deleteBranch: true,
    });
    const [view] = await h['tasks:list']();
    expect(view.status).toBe('done');
    expect(await new GitClient().branchExists(repo, t.branch)).toBe(false);
    terminals.killAllForTask(t.id);
  });
});

describe('handlers: finish', () => {
  it('reports checks, then removes worktree and branch and marks done', async () => {
    const { h, input, setupDone, terminals, repo } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input());
    await done;
    const checks = await h['tasks:finishChecks'](t.id);
    expect(checks.uncommitted).toEqual([
      { status: '?', path: '.env' },
      { status: '?', path: 'ok.txt' },
    ]);
    expect(checks.unpushed).toBe(0);
    expect(checks.runningTerminals).toBe(1);
    await h['tasks:finish'](t.id, {
      closeTerminals: true,
      removeWorktree: true,
      deleteBranch: true,
    });
    const [view] = await h['tasks:list']();
    expect(view.status).toBe('done');
    expect(view.finishedAt).not.toBeNull();
    expect(view.terminals).toEqual([]);
    expect(terminals.runningCount(t.id)).toBe(0);
    expect(existsSync(t.worktreePath)).toBe(false);
    expect(await new GitClient().branchExists(repo, t.branch)).toBe(false);
  });

  it('keeps the task ready when cleanup fails', async () => {
    const { h, input, setupDone, store, terminals, services } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ openShell: false }));
    await done;
    services.git.deleteBranch = async () => {
      throw new Error('boom');
    };
    await expect(
      h['tasks:finish'](t.id, {
        closeTerminals: true,
        removeWorktree: false,
        deleteBranch: true,
      }),
    ).rejects.toThrow(/boom/);
    expect(store.state.tasks[0].status).toBe('ready');
    terminals.killAllForTask(t.id);
  });
});

describe('handlers: concurrency guards', () => {
  const finishedCount = (b: { event: string; payload: unknown }[]) =>
    b.filter(
      (x) =>
        x.event === 'setup' &&
        (x.payload as { type: string }).type === 'finished',
    ).length;

  it('retrySetup twice at once runs setup once', async () => {
    const { h, input, setupDone, broadcasts } = await harness();
    const first = setupDone();
    const t = await h['tasks:create'](
      input({ commands: ['exit 7'], openShell: false }),
    );
    await first;
    expect(finishedCount(broadcasts)).toBe(1);
    const retry = setupDone();
    const results = await Promise.allSettled([
      h['tasks:retrySetup'](t.id),
      h['tasks:retrySetup'](t.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/busy|already/);
    await retry;
    await new Promise((r) => setTimeout(r, 200));
    expect(finishedCount(broadcasts)).toBe(2);
  });

  it('finish is rejected while setup runs', async () => {
    const { h, input, setupDone, terminals } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ commands: ['sleep 1'] }));
    await expect(
      h['tasks:finish'](t.id, {
        closeTerminals: true,
        removeWorktree: true,
        deleteBranch: true,
      }),
    ).rejects.toThrow(/setting-up/);
    await done;
    terminals.killAllForTask(t.id);
  });

  it('cancelSetup is rejected on a ready task', async () => {
    const { h, input, setupDone, terminals } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ openShell: false }));
    await done;
    await expect(h['tasks:cancelSetup'](t.id)).rejects.toThrow(/ready/);
    terminals.killAllForTask(t.id);
  });

  it('two concurrent creates for the same branch: one is rejected', async () => {
    const { h, input, setupDone, terminals } = await harness();
    const done = setupDone();
    const results = await Promise.allSettled([
      h['tasks:create'](input({ openShell: false })),
      h['tasks:create'](input({ openShell: false })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/already being created/);
    await done;
    for (const id of terminals.ids()) terminals.kill(id);
  });

  it('two concurrent terminals:open calls keep both terminals', async () => {
    const { h, input, setupDone, terminals, store } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ openShell: false }));
    await done;
    const [a, b] = await Promise.all([
      h['terminals:open'](t.id, { kind: 'shell', label: 'a' }),
      h['terminals:open'](t.id, { kind: 'shell', label: 'b' }),
    ]);
    const ids = store.state.tasks[0].terminals.map((x) => x.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    terminals.killAllForTask(t.id);
  });
});

describe('handlers: terminals', () => {
  it('opens a run terminal, exposes its buffer, restarts and kills it', async () => {
    const { h, input, setupDone, terminals, store } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ openShell: false }));
    await done;
    const def = await h['terminals:open'](t.id, {
      kind: 'run',
      label: 'dev',
      command: 'echo dev-server-up; sleep 30',
    });
    expect(store.state.tasks[0].terminals.map((x) => x.id)).toContain(def.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(await h['terminals:buffer'](def.id)).toContain('dev-server-up');
    expect(await h['terminals:isRunning'](def.id)).toBe(true);
    await h['terminals:restart'](def.id);
    expect(await h['terminals:isRunning'](def.id)).toBe(true);
    await h['terminals:kill'](def.id);
    expect(store.state.tasks[0].terminals.map((x) => x.id)).not.toContain(
      def.id,
    );
    expect(terminals.runningCount(t.id)).toBe(0);
  });
});

describe('handlers: after a relaunch', () => {
  it('restarts a persisted terminal that the new TerminalManager does not know', async () => {
    const { h, input, setupDone, terminals, store, services } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input());
    await done;
    const shellId = store.state.tasks[0].terminals[0].id;
    terminals.killAllForTask(t.id);
    const fresh = new TerminalManager();
    allTerminals.push(fresh);
    const h2 = createHandlers({ ...services, terminals: fresh });
    expect(fresh.runningCount(t.id)).toBe(0);
    await h2['terminals:restart'](shellId);
    expect(fresh.runningCount(t.id)).toBe(1);
    expect(typeof (await h2['terminals:buffer'](shellId))).toBe('string');
    await expect(h2['terminals:restart']('nope')).rejects.toThrow();
  });
});

describe('recoverInterruptedTasks', () => {
  it('turns setting-up into setup-failed and finishing into ready', async () => {
    const store = new TaskStore(
      path.join(mkdtempSync(path.join(os.tmpdir(), 'miac-rec-')), 'state.json'),
    );
    await store.load();
    const base: Omit<Task, 'id' | 'branch' | 'status'> = {
      repoId: 'r',
      name: 'x',
      workItem: null,
      slug: 'x',
      worktreePath: '/w',
      baseRef: 'main',
      setup: {
        copy: false,
        commands: [],
        startClaude: false,
        openShell: false,
      },
      terminals: [],
      createdAt: 'now',
      finishedAt: null,
    };
    await store.update((s) => {
      s.tasks.push(
        { ...base, id: 'a', branch: 'a', status: 'setting-up' },
        { ...base, id: 'b', branch: 'b', status: 'finishing' },
        { ...base, id: 'c', branch: 'c', status: 'ready' },
      );
    });
    expect(await recoverInterruptedTasks(store)).toBe(2);
    expect(store.state.tasks.map((t) => t.status)).toEqual([
      'setup-failed',
      'ready',
      'ready',
    ]);
  });
});
