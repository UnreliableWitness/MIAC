import { AdoClient } from './AdoClient';
import type { ConnectionStore } from './ConnectionStore';

/** One AdoClient per connection id, created lazily; drop it when the connection changes. */
export class AdoRegistry {
  private readonly clients = new Map<string, AdoClient>();

  constructor(
    private readonly connections: ConnectionStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  client(connectionId: string): AdoClient {
    const hit = this.clients.get(connectionId);
    if (hit) return hit;
    const c = this.connections.get(connectionId);
    const client = new AdoClient(
      c.organizationUrl,
      () => this.connections.token(connectionId),
      this.fetchImpl,
    );
    this.clients.set(connectionId, client);
    return client;
  }

  invalidate(connectionId?: string): void {
    if (connectionId) this.clients.delete(connectionId);
    else this.clients.clear();
  }
}
