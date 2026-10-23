import { parse } from 'yaml';
import { environmentOf } from '../classify';
import { isRecord, type Item } from './types';

const INTERPOLATED = /^\$\{[^}]*\}$/;

/** `environment:` (map or list) and `env_file:` of every service; the environment comes from the file name. */
export function parseCompose(
  text: string,
  source: string,
): { items: Item[]; envFiles: string[] } {
  const out = { items: [] as Item[], envFiles: [] as string[] };
  let doc: unknown;
  try {
    doc = parse(text, { merge: true });
  } catch {
    return out;
  }
  if (!isRecord(doc) || !isRecord(doc.services)) return out;
  const env = environmentOf(source.split('/').pop() ?? '');
  const add = (name: string, value: string) => {
    if (!INTERPOLATED.test(value)) out.items.push({ name, value, env, source });
  };
  for (const svc of Object.values(doc.services)) {
    if (!isRecord(svc)) continue;
    const e = svc.environment;
    if (Array.isArray(e)) {
      for (const entry of e) {
        if (typeof entry !== 'string') continue;
        const at = entry.indexOf('=');
        if (at > 0) add(entry.slice(0, at), entry.slice(at + 1));
      }
    } else if (isRecord(e)) {
      for (const [name, v] of Object.entries(e))
        if (
          typeof v === 'string' ||
          typeof v === 'number' ||
          typeof v === 'boolean'
        )
          add(name, String(v));
    }
    const files = Array.isArray(svc.env_file) ? svc.env_file : [svc.env_file];
    for (const f of files) {
      if (typeof f === 'string') out.envFiles.push(f);
      else if (isRecord(f) && typeof f.path === 'string')
        out.envFiles.push(f.path);
    }
  }
  return out;
}
