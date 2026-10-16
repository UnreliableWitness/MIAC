import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
import type { Telemetry } from '../telemetry/AppInsightsClient';
import { TerminalManager } from '../services/TerminalManager';
import { DocsWatcher } from '../docs/DocsWatcher';
import type { WorkspaceDetector } from '../workspaces/WorkspaceDetector';
import {
  addOrigin,
  cleanupTempRepos,
  commitFile,
  git,
  makeRepo,
} from '../test-helpers/gitRepo';
import { AdoError, CODE_WRITE_DENIED } from '../services/AdoClient';
import { prTitle } from '../services/azureRepos';
import {
  echoCmd,
  envRef,
  failCmd,
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
  // Most tests cover the write-back; the default (off) is tested on its own.
  await settings.save({ ...settings.get(), writeCostToAdo: true });
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

describe('handlers: workspaces', () => {
  it('scans, joins, removes and marks repos, broadcasting each change', async () => {
    const { h, setupDone, input, broadcasts } = await harness();
    const finished = setupDone();
    const task = await h['tasks:create'](input());
    await finished;
    const api = makeRepo('api');
    const apiRepo = await h['repos:add'](api);
    const apiWt = path.join(path.dirname(api), 'api-wt');
    git(api, 'worktree', 'add', '-q', '-b', task.branch, apiWt);
    broadcasts.length = 0;

    const added = await h['tasks:scanWorkspaces'](task.id);

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ repoId: apiRepo.id, source: 'detected' });
    expect(broadcasts.map((b) => b.event)).toEqual(
      expect.arrayContaining(['notice', 'repos:changed', 'tasks:changed']),
    );
    expect(broadcasts).toContainEqual({
      event: 'notice',
      payload: { level: 'info', message: 'Added api to this task' },
    });
    broadcasts.length = 0;
    expect(await h['tasks:scanWorkspaces'](task.id)).toEqual([]);
    expect(broadcasts).toEqual([]);

    await h['tasks:removeWorkspace'](task.id, added[0].id);
    const [view] = (await h['tasks:list']()).filter((t) => t.id === task.id);
    expect(view.extraWorkspaces).toEqual([]);
    expect(view.detachedPaths).toHaveLength(1);
    expect(broadcasts.some((b) => b.event === 'tasks:changed')).toBe(true);
    await expect(h['tasks:removeWorkspace'](task.id, 'home')).rejects.toThrow(
      /home workspace/,
    );

    expect((await h['repos:setDiscovered'](apiRepo.id, true)).discovered).toBe(
      true,
    );
    expect(broadcasts.at(-1)?.event).toBe('repos:changed');
  });
});

describe('handlers: open in editor', () => {
  it('opens the home worktree, or the chosen workspace', async () => {
    const launched: { command: string; args: string[] }[] = [];
    const { h, setupDone, input } = await harness(undefined, {
      launch: async (c) => {
        launched.push(c);
      },
    });
    const finished = setupDone();
    const task = await h['tasks:create'](input());
    await finished;
    const api = makeRepo('api');
    await h['repos:add'](api);
    const apiWt = path.join(path.dirname(api), 'api-wt');
    git(api, 'worktree', 'add', '-q', '-b', task.branch, apiWt);
    const [ws] = await h['tasks:scanWorkspaces'](task.id);

    await h['tasks:openInEditor'](task.id);
    await h['tasks:openInEditor'](task.id, ws.id);

    expect(launched.map((c) => c.args[0])).toEqual([
      task.worktreePath,
      ws.worktreePath,
    ]);
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
    const { h, input, setupDone, terminals, store } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input());
    await done;
    const kill = vi.spyOn(terminals, 'kill');
    await h['tasks:finish'](t.id, {
      closeTerminals: false,
      removeWorktree: false,
      deleteBranch: false,
      syncUsage: false,
    });
    expect(kill).not.toHaveBeenCalled();
    expectTerminalsKept(store, terminals, t.id, 1);
    kill.mockRestore();
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

  it('stops the docs watcher before Finish removes the worktree', async () => {
    const docsWatcher = new DocsWatcher(() => undefined);
    const { h, input, setupDone, services } = await harness(fakeCrypto(), {
      docsWatcher,
    });
    const done = setupDone();
    const t = await h['tasks:create'](input());
    await done;
    await h['docs:watch'](t.id, true);
    expect(docsWatcher.active(t.id)).toBe(true);
    const order: string[] = [];
    const realRemove = services.git.worktreeRemove.bind(services.git);
    vi.spyOn(services.git, 'worktreeRemove').mockImplementation(
      async (...a) => {
        order.push(`remove:${docsWatcher.active(t.id)}`);
        return realRemove(...a);
      },
    );
    await h['tasks:finish'](t.id, {
      closeTerminals: true,
      removeWorktree: true,
      deleteBranch: true,
      syncUsage: false,
    });
    expect(order).toEqual(['remove:false']);
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

  it('records what the branch did before the worktree goes', async () => {
    const { h, input, setupDone } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ openShell: false }));
    await done;
    commitFile(t.worktreePath, 'feature.txt', 'a\nb\n', 'Add the feature');
    await h['tasks:finish'](t.id, {
      closeTerminals: true,
      removeWorktree: true,
      deleteBranch: true,
      syncUsage: false,
    });
    const [view] = await h['tasks:list']();
    expect(view.summary).toMatchObject({
      commitCount: 1,
      commits: [{ subject: 'Add the feature' }],
      filesChanged: 1,
      insertions: 2,
      deletions: 0,
      pushed: false,
      upstream: null,
    });
  });

  it('records the base commit at setup and measures the summary from it after a merged PR', async () => {
    const { h, input, setupDone, store, repo } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ openShell: false }));
    await done;
    const baseSha = store.state.tasks[0].baseSha;
    expect(baseSha).toMatch(/^[0-9a-f]{40}$/);
    commitFile(t.worktreePath, 'feature.txt', 'a\n', 'Add the feature');
    git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge PR', t.branch);
    await h['tasks:finish'](t.id, {
      closeTerminals: true,
      removeWorktree: true,
      deleteBranch: false,
      syncUsage: false,
    });
    const [view] = await h['tasks:list']();
    expect(view.summary).toMatchObject({
      commitCount: 1,
      commits: [{ subject: 'Add the feature' }],
    });
  });

  it('finishes even when the summary fails', async () => {
    const { h, input, setupDone, services } = await harness();
    const done = setupDone();
    const t = await h['tasks:create'](input({ openShell: false }));
    await done;
    services.git.finishSummary = async () => {
      throw new Error('boom');
    };
    await h['tasks:finish'](t.id, {
      closeTerminals: true,
      removeWorktree: true,
      deleteBranch: true,
      syncUsage: false,
    });
    const [view] = await h['tasks:list']();
    expect(view.status).toBe('done');
    expect(view.summary).toBeNull();
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

/**
 * MIAC left the task's terminals alone: each is still listed on the task and still known to the TerminalManager,
 * which forgets a terminal when MIAC kills it. Whether the OS process is still alive is not asserted: on a loaded
 * Windows runner an idle interactive PowerShell has been seen to exit by itself during a long test.
 */
function expectTerminalsKept(
  store: TaskStore,
  terminals: TerminalManager,
  taskId: string,
  count: number,
) {
  const listed = store.state.tasks.find((t) => t.id === taskId)?.terminals;
  expect(listed).toHaveLength(count);
  for (const def of listed ?? []) expect(terminals.has(def.id)).toBe(true);
}

describe('handlers: update', () => {
  it('reports no update in dev and refuses to install one', async () => {
    const { h } = await harness();
    expect(await h['update:status']()).toBeNull();
    await expect(h['update:install']()).rejects.toThrow(
      'No update is ready to install',
    );
  });

  it('reports a downloaded update and installs it when asked', async () => {
    const install = vi.fn(() => true);
    let pending: { version: string | null } | null = null;
    const { h } = await harness(fakeCrypto(), {
      update: { pending: () => pending, install },
    });
    await expect(h['update:install']()).rejects.toThrow();
    expect(install).not.toHaveBeenCalled();
    pending = { version: '1.0.3' };
    expect(await h['update:status']()).toEqual({ version: '1.0.3' });
    await h['update:install']();
    expect(install).toHaveBeenCalledTimes(1);
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

describe('handlers: Claude Code sessions', () => {
  const recording = () => {
    const base = testPlatform();
    const calls: { prompt: string | null; flags: string[] }[] = [];
    const platform = {
      ...base,
      // A shell that exits at once stands in for claude.
      claudeCommand: (prompt: string | null, flags: string[] = []) => {
        calls.push({ prompt, flags });
        return base.runCommand(echoCmd('claude'));
      },
    };
    return { platform, calls };
  };

  it('starts Claude Code with the task as context and its own session id, and resumes it on restart', async () => {
    const { platform, calls } = recording();
    const hx = await harness(fakeCrypto(), {
      platform,
      claudeSessionExists: () => true,
    });
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](
      hx.input({ openShell: false, startClaude: true }),
    );
    await done;
    const def = hx.store.state.tasks[0].terminals.find(
      (x) => x.kind === 'claude',
    );
    expect(def?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls).toEqual([
      {
        prompt: expect.stringMatching(
          /\.miac\/task\.md\. Do not start on the task by yourself/,
        ),
        flags: ['--session-id', def?.sessionId],
      },
    ]);
    await hx.h['terminals:restart'](def!.id);
    expect(calls[1]).toEqual({
      prompt: null,
      flags: ['--resume', def?.sessionId],
    });
    // After a relaunch the new manager does not know the terminal; it still resumes.
    await hx.terminals.killAllForTask(t.id);
    const fresh = new TerminalManager();
    allTerminals.push(fresh);
    const h2 = createHandlers({ ...hx.services, terminals: fresh });
    await h2['terminals:restart'](def!.id);
    expect(calls[2]).toEqual({
      prompt: null,
      flags: ['--resume', def?.sessionId],
    });
  });

  it('continues the latest conversation for a Claude Code tab without a session id', async () => {
    const { platform, calls } = recording();
    const hx = await harness(fakeCrypto(), { platform });
    const done = hx.setupDone();
    await hx.h['tasks:create'](
      hx.input({ openShell: false, startClaude: true }),
    );
    await done;
    await hx.store.update((st) => {
      for (const d of st.tasks[0].terminals) delete d.sessionId;
    });
    const id = hx.store.state.tasks[0].terminals[0].id;
    await hx.h['terminals:restart'](id);
    expect(calls.at(-1)).toEqual({ prompt: null, flags: ['--continue'] });
  });

  it('starts a never-used session again instead of resuming it', async () => {
    const { platform, calls } = recording();
    const hx = await harness(fakeCrypto(), {
      platform,
      claudeSessionExists: () => false,
    });
    const done = hx.setupDone();
    await hx.h['tasks:create'](
      hx.input({ openShell: false, startClaude: true }),
    );
    await done;
    const def = hx.store.state.tasks[0].terminals[0];
    await hx.h['terminals:restart'](def.id);
    expect(calls.at(-1)).toEqual({
      prompt: expect.stringContaining('.miac/task.md'),
      flags: ['--session-id', def.sessionId],
    });
  });

  it('gives a Claude Code tab opened by hand a session id', async () => {
    const { platform, calls } = recording();
    const hx = await harness(fakeCrypto(), { platform });
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](hx.input({ openShell: false }));
    await done;
    const def = await hx.h['terminals:open'](t.id, {
      kind: 'claude',
      label: 'Claude Code',
    });
    expect(def.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls.at(-1)?.flags).toEqual(['--session-id', def.sessionId]);
  });
});

describe('handlers: terminals opened from the + menu', () => {
  it('names a shell tab after the platform shell and starts OpenCode with its command', async () => {
    const base = testPlatform();
    const platform = {
      ...base,
      shellLabel: 'PowerShell',
      opencodeCommand: () =>
        base.runCommand(`${echoCmd('opencode-started')}; ${sleepCmd(5)}`),
    };
    const hx = await harness(fakeCrypto(), { platform });
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](hx.input({ openShell: false }));
    await done;
    const shell = await hx.h['terminals:open'](t.id, {
      kind: 'shell',
      label: 'shell',
    });
    expect(shell.label).toBe('PowerShell');
    const oc = await hx.h['terminals:open'](t.id, {
      kind: 'opencode',
      label: 'OpenCode',
    });
    await vi.waitFor(
      async () =>
        expect(await hx.h['terminals:buffer'](oc.id)).toContain(
          'opencode-started',
        ),
      { timeout: 10_000 },
    );
    await hx.h['terminals:kill'](oc.id);
    expect(hx.store.state.tasks[0].terminals.map((x) => x.kind)).toEqual([
      'shell',
    ]);
    await hx.terminals.killAllForTask(t.id);
  });
});

describe('handlers: reopen a finished task', () => {
  const finishWith = (o: {
    removeWorktree: boolean;
    deleteBranch: boolean;
  }) => ({
    closeTerminals: true,
    syncUsage: false,
    ...o,
  });
  const recording = () => {
    const base = testPlatform();
    const calls: { context: string | null; flags: string[] }[] = [];
    const platform = {
      ...base,
      claudeCommand: (context: string | null, flags: string[] = []) => {
        calls.push({ context, flags });
        return base.runCommand(`${echoCmd('claude')}; ${sleepCmd(5)}`);
      },
    };
    return { platform, calls };
  };
  async function finished(
    o: { removeWorktree: boolean; deleteBranch: boolean },
    over: Partial<Services> = {},
  ) {
    const rec = recording();
    const hx = await harness(fakeCrypto(), {
      platform: rec.platform,
      claudeSessionExists: () => true,
      ...over,
    });
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](hx.input({ startClaude: true }));
    await done;
    commitFile(t.worktreePath, 'feature.txt', 'a\n', 'Add the feature');
    const before = hx.store.state.tasks[0].terminals;
    await hx.h['tasks:finish'](t.id, finishWith(o));
    return { ...hx, ...rec, t, before };
  }
  const reopenSetup = async (hx: Awaited<ReturnType<typeof finished>>) => {
    const done = hx.setupDone();
    expect(await hx.h['tasks:reopen'](hx.t.id)).toEqual({ setup: true });
    return done;
  };

  it('Finish keeps the tabs it closed, so Reopen can bring them back', async () => {
    const hx = await finished({ removeWorktree: true, deleteBranch: false });
    expect(hx.store.state.tasks[0]).toMatchObject({
      status: 'done',
      terminals: [],
      closedTerminals: hx.before,
    });
    expect(hx.before.map((d) => d.kind)).toEqual(['claude', 'shell']);
  });

  const withExtra = async (hx: Awaited<ReturnType<typeof finished>>) => {
    const extraPath = mkdtempSync(path.join(os.tmpdir(), 'miac-extra-'));
    git(extraPath, 'init', '-q');
    await hx.store.update((st) => {
      st.tasks[0].extraWorkspaces.push({
        id: 'w2',
        repoId: 'other',
        branch: 'b',
        worktreePath: extraPath,
        baseRef: 'HEAD',
        baseSha: null,
        source: 'detected',
        summary: null,
        pullRequest: null,
        reopen: null,
        dropped: false,
      });
    });
    return extraPath;
  };

  it('Claude gets --add-dir for the extra worktree, on resume and on start; dropped ones are left out', async () => {
    const hx = await finished({ removeWorktree: false, deleteBranch: false });
    const extra = await withExtra(hx);
    const id = hx.t.id;
    const claude = hx.before.find((d) => d.kind === 'claude')!;
    await hx.h['tasks:reopen'](id);
    expect(hx.calls.at(-1)?.flags).toEqual([
      '--resume',
      claude.sessionId,
      '--add-dir',
      extra,
    ]);
    await hx.h['terminals:open'](id, { kind: 'claude', label: 'Claude Code' });
    expect(hx.calls.at(-1)?.flags).toEqual([
      '--session-id',
      expect.any(String),
      '--add-dir',
      extra,
    ]);
    await hx.store.update((st) => {
      st.tasks[0].extraWorkspaces[0].dropped = true;
    });
    await hx.h['terminals:open'](id, { kind: 'claude', label: 'Claude Code' });
    expect(hx.calls.at(-1)?.flags).not.toContain('--add-dir');
    await hx.terminals.killAllForTask(id);
  });

  it('opens a shell in the workspace asked for, else in the active home', async () => {
    const hx = await finished({ removeWorktree: false, deleteBranch: false });
    const extra = await withExtra(hx);
    await hx.terminals.killAllForTask(hx.t.id);
    await hx.store.update((st) => {
      st.tasks[0].status = 'ready';
    });
    const spy = vi.spyOn(hx.terminals, 'spawn');
    await hx.h['terminals:open'](hx.t.id, {
      kind: 'shell',
      label: 'sh',
      workspaceId: 'w2',
    });
    await hx.h['terminals:open'](hx.t.id, { kind: 'shell', label: 'sh' });
    expect(spy.mock.calls.map((c) => c[0].cwd)).toEqual([
      extra,
      hx.t.worktreePath,
    ]);
    await hx.terminals.killAllForTask(hx.t.id);
  });

  it('summarises an extra worktree against its own baseRef', async () => {
    const hx = await finished({ removeWorktree: false, deleteBranch: false });
    const extra = await withExtra(hx);
    commitFile(extra, 'a.txt', 'a\n', 'first');
    commitFile(extra, 'b.txt', 'b\n', 'second');
    await hx.store.update((st) => {
      st.tasks[0].extraWorkspaces[0].baseRef = 'HEAD~1';
    });
    writeFileSync(path.join(extra, 'c.txt'), 'c\n');
    const sum = await hx.h['tasks:gitSummary'](hx.t.id, 'w2');
    expect(sum.files.map((f) => f.path)).toEqual(['c.txt']);
    expect(sum.ahead).toBe(1);
    const home = await hx.h['tasks:gitSummary'](hx.t.id);
    expect(home.files.map((f) => f.path)).not.toContain('c.txt');
  });

  it('a terminal of a removed or dropped workspace runs in the active home', async () => {
    const hx = await finished({ removeWorktree: false, deleteBranch: false });
    await withExtra(hx);
    await hx.terminals.killAllForTask(hx.t.id);
    await hx.store.update((st) => {
      st.tasks[0].status = 'ready';
      st.tasks[0].extraWorkspaces[0].dropped = true;
    });
    const spy = vi.spyOn(hx.terminals, 'spawn');
    for (const workspaceId of ['w2', 'gone'])
      await hx.h['terminals:open'](hx.t.id, {
        kind: 'shell',
        label: 'sh',
        workspaceId,
      });
    expect(spy.mock.calls.map((c) => c[0].cwd)).toEqual([
      hx.t.worktreePath,
      hx.t.worktreePath,
    ]);
    await hx.terminals.killAllForTask(hx.t.id);
  });

  it('reopens a task whose worktree was kept, without setup, resuming Claude', async () => {
    const hx = await finished({ removeWorktree: false, deleteBranch: false });
    expect(await hx.h['tasks:reopen'](hx.t.id)).toEqual({ setup: false });
    const task = hx.store.state.tasks[0];
    expect(task).toMatchObject({
      status: 'ready',
      finishedAt: null,
      closedTerminals: [],
    });
    expect(task.terminals.map((d) => d.id)).toEqual(hx.before.map((d) => d.id));
    const claude = hx.before.find((d) => d.kind === 'claude')!;
    expect(hx.calls.at(-1)).toEqual({
      context: null,
      flags: ['--resume', claude.sessionId],
    });
    expect(hx.terminals.runningCount(hx.t.id)).toBe(2);
    await hx.terminals.killAllForTask(hx.t.id);
  });

  it('makes the worktree again from the local branch and runs the setup again', async () => {
    const hx = await finished({ removeWorktree: true, deleteBranch: false });
    expect(existsSync(hx.t.worktreePath)).toBe(false);
    const result = await reopenSetup(hx);
    expect(result.ok).toBe(true);
    expect(existsSync(path.join(hx.t.worktreePath, 'feature.txt'))).toBe(true);
    expect(existsSync(path.join(hx.t.worktreePath, 'ok.txt'))).toBe(true);
    expect(hx.store.state.tasks[0]).toMatchObject({
      status: 'ready',
      reopen: null,
      extraWorkspaces: [],
      detachedPaths: [],
      homeDropped: false,
      connectionId: null,
      mainCheckoutEdits: [],
      finishedAt: null,
      baseSha: hx.t.baseSha ?? hx.store.state.tasks[0].baseSha,
    });
    expect(hx.store.state.tasks[0].terminals.map((d) => d.kind)).toEqual([
      'claude',
      'shell',
    ]);
    expect(hx.calls.at(-1)?.flags[0]).toBe('--resume');
    await hx.terminals.killAllForTask(hx.t.id);
  });

  it('brings a deleted branch back from origin', async () => {
    const rec = recording();
    const hx = await harness(fakeCrypto(), { platform: rec.platform });
    addOrigin(hx.repo);
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](hx.input({ openShell: false }));
    await done;
    commitFile(t.worktreePath, 'pushed.txt', 'a\n', 'Pushed work');
    git(t.worktreePath, 'push', '-q', 'origin', t.branch);
    await hx.h['tasks:finish'](
      t.id,
      finishWith({ removeWorktree: true, deleteBranch: true }),
    );
    const finishedDone = hx.setupDone();
    expect(await hx.h['tasks:reopen'](t.id)).toEqual({ setup: true });
    expect(hx.store.state.tasks[0].reopen).toEqual({
      from: `origin/${t.branch}`,
    });
    expect((await finishedDone).ok).toBe(true);
    expect(existsSync(path.join(t.worktreePath, 'pushed.txt'))).toBe(true);
  });

  it('brings a deleted, unpushed branch back from its last commit', async () => {
    const hx = await finished({ removeWorktree: true, deleteBranch: true });
    expect(await new GitClient().branchExists(hx.repo, hx.t.branch)).toBe(
      false,
    );
    const result = await reopenSetup(hx);
    expect(result.ok).toBe(true);
    expect(existsSync(path.join(hx.t.worktreePath, 'feature.txt'))).toBe(true);
    await hx.terminals.killAllForTask(hx.t.id);
  });

  it('refuses when the branch is gone for good, and the task stays done', async () => {
    const hx = await finished({ removeWorktree: true, deleteBranch: true });
    await hx.store.update((st) => {
      st.tasks[0].summary!.commits = [{ sha: 'f'.repeat(40), subject: 'x' }];
    });
    await expect(hx.h['tasks:reopen'](hx.t.id)).rejects.toThrow(
      `Branch ${hx.t.branch} cannot be restored`,
    );
    expect(hx.store.state.tasks[0].status).toBe('done');
    // Not left busy: a second try gives the same answer, not "Task is busy".
    await expect(hx.h['tasks:reopen'](hx.t.id)).rejects.toThrow(
      'cannot be restored',
    );
  });

  it('cancelling a failed reopen puts the task back to done and keeps it', async () => {
    const hx = await finished({ removeWorktree: true, deleteBranch: false });
    await hx.store.update((st) => {
      st.tasks[0].setup.commands = [failCmd(3)];
    });
    const result = await reopenSetup(hx);
    expect(result.ok).toBe(false);
    expect(hx.store.state.tasks[0].status).toBe('setup-failed');
    await hx.h['tasks:cancelSetup'](hx.t.id);
    expect(hx.store.state.tasks).toHaveLength(1);
    expect(hx.store.state.tasks[0]).toMatchObject({
      status: 'done',
      reopen: null,
      extraWorkspaces: [],
      detachedPaths: [],
      homeDropped: false,
      connectionId: null,
      mainCheckoutEdits: [],
    });
    expect(existsSync(hx.t.worktreePath)).toBe(false);
    expect(await new GitClient().branchExists(hx.repo, hx.t.branch)).toBe(true);
  });

  it('continues the latest Claude session in the folder for a task finished before tabs were kept', async () => {
    const hx = await finished(
      { removeWorktree: false, deleteBranch: false },
      { claudeHasSessionsIn: () => true },
    );
    await hx.store.update((st) => {
      st.tasks[0].closedTerminals = [];
    });
    await hx.h['tasks:reopen'](hx.t.id);
    expect(hx.calls.at(-1)).toEqual({ context: null, flags: ['--continue'] });
    await hx.terminals.killAllForTask(hx.t.id);
  });
  /**
   * A task in `webshop` (home, no changes) plus a worktree on its branch in `api` with one commit, finished with
   * its worktrees removed and branches kept. `api`'s .miac.yml copies .env and writes api.txt.
   */
  async function finishedMulti(
    o: {
      home?: 'keep' | 'drop';
      extra?: 'keep' | 'drop';
      apiSetup?: string[];
    } = {},
  ) {
    const rec = recording();
    const api = makeRepo('api');
    writeFileSync(path.join(api, '.env'), 'API=1');
    const apiSetup = o.apiSetup ?? [writeLineCmd('api', 'api.txt')];
    const hx = await harness(fakeCrypto(), {
      platform: rec.platform,
      claudeSessionExists: () => true,
      loadConfig: async (p) =>
        p === api
          ? { ...(await loadMiacConfig(p)), copy: ['.env'], setup: apiSetup }
          : loadMiacConfig(p),
    });
    // The copied .env is ignored, as in a real repo, so a home without commits can be dropped.
    commitFile(hx.repo, '.gitignore', '.env\n');
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](
      hx.input({ startClaude: true, openShell: false, commands: [] }),
    );
    await done;
    const added = await hx.h['repos:add'](api);
    const wt = path.join(path.dirname(api), 'api-wt');
    git(api, 'worktree', 'add', '-q', '-b', t.branch, wt, 'main');
    if (o.extra !== 'drop') commitFile(wt, 'api-work.txt', 'a\n', 'API work');
    await hx.store.update((st) => {
      st.tasks[0].extraWorkspaces.push({
        id: 'w2',
        repoId: added.id,
        branch: t.branch,
        worktreePath: wt,
        baseRef: 'main',
        baseSha: null,
        source: 'detected',
        summary: null,
        pullRequest: null,
        reopen: null,
        dropped: false,
      });
    });
    const before = hx.store.state.tasks[0].terminals;
    await hx.h['tasks:finish'](t.id, {
      ...finishWith({ removeWorktree: true, deleteBranch: false }),
      workspaces: [
        { workspaceId: 'home', action: o.home ?? 'keep' },
        { workspaceId: 'w2', action: o.extra ?? 'keep' },
      ],
    });
    expect(hx.store.state.tasks[0].status).toBe('done');
    expect(existsSync(t.worktreePath)).toBe(false);
    expect(existsSync(wt)).toBe(false);
    return { ...hx, ...rec, t, before, api, wt };
  }
  const extraOf = (hx: { store: TaskStore }) =>
    hx.store.state.tasks[0].extraWorkspaces[0];

  it('reopens every repo: reopen.from on each, both worktrees made again with their own setup', async () => {
    const hx = await finishedMulti();
    const done = hx.setupDone();
    expect(await hx.h['tasks:reopen'](hx.t.id)).toEqual({ setup: true });
    expect(hx.store.state.tasks[0].reopen).toEqual({ from: null });
    expect(extraOf(hx).reopen).toEqual({ from: null });
    expect((await done).ok).toBe(true);
    const state = await hx.h['tasks:setupState'](hx.t.id);
    expect(state!.steps.map((x) => x.def.label)).toEqual([
      'Restore worktree',
      'Copy local files',
      'Write task file',
      'Restore api worktree',
      'Copy local files (api)',
      writeLineCmd('api', 'api.txt'),
      'Restore terminals',
    ]);
    expect(existsSync(hx.t.worktreePath)).toBe(true);
    expect(existsSync(path.join(hx.wt, 'api-work.txt'))).toBe(true);
    expect(existsSync(path.join(hx.wt, '.env'))).toBe(true);
    expect(existsSync(path.join(hx.wt, 'api.txt'))).toBe(true);
    expect(existsSync(path.join(hx.t.worktreePath, 'api.txt'))).toBe(false);
    expect(hx.store.state.tasks[0]).toMatchObject({
      status: 'ready',
      reopen: null,
      finishedAt: null,
    });
    expect(extraOf(hx).reopen).toBeNull();
    expect(hx.calls.at(-1)?.flags).toEqual([
      '--resume',
      hx.before[0].sessionId,
      '--add-dir',
      hx.wt,
    ]);
    await hx.terminals.killAllForTask(hx.t.id);
  });

  it('a dropped repo is not restored', async () => {
    const hx = await finishedMulti({ extra: 'drop' });
    expect(extraOf(hx).dropped).toBe(true);
    const done = hx.setupDone();
    await hx.h['tasks:reopen'](hx.t.id);
    expect(extraOf(hx).reopen).toBeNull();
    expect((await done).ok).toBe(true);
    const state = await hx.h['tasks:setupState'](hx.t.id);
    expect(state!.steps.map((x) => x.def.label)).toEqual([
      'Restore worktree',
      'Copy local files',
      'Write task file',
      'Restore terminals',
    ]);
    expect(existsSync(hx.wt)).toBe(false);
    await hx.terminals.killAllForTask(hx.t.id);
  });

  it('a task whose home was dropped restores only the other repo, and Claude resumes there', async () => {
    const hx = await finishedMulti({ home: 'drop' });
    expect(hx.store.state.tasks[0].homeDropped).toBe(true);
    const spy = vi.spyOn(hx.terminals, 'spawn');
    const done = hx.setupDone();
    await hx.h['tasks:reopen'](hx.t.id);
    expect(hx.store.state.tasks[0].reopen).toBeNull();
    expect(extraOf(hx).reopen).toEqual({ from: null });
    expect((await done).ok).toBe(true);
    const state = await hx.h['tasks:setupState'](hx.t.id);
    expect(state!.steps.map((x) => x.def.label)).toEqual([
      'Restore api worktree',
      'Copy local files (api)',
      writeLineCmd('api', 'api.txt'),
      'Restore terminals',
    ]);
    expect(existsSync(hx.t.worktreePath)).toBe(false);
    expect(existsSync(path.join(hx.wt, 'api-work.txt'))).toBe(true);
    expect(hx.store.state.tasks[0].status).toBe('ready');
    expect(spy.mock.calls.map((c) => c[0].cwd)).toEqual([hx.wt]);
    expect(hx.calls.at(-1)?.flags).toEqual([
      '--resume',
      hx.before[0].sessionId,
    ]);
    await hx.terminals.killAllForTask(hx.t.id);
  });

  it('a failing restore of a repo fails setup at its step, and Retry resumes there', async () => {
    const hx = await finishedMulti({ apiSetup: [failCmd(3)] });
    const failed = hx.setupDone();
    await hx.h['tasks:reopen'](hx.t.id);
    expect(await failed).toMatchObject({ ok: false, failedStep: 5 });
    expect(hx.store.state.tasks[0].status).toBe('setup-failed');
    const state = await hx.h['tasks:setupState'](hx.t.id);
    expect(state!.steps[5].def).toMatchObject({
      kind: 'command',
      detail: 'in api',
      workspaceId: 'w2',
    });
    // The repo's setup command is fixed; the retry starts at the failed step.
    const runSpy = vi.spyOn(hx.services.runner, 'run');
    const retried = hx.setupDone();
    hx.services.loadConfig = async (p) =>
      p === hx.api
        ? {
            ...(await loadMiacConfig(p)),
            copy: ['.env'],
            setup: [writeLineCmd('retried', 'api.txt')],
          }
        : loadMiacConfig(p);
    await hx.h['tasks:retrySetup'](hx.t.id);
    expect((await retried).ok).toBe(true);
    expect(runSpy.mock.calls[0][1].fromStep).toBe(5);
    expect(existsSync(path.join(hx.wt, 'api.txt'))).toBe(true);
    expect(hx.store.state.tasks[0].status).toBe('ready');
    expect(extraOf(hx).reopen).toBeNull();
    await hx.terminals.killAllForTask(hx.t.id);
  });

  it('cancelling a failed reopen removes every remade worktree and the task goes back to done', async () => {
    const hx = await finishedMulti({ apiSetup: [failCmd(3)] });
    const failed = hx.setupDone();
    await hx.h['tasks:reopen'](hx.t.id);
    expect((await failed).ok).toBe(false);
    expect(existsSync(hx.wt)).toBe(true);
    await hx.h['tasks:cancelSetup'](hx.t.id);
    expect(hx.store.state.tasks[0]).toMatchObject({
      status: 'done',
      reopen: null,
    });
    expect(extraOf(hx).reopen).toBeNull();
    expect(existsSync(hx.t.worktreePath)).toBe(false);
    expect(existsSync(hx.wt)).toBe(false);
    expect(await new GitClient().branchExists(hx.api, hx.t.branch)).toBe(true);
    expect(await new GitClient().branchExists(hx.repo, hx.t.branch)).toBe(true);
  });

  it('a kept home with a removed repo goes through setup for that repo only', async () => {
    const hx = await finishedMulti();
    git(hx.repo, 'worktree', 'add', '-q', hx.t.worktreePath, hx.t.branch);
    writeFileSync(path.join(hx.t.worktreePath, 'mine.txt'), 'x');
    const done = hx.setupDone();
    expect(await hx.h['tasks:reopen'](hx.t.id)).toEqual({ setup: true });
    expect(hx.store.state.tasks[0].reopen).toBeNull();
    expect((await done).ok).toBe(true);
    const state = await hx.h['tasks:setupState'](hx.t.id);
    expect(state!.steps[0].def.label).toBe('Restore api worktree');
    expect(existsSync(path.join(hx.wt, 'api-work.txt'))).toBe(true);
    expect(existsSync(path.join(hx.t.worktreePath, 'mine.txt'))).toBe(true);
    await hx.terminals.killAllForTask(hx.t.id);
  });

  it('reopens without setup when every repo kept its worktree', async () => {
    const hx = await finishedMulti();
    git(hx.repo, 'worktree', 'add', '-q', hx.t.worktreePath, hx.t.branch);
    git(hx.api, 'worktree', 'add', '-q', hx.wt, hx.t.branch);
    expect(await hx.h['tasks:reopen'](hx.t.id)).toEqual({ setup: false });
    expect(hx.store.state.tasks[0].status).toBe('ready');
    await hx.terminals.killAllForTask(hx.t.id);
  });

  it('refuses when every repo was removed without changes', async () => {
    const hx = await finishedMulti({ home: 'drop', extra: 'drop' });
    await expect(hx.h['tasks:reopen'](hx.t.id)).rejects.toThrow(
      'Nothing to reopen: every repo of this task was removed without changes',
    );
    expect(hx.store.state.tasks[0].status).toBe('done');
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
      baseSha: null,
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
      summary: null,
      pullRequest: null,
      closedTerminals: [],
      reopen: null,
      extraWorkspaces: [],
      detachedPaths: [],
      homeDropped: false,
      connectionId: null,
      mainCheckoutEdits: [],
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
          id: 'it-1',
          name: 'Sprint 1',
          path: 'MIAC\\Sprint 1',
          attributes: { timeFrame: 'current' },
        },
      ],
    },
  });
  server.route(
    'GET',
    `/${org}/MIAC/_apis/work/teamsettings/iterations/it-1/workitems`,
    {
      body: {
        workItemRelations: [{ rel: null, source: null, target: { id: 5 } }],
      },
    },
  );
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
  it('keeps the unique name from verification, so a new connection can assign work items', async () => {
    const { h, server } = await harness();
    routeHealthyOrg(server);
    server.route('GET', '/unreliablewitness/_apis/connectionData', {
      body: {
        authenticatedUser: {
          providerDisplayName: 'Dries Hoebeke',
          properties: { Account: { $value: 'dries@example.com' } },
        },
      },
    });
    const c = await h['connections:save']({
      organizationUrl: `${server.url}/unreliablewitness`,
      project: 'MIAC',
      pat: 'p',
    });
    expect(c.userUniqueName).toBe('dries@example.com');
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
      id: 'it-1',
      path: 'MIAC\\Sprint 1',
      name: 'Sprint 1',
      startDate: null,
      finishDate: null,
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

describe('handlers: sprint, types and live work items', () => {
  const save = async (hx: Awaited<ReturnType<typeof harness>>) => {
    routeHealthyOrg(hx.server);
    return hx.h['connections:save']({
      organizationUrl: `${hx.server.url}/unreliablewitness`,
      project: 'MIAC',
      pat: 'p',
    });
  };
  it('returns the sprint rows through the connection', async () => {
    const hx = await harness();
    const c = await save(hx);
    const sprint = await hx.h['workItems:sprint'](c.id);
    expect(sprint.iteration?.name).toBe('Sprint 1');
    expect(sprint.rows.map((r) => [r.item.id, r.item.title, r.depth])).toEqual([
      ['5', 'Five', 0],
    ]);
  });
  it('a 401 on the sprint marks the connection unauthorized', async () => {
    const hx = await harness();
    const c = await save(hx);
    hx.server.route(
      'GET',
      '/unreliablewitness/MIAC/_apis/work/teamsettings/iterations',
      { status: 401, body: {} },
    );
    await expect(hx.h['workItems:sprint'](c.id)).rejects.toThrow(
      /rejected the token/,
    );
    expect((await hx.h['connections:list']())[0].status).toBe('unauthorized');
  });
  it('loads the types with icons as data URLs once per connection, and retries after a failure', async () => {
    const hx = await harness();
    const c = await save(hx);
    hx.server.route('GET', '/unreliablewitness/MIAC/_apis/wit/workitemtypes', {
      status: 500,
      body: {},
    });
    await expect(hx.h['workItems:types'](c.id)).rejects.toThrow();
    hx.server.route('GET', '/unreliablewitness/MIAC/_apis/wit/workitemtypes', {
      body: {
        value: [
          {
            name: 'Task',
            color: 'A4880A',
            icon: {
              url: `${hx.server.url}/unreliablewitness/_apis/wit/workItemIcons/icon_check_box`,
            },
            states: [{ name: 'Done', color: '339933', category: 'Completed' }],
          },
        ],
      },
    });
    hx.server.route('GET', '/unreliablewitness/_apis/wit/workItemIcons/', {
      raw: '<svg/>',
      headers: { 'content-type': 'image/svg+xml' },
    });
    const types = await hx.h['workItems:types'](c.id);
    expect(types).toEqual([
      {
        name: 'Task',
        color: '#a4880a',
        icon: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
        states: [{ name: 'Done', color: '#339933', category: 'Completed' }],
      },
    ]);
    // The icon came from under the organization itself, so it carried the PAT.
    const icon = hx.server.requests.find((r) =>
      r.path.startsWith('/unreliablewitness/_apis/wit/workItemIcons/'),
    );
    expect(icon!.auth).toBe(`Basic ${Buffer.from(':p').toString('base64')}`);
    const before = hx.server.requests.length;
    expect(await hx.h['workItems:types'](c.id)).toEqual(types);
    expect(hx.server.requests.length).toBe(before);
  });
  it('gets one work item live, or null when it is gone', async () => {
    const hx = await harness();
    const c = await save(hx);
    expect(await hx.h['workItems:get'](c.id, '5')).toMatchObject({
      id: '5',
      state: 'To Do',
    });
    expect(await hx.h['workItems:get'](c.id, '5')).not.toHaveProperty(
      'remainingWork',
    );
    hx.server.route('GET', '/unreliablewitness/_apis/wit/workitems', {
      body: { value: [null] },
    });
    expect(await hx.h['workItems:get'](c.id, '5')).toBeNull();
    expect(await hx.h['workItems:get'](c.id, 'x')).toBeNull();
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
    expect(await hx.h['app:info']()).toEqual({
      version: '9.9.9',
      windowsBuild: null,
    });
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

  it('writes nothing to Azure DevOps when cost writing is off (the default)', async () => {
    const hx = await harness();
    await hx.settings.save({ ...hx.settings.get(), writeCostToAdo: false });
    const { t } = await linkedTask(hx);
    await expect(hx.h['usage:sync'](t.id)).rejects.toThrow(
      'Writing AI cost to Azure DevOps is off',
    );
    hx.hourly[0]();
    await hx.h['tasks:finish'](t.id, {
      closeTerminals: true,
      removeWorktree: true,
      deleteBranch: true,
      syncUsage: true,
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(
      hx.server.requests.filter(
        (r) => r.method === 'PATCH' || r.path.includes('/comments'),
      ),
    ).toEqual([]);
    expect(hx.store.state.tasks[0]).toMatchObject({
      status: 'done',
      usageSyncedAt: null,
      usageCommentId: null,
    });
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

describe('handlers: telemetry', () => {
  function recorder() {
    const items: {
      kind: string;
      name: string;
      props?: unknown;
      m?: unknown;
    }[] = [];
    const telemetry: Telemetry = {
      event: (name, props, m) => items.push({ kind: 'event', name, props, m }),
      pageView: (name) => items.push({ kind: 'pageView', name }),
      metric: (name, value, props) =>
        items.push({ kind: 'metric', name, props, m: value }),
      exception: (e, props) =>
        items.push({ kind: 'exception', name: String(e), props }),
      exceptionParts: (p) => items.push({ kind: 'exception', name: p.message }),
      dependency: (d) => items.push({ kind: 'dependency', name: d.name }),
      flush: async () => {},
    };
    return { items, telemetry };
  }

  it('reports task creation, setup timing and terminals without names', async () => {
    const { items, telemetry } = recorder();
    const hx = await harness(fakeCrypto(), { telemetry });
    const done = hx.setupDone();
    const task = await hx.h['tasks:create'](hx.input());
    await done;
    const names = items.map((i) => `${i.kind}:${i.name}`);
    expect(names).toContain('event:repo.added');
    expect(names).toContain('event:task.created');
    expect(names).toContain('metric:setup.step.worktree');
    expect(names).toContain('event:terminal.opened');
    const finished = items.find((i) => i.name === 'setup.finished');
    expect(finished?.props).toMatchObject({ ok: true, failedStep: 'none' });
    expect(finished?.m).toMatchObject({ durationMs: expect.any(Number) });
    // No title, branch or repo name in any property.
    const all = JSON.stringify(items);
    expect(all).not.toContain('delivery');
    expect(all).not.toContain('webshop');
    hx.terminals.killAllForTask(task.id);
  });

  it('reports which settings changed, but not turning telemetry off', async () => {
    const { items, telemetry } = recorder();
    const hx = await harness(fakeCrypto(), { telemetry });
    const s = await hx.h['settings:get']();
    await hx.h['settings:save']({ ...s, showSplash: false });
    await hx.h['settings:save']({
      ...s,
      showSplash: false,
      sendTelemetry: false,
    });
    expect(items.filter((i) => i.name === 'settings.changed')).toEqual([
      {
        kind: 'event',
        name: 'settings.changed',
        props: { keys: 'showSplash' },
        m: undefined,
      },
    ]);
  });
});

describe('handlers: work item on start', () => {
  async function connected(hx: Awaited<ReturnType<typeof harness>>) {
    routeHealthyOrg(hx.server);
    const c = await hx.h['connections:save']({
      organizationUrl: `${hx.server.url}/unreliablewitness`,
      project: 'MIAC',
      pat: 'p',
    });
    await hx.connections.setStatus(c.id, 'ok', 'Dries Hoebeke', 'me@x.com');
    await hx.h['repos:setConnection'](hx.added.id, c.id);
    const client = hx.services.ado.client(c.id);
    vi.spyOn(client, 'workItemForStart').mockResolvedValue({
      type: 'Task',
      state: 'To Do',
      assignedTo: null,
    });
    vi.spyOn(client, 'typeStates').mockResolvedValue([
      { name: 'To Do', category: 'Proposed' },
      { name: 'Doing', category: 'InProgress' },
      { name: 'Done', category: 'Completed' },
    ]);
    const update = vi.spyOn(client, 'updateWorkItem').mockResolvedValue();
    return { c, client, update };
  }

  async function createAndWait(
    hx: Awaited<ReturnType<typeof harness>>,
    over: Partial<CreateTaskInput> = {},
  ) {
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](
      hx.input({ openShell: false, ...over }),
    );
    const finished = await done;
    const state = await hx.h['tasks:setupState'](t.id);
    return { t, finished, state };
  }

  it('moves the work item to In Progress and assigns it to the user', async () => {
    const hx = await harness();
    const { update } = await connected(hx);
    const { finished, state } = await createAndWait(hx);
    expect(finished.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(48231, {
      state: 'Doing',
      assignedTo: 'me@x.com',
    });
    const step = state?.steps.find((s) => s.def.kind === 'work-item');
    expect(state?.steps.map((s) => s.def.kind).slice(0, 3)).toEqual([
      'fetch',
      'worktree',
      'work-item',
    ]);
    expect(step?.status).toBe('done');
  });

  it('looks up the unique name for a connection saved before it was stored', async () => {
    const hx = await harness();
    const { c, update } = await connected(hx);
    await hx.connections.setStatus(c.id, 'ok', 'Dries Hoebeke', null);
    hx.server.route('GET', '/unreliablewitness/_apis/connectionData', {
      body: {
        authenticatedUser: {
          providerDisplayName: 'Dries Hoebeke',
          properties: { Account: { $value: 'me@x.com' } },
        },
      },
    });
    await createAndWait(hx);
    expect(update).toHaveBeenCalledWith(48231, {
      state: 'Doing',
      assignedTo: 'me@x.com',
    });
    expect(hx.connections.get(c.id).userUniqueName).toBe('me@x.com');
  });

  it('warns but finishes the setup when the update fails', async () => {
    const hx = await harness();
    const { update } = await connected(hx);
    update.mockRejectedValue(new Error('Azure DevOps is unreachable'));
    const { finished, state } = await createAndWait(hx);
    expect(finished.ok).toBe(true);
    expect(state?.steps.find((s) => s.def.kind === 'work-item')).toMatchObject({
      status: 'warn',
      detail: 'Azure DevOps is unreachable',
    });
    expect((await hx.h['tasks:list']())[0].status).toBe('ready');
  });

  it('has no work item step for a blank task', async () => {
    const hx = await harness();
    const { update } = await connected(hx);
    const { state } = await createAndWait(hx, {
      workItem: null,
      name: 'Spike',
      branch: 'spike',
    });
    expect(state?.steps.map((s) => s.def.kind)).not.toContain('work-item');
    expect(update).not.toHaveBeenCalled();
  });

  it('has no work item step on a repo without a connection', async () => {
    const hx = await harness();
    const { state } = await createAndWait(hx);
    expect(state?.steps.map((s) => s.def.kind)).not.toContain('work-item');
  });

  it('has no work item step when both start options are off', async () => {
    const hx = await harness();
    const { update } = await connected(hx);
    await hx.services.repos.setWorkItemOnStart(hx.added.id, {
      moveToInProgress: false,
      assignToMe: false,
      stateOverrides: {},
    });
    const { state } = await createAndWait(hx);
    expect(state?.steps.map((s) => s.def.kind)).not.toContain('work-item');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('handlers: finish with a pull request', () => {
  const PR_URL = 'https://dev.azure.com/contoso/P/_git/R/pullrequest/7';
  const finishWithPr = {
    closeTerminals: true,
    removeWorktree: true,
    deleteBranch: true,
    syncUsage: false,
    createPullRequest: true,
  };

  async function prHarness(
    remote = 'https://dev.azure.com/contoso/P/_git/R',
    over: Partial<CreateTaskInput> = {},
  ) {
    const hx = await harness();
    const bare = addOrigin(hx.repo);
    const c = await hx.connections.save({
      organizationUrl: 'https://dev.azure.com/contoso',
      project: 'P',
      pat: 'p',
    });
    await hx.h['repos:setConnection'](hx.added.id, c.id);
    vi.spyOn(hx.services.git, 'remoteUrl').mockResolvedValue(remote);
    const client = hx.services.ado.client(c.id);
    const repositoryId = vi
      .spyOn(client, 'repositoryId')
      .mockResolvedValue('repo-1');
    const findActive = vi
      .spyOn(client, 'findActivePullRequest')
      .mockResolvedValue(null);
    const create = vi.spyOn(client, 'createPullRequest').mockResolvedValue({
      pullRequestId: 7,
      status: 'active',
      isDraft: true,
    });
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](
      hx.input({ baseRef: 'origin/main', openShell: false, ...over }),
    );
    await done;
    return { ...hx, bare, c, client, repositoryId, findActive, create, t };
  }

  it('reports availability with the target branch', async () => {
    const hx = await prHarness();
    expect(await hx.h['tasks:prAvailability'](hx.t.id)).toEqual({
      available: true,
      reason: null,
      target: 'main',
    });
    vi.mocked(hx.services.git.remoteUrl).mockResolvedValue(
      'https://github.com/contoso/R.git',
    );
    expect(await hx.h['tasks:prAvailability'](hx.t.id)).toEqual({
      available: false,
      reason: 'origin is not an Azure Repos URL',
      target: null,
    });
  });

  it('tells telemetry to scrub the project and repo of the Azure Repos remote', async () => {
    const hx = await prHarness(
      'git@ssh.dev.azure.com:v3/contoso/Other%20Project/azure-repo',
    );
    const seen: string[] = [];
    hx.services.rememberSensitive = (values) => seen.push(...values);
    await hx.h['tasks:prAvailability'](hx.t.id);
    expect(seen).toEqual(
      expect.arrayContaining(['Other Project', 'azure-repo']),
    );
  });

  it('pushes, creates a draft PR linked to the work item, opens it, then cleans up', async () => {
    const hx = await prHarness();
    commitFile(hx.t.worktreePath, 'feature.txt', 'a\n', 'Add the feature');
    await hx.h['tasks:finish'](hx.t.id, finishWithPr);
    expect(git(hx.bare, 'branch', '--list', hx.t.branch).trim()).toContain(
      hx.t.branch,
    );
    expect(hx.repositoryId).toHaveBeenCalledWith('P', 'R');
    expect(hx.findActive).toHaveBeenCalledWith('P', 'repo-1', hx.t.branch);
    expect(hx.create).toHaveBeenCalledWith(
      'P',
      'repo-1',
      expect.objectContaining({
        source: hx.t.branch,
        target: 'main',
        title: prTitle(hx.t),
        workItemId: 48231,
      }),
    );
    const description = hx.create.mock.calls[0][2].description;
    expect(description).toContain('Add the feature');
    expect(description).toContain('recorded by MIAC');
    expect(description).toContain('AI cost for this task: ');
    expect(hx.opened).toEqual([PR_URL]);
    const [view] = await hx.h['tasks:list']();
    expect(view.status).toBe('done');
    expect(view.pullRequest).toEqual({
      id: 7,
      url: PR_URL,
      repositoryId: 'repo-1',
      project: 'P',
      repo: 'R',
      status: 'active',
      isDraft: true,
    });
    expect(existsSync(hx.t.worktreePath)).toBe(false);
  });

  it('leaves the AI cost out of the PR description when cost writing is off', async () => {
    const hx = await prHarness();
    await hx.settings.save({ ...hx.settings.get(), writeCostToAdo: false });
    commitFile(hx.t.worktreePath, 'feature.txt', 'a\n', 'Add the feature');
    await hx.h['tasks:finish'](hx.t.id, finishWithPr);
    const description = hx.create.mock.calls[0][2].description;
    expect(description).toContain('Add the feature');
    expect(description).not.toContain('AI cost');
  });

  it('records the branch as pushed in the Done summary, since the PR pushed it', async () => {
    const hx = await prHarness();
    commitFile(hx.t.worktreePath, 'feature.txt', 'a\n', 'Add the feature');
    await hx.h['tasks:finish'](hx.t.id, finishWithPr);
    const [view] = await hx.h['tasks:list']();
    expect(view.summary).toMatchObject({
      pushed: true,
      upstream: `origin/${hx.t.branch}`,
      commitCount: 1,
    });
  });

  it('links an existing active PR instead of creating another', async () => {
    const hx = await prHarness();
    hx.findActive.mockResolvedValue({
      pullRequestId: 3,
      status: 'active',
      isDraft: false,
    });
    await hx.h['tasks:finish'](hx.t.id, finishWithPr);
    expect(hx.create).not.toHaveBeenCalled();
    const [view] = await hx.h['tasks:list']();
    expect(view.pullRequest).toMatchObject({ id: 3, isDraft: false });
    expect(hx.opened).toEqual([
      'https://dev.azure.com/contoso/P/_git/R/pullrequest/3',
    ]);
  });

  it('stops Finish before cleanup when the push is rejected', async () => {
    const hx = await prHarness('https://dev.azure.com/contoso/P/_git/R', {
      openShell: true,
    });
    commitFile(hx.t.worktreePath, 'mine.txt', 'a\n', 'Mine');
    git(hx.t.worktreePath, 'push', '-q', 'origin', hx.t.branch);
    const other = path.join(path.dirname(hx.bare), 'other');
    git(
      path.dirname(hx.bare),
      'clone',
      '-q',
      '-b',
      hx.t.branch,
      hx.bare,
      'other',
    );
    git(other, 'config', 'user.email', 'tests@miac.local');
    git(other, 'config', 'user.name', 'MIAC tests');
    commitFile(other, 'theirs.txt', 'b\n', 'Theirs');
    git(other, 'push', '-q', 'origin', hx.t.branch);
    git(hx.t.worktreePath, 'commit', '-q', '--amend', '-m', 'Mine again');
    const kill = vi.spyOn(hx.terminals, 'kill');
    await expect(hx.h['tasks:finish'](hx.t.id, finishWithPr)).rejects.toThrow(
      /^Pull request not created: [^]*rejected/,
    );
    expect(hx.store.state.tasks[0].status).toBe('ready');
    expect(hx.store.state.tasks[0].pullRequest).toBeNull();
    expect(existsSync(hx.t.worktreePath)).toBe(true);
    expect(kill).not.toHaveBeenCalled();
    expectTerminalsKept(hx.store, hx.terminals, hx.t.id, 1);
    expect(hx.create).not.toHaveBeenCalled();
    expect(hx.opened).toEqual([]);
    kill.mockRestore();
    await hx.terminals.killAllForTask(hx.t.id);
  });

  it('stops Finish before cleanup when the push hangs past its timeout', async () => {
    const hx = await prHarness();
    commitFile(hx.t.worktreePath, 'mine.txt', 'a\n', 'Mine');
    const hook = path.join(hx.repo, '.git', 'hooks', 'pre-push');
    writeFileSync(hook, '#!/bin/sh\nsleep 10\n');
    chmodSync(hook, 0o755);
    (hx.services.git as { pushTimeoutMs: number }).pushTimeoutMs = 300;
    await expect(hx.h['tasks:finish'](hx.t.id, finishWithPr)).rejects.toThrow(
      'Pull request not created: git push timed out after 0.3 s (a credential prompt may be waiting)',
    );
    expect(hx.store.state.tasks[0].status).toBe('ready');
    expect(existsSync(hx.t.worktreePath)).toBe(true);
    expect(hx.create).not.toHaveBeenCalled();
  });

  it('stops Finish before cleanup when the PR call fails', async () => {
    const hx = await prHarness();
    hx.create.mockRejectedValue(
      new AdoError('unauthorized', '_apis/git', CODE_WRITE_DENIED, 403),
    );
    await expect(hx.h['tasks:finish'](hx.t.id, finishWithPr)).rejects.toThrow(
      'Pull request not created: The token cannot create pull requests (needs Code: Read & write)',
    );
    expect(hx.store.state.tasks[0].status).toBe('ready');
    expect(existsSync(hx.t.worktreePath)).toBe(true);
  });

  it('refuses a PR when pull requests are unavailable, and cleans up nothing', async () => {
    const hx = await prHarness('https://github.com/contoso/R.git');
    const push = vi.spyOn(hx.services.git, 'push');
    await expect(hx.h['tasks:finish'](hx.t.id, finishWithPr)).rejects.toThrow(
      'Pull request not created: origin is not an Azure Repos URL',
    );
    expect(push).not.toHaveBeenCalled();
    expect(hx.store.state.tasks[0].status).toBe('ready');
    expect(existsSync(hx.t.worktreePath)).toBe(true);
    expect(await new GitClient().branchExists(hx.repo, hx.t.branch)).toBe(true);
  });

  it('refreshes the PR status, keeping the stored ref when the refresh fails', async () => {
    const hx = await prHarness();
    expect(await hx.h['tasks:prStatus'](hx.t.id)).toBeNull();
    await hx.h['tasks:finish'](hx.t.id, finishWithPr);
    const refresh = vi.spyOn(hx.client, 'pullRequest').mockResolvedValue({
      pullRequestId: 7,
      status: 'completed',
      isDraft: false,
    });
    const next = await hx.h['tasks:prStatus'](hx.t.id);
    expect(refresh).toHaveBeenCalledWith('P', 'repo-1', 7);
    expect(next).toMatchObject({ id: 7, status: 'completed', isDraft: false });
    expect(hx.store.state.tasks[0].pullRequest).toEqual(next);
    refresh.mockRejectedValue(new Error('offline'));
    expect(await hx.h['tasks:prStatus'](hx.t.id)).toEqual(next);
  });

  it('refreshes and stores an extra workspace PR', async () => {
    const hx = await prHarness();
    const pr = {
      id: 8,
      url: 'u',
      repositoryId: 'rid2',
      project: 'P',
      repo: 'api',
      status: 'active' as const,
      isDraft: true,
    };
    await hx.store.update((st) => {
      st.tasks[0].extraWorkspaces.push({
        id: 'x1',
        repoId: hx.t.repoId,
        branch: 'feature/x',
        worktreePath: '/w/x',
        baseRef: 'origin/main',
        baseSha: null,
        source: 'detected',
        summary: null,
        pullRequest: pr,
        reopen: null,
        dropped: false,
      });
    });
    const refresh = vi.spyOn(hx.client, 'pullRequest').mockResolvedValue({
      pullRequestId: 8,
      status: 'completed',
      isDraft: false,
    });
    const next = await hx.h['tasks:prStatus'](hx.t.id, 'x1');
    expect(refresh).toHaveBeenCalledWith('P', 'rid2', 8);
    expect(next).toMatchObject({ id: 8, status: 'completed' });
    expect(hx.store.state.tasks[0].extraWorkspaces[0].pullRequest).toEqual(
      next,
    );
    expect(hx.store.state.tasks[0].pullRequest).toBeNull();
  });

  it('refreshes a workspace PR through its own repo connection, not the task one', async () => {
    const hx = await prHarness();
    const other = await hx.connections.save({
      organizationUrl: 'https://dev.azure.com/other',
      project: 'Q',
      pat: 'p',
    });
    const pr = {
      id: 8,
      url: 'u',
      repositoryId: 'rid2',
      project: 'P',
      repo: 'api',
      status: 'active' as const,
      isDraft: true,
    };
    await hx.store.update((st) => {
      st.tasks[0].connectionId = other.id;
      st.tasks[0].extraWorkspaces.push({
        id: 'x1',
        repoId: hx.t.repoId,
        branch: 'feature/x',
        worktreePath: '/w/x',
        baseRef: 'origin/main',
        baseSha: null,
        source: 'detected',
        summary: null,
        pullRequest: pr,
        reopen: null,
        dropped: false,
      });
    });
    const own = vi.spyOn(hx.client, 'pullRequest').mockResolvedValue({
      pullRequestId: 8,
      status: 'completed',
      isDraft: false,
    });
    const taskClient = vi.spyOn(
      hx.services.ado.client(other.id),
      'pullRequest',
    );
    await hx.h['tasks:prStatus'](hx.t.id, 'x1');
    expect(own).toHaveBeenCalledWith('P', 'rid2', 8);
    expect(taskClient).not.toHaveBeenCalled();
  });

  it('finishChecks still reports unpushed commits as a count', async () => {
    const hx = await prHarness();
    commitFile(hx.t.worktreePath, 'feature.txt', 'a\n', 'Add the feature');
    const checks = await hx.h['tasks:finishChecks'](hx.t.id);
    expect(checks.unpushed).toBe(1);
    expect(checks.runningTerminals).toBe(0);
  });
});

describe('handlers: task-level connection', () => {
  it('stores the repo connection on the task when it is created', async () => {
    const hx = await harness();
    const { t } = await linkedTask(hx);
    expect(t.connectionId).toBe(
      hx.services.repos.get(hx.added.id).connectionId,
    );
    expect(t.connectionId).not.toBeNull();
  });

  it('syncs usage to the task connection even after the repo is unlinked', async () => {
    const hx = await harness();
    const { t } = await linkedTask(hx);
    await hx.h['repos:setConnection'](hx.added.id, null);
    expect(await hx.h['usage:sync'](t.id)).toMatchObject({ ok: true });
  });

  it('prefers the task connection over the home repo connection', async () => {
    const hx = await harness();
    const { t } = await linkedTask(hx);
    await hx.store.update((st) => {
      st.tasks[0].connectionId = 'c2';
    });
    // c2 does not exist: the sync target is gone, though the repo still links the real connection.
    expect(await hx.h['usage:sync'](t.id)).toMatchObject({ ok: false });
  });

  it('refreshes the PR status through the task connection', async () => {
    const hx = await harness();
    const { t } = await linkedTask(hx);
    const client = hx.services.ado.client(t.connectionId!);
    const refresh = vi.spyOn(client, 'pullRequest').mockResolvedValue({
      pullRequestId: 7,
      status: 'completed',
      isDraft: false,
    });
    await hx.store.update((st) => {
      st.tasks[0].pullRequest = {
        id: 7,
        url: 'u',
        repositoryId: 'repo-1',
        project: 'P',
        repo: 'R',
        status: 'active',
        isDraft: true,
      };
    });
    await hx.h['repos:setConnection'](hx.added.id, null);
    expect(await hx.h['tasks:prStatus'](t.id)).toMatchObject({
      status: 'completed',
    });
    expect(refresh).toHaveBeenCalled();
  });
});

describe('handlers: finish every workspace of a task', () => {
  const HOME_REMOTE = 'https://dev.azure.com/contoso/P/_git/Web';
  const opts = {
    closeTerminals: true,
    removeWorktree: true,
    deleteBranch: true,
    syncUsage: false,
  };

  /** A task in `webshop` (home, origin Web) plus worktrees on its branch in more repos, joined by a scan. */
  async function multiHarness(
    extras: { name: string; org?: string }[],
    over: Partial<CreateTaskInput> = {},
  ) {
    const hx = await harness();
    commitFile(hx.repo, '.gitignore', '.env\n');
    addOrigin(hx.repo);
    const c = await hx.connections.save({
      organizationUrl: 'https://dev.azure.com/contoso',
      project: 'P',
      pat: 'p',
    });
    await hx.h['repos:setConnection'](hx.added.id, c.id);
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](
      hx.input({
        baseRef: 'origin/main',
        openShell: false,
        // The copied .env is ignored, as in a real repo; no generated files.
        commands: [],
        ...over,
      }),
    );
    await done;
    const remotes = new Map<string, string>([[hx.repo, HOME_REMOTE]]);
    const repos: {
      name: string;
      path: string;
      wt: string;
      bare: string;
      connectionId: string;
    }[] = [];
    for (const e of extras) {
      const p = makeRepo(e.name);
      const bare = addOrigin(p);
      const org = e.org ?? 'contoso';
      const conn =
        org === 'contoso'
          ? c
          : await hx.connections.save({
              organizationUrl: `https://dev.azure.com/${org}`,
              project: 'P',
              pat: 'p',
            });
      const added = await hx.h['repos:add'](p);
      await hx.h['repos:setConnection'](added.id, conn.id);
      remotes.set(p, `https://dev.azure.com/${org}/P/_git/${e.name}`);
      const wt = path.join(path.dirname(p), `${e.name}-wt`);
      git(p, 'worktree', 'add', '-q', '-b', t.branch, wt, 'origin/main');
      repos.push({ name: e.name, path: p, wt, bare, connectionId: conn.id });
    }
    vi.spyOn(hx.services.git, 'remoteUrl').mockImplementation(
      async (cwd) => remotes.get(cwd) ?? null,
    );
    await hx.h['tasks:scanWorkspaces'](t.id);
    const ids = hx.store.state.tasks[0].extraWorkspaces.map((w) => w.id);
    expect(ids).toHaveLength(extras.length);
    // One fake Azure Repos per connection: PRs it created are found again as active.
    const created: { connectionId: string; repo: string; args: unknown }[] = [];
    const clients = new Map<
      string,
      ReturnType<typeof hx.services.ado.client>
    >();
    for (const id of new Set([c.id, ...repos.map((r) => r.connectionId)])) {
      const client = hx.services.ado.client(id);
      clients.set(id, client);
      vi.spyOn(client, 'repositoryId').mockImplementation(
        async (_p, name) => `id-${name}`,
      );
      vi.spyOn(client, 'findActivePullRequest').mockImplementation(
        async (_p, repositoryId) => {
          const n = created.findIndex(
            (x) => x.connectionId === id && `id-${x.repo}` === repositoryId,
          );
          return n < 0
            ? null
            : { pullRequestId: 100 + n, status: 'active', isDraft: true };
        },
      );
      vi.spyOn(client, 'createPullRequest').mockImplementation(
        async (_p, repositoryId, args) => {
          created.push({
            connectionId: id,
            repo: repositoryId.slice(3),
            args,
          });
          return {
            pullRequestId: 100 + created.length - 1,
            status: 'active',
            isDraft: true,
          };
        },
      );
    }
    const push = vi.spyOn(hx.services.git, 'push');
    return { ...hx, c, t, repos, ids, created, clients, push };
  }

  const ws = (hx: { store: TaskStore }, id: string) =>
    hx.store.state.tasks[0].extraWorkspaces.find((w) => w.id === id)!;

  it('checks every workspace: changes, PR target and whether the PR links the work item', async () => {
    const hx = await multiHarness([
      { name: 'api' },
      { name: 'docs', org: 'fabrikam' },
    ]);
    commitFile(hx.repos[0].wt, 'api.txt', 'a\n', 'API change');
    const checks = await hx.h['tasks:finishChecks'](hx.t.id);
    expect(checks.workspaces.map((w) => w.workspaceId)).toEqual([
      'home',
      ...hx.ids,
    ]);
    expect(checks.workspaces[0]).toMatchObject({
      repoName: 'webshop',
      branch: hx.t.branch,
      missing: false,
      commits: 0,
      pr: { available: true, target: 'main', linksWorkItem: true },
    });
    expect(checks.workspaces[1]).toMatchObject({
      repoName: 'api',
      commits: 1,
      unpushed: 1,
      pr: { available: true, target: 'main', linksWorkItem: true },
    });
    expect(checks.workspaces[2].pr).toMatchObject({
      available: true,
      linksWorkItem: false,
    });
    expect(await hx.h['tasks:prAvailability'](hx.t.id, hx.ids[0])).toEqual({
      available: true,
      reason: null,
      target: 'main',
    });
  });

  it('drops the home without a push and opens a PR for the repo with changes', async () => {
    const hx = await multiHarness([{ name: 'api' }]);
    commitFile(hx.repos[0].wt, 'api.txt', 'a\n', 'API change');
    // The copied .env is gitignored, so the home still counts as unchanged.
    expect(existsSync(path.join(hx.t.worktreePath, '.env'))).toBe(true);
    await hx.h['tasks:finish'](hx.t.id, {
      ...opts,
      deleteBranch: false,
      removeWorktree: false,
      workspaces: [
        { workspaceId: 'home', action: 'drop' },
        { workspaceId: hx.ids[0], action: 'pr' },
      ],
    });
    expect(hx.push.mock.calls.map((c) => c[0])).toEqual([hx.repos[0].wt]);
    const task = hx.store.state.tasks[0];
    expect(task.status).toBe('done');
    expect(task.homeDropped).toBe(true);
    // A dropped workspace is always removed, whatever the global options say.
    expect(existsSync(hx.t.worktreePath)).toBe(false);
    expect(await new GitClient().branchExists(hx.repo, hx.t.branch)).toBe(
      false,
    );
    expect(existsSync(hx.repos[0].wt)).toBe(true);
    expect(git(hx.repos[0].bare, 'branch', '--list', hx.t.branch)).toContain(
      hx.t.branch,
    );
    expect(hx.created).toHaveLength(1);
    expect(hx.created[0]).toMatchObject({
      repo: 'api',
      args: { source: hx.t.branch, target: 'main', workItemId: 48231 },
    });
    // One repo with changes: the cost line is the plain one.
    expect(
      (hx.created[0].args as { description: string }).description,
    ).toContain('AI cost for this task: ');
    expect(ws(hx, hx.ids[0]).pullRequest).toMatchObject({
      id: 100,
      repo: 'api',
      url: 'https://dev.azure.com/contoso/P/_git/api/pullrequest/100',
    });
    expect(ws(hx, hx.ids[0]).summary).toMatchObject({
      pushed: true,
      commitCount: 1,
    });
    expect(task.pullRequest).toBeNull();
    expect(hx.opened).toEqual([
      'https://dev.azure.com/contoso/P/_git/api/pullrequest/100',
    ]);
  });

  it('marks the cost line as the whole task when several repos have changes', async () => {
    const hx = await multiHarness([{ name: 'api' }]);
    commitFile(hx.t.worktreePath, 'web.txt', 'a\n', 'Web change');
    commitFile(hx.repos[0].wt, 'api.txt', 'a\n', 'API change');
    await hx.h['tasks:finish'](hx.t.id, {
      ...opts,
      workspaces: [
        { workspaceId: 'home', action: 'pr' },
        { workspaceId: hx.ids[0], action: 'pr' },
      ],
    });
    expect(hx.created.map((x) => x.repo)).toEqual(['Web', 'api']);
    for (const x of hx.created)
      expect((x.args as { description: string }).description).toContain(
        'AI cost (whole task, 2 repos): ',
      );
    const task = hx.store.state.tasks[0];
    expect(task.pullRequest).toMatchObject({ repo: 'Web' });
    expect(ws(hx, hx.ids[0]).pullRequest).toMatchObject({ repo: 'api' });
    expect(existsSync(hx.t.worktreePath)).toBe(false);
    expect(existsSync(hx.repos[0].wt)).toBe(false);
    expect(
      await new GitClient().branchExists(hx.repos[0].path, hx.t.branch),
    ).toBe(false);
  });

  it('stops before cleanup when one PR fails, and a retry neither pushes again nor duplicates the PR', async () => {
    const hx = await multiHarness([{ name: 'api' }, { name: 'docs' }]);
    commitFile(hx.repos[0].wt, 'api.txt', 'a\n', 'API change');
    commitFile(hx.repos[1].wt, 'docs.txt', 'a\n', 'Docs change');
    const realPush = GitClient.prototype.push;
    let failDocs = true;
    hx.push.mockImplementation(
      async function (this: GitClient, cwd, remote, branch) {
        if (failDocs && cwd === hx.repos[1].wt)
          throw new Error('! [rejected] (fetch first)');
        return realPush.call(this, cwd, remote, branch);
      },
    );
    const finishAll = {
      ...opts,
      workspaces: [
        { workspaceId: 'home', action: 'drop' as const },
        { workspaceId: hx.ids[0], action: 'pr' as const },
        { workspaceId: hx.ids[1], action: 'pr' as const },
      ],
    };
    await expect(hx.h['tasks:finish'](hx.t.id, finishAll)).rejects.toThrow(
      /^Pull request not created for docs: [^]*rejected/,
    );
    const failed = hx.store.state.tasks[0];
    expect(failed.status).toBe('ready');
    expect(failed.homeDropped).toBe(false);
    expect(ws(hx, hx.ids[0]).pullRequest).toMatchObject({ repo: 'api' });
    expect(ws(hx, hx.ids[1]).pullRequest).toBeNull();
    expect(existsSync(hx.t.worktreePath)).toBe(true);
    expect(existsSync(hx.repos[0].wt)).toBe(true);
    expect(existsSync(hx.repos[1].wt)).toBe(true);
    expect(hx.opened).toEqual([
      'https://dev.azure.com/contoso/P/_git/api/pullrequest/100',
    ]);
    expect(await hx.h['tasks:finishResults'](hx.t.id)).toEqual([
      {
        workspaceId: 'home',
        action: 'drop',
        ok: true,
        pushed: false,
        pullRequest: null,
        error: null,
      },
      {
        workspaceId: hx.ids[0],
        action: 'pr',
        ok: true,
        pushed: true,
        pullRequest: {
          id: 100,
          url: 'https://dev.azure.com/contoso/P/_git/api/pullrequest/100',
          linked: false,
        },
        error: null,
      },
      {
        workspaceId: hx.ids[1],
        action: 'pr',
        ok: false,
        pushed: false,
        pullRequest: null,
        error: '! [rejected] (fetch first)',
      },
    ]);

    failDocs = false;
    hx.push.mockClear();
    // The api PR was completed meanwhile: the retry keeps the stored one instead of making a second.
    const findActive = vi.mocked(
      hx.clients.get(hx.c.id)!.findActivePullRequest,
    );
    findActive.mockClear();
    await hx.h['tasks:finish'](hx.t.id, finishAll);
    expect(findActive.mock.calls.map((c) => c[1])).toEqual(['id-docs']);
    expect(hx.push.mock.calls.map((c) => c[0])).toEqual([hx.repos[1].wt]);
    expect(hx.created.map((x) => x.repo)).toEqual(['api', 'docs']);
    expect(ws(hx, hx.ids[0]).pullRequest).toMatchObject({ id: 100 });
    expect(ws(hx, hx.ids[1]).pullRequest).toMatchObject({ id: 101 });
    const task = hx.store.state.tasks[0];
    expect(task.status).toBe('done');
    expect(task.homeDropped).toBe(true);
    expect(existsSync(hx.repos[1].wt)).toBe(false);
  });

  it('finishes without the PR for the failed row only', async () => {
    const hx = await multiHarness([{ name: 'api' }, { name: 'docs' }]);
    commitFile(hx.repos[0].wt, 'api.txt', 'a\n', 'API change');
    commitFile(hx.repos[1].wt, 'docs.txt', 'a\n', 'Docs change');
    vi.mocked(hx.clients.get(hx.c.id)!.createPullRequest).mockRejectedValueOnce(
      new Error('boom'),
    );
    const rows = (api: 'pr' | 'keep') => ({
      ...opts,
      workspaces: [
        { workspaceId: 'home', action: 'drop' as const },
        { workspaceId: hx.ids[0], action: api },
        { workspaceId: hx.ids[1], action: 'pr' as const },
      ],
    });
    await expect(hx.h['tasks:finish'](hx.t.id, rows('pr'))).rejects.toThrow(
      'Pull request not created for api: boom',
    );
    expect(ws(hx, hx.ids[1]).pullRequest).toMatchObject({ repo: 'docs' });
    // Finish without PR keeps api; docs' PR exists already, so it is linked, not created again.
    await hx.h['tasks:finish'](hx.t.id, rows('keep'));
    expect(hx.created.map((x) => x.repo)).toEqual(['docs']);
    const task = hx.store.state.tasks[0];
    expect(task.status).toBe('done');
    expect(ws(hx, hx.ids[0]).pullRequest).toBeNull();
    expect(existsSync(hx.repos[0].wt)).toBe(false);
    expect(existsSync(hx.repos[1].wt)).toBe(false);
  });

  it('refuses to drop a repo that got changes after the checks, and cleans up nothing', async () => {
    const hx = await multiHarness([{ name: 'api' }]);
    commitFile(hx.repos[0].wt, 'api.txt', 'a\n', 'API change');
    const checks = await hx.h['tasks:finishChecks'](hx.t.id);
    expect(checks.workspaces[0]).toMatchObject({ commits: 0, uncommitted: [] });
    // Claude keeps working while the Finish page is open.
    commitFile(hx.t.worktreePath, 'late.txt', 'a\n', 'Late change');
    await expect(
      hx.h['tasks:finish'](hx.t.id, {
        ...opts,
        workspaces: [
          { workspaceId: 'home', action: 'drop' },
          { workspaceId: hx.ids[0], action: 'push' },
        ],
      }),
    ).rejects.toThrow('webshop has changes now; reload Finish');
    const task = hx.store.state.tasks[0];
    expect(task.status).toBe('ready');
    expect(task.homeDropped).toBe(false);
    expect(existsSync(hx.t.worktreePath)).toBe(true);
    expect(existsSync(hx.repos[0].wt)).toBe(true);
    expect(await new GitClient().branchExists(hx.repo, hx.t.branch)).toBe(true);
    // Uncommitted files count as changes too.
    git(hx.t.worktreePath, 'reset', '-q', '--hard', 'HEAD~1');
    writeFileSync(path.join(hx.t.worktreePath, 'draft.txt'), 'x');
    await expect(
      hx.h['tasks:finish'](hx.t.id, {
        ...opts,
        workspaces: [{ workspaceId: 'home', action: 'drop' }],
      }),
    ).rejects.toThrow('webshop has changes now; reload Finish');
    expect(existsSync(path.join(hx.t.worktreePath, 'draft.txt'))).toBe(true);
  });

  it('keeps the summaries when cleanup fails midway', async () => {
    const hx = await multiHarness([{ name: 'api' }]);
    commitFile(hx.repos[0].wt, 'api.txt', 'a\n', 'API change');
    vi.spyOn(hx.services.git, 'worktreeRemove').mockRejectedValueOnce(
      new Error('folder locked'),
    );
    await expect(
      hx.h['tasks:finish'](hx.t.id, {
        ...opts,
        workspaces: [
          { workspaceId: 'home', action: 'keep' },
          { workspaceId: hx.ids[0], action: 'push' },
        ],
      }),
    ).rejects.toThrow('folder locked');
    const task = hx.store.state.tasks[0];
    expect(task.status).toBe('ready');
    expect(task.summary).toMatchObject({ commitCount: 0 });
    expect(ws(hx, hx.ids[0]).summary).toMatchObject({
      commitCount: 1,
      pushed: true,
    });
  });

  it('a PR stored by an earlier Finish (before a Reopen) is looked up again, not kept', async () => {
    const hx = await multiHarness([{ name: 'api' }]);
    commitFile(hx.repos[0].wt, 'api.txt', 'a\n', 'API change');
    await hx.store.update((st) => {
      st.tasks[0].extraWorkspaces[0].pullRequest = {
        id: 3,
        url: 'https://dev.azure.com/contoso/P/_git/api/pullrequest/3',
        repositoryId: 'id-api',
        project: 'P',
        repo: 'api',
        status: 'completed',
        isDraft: false,
      };
    });
    const findActive = vi.mocked(
      hx.clients.get(hx.c.id)!.findActivePullRequest,
    );
    await hx.h['tasks:finish'](hx.t.id, {
      ...opts,
      workspaces: [
        { workspaceId: 'home', action: 'drop' },
        { workspaceId: hx.ids[0], action: 'pr' },
      ],
    });
    expect(findActive.mock.calls.map((c) => c[1])).toEqual(['id-api']);
    expect(hx.created.map((x) => x.repo)).toEqual(['api']);
    expect(ws(hx, hx.ids[0]).pullRequest).toMatchObject({
      id: 100,
      status: 'active',
    });
  });

  it('a branch whose base cannot be found is never "no changes", and is not dropped', async () => {
    const hx = await multiHarness([{ name: 'api' }]);
    await hx.store.update((st) => {
      st.tasks[0].extraWorkspaces[0].baseRef = 'no-such-base';
      st.tasks[0].extraWorkspaces[0].baseSha = null;
    });
    const checks = await hx.h['tasks:finishChecks'](hx.t.id);
    expect(checks.workspaces[0].baseKnown).toBe(true);
    expect(checks.workspaces[1]).toMatchObject({
      baseKnown: false,
      uncommitted: [],
    });
    await expect(
      hx.h['tasks:finish'](hx.t.id, {
        ...opts,
        workspaces: [
          { workspaceId: 'home', action: 'keep' },
          { workspaceId: hx.ids[0], action: 'drop' },
        ],
      }),
    ).rejects.toThrow('api has changes now; reload Finish');
    expect(existsSync(hx.repos[0].wt)).toBe(true);
  });

  it('a scan error does not break the Finish checks', async () => {
    const hx = await harness(fakeCrypto(), {
      workspaces: {
        scan: async () => {
          throw new Error('scan exploded');
        },
      } as unknown as WorkspaceDetector,
    });
    const done = hx.setupDone();
    const t = await hx.h['tasks:create'](hx.input({ openShell: false }));
    await done;
    const checks = await hx.h['tasks:finishChecks'](t.id);
    expect(checks.workspaces.map((w) => w.workspaceId)).toEqual(['home']);
  });

  it('a push-only row pushes without a PR, and records it as pushed', async () => {
    const hx = await multiHarness([{ name: 'api' }]);
    commitFile(hx.repos[0].wt, 'api.txt', 'a\n', 'API change');
    await hx.h['tasks:finish'](hx.t.id, {
      ...opts,
      workspaces: [
        { workspaceId: 'home', action: 'drop' },
        { workspaceId: hx.ids[0], action: 'push' },
      ],
    });
    expect(hx.created).toEqual([]);
    expect(git(hx.repos[0].bare, 'branch', '--list', hx.t.branch)).toContain(
      hx.t.branch,
    );
    expect(ws(hx, hx.ids[0]).summary).toMatchObject({ pushed: true });
    expect(hx.store.state.tasks[0].status).toBe('done');
  });

  it('a worktree removed by hand is reported missing and skipped by Finish', async () => {
    const hx = await multiHarness([{ name: 'api' }]);
    commitFile(hx.t.worktreePath, 'web.txt', 'a\n', 'Web change');
    rmSync(hx.repos[0].wt, { recursive: true, force: true });
    const checks = await hx.h['tasks:finishChecks'](hx.t.id);
    expect(checks.workspaces[1]).toMatchObject({
      workspaceId: hx.ids[0],
      missing: true,
      uncommitted: [],
      commits: 0,
    });
    const view = (await hx.h['tasks:list']())[0];
    expect(view.extraWorkspaces.map((w) => w.id)).toEqual(hx.ids);
    await hx.h['tasks:finish'](hx.t.id, {
      ...opts,
      workspaces: [
        { workspaceId: 'home', action: 'pr' },
        { workspaceId: hx.ids[0], action: 'pr' },
      ],
    });
    expect(hx.push.mock.calls.map((c) => c[0])).toEqual([hx.t.worktreePath]);
    expect(hx.created.map((x) => x.repo)).toEqual(['Web']);
    expect(hx.store.state.tasks[0].status).toBe('done');
  });

  it('a repo in another organization gets a PR without the work item link, naming it instead', async () => {
    const hx = await multiHarness([{ name: 'docs', org: 'fabrikam' }], {
      workItem: {
        id: '48231',
        type: 'User Story',
        title: 'Show estimated delivery date',
        url: 'https://dev.azure.com/contoso/P/_workitems/edit/48231',
      },
    });
    commitFile(hx.repos[0].wt, 'docs.txt', 'a\n', 'Docs change');
    await hx.h['tasks:finish'](hx.t.id, {
      ...opts,
      workspaces: [
        { workspaceId: 'home', action: 'drop' },
        { workspaceId: hx.ids[0], action: 'pr' },
      ],
    });
    expect(hx.created).toHaveLength(1);
    expect(hx.created[0].connectionId).toBe(hx.repos[0].connectionId);
    const args = hx.created[0].args as {
      workItemId: number | null;
      description: string;
    };
    expect(args.workItemId).toBeNull();
    expect(args.description).toContain(
      'Work item: https://dev.azure.com/contoso/P/_workitems/edit/48231',
    );
    expect(ws(hx, hx.ids[0]).pullRequest).toMatchObject({
      url: 'https://dev.azure.com/fabrikam/P/_git/docs/pullrequest/100',
    });
  });
});
