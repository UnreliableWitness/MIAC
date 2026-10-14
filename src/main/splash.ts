import path from 'node:path';
import { app, BrowserWindow } from 'electron';

export const SPLASH_MIN_MS = 2200;
export const SPLASH_FADE_MS = 200;

export type SplashWindowLike = {
  isDestroyed(): boolean;
  webContents: { send(channel: string, ...args: unknown[]): void };
  close(): void;
  once(event: 'ready-to-show', fn: () => void): void;
};

/** Reports boot steps to the splash window and gates the handoff on the minimum animation time. */
export class SplashReporter {
  private shownAt: number | null = null;
  private failed = false;
  private release: (() => void) | null = null;
  private readonly minMs: number;
  private readonly fadeMs: number;
  private readonly gate: Promise<void>;

  constructor(
    private readonly win: SplashWindowLike | null,
    opts: { minMs?: number; fadeMs?: number } = {},
  ) {
    this.minMs = opts.minMs ?? SPLASH_MIN_MS;
    this.fadeMs = opts.fadeMs ?? SPLASH_FADE_MS;
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
    if (!this.active) {
      this.open();
      return;
    }
    win!.once('ready-to-show', () => {
      this.shownAt = Date.now();
      setTimeout(() => this.open(), this.minMs);
    });
  }

  get active(): boolean {
    return this.win !== null && !this.win.isDestroyed();
  }

  private open(): void {
    if (!this.failed) this.release?.();
  }

  private send(channel: string, ...args: unknown[]): void {
    if (this.active) this.win!.webContents.send(channel, ...args);
  }

  step(label: string): void {
    this.send('splash:step', label);
  }

  /** Shows the failure; done() never resolves afterwards, so the splash stays until Quit. */
  fail(message: string): void {
    this.failed = true;
    this.send('splash:fail', message);
  }

  skip(): void {
    this.open();
  }

  done(): Promise<void> {
    return this.active ? this.gate : Promise.resolve();
  }

  fadeOut(): Promise<void> {
    if (!this.active) return Promise.resolve();
    this.send('splash:done');
    return new Promise((resolve) => setTimeout(resolve, this.fadeMs));
  }

  close(): void {
    if (this.active) this.win!.close();
  }
}

export function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 640,
    height: 400,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    alwaysOnTop: false,
    backgroundColor: '#050609',
    title: 'MIAC',
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'splashPreload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  const hash = `v=${encodeURIComponent(app.getVersion())}`;
  if (SPLASH_WINDOW_VITE_DEV_SERVER_URL)
    void win.loadURL(
      `${SPLASH_WINDOW_VITE_DEV_SERVER_URL}/splash.html#${hash}`,
    );
  else
    void win.loadFile(
      path.join(
        __dirname,
        `../renderer/${SPLASH_WINDOW_VITE_NAME}/splash.html`,
      ),
      { hash },
    );
  return win;
}
