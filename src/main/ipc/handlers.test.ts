import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Events } from '../../shared/ipc';
import type { CreateTaskInput, SetupEvent, Task } from '../../shared/types';
import { AdoRegistry } from '../services/AdoRegistry';
import { ConnectionStore, type TokenCrypto } from '../services/ConnectionStore';
import { fakeCrypto } from '../test-helpers/fakeCrypto';
import { startAdoServer, type AdoServer } from '../test-helpers/adoServer';
import { OFFICIAL_RATES } from '../pricing/officialRates';
import { SettingsStore } from '../usage/SettingsStore';
import { UsageStore } from '../usage/UsageStore';
import { GitClient } from '../services/GitClient';
import { loadMiacConfig } from '../services/MiacConfig';
import { RepoRegistry } from '../services/RepoRegistry';
import { SetupRunner } from '../services/SetupRunner';
import { TaskStore } from '../services/TaskStore';
import { TerminalManager } from '../services/TerminalManager';
import { cleanupTempRepos, makeRepo } from '../test-helpers/gitRepo';
import {
  echoCmd,
  envRef,
  isWindows,
  sleepCmd,
  testPlatform,
  writeLineCmd,
} from '../test-helpers/shell';
import {
  createHandlers,
  pruneDanglingConnectionLinks,
  recoverInterruptedTasks,
  type Services,
} from './handlers';

type Finished = Extract<SetupEvent, { type: 'finished' }>;
type Broadcast = { event: keyof Events; payload: unknown };

const allTerminals: TerminalManager[] = [];
const servers: AdoServer[] = [];
const connDirs: string[] = [];
afterAll(async () => {
  await Promise.all(servers.map((v) => v.close()));
  await Promise.all(
    allTerminals.flatMap((t) => t.ids().map((id) => t.kill(id))),
  );
  for (const d of connDirs) rmSync(d, { recursive: true, force: true });
  cleanupTempRepos();
});

async function harness(
  crypto: TokenCrypto = fakeCrypto(),
  over: Partial<Services> = {},
) {
  const store = new TaskStore(
    path.join(mkdtempSync(path.join(os.tmpdir(), 'miac-ipc-')), 'state.json'),
  );
  await store.load();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'miac-conn-'));
  connDirs.push(dir);
  const connections = new ConnectionStore(
    path.join(dir, 'connections.json'),
    crypto,
    { allowLoopbackHttp: true },
  );
  await connections.load();
  const server = await startAdoServer();
  servers.push(server);
  const opened: string[] = [];
  const git = new GitClient();
  const platform = testPlatform();
  const terminals = new TerminalManager();
  allTerminals.push(terminals);
  const usageDir = mkdtempSync(path.join(os.tmpdir(), 'miac-usage-'));
  connDirs.push(usageDir);
  const settings = new SettingsStore(path.join(usageDir, 'settings.json'));
  await settings.load();
  const usage = new UsageStore(usageDir, () => OFFICIAL_RATES);
  await usage.load();
  const receiverStarts: number[] = [];
  let receiverStatus = {
    listening: true,
    port: 4319,
    error: null as string | null,
  };
  const receiver = {
    get status() {
      return receiverStatus;
    },
    start: async (port: number) => {
      receiverStarts.push(port);
      receiverStatus =
        port === 1999
          ? {
              listening: false,
              port,
              error: `Port ${port} is in use by another program`,
            }
          : { listening: true, port, error: null };
      return receiverStatus;
    },
  };
  const hourly: (() => void)[] = [];
  const broadcasts: Broadcast[] = [];
  const waiters: ((e: Events['setup']) => void)[] = [];
  const services: Services = {
    store,
    git,
    platform,
    terminals,
    repos: new RepoRegistry(store, git),
    connections,
    ado: new AdoRegistry(connections),
    openExternal: async (url) => {
      opened.push(url);
    },
    runner: new SetupRunner(git, platform),
    loadConfig: loadMiacConfig,
    pickFolder: async () => '/picked',
    launch: async () => {},
    usage,
    settings,
    receiver,
    copilot: { stats: { records: 0, unreadable: 0 }, poll: async () => {} },
    usageDir,
    onHourly: (fn) => {
      hourly.push(fn);
    },
    finishFlushMs: 0,
    appVersion: '9.9.9',
    ...over,
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
      url: null,
    },
    branch: 'feature/48231-show-estimated-delivery-date',
    copy: true,
    commands: [writeLineCmd('ok', 'ok.txt')],
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
    server,
    connections,
    opened,
    usage,
    settings,
    receiverStarts,
    hourly,
    usageDir,
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
        input({
          workItem: { id: '1', type: 'Bug', title: 'other', url: null },
        }),
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
      syncUsage: false,
    });
    const [view] = await h['tasks:list']();
    expect(view.status).toBe('done');
    expect(await new GitClient().branchExists(repo, t.branch)).toBe(false);
    terminals.killAllForTask(t.id);
  });
});

describe('handlers: finish', () => {
  it('finish waits for the terminals to exit before removing the worktree', async () => {
    const { h, input, setupDone, terminals, services } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input());
    await done;
    const order: string[] = [];
    const realKill = terminals.killAllForTask.bind(terminals);
    vi.spyOn(terminals, 'killAllForTask').mockImplementation(async (id) => {
      await realKill(id);
      await new Promise((r) => setTimeout(r, 50));
      order.push('terminals exited');
    });
    const realRemove = services.git.worktreeRemove.bind(services.git);
    vi.spyOn(services.git, 'worktreeRemove').mockImplementation(
      async (...a) => {
        order.push('remove');
        return realRemove(...a);
      },
    );
    await h['tasks:finish'](t.id, {
      closeTerminals: true,
      removeWorktree: true,
      deleteBranch: true,
      syncUsage: false,
    });
    expect(order).toEqual(['terminals exited', 'remove']);
  });

  it('removing the worktree closes the terminals first, even when Close terminals is unticked', async () => {
    const { h, input, setupDone, terminals, services, store } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input());
    await done;
    expect(terminals.runningCount(t.id)).toBe(1);
    const order: string[] = [];
    const realKill = terminals.killAllForTask.bind(terminals);
    vi.spyOn(terminals, 'killAllForTask').mockImplementation(async (id) => {
      await realKill(id);
      await new Promise((r) => setTimeout(r, 50));
      order.push('terminals exited');
    });
    const realRemove = services.git.worktreeRemove.bind(services.git);
    vi.spyOn(services.git, 'worktreeRemove').mockImplementation(
      async (...a) => {
        order.push('remove');
        return realRemove(...a);
      },
    );
    await h['tasks:finish'](t.id, {
      closeTerminals: false,
      removeWorktree: true,
      deleteBranch: true,
      syncUsage: false,
    });
    expect(order).toEqual(['terminals exited', 'remove']);
    expect(terminals.runningCount(t.id)).toBe(0);
    expect(store.state.tasks[0].terminals).toEqual([]);
    expect(existsSync(t.worktreePath)).toBe(false);
  });

  it('keeps the terminals when neither Close terminals nor Remove worktree is ticked', async () => {
    const { h, input, setupDone, terminals } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input());
    await done;
    await h['tasks:finish'](t.id, {
      closeTerminals: false,
      removeWorktree: false,
      deleteBranch: false,
      syncUsage: false,
    });
    expect(terminals.runningCount(t.id)).toBe(1);
    await terminals.killAllForTask(t.id);
  });

  it('cancelSetup waits for the terminals to exit before removing the worktree', async () => {
    const { h, input, setupDone, terminals, services } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ commands: ['exit 1'] }));
    await done;
    const order: string[] = [];
    vi.spyOn(terminals, 'killAllForTask').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push('terminals exited');
    });
    const realRemove = services.git.worktreeRemove.bind(services.git);
    vi.spyOn(services.git, 'worktreeRemove').mockImplementation(
      async (...a) => {
        order.push('remove');
        return realRemove(...a);
      },
    );
    await h['tasks:cancelSetup'](t.id);
    expect(order).toEqual(['terminals exited', 'remove']);
  });

  it('finish does not delete an unticked worktree folder', async () => {
    const { h, input, setupDone, store, terminals, repo } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ openShell: false }));
    await done;
    await expect(
      h['tasks:finish'](t.id, {
        closeTerminals: true,
        removeWorktree: false,
        deleteBranch: true,
        syncUsage: false,
      }),
    ).rejects.toThrow();
    expect(existsSync(t.worktreePath)).toBe(true);
    expect(await new GitClient().branchExists(repo, t.branch)).toBe(true);
    expect(store.state.tasks[0].status).toBe('ready');
    terminals.killAllForTask(t.id);
  });

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
      syncUsage: false,
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
        syncUsage: false,
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
    const t = await h['tasks:create'](input({ commands: [sleepCmd(1)] }));
    await expect(
      h['tasks:finish'](t.id, {
        closeTerminals: true,
        removeWorktree: true,
        deleteBranch: true,
        syncUsage: false,
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
      command: `${echoCmd('dev-server-up')}; ${sleepCmd(30)}`,
    });
    expect(store.state.tasks[0].terminals.map((x) => x.id)).toContain(def.id);
    await vi.waitFor(
      async () =>
        expect(await h['terminals:buffer'](def.id)).toContain('dev-server-up'),
      { timeout: 10_000 },
    );
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

describe('handlers: run terminal command', () => {
  it('starts a run terminal with runCommand, not the setup wrapper', async () => {
    const base = testPlatform();
    const ran: string[] = [];
    const platform = {
      ...base,
      runCommand: (cmd: string) => {
        ran.push(cmd);
        return base.runCommand(cmd);
      },
    };
    const hx = await harness(fakeCrypto(), { platform });
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](hx.input({ openShell: false }));
    await done;
    const command = `${echoCmd('via-run')}; ${sleepCmd(5)}`;
    const def = await hx.h['terminals:open'](t.id, {
      kind: 'run',
      label: 'dev',
      command,
    });
    expect(ran).toEqual([command]);
    await vi.waitFor(
      async () =>
        expect(await hx.h['terminals:buffer'](def.id)).toContain('via-run'),
      { timeout: 10_000 },
    );
    await hx.terminals.killAllForTask(t.id);
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
        openCopilot: false,
      },
      terminals: [],
      createdAt: 'now',
      finishedAt: null,
      usageSyncedAt: null,
      usageSyncError: null,
      usageCommentId: null,
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

function routeHealthyOrg(server: AdoServer, org = 'unreliablewitness') {
  server.route('GET', `/${org}/_apis/connectionData`, {
    body: { authenticatedUser: { providerDisplayName: 'Dries Hoebeke' } },
  });
  server.route('GET', `/${org}/_apis/projects/MIAC`, {
    body: { name: 'MIAC' },
  });
  server.route('GET', `/${org}/MIAC/_apis/work/teamsettings/iterations`, {
    body: {
      value: [
        {
          name: 'Sprint 1',
          path: 'MIAC\\Sprint 1',
          attributes: { timeFrame: 'current' },
        },
      ],
    },
  });
  server.route('POST', `/${org}/MIAC/_apis/wit/wiql`, {
    body: { workItems: [{ id: 5 }] },
  });
  server.route('GET', `/${org}/_apis/wit/workitems`, {
    body: {
      value: [
        {
          id: 5,
          fields: {
            'System.WorkItemType': 'Issue',
            'System.Title': 'Five',
            'System.State': 'To Do',
            'System.AreaPath': 'MIAC',
            'System.IterationPath': 'MIAC\\Sprint 1',
          },
        },
      ],
    },
  });
}

async function linkedTask(hx: Awaited<ReturnType<typeof harness>>) {
  routeHealthyOrg(hx.server);
  const c = await hx.h['connections:save']({
    organizationUrl: `${hx.server.url}/unreliablewitness`,
    project: 'MIAC',
    pat: 'secret-pat',
  });
  await hx.h['repos:setConnection'](hx.added.id, c.id);
  const done = hx.setupDone();
  const t = await hx.h['tasks:create'](hx.input({ openShell: false }));
  await done;
  await hx.usage.add({
    id: 'req-1',
    taskId: t.id,
    tool: 'claude-code',
    sessionId: 's1',
    model: 'claude-opus-5-5',
    at: '2026-10-14T10:00:00.000Z',
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    fast: false,
  });
  hx.server.route('GET', '/unreliablewitness/MIAC/_apis/wit/workitemtypes', {
    body: {
      value: [
        {
          name: 'User Story',
          fields: [
            { referenceName: 'Custom.AICost' },
            { referenceName: 'Custom.AICostClaude' },
            { referenceName: 'Custom.AICostCopilot' },
            { referenceName: 'Custom.AITokens' },
          ],
        },
      ],
    },
  });
  hx.server.route('PATCH', '/unreliablewitness/_apis/wit/workitems/48231', {
    body: { id: 48231 },
  });
  hx.server.route(
    'POST',
    '/unreliablewitness/MIAC/_apis/wit/workItems/48231/comments',
    { body: { id: 501 } },
  );
  return { t, c };
}

describe('handlers: connections', () => {
  it('saves after verifying, lists without the token, and broadcasts', async () => {
    const { h, server, broadcasts } = await harness();
    routeHealthyOrg(server);
    const c = await h['connections:save']({
      organizationUrl: `${server.url}/unreliablewitness`,
      project: 'MIAC',
      pat: 'secret-pat',
    });
    expect(c).toMatchObject({
      project: 'MIAC',
      status: 'ok',
      user: 'Dries Hoebeke',
    });
    expect(JSON.stringify(await h['connections:list']())).not.toContain(
      'secret-pat',
    );
    expect(broadcasts.some((b) => b.event === 'connections:changed')).toBe(
      true,
    );
  });
  it('does not save when verification fails', async () => {
    const { h, server } = await harness();
    server.route('GET', '/unreliablewitness/_apis/connectionData', {
      status: 401,
      body: {},
    });
    await expect(
      h['connections:save']({
        organizationUrl: `${server.url}/unreliablewitness`,
        project: 'MIAC',
        pat: 'bad',
      }),
    ).rejects.toThrow(/rejected the token/);
    expect(await h['connections:list']()).toEqual([]);
  });
  it('verify flips status to unauthorized on 401 and back to ok', async () => {
    const { h, server } = await harness();
    routeHealthyOrg(server);
    const c = await h['connections:save']({
      organizationUrl: `${server.url}/unreliablewitness`,
      project: 'MIAC',
      pat: 'p',
    });
    server.route('GET', '/unreliablewitness/_apis/connectionData', {
      status: 401,
      body: {},
    });
    await expect(h['connections:verify'](c.id)).rejects.toThrow();
    expect((await h['connections:list']())[0].status).toBe('unauthorized');
    routeHealthyOrg(server);
    expect((await h['connections:verify'](c.id)).status).toBe('ok');
  });
  it('removing a connection unlinks its repos', async () => {
    const { h, server, added } = await harness();
    routeHealthyOrg(server);
    const c = await h['connections:save']({
      organizationUrl: `${server.url}/unreliablewitness`,
      project: 'MIAC',
      pat: 'p',
    });
    expect((await h['repos:setConnection'](added.id, c.id)).connectionId).toBe(
      c.id,
    );
    await h['connections:remove'](c.id);
    expect((await h['repos:list']())[0].connectionId).toBeNull();
    await expect(h['repos:setConnection'](added.id, 'ghost')).rejects.toThrow(
      /Unknown connection/,
    );
  });
});

describe('handlers: connection robustness', () => {
  it('validates before any network call', async () => {
    const { h, server } = await harness();
    await expect(
      h['connections:save']({
        organizationUrl: `${server.url}/unreliablewitness`,
        project: ' ',
        pat: 'secret',
      }),
    ).rejects.toThrow(/project/);
    expect(server.requests).toHaveLength(0);
  });
  it('keeps the original error when the connection disappears mid-call', async () => {
    const { h, server, connections } = await harness();
    routeHealthyOrg(server);
    const c = await h['connections:save']({
      organizationUrl: `${server.url}/unreliablewitness`,
      project: 'MIAC',
      pat: 'p',
    });
    server.route('POST', '/unreliablewitness/MIAC/_apis/wit/wiql', () => {
      void connections.remove(c.id);
      return { status: 401, body: {} };
    });
    await expect(
      h['workItems:search'](c.id, { scope: 'mine', text: '' }),
    ).rejects.toThrow(/rejected the token/);
  });
  it('an undecryptable stored token flips the status without a network call', async () => {
    let broken = false;
    const base = fakeCrypto();
    const { h, server, connections } = await harness({
      ...base,
      decrypt: (b) => {
        if (broken) throw new Error('decrypt failed');
        return base.decrypt(b);
      },
    });
    const c = await connections.save({
      organizationUrl: `${server.url}/unreliablewitness`,
      project: 'MIAC',
      pat: 'p',
    });
    broken = true;
    await expect(
      h['workItems:search'](c.id, { scope: 'mine', text: '' }),
    ).rejects.toThrow(/could not be decrypted/);
    expect((await h['connections:list']())[0].status).toBe('unauthorized');
    expect(server.requests).toHaveLength(0);
  });
});

describe('handlers: work items', () => {
  it('returns the current iteration and search results through the connection', async () => {
    const { h, server } = await harness();
    routeHealthyOrg(server);
    const c = await h['connections:save']({
      organizationUrl: `${server.url}/unreliablewitness`,
      project: 'MIAC',
      pat: 'p',
    });
    expect(await h['workItems:currentIteration'](c.id)).toEqual({
      path: 'MIAC\\Sprint 1',
      name: 'Sprint 1',
    });
    const items = await h['workItems:search'](c.id, {
      scope: 'sprint',
      text: '',
    });
    expect(items.map((i) => i.id)).toEqual(['5']);
    const wiql = server.requests.find((r) => r.method === 'POST');
    expect(JSON.parse(wiql!.body).query).toContain(
      "[System.IterationPath] = 'MIAC\\Sprint 1'",
    );
  });
  it('a 401 during search marks the connection unauthorized and broadcasts', async () => {
    const { h, server, broadcasts } = await harness();
    routeHealthyOrg(server);
    const c = await h['connections:save']({
      organizationUrl: `${server.url}/unreliablewitness`,
      project: 'MIAC',
      pat: 'p',
    });
    broadcasts.length = 0;
    server.route('POST', '/unreliablewitness/MIAC/_apis/wit/wiql', {
      status: 401,
      body: {},
    });
    await expect(
      h['workItems:search'](c.id, { scope: 'mine', text: '' }),
    ).rejects.toThrow(/rejected the token/);
    expect((await h['connections:list']())[0].status).toBe('unauthorized');
    expect(broadcasts.some((b) => b.event === 'connections:changed')).toBe(
      true,
    );
  });
});

describe('handlers: work item robustness', () => {
  it('a successful call heals a stale unreachable status and broadcasts', async () => {
    const { h, server, broadcasts, connections } = await harness();
    routeHealthyOrg(server);
    const c = await h['connections:save']({
      organizationUrl: `${server.url}/unreliablewitness`,
      project: 'MIAC',
      pat: 'p',
    });
    await connections.setStatus(c.id, 'unreachable');
    broadcasts.length = 0;
    await h['workItems:search'](c.id, { scope: 'mine', text: '' });
    expect(connections.get(c.id)).toMatchObject({
      status: 'ok',
      user: 'Dries Hoebeke',
    });
    expect(broadcasts.some((b) => b.event === 'connections:changed')).toBe(
      true,
    );
  });
  it('sprint scope without a current iteration returns nothing and skips wiql', async () => {
    const { h, server } = await harness();
    routeHealthyOrg(server);
    const c = await h['connections:save']({
      organizationUrl: `${server.url}/unreliablewitness`,
      project: 'MIAC',
      pat: 'p',
    });
    server.route(
      'GET',
      '/unreliablewitness/MIAC/_apis/work/teamsettings/iterations',
      { body: { value: [] } },
    );
    server.requests.length = 0;
    expect(
      await h['workItems:search'](c.id, { scope: 'sprint', text: '' }),
    ).toEqual([]);
    expect(server.requests.some((r) => r.path.includes('/wiql'))).toBe(false);
  });
  it('prunes repo links to connections that no longer exist', async () => {
    const { h, services, added, connections } = await harness();
    await services.repos.setConnection(added.id, 'gone');
    expect(
      await pruneDanglingConnectionLinks(services.repos, connections),
    ).toBe(1);
    expect(services.repos.get(added.id).connectionId).toBeNull();
    expect(
      await pruneDanglingConnectionLinks(services.repos, connections),
    ).toBe(0);
    expect(await h['repos:list']()).toHaveLength(1);
  });
});

describe('handlers: shell', () => {
  it('opens only Azure DevOps urls', async () => {
    const { h, opened } = await harness();
    await h['shell:openExternal'](
      'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/5',
    );
    await h['shell:openExternal'](
      'https://contoso.visualstudio.com/P/_workitems/edit/1',
    );
    await expect(
      h['shell:openExternal']('https://evil.example/x'),
    ).rejects.toThrow(/not allowed/);
    await expect(
      h['shell:openExternal']('javascript:alert(1)'),
    ).rejects.toThrow(/not allowed/);
    for (const bad of [
      'http://dev.azure.com/o/x',
      'https://dev.azure.com.evil.com/x',
      'https://evil@dev.azure.com/x',
      'https://dev.azure.com:8443/x',
    ])
      await expect(h['shell:openExternal'](bad)).rejects.toThrow(/not allowed/);
    expect(opened).toHaveLength(2);
  });
});

describe('handlers: usage', () => {
  it('starts every task terminal with the telemetry env', async () => {
    const hx = await harness();
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](hx.input({ openShell: false }));
    await done;
    const def = await hx.h['terminals:open'](t.id, {
      kind: 'run',
      label: 'env',
      command: `${isWindows ? 'Write-Output' : 'echo'} "T=${envRef('OTEL_RESOURCE_ATTRIBUTES')} E=${envRef('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT')} C=${envRef('CLAUDE_CODE_ENABLE_TELEMETRY')}"; ${sleepCmd(5)}`,
    });
    await vi.waitFor(
      async () =>
        expect(await hx.h['terminals:buffer'](def.id)).toContain(
          `T=miac.task.id=${t.id} E=http://127.0.0.1:4319/v1/logs C=1`,
        ),
      { timeout: 10_000 },
    );
    hx.terminals.killAllForTask(t.id);
  });

  it('opens a Copilot CLI terminal with the platform command', async () => {
    const base = testPlatform();
    const platform = {
      ...base,
      copilotCommand: () =>
        base.shellCommand(`${echoCmd('copilot-started')}; ${sleepCmd(5)}`),
    };
    const hx = await harness(fakeCrypto(), { platform });
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](
      hx.input({ openShell: false, openCopilot: true }),
    );
    await done;
    const def = hx.store.state.tasks[0].terminals.find(
      (x) => x.kind === 'copilot',
    );
    expect(def?.label).toBe('Copilot CLI');
    await vi.waitFor(
      async () =>
        expect(await hx.h['terminals:buffer'](def!.id)).toContain(
          'copilot-started',
        ),
      { timeout: 10_000 },
    );
    hx.terminals.killAllForTask(t.id);
  });

  it('summarises, toggles billable, exports CSV and broadcasts changes', async () => {
    const hx = await harness();
    await hx.usage.add({
      id: 'a',
      taskId: 'tx',
      tool: 'claude-code',
      sessionId: 's1',
      model: 'claude-opus-5-5',
      at: '2026-10-14T10:00:00.000Z',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      fast: false,
    });
    expect(hx.broadcasts).toContainEqual({
      event: 'usage:changed',
      payload: { taskId: 'tx' },
    });
    expect((await hx.h['usage:task']('tx')).billable.costUsd).toBe(4);
    const after = await hx.h['usage:setBillable']('tx', 's1', false);
    expect(after.billable.costUsd).toBe(0);
    expect(await hx.h['usage:exportCsv']('tx')).toContain(
      ',s1,claude-opus-5-5,1000000,0,0,0,false,4,3.68,false,',
    );
  });

  it('reports the app version', async () => {
    const hx = await harness();
    expect(await hx.h['app:info']()).toEqual({ version: '9.9.9' });
  });

  it('saves settings, moves the receiver and reports a busy port', async () => {
    const hx = await harness();
    const s = await hx.h['settings:get']();
    await hx.h['settings:save']({ ...s, hourlySync: false });
    expect(hx.receiverStarts).toEqual([]);
    await hx.h['settings:save']({ ...s, receiverPort: 1999 });
    expect(hx.receiverStarts).toEqual([1999]);
    expect(await hx.h['usage:receiverStatus']()).toEqual({
      listening: false,
      port: 1999,
      error: 'Port 1999 is in use by another program',
      copilot: { records: 0, unreadable: 0 },
    });
    expect(
      hx.broadcasts.some(
        (b) =>
          b.event === 'notice' &&
          String((b.payload as { message: string }).message).includes('in use'),
      ),
    ).toBe(true);
    expect(hx.broadcasts).toContainEqual({
      event: 'usage:changed',
      payload: { taskId: '*' },
    });
    await expect(
      hx.h['settings:save']({ ...s, receiverPort: 80 }),
    ).rejects.toThrow();
  });

  it('lists the official rates read-only', async () => {
    const hx = await harness();
    const { rates, officialAsOf } = await hx.h['rates:list']();
    expect(officialAsOf).toBe('2026-10-14');
    expect(rates).toEqual(OFFICIAL_RATES);
  });

  it('finish writes the fields and the comment, then the task is done', async () => {
    const hx = await harness();
    const { t } = await linkedTask(hx);
    await hx.h['tasks:finish'](t.id, {
      closeTerminals: true,
      removeWorktree: true,
      deleteBranch: true,
      syncUsage: true,
    });
    const task = hx.store.state.tasks[0];
    expect(task).toMatchObject({
      status: 'done',
      usageCommentId: 501,
      usageSyncError: null,
    });
    const patch = hx.server.requests.find((r) => r.method === 'PATCH');
    expect(JSON.parse(patch!.body)).toContainEqual({
      op: 'add',
      path: '/fields/Custom.AICost',
      value: 3.68,
    });
    const comment = hx.server.requests.find(
      (r) => r.method === 'POST' && r.path.includes('/comments'),
    );
    expect(JSON.parse(comment!.body).text).toContain(
      'Branch feature/48231-show-estimated-delivery-date',
    );
  });

  it('finish still completes when Azure DevOps rejects the write', async () => {
    const hx = await harness();
    const { t } = await linkedTask(hx);
    hx.server.route('PATCH', '/unreliablewitness/_apis/wit/workitems/48231', {
      status: 403,
      body: {},
    });
    await hx.h['tasks:finish'](t.id, {
      closeTerminals: true,
      removeWorktree: true,
      deleteBranch: true,
      syncUsage: true,
    });
    expect(hx.store.state.tasks[0]).toMatchObject({
      status: 'done',
      usageSyncError:
        'The token cannot write work items (needs Work Items: Read & write)',
    });
    expect(
      hx.broadcasts.some(
        (b) =>
          b.event === 'notice' &&
          String((b.payload as { message: string }).message).includes(
            'could not be written',
          ),
      ),
    ).toBe(true);
  });

  it('sync now on a done task retries a failed finish write and posts the comment once', async () => {
    const hx = await harness();
    const { t } = await linkedTask(hx);
    hx.server.route('PATCH', '/unreliablewitness/_apis/wit/workitems/48231', {
      status: 403,
      body: {},
    });
    await hx.h['tasks:finish'](t.id, {
      closeTerminals: true,
      removeWorktree: true,
      deleteBranch: true,
      syncUsage: true,
    });
    expect(hx.store.state.tasks[0]).toMatchObject({
      status: 'done',
      usageCommentId: null,
    });
    expect(hx.store.state.tasks[0].usageSyncError).toBeTruthy();
    hx.server.route('PATCH', '/unreliablewitness/_apis/wit/workitems/48231', {
      body: { id: 48231 },
    });
    expect(await hx.h['usage:sync'](t.id)).toMatchObject({
      ok: true,
      commentPosted: true,
      fieldsWritten: [
        'Custom.AICost',
        'Custom.AICostClaude',
        'Custom.AICostCopilot',
        'Custom.AITokens',
      ],
    });
    expect(hx.store.state.tasks[0]).toMatchObject({
      usageCommentId: 501,
      usageSyncError: null,
    });
    expect(await hx.h['usage:sync'](t.id)).toMatchObject({
      commentPosted: false,
    });
    expect(
      hx.server.requests.filter((r) => r.path.includes('/comments')),
    ).toHaveLength(1);
  });

  it('logs a failing hourly sync instead of leaving an unhandled rejection', async () => {
    const hx = await harness();
    await linkedTask(hx);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(hx.usage, 'changedSince').mockImplementation(() => {
      throw new Error('index broken');
    });
    hx.hourly[0]();
    await new Promise((r) => setTimeout(r, 20));
    expect(errors).toHaveBeenCalledWith(
      '[usage] hourly sync failed',
      expect.any(Error),
    );
    errors.mockRestore();
  });

  it('sync now and the hourly sync write fields without a comment', async () => {
    const hx = await harness();
    const { t, c } = await linkedTask(hx);
    expect(await hx.h['usage:sync'](t.id)).toMatchObject({
      ok: true,
      commentPosted: false,
      fieldsWritten: [
        'Custom.AICost',
        'Custom.AICostClaude',
        'Custom.AICostCopilot',
        'Custom.AITokens',
      ],
    });
    expect(hx.hourly).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 5)); // changedSince compares ISO times; keep them apart
    await hx.usage.add({
      id: 'req-2',
      taskId: t.id,
      tool: 'claude-code',
      sessionId: 's1',
      model: 'claude-opus-5-5',
      at: '2026-10-14T11:00:00.000Z',
      inputTokens: 10,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      fast: false,
    });
    hx.hourly[0]();
    await new Promise((r) => setTimeout(r, 200));
    expect(hx.server.requests.filter((r) => r.method === 'PATCH')).toHaveLength(
      2,
    );
    expect(hx.server.requests.some((r) => r.path.includes('/comments'))).toBe(
      false,
    );
    expect((await hx.h['usage:fieldsStatus'](c.id)).types[0]).toMatchObject({
      type: 'User Story',
      missing: [],
    });
  });
});
