import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ConnectionsFileSchema,
  type Connection,
  type ConnectionInput,
  type ConnectionStatus,
  type ConnectionsFile,
} from '../../shared/types';

/** Encrypts tokens at rest. main.ts adapts Electron safeStorage; tests pass a fake. */
export interface TokenCrypto {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}

export class TokenUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenUnavailableError';
  }
}

/** `https://dev.azure.com/<org>` or `https://<org>.visualstudio.com`, from anything a user is likely to paste. */
export function normalizeOrganizationUrl(
  input: string,
  opts: { allowLoopbackHttp?: boolean } = {},
): string {
  let text = input.trim();
  if (text.length === 0)
    throw new Error(
      'Enter the organization URL, e.g. https://dev.azure.com/<organization>',
    );
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`"${input.trim()}" is not a valid URL`);
  }
  const host = url.hostname.toLowerCase();
  if (host === 'dev.azure.com') {
    const org = url.pathname.split('/').filter(Boolean)[0];
    if (!org)
      throw new Error(
        'The URL needs the organization: https://dev.azure.com/<organization>',
      );
    return `https://dev.azure.com/${org}`;
  }
  if (host.endsWith('.visualstudio.com') && host.split('.').length === 3) {
    return `https://${host}`;
  }
  if (
    opts.allowLoopbackHttp &&
    url.protocol === 'http:' &&
    (host === '127.0.0.1' || host === 'localhost')
  ) {
    const org = url.pathname.split('/').filter(Boolean)[0];
    if (org) return `http://${url.host}/${org}`;
  }
  throw new Error('Use a dev.azure.com or visualstudio.com organization URL');
}

export function organizationSlug(organizationUrl: string): string {
  const url = new URL(organizationUrl);
  if (
    url.hostname === 'dev.azure.com' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === 'localhost'
  )
    return url.pathname.split('/').filter(Boolean)[0] ?? organizationUrl;
  return url.hostname.split('.')[0];
}

type Stored = ConnectionsFile['connections'][number];

const empty = (): ConnectionsFile => ({ version: 1, connections: [] });

/** Connections to Azure DevOps organizations, tokens encrypted at rest. Same atomic-write pattern as TaskStore. */
export class ConnectionStore {
  private current: ConnectionsFile = empty();
  private queue: Promise<unknown> = Promise.resolve();
  /** Ids whose stored organization URL no longer passes validation; never used for requests. */
  private readonly invalidUrls = new Set<string>();

  constructor(
    private readonly filePath: string,
    private readonly crypto: TokenCrypto,
    private readonly opts: { allowLoopbackHttp?: boolean } = {},
  ) {}

  normalizeUrl(input: string): string {
    return normalizeOrganizationUrl(input, this.opts);
  }

  /** Everything save() rejects up front, so callers can fail before any network call. */
  assertCanSave(input: ConnectionInput): void {
    this.normalizeUrl(input.organizationUrl);
    if (input.project.trim().length === 0)
      throw new Error('Enter the project name');
    if (input.pat.trim().length === 0)
      throw new Error('Enter a personal access token');
    if (!this.crypto.available())
      throw new TokenUnavailableError(
        'Token encryption is not available on this machine; the connection was not saved',
      );
  }

  async load(): Promise<{ recovered: boolean; backup?: string }> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.current = empty();
        return { recovered: false };
      }
      throw e;
    }
    try {
      this.current = ConnectionsFileSchema.parse(JSON.parse(raw));
    } catch {
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      await fs.rename(this.filePath, backup);
      this.current = empty();
      return { recovered: true, backup };
    }
    this.invalidUrls.clear();
    for (const c of this.current.connections) {
      try {
        c.organizationUrl = this.normalizeUrl(c.organizationUrl);
      } catch {
        this.invalidUrls.add(c.id);
        c.status = 'unauthorized';
      }
    }
    return { recovered: false };
  }

  list(): Connection[] {
    return this.current.connections.map(strip);
  }

  get(id: string): Connection {
    return strip(this.stored(id));
  }

  async save(input: ConnectionInput): Promise<Connection> {
    this.assertCanSave(input);
    const organizationUrl = this.normalizeUrl(input.organizationUrl);
    const project = input.project.trim();
    const pat = input.pat.trim();
    const tokenCiphertext = this.crypto.encrypt(pat).toString('base64');
    const existing = input.id
      ? this.current.connections.find((c) => c.id === input.id)
      : undefined;
    const record: Stored = {
      id: existing?.id ?? input.id ?? randomUUID(),
      name:
        (
          input.name ??
          existing?.name ??
          organizationSlug(organizationUrl)
        ).trim() || organizationSlug(organizationUrl),
      organizationUrl,
      project,
      user: null,
      status: 'unknown',
      checkedAt: null,
      tokenCiphertext,
    };
    await this.update((f) => {
      const i = f.connections.findIndex((c) => c.id === record.id);
      if (i >= 0) f.connections[i] = record;
      else f.connections.push(record);
    });
    this.invalidUrls.delete(record.id);
    return strip(record);
  }

  async remove(id: string): Promise<void> {
    this.stored(id);
    await this.update((f) => {
      f.connections = f.connections.filter((c) => c.id !== id);
    });
    this.invalidUrls.delete(id);
  }

  async setStatus(
    id: string,
    status: ConnectionStatus,
    user?: string | null,
  ): Promise<Connection> {
    await this.update((f) => {
      const c = f.connections.find((x) => x.id === id);
      if (!c) throw new Error(`Unknown connection ${id}`);
      c.status = status;
      c.checkedAt = new Date().toISOString();
      if (user !== undefined) c.user = user;
    });
    return this.get(id);
  }

  async token(id: string): Promise<string> {
    const c = this.stored(id);
    if (this.invalidUrls.has(id))
      throw new TokenUnavailableError(
        'This connection has an invalid organization URL; remove it and add it again',
      );
    try {
      return this.crypto.decrypt(Buffer.from(c.tokenCiphertext, 'base64'));
    } catch {
      throw new TokenUnavailableError(
        'Stored token could not be decrypted; enter it again',
      );
    }
  }

  private stored(id: string): Stored {
    const c = this.current.connections.find((x) => x.id === id);
    if (!c) throw new Error(`Unknown connection ${id}`);
    return c;
  }

  private update(mutate: (f: ConnectionsFile) => void): Promise<void> {
    const run = async () => {
      const next = structuredClone(this.current);
      mutate(next);
      const valid = ConnectionsFileSchema.parse(next);
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(valid, null, 2), 'utf8');
      await fs.rename(tmp, this.filePath);
      this.current = valid;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

function strip(c: Stored): Connection {
  return {
    id: c.id,
    name: c.name,
    organizationUrl: c.organizationUrl,
    project: c.project,
    user: c.user,
    status: c.status,
    checkedAt: c.checkedAt,
  };
}
