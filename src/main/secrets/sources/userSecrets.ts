import { flattenJson, parseJsonc } from '../classify';
import type { Item } from './types';

/** The `UserSecretsId` of a project file. Only a plain id counts: it becomes a folder name outside the repo. */
export function userSecretsId(csproj: string): string | null {
  const id = /<UserSecretsId>\s*([^<]*?)\s*<\/UserSecretsId>/.exec(csproj)?.[1];
  return id !== undefined && /^[A-Za-z0-9._-]+$/.test(id) && !/^\.+$/.test(id)
    ? id
    : null;
}

/** A user-secrets `secrets.json`: flat `A:B` keys or nested; Development. */
export function parseUserSecrets(text: string): Item[] {
  try {
    return flattenJson(parseJsonc(text), '').map(([name, value]) => ({
      name,
      value,
      env: 'development',
      source: 'user secrets',
    }));
  } catch {
    return [];
  }
}
