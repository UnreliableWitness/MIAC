import { AdoClient } from '../services/AdoClient';
import type { ConnectionStore } from '../services/ConnectionStore';
import { AzureDevOpsTracker } from './AzureDevOpsTracker';
import type { Tracker } from './Tracker';

/** One client and one Tracker per connection id, created lazily; drop them when the connection changes. */
export class TrackerRegistry {
  private readonly clients = new Map<string, AdoClient>();
  private readonly trackers = new Map<string, Tracker>();

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

  tracker(connectionId: string): Tracker {
    const hit = this.trackers.get(connectionId);
    if (hit) return hit;
    if (this.connections.get(connectionId).provider === 'github') {
      throw new Error('GitHub connections are not supported yet');
    }
    const tracker = new AzureDevOpsTracker(this.client(connectionId));
    this.trackers.set(connectionId, tracker);
    return tracker;
  }

  invalidate(connectionId?: string): void {
    if (connectionId) {
      this.clients.delete(connectionId);
      this.trackers.delete(connectionId);
    } else {
      this.clients.clear();
      this.trackers.clear();
    }
  }
}
