import { environmentOf, parseJsonc } from '../classify';
import { isRecord, type Item } from './types';

const ENV_VARS = ['ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT'];

/** Each profile's `environmentVariables`; the profile's environment is its name's, else its ASPNETCORE_ENVIRONMENT's. */
export function parseLaunchSettings(text: string): Item[] {
  let json: unknown;
  try {
    json = parseJsonc(text);
  } catch {
    return [];
  }
  if (!isRecord(json) || !isRecord(json.profiles)) return [];
  const items: Item[] = [];
  for (const [profile, def] of Object.entries(json.profiles)) {
    if (!isRecord(def) || !isRecord(def.environmentVariables)) continue;
    const vars = Object.entries(def.environmentVariables).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    );
    const named = vars.find(([k]) => ENV_VARS.includes(k));
    const env =
      environmentOf(profile) ?? (named ? environmentOf(named[1]) : null);
    for (const [name, value] of vars)
      items.push({ name, value, env, source: `launch profile ${profile}` });
  }
  return items;
}
