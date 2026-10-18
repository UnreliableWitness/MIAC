import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  safeStorage,
  shell,
} from 'electron';
import started from 'electron-squirrel-startup';
import iconUrl from '../assets/icon/png/256.png?inline';
import { EVENT_PREFIX, type Events, type PendingUpdate } from './shared/ipc';
import type { UsageEvent } from './shared/usage';
import {
  createHandlers,
  pruneDanglingConnectionLinks,
  recoverInterruptedTasks,
} from './main/ipc/handlers';
import { DocsWatcher } from './main/docs/DocsWatcher';
import { GitDirWatcher } from './main/review/GitDirWatcher';
import { registerIpc } from './main/ipc/register';
import { migrateDataFolder } from './main/migrate/dataFolder';
import {
  migrateTokens,
  readMiacKeychainPassword,
  readMiacWindowsKey,
  type TokenMigration,
} from './main/migrate/tokens';
import { createPlatform } from './main/platform';
import { AdoRegistry } from './main/services/AdoRegistry';
import { ConnectionStore } from './main/services/ConnectionStore';
import { GitClient } from './main/services/GitClient';
import { loadShellieConfig } from './main/services/ShellieConfig';
import { RepoRegistry } from './main/services/RepoRegistry';
import { claudeProjectsDir } from './main/services/claudeSessions';
import { WorkspaceDetector } from './main/workspaces/WorkspaceDetector';
import { taskWorkspaces } from './shared/workspaces';
import { migrateTaskFolders } from './main/migrate/taskFolders';
import { SetupRunner, ensureExcluded } from './main/services/SetupRunner';
import { TaskStore } from './main/services/TaskStore';
import { TerminalManager } from './main/services/TerminalManager';
import { CopilotFileTailer } from './main/usage/CopilotFileTailer';
import { ActivityTracker } from './main/time/ActivityTracker';
import { TerminalAgentTimer } from './main/time/TerminalAgentTimer';
import { TimeStore } from './main/time/TimeStore';
import { SettingsStore } from './main/usage/SettingsStore';
import { UsageReceiver } from './main/usage/UsageReceiver';
import { OFFICIAL_RATES } from './main/pricing/officialRates';
import { UsageStore } from './main/usage/UsageStore';
import { runSmoke } from './main/smoke';
import { createSplashWindow, SplashReporter } from './main/splash';
import { appMenu } from './main/appMenu';
import {
  AppInsightsClient,
  NoopTelemetry,
  type Telemetry,
} from './main/telemetry/AppInsightsClient';
import {
  forwardRendererTelemetry,
  installId,
  sensitiveValues,
  telemetryOptedOut,
  timedFetch,
  trackHandlerFailures,
} from './main/telemetry/helpers';
import { TELEMETRY_CHANNEL } from './shared/telemetry';
import { type AutoUpdate, startAutoUpdate } from './main/autoUpdate';
import { appUrlMatcher, guardWindow, trustedSender } from './main/windowGuards';
import { titleBarOptions } from './main/windowChrome';
import { errorMessage } from './shared/errors';

if (started) app.quit();

/** Replaced by the real client in boot when the build has a connection string (CI release builds). */
let telemetry: Telemetry = NoopTelemetry;
const sessionStart = Date.now();

// Monitor only: Electron's own handling of an uncaught exception (the error dialog) stays as it is.
process.on('uncaughtExceptionMonitor', (error, origin) => {
  telemetry.exception(error, { source: 'main', origin }, 'critical');
  void telemetry.flush();
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in main:', reason);
  telemetry.exception(reason, { source: 'main', origin: 'unhandledRejection' });
});
app.on('render-process-gone', (_e, _wc, details) => {
  if (details.reason === 'clean-exit') return;
  telemetry.event('process.gone', {
    process: 'renderer',
    reason: details.reason,
    exitCode: details.exitCode,
  });
  void telemetry.flush();
});
app.on('child-process-gone', (_e, details) => {
  if (details.reason === 'clean-exit') return;
  telemetry.event('process.gone', {
    process: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
  });
});

const icon = nativeImage.createFromDataURL(iconUrl);
// macOS takes the icon from the app bundle; only Windows and Linux windows need it passed in.
const windowIcon = process.platform === 'darwin' ? undefined : icon;

let mainWindow: BrowserWindow | null = null;
let splashWin: BrowserWindow | null = null;
/** True until the main window is revealed (stays true after a boot failure). */
let booting = true;
const terminals = new TerminalManager();
const DOT = String.fromCharCode(0xb7);
let stopUsage: () => void = () => {};
/** Ends the time tracking timers and closes the open intervals (on quit). */
let stopTime: () => void = () => {};
/** Time writes still in flight; the quit waits for them. */
const timeWrites = new Set<Promise<void>>();
/** Window focus, for active time (set once the tracker exists). */
let onWindowFocus: (focused: boolean) => void = () => {};
let stopUpdates: () => void = () => {};
let updates: AutoUpdate | null = null;
/** Set when an update has downloaded; the renderer offers Restart and update. */
let pendingUpdate: PendingUpdate | null = null;

const gitDirWatcher = new GitDirWatcher(
  (wt) => new GitClient().gitDir(wt),
  (target) => broadcast('review:changed', { taskId: target }),
  undefined,
  (target) => docsWatcher.stopTarget(target),
);
const docsWatcher = new DocsWatcher(
  (taskId, paths) => broadcast('docs:changed', { taskId, paths }),
  undefined,
  (taskId) => {
    gitDirWatcher.stopTarget(taskId);
    broadcast('docs:watchStopped', { taskId });
  },
);

// The app's own pages, from the same values the windows are loaded with (dev server or renderer folder).
const isMainPage = appUrlMatcher({
  devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
  dir: path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`),
});
const isSplashPage = appUrlMatcher({
  devServerUrl: SPLASH_WINDOW_VITE_DEV_SERVER_URL,
  dir: path.join(__dirname, `../renderer/${SPLASH_WINDOW_VITE_NAME}`),
});
const openLink = (url: string) => shell.openExternal(url);

function broadcast<K extends keyof Events>(event: K, payload: Events[K]): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(`${EVENT_PREFIX}${event}`, payload);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#201f1e',
    // The title stays for the taskbar, Alt+Tab and the Window menu; the header shows the app instead of a title bar.
    title: 'Shellie',
    ...titleBarOptions(process.platform),
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  guardWindow(win.webContents, isMainPage, openLink);
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
    // Surface renderer errors in the Forge terminal (dev only).
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') {
        console.error(`[renderer] ${event.message}`);
      }
    });
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
  // Full screen hides the traffic lights, so the header drops the room it keeps for them (macOS).
  const sendFullScreen = () => {
    const payload: Events['window:fullScreen'] = win.isFullScreen();
    win.webContents.send(`${EVENT_PREFIX}window:fullScreen`, payload);
  };
  win.on('enter-full-screen', sendFullScreen);
  win.on('leave-full-screen', sendFullScreen);
  win.webContents.on('did-finish-load', sendFullScreen);
  win.on('focus', () => onWindowFocus(true));
  win.on('blur', () => onWindowFocus(false));
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

/** Fades the main window in over 200 ms where window opacity is supported; Linux gets a plain show. */
function revealMain(win: BrowserWindow): void {
  if (process.platform === 'linux') {
    win.show();
    return;
  }
  win.setOpacity(0);
  win.show();
  const t0 = Date.now();
  const timer = setInterval(() => {
    const p = Math.min(1, (Date.now() - t0) / 200);
    if (win.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    win.setOpacity(p);
    if (p === 1) clearInterval(timer);
  }, 16);
}

async function boot(): Promise<void> {
  const bootStart = performance.now();
  const userData = app.getPath('userData');
  // First on purpose: before settings load and before any window, copy MIAC's data folder.
  const migrationStart = performance.now();
  const migration = await migrateDataFolder({
    from: path.join(app.getPath('appData'), 'miac'),
    to: userData,
    platform: process.platform,
  }).catch((err) => {
    console.error(
      'Data migration from MIAC failed; it runs again on the next start.',
      err,
    );
    return null;
  });
  const migrationMs = performance.now() - migrationStart;
  const settings = new SettingsStore(path.join(userData, 'settings.json'));
  const settingsLoaded = await settings.load();
  splashWin = settings.get().showSplash ? createSplashWindow(windowIcon) : null;
  if (splashWin) guardWindow(splashWin.webContents, isSplashPage, openLink);
  const reporter = new SplashReporter(splashWin);
  ipcMain.on('splash:skip', (e) => {
    if (trustedSender(e, isSplashPage)) reporter.skip();
  });
  ipcMain.on('splash:quit', (e) => {
    if (trustedSender(e, isSplashPage)) app.quit();
  });
  // Right after the copy, once, before ConnectionStore.load: the copied tokens are under MIAC's key (Local State is not copied); move them to Shellie's.
  // After the splash exists, as its own step, so the Keychain prompt does not appear with no window.
  let tokenResult: TokenMigration = 'none';
  const readOldKey =
    process.platform === 'darwin'
      ? () => readMiacKeychainPassword()
      : process.platform === 'win32'
        ? () =>
            readMiacWindowsKey(
              path.join(app.getPath('appData'), 'miac', 'Local State'),
            )
        : null;
  if (migration?.connections && !migration.failed && readOldKey) {
    reporter.step('Moving connection tokens');
    // Without encryption the tokens cannot be re-encrypted: keep the connections, marked unauthorized ('refused').
    const canEncrypt = safeStorage.isEncryptionAvailable();
    tokenResult = await migrateTokens({
      file: path.join(userData, 'connections.json'),
      readOldKey: canEncrypt
        ? readOldKey
        : () => Promise.reject(new Error('safeStorage unavailable')),
      encrypt: (plain) => safeStorage.encryptString(plain),
    }).catch((): TokenMigration => {
      console.error('Moving MIAC connection tokens failed; enter them again.');
      return 'refused';
    });
  }
  // Boot step timings (ms), measured around the real work, not the splash pacing.
  const timings: Record<string, number> = {
    settingsMs: performance.now() - bootStart,
  };
  let mark = performance.now();
  const lap = (key: string) => {
    const now = performance.now();
    timings[key] = now - mark;
    mark = now;
  };
  let sensitive: () => string[] = () => [];
  if (__APPINSIGHTS_CONNECTION_STRING__ && !telemetryOptedOut(process.env)) {
    try {
      telemetry = new AppInsightsClient({
        connectionString: __APPINSIGHTS_CONNECTION_STRING__,
        enabled: () => settings.get().sendTelemetry,
        home: app.getPath('home'),
        sensitive: () => sensitive(),
        context: {
          appVersion: app.getVersion(),
          os: process.platform,
          osVersion: os.release(),
          arch: process.arch,
          electronVersion: process.versions.electron,
          packaged: app.isPackaged,
          installId: await installId(userData),
          sessionId: randomUUID(),
        },
      });
    } catch (e) {
      console.error('[telemetry] disabled:', e);
    }
  }
  ipcMain.on(TELEMETRY_CHANNEL, (e, payload: unknown) => {
    if (trustedSender(e, isMainPage))
      forwardRendererTelemetry(payload, telemetry);
  });
  if (migration)
    telemetry.event(
      'migration.miac',
      { tokens: tokenResult, result: migration.failed ? 'failed' : 'ok' },
      { copied: migration.copied.length, ms: migrationMs },
    );
  lap('telemetryMs');
  try {
    reporter.step('Loading tasks');
    const store = new TaskStore(path.join(userData, 'state.json'));
    const loaded = await store.load();
    const recovered = await recoverInterruptedTasks(store);
    const git = new GitClient();
    const platform = createPlatform();
    const connections = new ConnectionStore(
      path.join(userData, 'connections.json'),
      {
        available: () => safeStorage.isEncryptionAvailable(),
        encrypt: (plain) => safeStorage.encryptString(plain),
        decrypt: (cipher) => safeStorage.decryptString(cipher),
      },
    );
    const connectionsLoaded = await connections.load();
    const repos = new RepoRegistry(store, git);
    // Worktrees made before the rename keep their task file in .miac/; move it in the background.
    void (async () => {
      const pending: { worktreePath: string; repoPath: string }[] = [];
      for (const task of store.state.tasks) {
        for (const w of taskWorkspaces(task)) {
          const repo = store.state.repos.find((r) => r.id === w.repoId);
          if (w.worktreePath && repo)
            pending.push({ worktreePath: w.worktreePath, repoPath: repo.path });
        }
      }
      await migrateTaskFolders(pending, (repoPath) =>
        ensureExcluded(git, repoPath, '.shellie/'),
      );
    })().catch(() => {});
    await pruneDanglingConnectionLinks(repos, connections);
    const username = (() => {
      try {
        return os.userInfo().username;
      } catch {
        return undefined;
      }
    })();
    // Learned at run time: an Azure Repos remote's project and repo can differ from anything stored.
    const learned = new Set<string>();
    sensitive = () =>
      sensitiveValues({
        repos: repos.list(),
        tasks: store.state.tasks,
        connections: connections.list(),
        username,
        extra: learned,
      });
    lap('tasksMs');
    const usageDir = path.join(userData, 'usage');
    await fs.mkdir(path.join(usageDir, 'copilot'), { recursive: true });
    const usage = new UsageStore(usageDir, () => OFFICIAL_RATES);
    const usageLoaded = await usage.load();
    lap('usageMs');
    const ingest = (events: UsageEvent[]) => {
      for (const e of events)
        usage
          .add(e)
          .catch((err) =>
            console.error('[usage] could not store a record', err),
          );
    };
    const time = new TimeStore(path.join(usageDir, 'time.json'));
    const timeLoaded = await time.load();
    const keep = (write: Promise<void>) => {
      const p = write.catch((err: unknown) =>
        console.error('[time] could not store an interval', err),
      );
      timeWrites.add(p);
      void p.finally(() => timeWrites.delete(p));
    };
    const tracker = new ActivityTracker({
      now: Date.now,
      idleSeconds: () => powerMonitor.getSystemIdleTime(),
      idleLimitSeconds: () => settings.get().idleMinutes * 60,
      onInterval: (taskId, iv) => keep(time.addActive(taskId, iv)),
    });
    // OpenCode has no telemetry: its agent time is estimated from the terminal (output after Enter).
    const agentTimer = new TerminalAgentTimer({
      now: Date.now,
      watch: (terminalId) => {
        for (const t of store.state.tasks)
          if (
            t.terminals.some(
              (d) => d.id === terminalId && d.kind === 'opencode',
            )
          )
            return { taskId: t.id };
        return null;
      },
      onInterval: (taskId, iv) => keep(time.addAgent(taskId, 'opencode', iv)),
    });
    time.on('changed', (taskId) => broadcast('time:changed', { taskId }));
    const receiver = new UsageReceiver(ingest, (points) => {
      for (const p of points) keep(time.addClaudeActive(p));
    });
    const copilot = new CopilotFileTailer(
      path.join(usageDir, 'copilot'),
      ingest,
      (taskId, ivs) => {
        for (const iv of ivs) keep(time.addAgent(taskId, 'copilot-cli', iv));
      },
    );
    const workspaces = new WorkspaceDetector({
      store,
      git,
      repos,
      connections: () => connections.list(),
      projectsDir: () => claudeProjectsDir(),
      notice: (message) => broadcast('notice', { level: 'info', message }),
      event: (name, props) => telemetry.event(name, props),
    });
    const handlers = createHandlers({
      workspaces,
      update: {
        pending: () => pendingUpdate,
        install: () => updates?.install() ?? false,
      },
      appVersion: app.getVersion(),
      windowsBuild:
        process.platform === 'win32'
          ? Number(os.release().split('.')[2]) || null
          : null,
      usage,
      time,
      tracker,
      onTerminalInput: (id, data) => agentTimer.input(id, data),
      settings,
      receiver,
      copilot,
      usageDir,
      onHourly: (fn) => {
        setInterval(fn, 60 * 60 * 1000);
      },
      finishFlushMs: 2500,
      connections,
      ado: new AdoRegistry(connections, timedFetch(telemetry)),
      telemetry,
      rememberSensitive: (values) => {
        for (const v of values) learned.add(v);
      },
      openExternal: (url) => shell.openExternal(url),
      revealFile: (p) => shell.showItemInFolder(p),
      docsWatcher,
      gitDirWatcher,
      reviewDir: path.join(userData, 'review'),
      store,
      git,
      platform,
      terminals,
      repos,
      runner: new SetupRunner(git, platform),
      loadConfig: loadShellieConfig,
      pickFolder: async () => {
        const r = await dialog.showOpenDialog({
          properties: ['openDirectory'],
        });
        return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
      },
      launch: async (cmd) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(cmd.command, cmd.args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env: { ...process.env, ...cmd.env },
          });
          child.on('error', (e) =>
            reject(new Error(`Could not start ${cmd.command}: ${e.message}`)),
          );
          child.on('spawn', () => {
            child.unref();
            resolve();
          });
        }),
      broadcast,
    });
    registerIpc(ipcMain, trackHandlerFailures(handlers, telemetry), isMainPage);
    reporter.step(
      `Starting usage receiver 127.0.0.1:${settings.get().receiverPort}`,
    );
    lap('handlersMs');
    const receiverStarted = await receiver.start(settings.get().receiverPort);
    copilot.start();
    lap('receiverMs');
    stopUsage = () => {
      copilot.stop();
      void receiver.stop();
    };
    terminals.on('data', (id, data) =>
      broadcast('terminal:data', { id, data }),
    );
    terminals.on('exit', (id, exitCode) =>
      broadcast('terminal:exit', { id, exitCode }),
    );
    terminals.on('exit', () => void copilot.poll());
    terminals.on('data', (id) => agentTimer.output(id));
    terminals.on('exit', (id) => agentTimer.close(id));
    const timeTick = setInterval(() => {
      tracker.tick();
      agentTimer.tick();
    }, 15_000);
    const timeFlush = setInterval(() => tracker.flush(), 60_000);
    powerMonitor.on('lock-screen', () => tracker.suspend());
    powerMonitor.on('suspend', () => tracker.suspend());
    powerMonitor.on('unlock-screen', () => tracker.resume());
    powerMonitor.on('resume', () => tracker.resume());
    stopTime = () => {
      clearInterval(timeTick);
      clearInterval(timeFlush);
      // Closes the open intervals at now; will-quit waits for their writes.
      tracker.setFocused(false);
      for (const id of terminals.ids()) agentTimer.close(id);
    };
    onWindowFocus = (focused) => tracker.setFocused(focused);

    reporter.step(
      `Checking Azure DevOps ${DOT} ${connections.list().length} connection(s)`,
    );
    mainWindow = createWindow();
    const win = mainWindow;
    win.webContents.once('did-finish-load', () => {
      if (loaded.recovered)
        broadcast('notice', {
          level: 'warn',
          message: `state.json was unreadable and was moved to ${path.basename(loaded.backup ?? '')}. Starting empty.`,
        });
      if (connectionsLoaded.recovered)
        broadcast('notice', {
          level: 'warn',
          message: `connections.json was unreadable and was moved to ${path.basename(connectionsLoaded.backup ?? '')}; add your connections again.`,
        });
      if (!receiverStarted.listening)
        broadcast('notice', {
          level: 'warn',
          message: `AI usage capture is off: ${receiverStarted.error}. Pick another port in Settings > AI cost and invoicing.`,
        });
      if (usageLoaded.damagedLines > 0)
        broadcast('notice', {
          level: 'warn',
          message: `${usageLoaded.damagedLines} damaged line(s) in the usage files were skipped.`,
        });
      if (usageLoaded.billableBackup)
        broadcast('notice', {
          level: 'warn',
          message: `billable.json was unreadable and was moved to ${path.basename(usageLoaded.billableBackup)}; all sessions are billable again. Review them on the Usage screen.`,
        });
      if (timeLoaded.recovered)
        broadcast('notice', {
          level: 'warn',
          message: `time.json was unreadable and was moved to ${path.basename(timeLoaded.backup ?? '')}; measured time starts empty.`,
        });
      for (const [name, r] of [['settings.json', settingsLoaded]] as const)
        if (r.recovered)
          broadcast('notice', {
            level: 'warn',
            message: `${name} was unreadable and was moved to ${path.basename(r.backup ?? '')}; defaults are used.`,
          });
      if (recovered > 0)
        broadcast('notice', {
          level: 'warn',
          message: `${recovered} task(s) were interrupted by a previous exit and need attention.`,
        });
    });
    await Promise.all([
      new Promise<void>((r) =>
        win.once('ready-to-show', () => {
          lap('windowMs');
          timings.readyMs = performance.now() - bootStart;
          r();
        }),
      ),
      reporter.done(),
    ]);
    reporter.step('Ready');
    await reporter.fadeOut();
    revealMain(win);
    booting = false;
    reporter.close();
    splashWin = null;
    telemetry.event(
      'app.started',
      {
        splash: settings.get().showSplash,
        repos: repos.list().length,
        openTasks: store.state.tasks.filter((t) => t.status !== 'done').length,
        connections: connections.list().length,
        receiverListening: receiverStarted.listening,
      },
      {
        ...timings,
        // From process start to the main window shown (includes splash pacing).
        visibleMs: process.uptime() * 1000,
      },
    );
    telemetry.metric('app.startup.readyMs', timings.readyMs ?? 0);
    updates = startAutoUpdate({
      isPackaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      version: app.getVersion(),
      argv: process.argv,
      enabled: settings.get().autoUpdate,
      updater: autoUpdater,
      onReady: (version) => {
        pendingUpdate = { version };
        telemetry.event('update.ready');
        broadcast('update:ready', pendingUpdate);
      },
      log: (message, error) => console.error(message, error ?? ''),
    });
    stopUpdates = () => updates?.stop();
  } catch (e) {
    const message = errorMessage(e);
    console.error(e);
    telemetry.exception(e, { source: 'boot' }, 'critical');
    void telemetry.flush();
    if (reporter.active) {
      reporter.fail(message);
      // Closing the failed splash (Cmd+W) must not leave a windowless, half-booted app on macOS.
      splashWin?.once('closed', () => app.quit());
    } else {
      dialog.showErrorBox('Shellie could not start', message);
      app.quit();
    }
  }
}

if (process.env.SHELLIE_SMOKE === '1') {
  // Packaged-app smoke check for CI: one pty, then exit. No window, no stores, no single-instance lock.
  app
    .whenReady()
    .then(() =>
      runSmoke({
        terminals,
        platform: createPlatform(),
        log: (line) => console.error(line),
      }),
    )
    .then((ok) => {
      if (ok) console.log('SHELLIE_SMOKE_OK');
      app.exit(ok ? 0 : 1);
    })
    .catch((e) => {
      console.error(e);
      app.exit(1);
    });
} else if (!started && !app.requestSingleInstanceLock()) {
  // A second Shellie (a double launch, or a stray relaunch of Shellie.exe) hands over to the first one.
  app.quit();
} else if (!started) {
  app.on('second-instance', () => {
    // The splash while booting (nothing when it is off: the main window is still hidden), else the main window.
    const win = booting ? splashWin : mainWindow;
    const target = win && !win.isDestroyed() ? win : null;
    if (!target) return;
    if (target.isMinimized()) target.restore();
    target.focus();
  });
  app
    .whenReady()
    .then(() => {
      // Packaged macOS builds get the icon from the bundle; in dev the Dock shows Electron's.
      if (process.platform === 'darwin' && !app.isPackaged)
        app.dock?.setIcon(icon);
      const menu = appMenu(process.platform, app.isPackaged);
      if (menu.kind === 'template')
        Menu.setApplicationMenu(Menu.buildFromTemplate(menu.template));
      else if (menu.kind === 'none') Menu.setApplicationMenu(null);
      return boot();
    })
    // boot reports its own failures on the splash; this catches the ones before it exists (settings load).
    .catch((e) => {
      console.error(e);
      app.quit();
    });
}

app.on('activate', () => {
  // During boot the main window is created (with its handlers) by boot itself.
  if (booting || BrowserWindow.getAllWindows().length > 0) return;
  const w = createWindow();
  w.once('ready-to-show', () => w.show());
  mainWindow = w;
});

app.on('window-all-closed', () => {
  // A splash that closes or dies before the main window exists must not end the boot.
  if (booting) return;
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopTime();
  docsWatcher.stopAll();
  gitDirWatcher.stopAll();
  for (const id of terminals.ids()) terminals.kill(id);
  stopUsage();
  stopUpdates();
});

let quitHeld = false;
app.on('will-quit', (e) => {
  // Hold the quit for the last time writes and one best-effort telemetry send (at most 2 s), then exit.
  const sendTelemetry = telemetry !== NoopTelemetry;
  if (quitHeld || (!sendTelemetry && timeWrites.size === 0)) return;
  quitHeld = true;
  e.preventDefault();
  if (sendTelemetry)
    telemetry.event('app.quit', undefined, {
      sessionMinutes: (Date.now() - sessionStart) / 60_000,
    });
  void Promise.race([
    Promise.allSettled([
      ...timeWrites,
      ...(sendTelemetry ? [telemetry.flush()] : []),
    ]),
    new Promise((r) => setTimeout(r, 2000)),
  ]).finally(() => app.exit(0));
});
