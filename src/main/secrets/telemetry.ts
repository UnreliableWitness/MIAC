import path from 'node:path';
import type { Environment, Found } from '../../shared/secrets';

/**
 * What telemetry may say about secrets: kinds and counts. Never a name, a value, a path or a source as shown in
 * the app (`docs/telemetry.md`).
 */
export type SourceKind =
  | 'dotenv'
  | 'appsettings'
  | 'launchSettings'
  | 'userSecrets'
  | 'vscode'
  | 'compose'
  | 'localSettings'
  | 'secretsFolder'
  | 'other';

/** The kind of a discovery source, from its display form (a repo-relative path, "user secrets", "launch profile x"). */
export function sourceKind(source: string): SourceKind {
  if (source === 'user secrets') return 'userSecrets';
  if (source.startsWith('launch profile ')) return 'launchSettings';
  const base = path.posix.basename(source.replaceAll('\\', '/'));
  const parts = source.replaceAll('\\', '/').split('/');
  if (/^\.env(\..+)?$/.test(base) || /\.env$/i.test(base)) return 'dotenv';
  if (/^appsettings(\..+)?\.json$/i.test(base)) return 'appsettings';
  if (base === 'launchSettings.json') return 'launchSettings';
  if (base === 'launch.json' && parts.at(-2) === '.vscode') return 'vscode';
  if (/^(docker-)?compose(\..+)?\.ya?ml$/i.test(base)) return 'compose';
  if (base === 'local.settings.json') return 'localSettings';
  if (parts.includes('secrets') || /\.secrets\.json$/i.test(base))
    return 'secretsFolder';
  return 'other';
}

/** `secrets.discovered`'s measurements: values per source kind and totals. */
export function discoveredMeasurements(
  found: Pick<Found, 'source' | 'env' | 'secretLike'>[],
  skipped: number,
): Record<string, number> {
  const m: Record<string, number> = {
    values: found.length,
    secretLike: found.filter((f) => f.secretLike).length,
    unassigned: found.filter((f) => f.env === null).length,
    skipped,
  };
  for (const f of found) {
    const k = sourceKind(f.source);
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

const SEVERITY: Record<Environment, number> = {
  development: 0,
  test: 1,
  uat: 2,
  production: 3,
};

/** The graver of two environments (Production over UAT over Test over Development). */
export function graverEnvironment(
  a: Environment | null,
  b: Environment,
): Environment {
  return a !== null && SEVERITY[a] >= SEVERITY[b] ? a : b;
}
