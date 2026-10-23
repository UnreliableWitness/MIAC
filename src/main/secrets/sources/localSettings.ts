import { flattenJson, parseJsonc } from '../classify';
import { isRecord, type Item } from './types';

/** Azure Functions `local.settings.json`: `Values` and `ConnectionStrings`, Development. */
export function parseLocalSettings(text: string, source: string): Item[] {
  let json: unknown;
  try {
    json = parseJsonc(text);
  } catch {
    return [];
  }
  if (!isRecord(json)) return [];
  return [
    ...flattenJson(json.Values, ''),
    ...flattenJson(json.ConnectionStrings, 'ConnectionStrings'),
  ].map(([name, value]) => ({ name, value, env: 'development', source }));
}
