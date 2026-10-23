import type { Environment } from '../../shared/secrets';

const WORDS: Record<string, Environment> = {
  dev: 'development',
  development: 'development',
  local: 'development',
  test: 'test',
  tst: 'test',
  qa: 'test',
  uat: 'uat',
  acc: 'uat',
  acceptance: 'uat',
  staging: 'uat',
  stg: 'uat',
  prod: 'production',
  prd: 'production',
  production: 'production',
  live: 'production',
};

/**
 * Maps a file or profile name to an environment by its words (split on anything that is not a letter or digit),
 * so `.env.production.local` and `appsettings.Uat.json` work. `local` only counts when nothing more specific is
 * there, since it is also the suffix of a personal copy of any environment's file.
 */
export function environmentOf(label: string): Environment | null {
  const hits = label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => ({ w, env: WORDS[w] }))
    .filter((h): h is { w: string; env: Environment } => h.env !== undefined);
  return (hits.find((h) => h.w !== 'local') ?? hits[0])?.env ?? null;
}

export const SECRET_NAME_WORDS =
  /KEY|SECRET|TOKEN|PASSWORD|PWD|CONNECTIONSTRING|CREDENTIAL|DSN/i;

const SECRET_VALUE = [
  /^(sk_live_|sk_test_|ghp_|npm_|xox[bp]-|AKIA)/,
  /-----BEGIN [A-Z ]*PRIVATE KEY/,
  /^eyJ[\w-]+\.[\w-]+\.[\w-]+/,
  /(AccountKey|SharedAccessKey)=/i,
  /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i,
];

export function looksSecret(name: string, value: string): boolean {
  return (
    SECRET_NAME_WORDS.test(name) || SECRET_VALUE.some((r) => r.test(value))
  );
}

/** `Stripe:Key` (.NET configuration paths) and nesting both become `__`, which is also how .NET reads env vars. */
export function flattenJson(obj: unknown, prefix: string): [string, string][] {
  if (typeof obj === 'string') return prefix === '' ? [] : [[prefix, obj]];
  if (typeof obj === 'number' || typeof obj === 'boolean')
    return prefix === '' ? [] : [[prefix, String(obj)]];
  if (obj === null || typeof obj !== 'object') return [];
  const entries: [string, unknown][] = Array.isArray(obj)
    ? obj.map((v, i) => [String(i), v])
    : Object.entries(obj);
  return entries.flatMap(([k, v]) =>
    flattenJson(
      v,
      prefix === ''
        ? k.replaceAll(':', '__')
        : `${prefix}__${k.replaceAll(':', '__')}`,
    ),
  );
}

/** Drops `//` and block comments, then trailing commas, without touching anything inside strings. */
function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  let res = '';
  i = 0;
  while (i < out.length) {
    const c = out[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < out.length && out[j] !== '"') j += out[j] === '\\' ? 2 : 1;
      res += out.slice(i, j + 1);
      i = j + 1;
    } else if (c === ',' && /^\s*[}\]]/.test(out.slice(i + 1))) {
      i++;
    } else {
      res += c;
      i++;
    }
  }
  return res;
}

/** JSON with comments and trailing commas (launchSettings, .vscode/launch.json). Throws on invalid JSON. */
export function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonc(text.replace(/^\uFEFF/, '')));
}
