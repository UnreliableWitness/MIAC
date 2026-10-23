import { environmentOf, flattenJson, parseJsonc } from '../classify';
import { parseDotenv } from './dotenv';
import type { Item } from './types';

/** A file in `secrets/` or `*.secrets.json`: JSON when it starts with `{`, else `KEY=VALUE`. */
export function parseSecretsFile(text: string, source: string): Item[] {
  const env = environmentOf(source.split('/').pop() ?? '');
  if (
    text
      .replace(/^\uFEFF/, '')
      .trimStart()
      .startsWith('{')
  ) {
    try {
      return flattenJson(parseJsonc(text), '').map(([name, value]) => ({
        name,
        value,
        env,
        source,
      }));
    } catch {
      return [];
    }
  }
  return parseDotenv(text, source, env);
}
