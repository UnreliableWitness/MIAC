import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} from 'electron';
import started from 'electron-squirrel-startup';
import { EVENT_PREFIX, type Events } from './shared/ipc';
import type { UsageEvent } from './shared/usage';
import {
  createHandlers,
  pruneDanglingConnectionLinks,
  recoverInterruptedTasks,
} from './main/ipc/handlers';
import { registerIpc } from './main/ipc/register';
import { createPlatform } from './main/platform';
import { AdoRegistry } from './main/services/AdoRegistry';
import { ConnectionStore } from './main/services/ConnectionStore';
import { GitClient } from './main/services/GitClient';
import { loadMiacConfig } from './main/services/MiacConfig';
import { RepoRegistry } from './main/services/RepoRegistry';
import { SetupRunner } from './main/services/SetupRunner';
import { TaskStore } from './main/services/TaskStore';
import { TerminalManager } from './main/services/TerminalManager';
import { CopilotFileTailer } from './main/usage/CopilotFileTailer';
import { SettingsStore } from './main/usage/SettingsStore';
import { UsageReceiver } from './main/usage/UsageReceiver';
import { OFFICIAL_RATES } from './main/pricing/officialRates';
import { UsageStore } from './main/usage/UsageStore';
import { runSmoke } from './main/smoke';

if (started) app.quit();

let mainWindow: BrowserWindow | null = null;
const terminals = new TerminalManager();
let stopUsage: () => void = () => {};

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
    backgroundColor: '#15171a',
    title: 'MIAC',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
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
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

async function boot(): Promise<void> {
  const store = new TaskStore(path.join(app.getPath('userData'), 'state.json'));
  const loaded = await store.load();
  const recovered = await recoverInterruptedTasks(store);
  const git = new GitClient();
  const platform = createPlatform();
  const connections = new ConnectionStore(
    path.join(app.getPath('userData'), 'connections.json'),
    {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (cipher) => safeStorage.decryptString(cipher),
    },
  );
  const connectionsLoaded = await connections.load();
  const repos = new RepoRegistry(store, git);
  await pruneDanglingConnectionLinks(repos, connections);
  const userData = app.getPath('userData');
  const usageDir = path.join(userData, 'usage');
  await fs.mkdir(path.join(usageDir, 'copilot'), { recursive: true });
  const settings = new SettingsStore(path.join(userData, 'settings.json'));
  const settingsLoaded = await settings.load();
  const usage = new UsageStore(usageDir, () => OFFICIAL_RATES);
  const usageLoaded = await usage.load();
  const ingest = (events: UsageEvent[]) => {
    for (const e of events)
      usage
        .add(e)
        .catch((err) => console.error('[usage] could not store a record', err));
  };
  const receiver = new UsageReceiver(ingest);
  const copilot = new CopilotFileTailer(path.join(usageDir, 'copilot'), ingest);
  const handlers = createHandlers({
    appVersion: app.getVersion(),
    usage,
    settings,
    receiver,
    copilot,
    usageDir,
    onHourly: (fn) => {
      setInterval(fn, 60 * 60 * 1000);
    },
    finishFlushMs: 2500,
    connections,
    ado: new AdoRegistry(connections),
    openExternal: (url) => shell.openExternal(url),
    store,
    git,
    platform,
    terminals,
    repos,
    runner: new SetupRunner(git, platform),
    loadConfig: loadMiacConfig,
    pickFolder: async () => {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
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
  registerIpc(ipcMain, handlers);
  const receiverStarted = await receiver.start(settings.get().receiverPort);
  copilot.start();
  stopUsage = () => {
    copilot.stop();
    void receiver.stop();
  };
  terminals.on('data', (id, data) => broadcast('terminal:data', { id, data }));
  terminals.on('exit', (id, exitCode) =>
    broadcast('terminal:exit', { id, exitCode }),
  );
  terminals.on('exit', () => void copilot.poll());

  mainWindow = createWindow();
  mainWindow.webContents.once('did-finish-load', () => {
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
}

if (process.env.MIAC_SMOKE === '1') {
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
      if (ok) console.log('MIAC_SMOKE_OK');
      app.exit(ok ? 0 : 1);
    })
    .catch((e) => {
      console.error(e);
      app.exit(1);
    });
} else if (!started && !app.requestSingleInstanceLock()) {
  // A second MIAC (a double launch, or a stray relaunch of MIAC.exe) hands over to the first one.
  app.quit();
} else if (!started) {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app
    .whenReady()
    .then(boot)
    .catch((e) => {
      console.error(e);
      app.quit();
    });
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  for (const id of terminals.ids()) terminals.kill(id);
  stopUsage();
});
