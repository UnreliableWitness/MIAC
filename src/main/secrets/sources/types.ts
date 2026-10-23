import type { Found } from '../../../shared/secrets';

/** What a source parser yields; discovery adds `tracked` and `secretLike`. */
export type Item = Pick<Found, 'name' | 'value' | 'env' | 'source'>;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
