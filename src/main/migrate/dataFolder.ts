import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Chromium's own entries in the profile folder; everything else is the app's. */
const CHROMIUM = [
  /^Cache$/,
  /^Code Cache$/,
  /^GPUCache$/,
  /^GPUPersistentCache$/,
  /^blob_storage$/,
  /^Cookies/,
  /^Session Storage$/,
  /^Dawn/,
  /^Graphite/,
  /^DIPS/,
  /^Trust Tokens/,
  /^Shared Dictionary$/,
  /^Network Persistent State$/,
  /^Preferences$/,
  /^DevToolsActivePort$/,
  /^declarative_performance_observer/,
  /^Crashpad$/,
  /^SingletonLock$/,
  /^SingletonSocket$/,
  /^SingletonCookie$/,
  // Chromium has loaded its own by the time we run; Windows tokens are re-encrypted explicitly.
  /^Local State$/,
  /^migrated-from-miac\.json$/,
  /^migrating-from-miac$/,
  /^lockfile$/,
  /^Network$/,
  /^Crashpad/,
  /^BrowserMetrics/,
  /^IndexedDB$/,
  /^WebStorage$/,
  /^Service Worker$/,
  /^shared_proto_db$/,
  /^VideoDecodeStats$/,
  /^SharedStorage/,
  /^segmentation_platform$/,
  /^Dictionaries$/,
  /_crx_cache$/,
  /^logs$/,
  /\.tmp$/,
  /\.corrupt-/,
];
export const MARKER = 'migrated-from-miac.json';
/** Present while a copy runs; if it is still there at the next start the copy failed and runs again. */
export const SENTINEL = 'migrating-from-miac';
const DATA = ['state.json', 'connections.json'];

export type DataMigration = { copied: string[]; connections: boolean };

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

/** First start of Shellie on a machine that ran MIAC: copy the app's files from the old `miac` folder. The old folder is left as it is. */
export async function migrateDataFolder(opts: {
  from: string;
  to: string;
  platform: NodeJS.Platform;
  copy?: (src: string, dest: string) => Promise<void>;
}): Promise<DataMigration | null> {
  const copy =
    opts.copy ??
    ((s, d) =>
      fs.cp(s, d, { recursive: true, errorOnExist: false, force: true }));
  if (await exists(path.join(opts.to, MARKER))) return null;
  const interrupted = await exists(path.join(opts.to, SENTINEL));
  if (!interrupted)
    for (const f of DATA) if (await exists(path.join(opts.to, f))) return null;
  const hasData = await Promise.all(
    DATA.map((f) => exists(path.join(opts.from, f))),
  );
  if (!hasData.some(Boolean)) return null;

  const names = (await fs.readdir(opts.from)).filter(
    (n) => !CHROMIUM.some((r) => r.test(n)),
  );
  await fs.mkdir(opts.to, { recursive: true });
  await fs.writeFile(path.join(opts.to, SENTINEL), new Date().toISOString());
  // Data files last: all copied to a temp name first, then renamed back to back, so a failure leaves no state.json.
  const ordered = [
    ...names.filter((n) => !DATA.includes(n)),
    ...names.filter((n) => DATA.includes(n)),
  ];
  const data = ordered.filter((n) => DATA.includes(n));
  for (const n of ordered) {
    const dest = path.join(opts.to, n);
    if (DATA.includes(n)) {
      await fs.rm(`${dest}.migrating`, { force: true });
      await copy(path.join(opts.from, n), `${dest}.migrating`);
    } else {
      await fs.rm(dest, { recursive: true, force: true });
      await copy(path.join(opts.from, n), dest);
    }
  }
  for (const n of data)
    await fs.rename(
      path.join(opts.to, `${n}.migrating`),
      path.join(opts.to, n),
    );
  const result = {
    copied: ordered,
    connections: ordered.includes('connections.json'),
  };
  await fs.writeFile(
    path.join(opts.to, MARKER),
    JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2),
  );
  await fs.rm(path.join(opts.to, SENTINEL), { force: true });
  return result;
}
