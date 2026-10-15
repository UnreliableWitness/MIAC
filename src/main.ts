import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  shell,
} from 'electron';
import started from 'electron-squirrel-startup';
import iconUrl from '../assets/icon/png/256.png?inline';
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
import { createSplashWindow, SplashReporter } from './main/splash';
import { appMenu } from './main/appMenu';

if (started) app.quit();

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
    backgroundColor: '#090b10',
    title: 'MIAC',
    ...(windowIcon ? { icon: windowIcon } : {}),
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
  const userData = app.getPath('userData');
  const settings = new SettingsStore(path.join(userData, 'settings.json'));
  const settingsLoaded = await settings.load();
  splashWin = settings.get().showSplash ? createSplashWindow(windowIcon) : null;
  const reporter = new SplashReporter(splashWin);
  ipcMain.on('splash:skip', () => reporter.skip());
  ipcMain.on('splash:quit', () => app.quit());
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
    await pruneDanglingConnectionLinks(repos, connections);
    const usageDir = path.join(userData, 'usage');
    await fs.mkdir(path.join(usageDir, 'copilot'), { recursive: true });
    const usage = new UsageStore(usageDir, () => OFFICIAL_RATES);
    const usageLoaded = await usage.load();
    const ingest = (events: UsageEvent[]) => {
      for (const e of events)
        usage
          .add(e)
          .catch((err) =>
            console.error('[usage] could not store a record', err),
          );
    };
    const receiver = new UsageReceiver(ingest);
    const copilot = new CopilotFileTailer(
      path.join(usageDir, 'copilot'),
      ingest,
    );
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
    registerIpc(ipcMain, handlers);
    reporter.step(
      `Starting usage receiver 127.0.0.1:${settings.get().receiverPort}`,
    );
    const receiverStarted = await receiver.start(settings.get().receiverPort);
    copilot.start();
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
      new Promise<void>((r) => win.once('ready-to-show', () => r())),
      reporter.done(),
    ]);
    reporter.step('Ready');
    await reporter.fadeOut();
    revealMain(win);
    booting = false;
    reporter.close();
    splashWin = null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(e);
    if (reporter.active) {
      reporter.fail(message);
      // Closing the failed splash (Cmd+W) must not leave a windowless, half-booted app on macOS.
      splashWin?.once('closed', () => app.quit());
    } else {
      dialog.showErrorBox('MIAC could not start', message);
      app.quit();
    }
  }
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
  for (const id of terminals.ids()) terminals.kill(id);
  stopUsage();
});
