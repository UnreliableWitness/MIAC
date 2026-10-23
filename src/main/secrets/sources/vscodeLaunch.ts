import { environmentOf, parseJsonc } from '../classify';
import { isRecord, type Item } from './types';

/** `env` of each configuration (environment from its name) and the `envFile`s, repo-relative. */
export function parseVscodeLaunch(
  text: string,
  source: string,
): { items: Item[]; envFiles: string[] } {
  const out = { items: [] as Item[], envFiles: [] as string[] };
  let json: unknown;
  try {
    json = parseJsonc(text);
  } catch {
    return out;
  }
  if (!isRecord(json) || !Array.isArray(json.configurations)) return out;
  for (const conf of json.configurations as unknown[]) {
    if (!isRecord(conf)) continue;
    const env = typeof conf.name === 'string' ? environmentOf(conf.name) : null;
    if (isRecord(conf.env))
      for (const [name, v] of Object.entries(conf.env))
        if (typeof v === 'string')
          out.items.push({ name, value: v, env, source });
    if (typeof conf.envFile === 'string')
      out.envFiles.push(
        conf.envFile.replace(/^\$\{workspaceFolder\}[\\/]?/, ''),
      );
  }
  return out;
}
