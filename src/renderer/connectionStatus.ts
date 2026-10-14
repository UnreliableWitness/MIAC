import type { Connection } from '../shared/types';

/** Wording for a connection's status; `short` is the terse form used in the nav footer. */
export function statusText(
  c: Connection,
  short = false,
): { text: string; ok: boolean } {
  switch (c.status) {
    case 'ok':
      return { text: `Connected as ${c.user ?? 'unknown user'}`, ok: true };
    case 'unauthorized':
      return {
        text: short ? 'token rejected' : 'Token rejected, enter it again',
        ok: false,
      };
    case 'unreachable':
      return {
        text: short ? 'unreachable' : 'Organization unreachable',
        ok: false,
      };
    default:
      return { text: short ? 'not verified' : 'Not verified yet', ok: false };
  }
}
