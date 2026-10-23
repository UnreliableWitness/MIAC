import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  maskValue,
  SECRET_NAME,
  type DiscoverResult,
  type Environment,
  type Found,
} from '../../shared/secrets';
import { isInside } from '../paths';
import type { GitClient } from '../services/GitClient';
import { environmentOf, looksSecret } from './classify';
import { parseAppsettings } from './sources/appsettings';
import { parseCompose } from './sources/compose';
import { parseDotenv } from './sources/dotenv';
import { parseLaunchSettings } from './sources/launchSettings';
import { parseLocalSettings } from './sources/localSettings';
import { parseSecretsFile } from './sources/secretsFolder';
import type { Item } from './sources/types';
import { parseUserSecrets, userSecretsId } from './sources/userSecrets';
import { parseVscodeLaunch } from './sources/vscodeLaunch';

const MAX_DEPTH = 2;
/** A `secrets/` folder is read all the way down, to this depth. */
const MAX_SECRETS_DEPTH = 8;
const MAX_FILE_BYTES = 1024 * 1024;
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'bin',
  'obj',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '.venv',
  'venv',
  '.next',
]);
/** Templates carry placeholders, not values. */
const TEMPLATE = /\.(example|sample|template|dist)$/i;

const rel = (root: string, file: string) =>
  path.relative(root, file).split(path.sep).join('/');

/** `.env` and `.env.local` are Development; any other name is mapped by its words. */
function dotenvEnvironment(file: string): Environment | null {
  const base = path.basename(file);
  return environmentOf(base) ?? (base === '.env' ? 'development' : null);
}

/**
 * Looks in the known places at the repo's root and up to two folders down, plus .NET user secrets. Never reads
 * outside the repo except the user-secrets folder, never shell profiles.
 */
export async function discoverSecrets(
  repoPath: string,
  deps: { git: GitClient; userSecretsDir: (id: string) => string | null },
): Promise<{ found: Found[]; skipped: number }> {
  const root = path.resolve(repoPath);
  const realRoot = await fs.realpath(root).catch(() => root);
  const tracked = new Set<string>();
  try {
    const out = await deps.git.run(root, ['ls-files', '-z']);
    for (const f of out.split('\0')) if (f) tracked.add(f);
  } catch {
    // Not a git repo: nothing is tracked.
  }

  const found: Found[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  const readFile = async (file: string): Promise<string | null> => {
    try {
      const st = await fs.stat(file);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
      return await fs.readFile(file, 'utf8');
    } catch {
      return null;
    }
  };
  /** A file of the repo, after following symlinks: one that points outside is not read. */
  const readInRepo = async (file: string): Promise<string | null> => {
    try {
      if (!isInside(realRoot, await fs.realpath(file))) return null;
    } catch {
      return null;
    }
    return readFile(file);
  };
  const add = (items: Item[], isTracked: boolean) => {
    for (const it of items) {
      if (it.value === '') continue;
      if (!SECRET_NAME.test(it.name)) {
        skipped++;
        continue;
      }
      const key = `${it.source}\0${it.env ?? ''}\0${it.name}\0${it.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        ...it,
        tracked: isTracked,
        secretLike: looksSecret(it.name, it.value),
      });
    }
  };
  const visited = new Set<string>();
  const dotenvFile = async (file: string) => {
    const r = rel(root, file);
    if (visited.has(r) || !isInside(root, file)) return;
    visited.add(r);
    const text = await readInRepo(file);
    if (text !== null)
      add(parseDotenv(text, r, dotenvEnvironment(file)), tracked.has(r));
  };
  const envFiles = async (dir: string, files: string[]) => {
    for (const f of files) await dotenvFile(path.resolve(dir, f));
  };

  /** What a file is, from its name and folder alone, so only files that can hold values are read. */
  const handle = async (file: string, inSecrets: boolean) => {
    const base = path.basename(file);
    const dir = path.dirname(file);
    const r = rel(root, file);
    const isTracked = tracked.has(r);
    if (TEMPLATE.test(base)) return;
    if (/^\.env(\..+)?$/.test(base)) return dotenvFile(file);
    const parent = path.basename(dir);
    const kind = /^appsettings(\..+)?\.json$/i.test(base)
      ? 'appsettings'
      : base === 'launchSettings.json' && parent === 'Properties'
        ? 'launchSettings'
        : base === 'launch.json' && parent === '.vscode'
          ? 'vscode'
          : /^(docker-)?compose(\..+)?\.ya?ml$/i.test(base)
            ? 'compose'
            : base === 'local.settings.json'
              ? 'local'
              : /\.csproj$/i.test(base)
                ? 'csproj'
                : inSecrets || /\.secrets\.json$/i.test(base)
                  ? 'secrets'
                  : null;
    if (kind === null) return;
    const text = await readInRepo(file);
    if (text === null) return;
    switch (kind) {
      case 'appsettings':
        return add(parseAppsettings(text, r, environmentOf(base)), isTracked);
      case 'launchSettings':
        return add(parseLaunchSettings(text), isTracked);
      case 'vscode': {
        const v = parseVscodeLaunch(text, r);
        add(v.items, isTracked);
        return envFiles(root, v.envFiles);
      }
      case 'compose': {
        const c = parseCompose(text, r);
        add(c.items, isTracked);
        return envFiles(dir, c.envFiles);
      }
      case 'local':
        return add(parseLocalSettings(text, r), isTracked);
      case 'csproj': {
        const id = userSecretsId(text);
        const folder = id === null ? null : deps.userSecretsDir(id);
        if (folder === null) return;
        const secrets = await readFile(path.join(folder, 'secrets.json'));
        if (secrets !== null) add(parseUserSecrets(secrets), false);
        return;
      }
      case 'secrets':
        return add(parseSecretsFile(text, r), isTracked);
    }
  };

  const walk = async (dir: string, depth: number, inSecrets: boolean) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile()) await handle(full, inSecrets);
      else if (
        e.isDirectory() &&
        (depth < MAX_DEPTH || (inSecrets && depth < MAX_SECRETS_DEPTH)) &&
        !SKIP_DIRS.has(e.name)
      )
        await walk(full, depth + 1, inSecrets || e.name === 'secrets');
    }
  };
  await walk(root, 0, false);
  return { found, skipped };
}

/** Holds each repo's last discovery in main, so the renderer only ever gets masks and a key to pick by. */
export class DiscoveryHold {
  private readonly byRepo = new Map<string, Map<string, Found>>();

  hold(repoId: string, found: Found[], skipped = 0): DiscoverResult {
    const keyed = new Map<string, Found>();
    const view = found.map(({ value, ...rest }) => {
      const key = randomUUID();
      keyed.set(key, { ...rest, value });
      return { ...rest, key, mask: maskValue(value) };
    });
    this.byRepo.set(repoId, keyed);
    return {
      found: view,
      sources: [...new Set(found.map((f) => f.source))],
      skipped,
    };
  }

  resolve(repoId: string, key: string): Found | undefined {
    return this.byRepo.get(repoId)?.get(key);
  }

  /** The held values with their keys, in discovery order (main only: the import plan compares them). */
  entries(repoId: string): (Found & { key: string })[] {
    return [...(this.byRepo.get(repoId) ?? [])].map(([key, f]) => ({
      ...f,
      key,
    }));
  }

  /** Forgets a repo's values once they are imported, so plaintext is not kept longer than needed. */
  drop(repoId: string): void {
    this.byRepo.delete(repoId);
  }
}
