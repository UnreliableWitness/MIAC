/**
 * Auto-update for packaged Windows builds (Squirrel.Windows), fed by update.electronjs.org.
 *
 * update.electronjs.org reads the GitHub Releases of a public repo: the newest non-draft, non-prerelease
 * release with a semver tag that has an `.exe` asset, plus its `RELEASES` file and the `.nupkg` that file
 * names. Electron's autoUpdater fetches `<feed>/RELEASES`, downloads the package in the background and
 * Squirrel runs the new version on the next start; `quitAndInstall` applies it right away. When a download is
 * ready, `onReady` tells the app, which offers Restart and update in a quiet in-app card (no modal dialog).
 *
 * Everything Electron-specific is injected, so this module is testable without Electron.
 */

export const UPDATE_REPO = 'UnreliableWitness/MIAC';
export const UPDATE_SERVER = 'https://update.electronjs.org';
/** First check after start: lets the boot and the first terminals settle. */
export const FIRST_CHECK_DELAY_MS = 30 * 1000;
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Squirrel passes this on the launch right after install, while it still holds its update lock. */
export const SQUIRREL_FIRSTRUN = '--squirrel-firstrun';

/** The subset of Electron's autoUpdater this module uses. */
export type UpdaterLike = {
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(
    event: 'update-downloaded',
    listener: (
      event: unknown,
      releaseNotes: string,
      releaseName: string,
    ) => void,
  ): unknown;
};

export type Timers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

export type AutoUpdateDeps = {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  arch: string;
  version: string;
  argv: readonly string[];
  /** The `autoUpdate` setting; undefined means on. */
  enabled: boolean | undefined;
  updater: UpdaterLike;
  /** A downloaded update is ready; `version` is parsed from the release name, null when it has none. */
  onReady(version: string | null): void;
  log(message: string, error?: unknown): void;
  timers?: Timers;
};

export type AutoUpdate = {
  stop(): void;
  /** Quits and starts the downloaded update; false (and nothing happens) when none is downloaded. */
  install(): boolean;
};

/** "MIAC v1.0.3 (unsigned)" -> "1.0.3"; null when the name holds no version. */
export function releaseVersion(name: string | undefined): string | null {
  return name?.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/)?.[0] ?? null;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export function updateFeedUrl(
  platform: NodeJS.Platform,
  arch: string,
  version: string,
): string {
  return `${UPDATE_SERVER}/${UPDATE_REPO}/${platform}-${arch}/${version}`;
}

/** Only installed (packaged) Windows builds update; dev runs and macOS never do. */
export function canAutoUpdate(
  d: Pick<AutoUpdateDeps, 'isPackaged' | 'platform' | 'enabled'>,
): boolean {
  return d.isPackaged && d.platform === 'win32' && d.enabled !== false;
}

/**
 * Starts the update checks, or returns null when this build does not update.
 * On a Squirrel first run the start-up check is skipped (Squirrel holds a lock); the hourly check still runs.
 */
export function startAutoUpdate(d: AutoUpdateDeps): AutoUpdate | null {
  if (!canAutoUpdate(d)) return null;
  const timers = d.timers ?? realTimers;
  let downloaded = false;
  let stopped = false;

  try {
    d.updater.setFeedURL({ url: updateFeedUrl(d.platform, d.arch, d.version) });
  } catch (e) {
    d.log('[update] could not set the feed URL', e);
    return null;
  }

  d.updater.on('error', (e) => d.log('[update] check failed', e));
  d.updater.on('update-downloaded', (_event, _notes, releaseName) => {
    if (downloaded || stopped) return;
    downloaded = true;
    stop();
    d.onReady(releaseVersion(releaseName));
  });

  const check = () => {
    if (downloaded || stopped) return;
    try {
      d.updater.checkForUpdates();
    } catch (e) {
      d.log('[update] check failed', e);
    }
  };

  const firstRun = d.argv.includes(SQUIRREL_FIRSTRUN);
  const first = firstRun
    ? null
    : timers.setTimeout(check, FIRST_CHECK_DELAY_MS);
  const hourly = timers.setInterval(check, CHECK_INTERVAL_MS);

  function stop() {
    stopped = true;
    if (first !== null) timers.clearTimeout(first);
    timers.clearInterval(hourly);
  }
  const install = () => {
    if (!downloaded) return false;
    d.updater.quitAndInstall();
    return true;
  };
  return { stop, install };
}
