import type { Environment } from '../../../shared/secrets';
import { flattenJson, parseJsonc, SECRET_NAME_WORDS } from '../classify';
import type { Item } from './types';

/** `ConnectionStrings:*` and values under keys whose name looks secret, as `A__B` names. */
export function parseAppsettings(
  text: string,
  source: string,
  env: Environment | null,
): Item[] {
  let json: unknown;
  try {
    json = parseJsonc(text);
  } catch {
    return [];
  }
  return flattenJson(json, '')
    .filter(
      ([name]) =>
        name.startsWith('ConnectionStrings__') || SECRET_NAME_WORDS.test(name),
    )
    .map(([name, value]) => ({ name, value, env, source }));
}
