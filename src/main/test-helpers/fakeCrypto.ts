import type { TokenCrypto } from '../services/ConnectionStore';

/** Reversible fake: "encrypted" is the reversed string, so files visibly never hold the PAT. */
export const fakeCrypto = (available = true): TokenCrypto => ({
  available: () => available,
  encrypt: (s) => Buffer.from([...s].reverse().join(''), 'utf8'),
  decrypt: (b) => [...b.toString('utf8')].reverse().join(''),
});
