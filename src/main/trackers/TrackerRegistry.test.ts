import { describe, expect, it } from 'vitest';
import type { ConnectionStore } from '../services/ConnectionStore';
import { TrackerRegistry } from './TrackerRegistry';

function registry(provider: 'azure-devops' | 'github') {
  const connections = {
    get: () => ({ organizationUrl: 'https://dev.azure.com/o', provider }),
    token: async () => 't',
  } as unknown as ConnectionStore;
  return new TrackerRegistry(
    connections,
    (async () => new Response('{}')) as typeof fetch,
  );
}

describe('TrackerRegistry.tracker', () => {
  it('returns the same tracker twice and a new one after invalidate', () => {
    const r = registry('azure-devops');
    const a = r.tracker('c1');
    expect(r.tracker('c1')).toBe(a);
    r.invalidate('c1');
    expect(r.tracker('c1')).not.toBe(a);
  });

  it('throws for a GitHub connection', () => {
    expect(() => registry('github').tracker('c1')).toThrow(
      'GitHub connections are not supported yet',
    );
  });
});
