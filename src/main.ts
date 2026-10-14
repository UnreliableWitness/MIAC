import { spawn } from 'node:child_process';
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
import { createHandlers, recoverInterruptedTasks } from './main/ipc/handlers';
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

if (started) app.quit();

let mainWindow: BrowserWindow | null = null;
const terminals = new TerminalManager();

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
  const handlers = createHandlers({
    connections,
    ado: new AdoRegistry(connections),
    openExternal: (url) => shell.openExternal(url),
    store,
    git,
    platform,
    terminals,
    repos: new RepoRegistry(store, git),
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
  terminals.on('data', (id, data) => broadcast('terminal:data', { id, data }));
  terminals.on('exit', (id, exitCode) =>
    broadcast('terminal:exit', { id, exitCode }),
  );

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
    if (recovered > 0)
      broadcast('notice', {
        level: 'warn',
        message: `${recovered} task(s) were interrupted by a previous exit and need attention.`,
      });
  });
}

app
  .whenReady()
  .then(boot)
  .catch((e) => {
    console.error(e);
    app.quit();
  });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  for (const id of terminals.ids()) terminals.kill(id);
});
