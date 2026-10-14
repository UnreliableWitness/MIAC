import type { Iteration, WorkItemSummary } from '../../shared/types';

export type AdoErrorKind =
  | 'unauthorized'
  | 'not-found'
  | 'unreachable'
  | 'http';

export class AdoError extends Error {
  constructor(
    public readonly kind: AdoErrorKind,
    public readonly path: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AdoError';
  }
}

const API = 'api-version=7.1';
const EXCLUDED_STATES = ['Closed', 'Removed', 'Done', 'Resolved'];
const FIELDS = [
  'System.Id',
  'System.WorkItemType',
  'System.Title',
  'System.State',
  'System.AreaPath',
  'System.IterationPath',
  'System.AssignedTo',
];
const MAX_RESULTS = 50;

const wiqlString = (s: string) => `'${s.replaceAll("'", "''")}'`;

export function buildWiql(opts: {
  scope: 'sprint' | 'mine';
  text: string;
  iterationPath: string | null;
}): string {
  const where = [
    '[System.TeamProject] = @project',
    `[System.State] NOT IN (${EXCLUDED_STATES.map(wiqlString).join(', ')})`,
  ];
  if (opts.scope === 'mine') where.push('[System.AssignedTo] = @Me');
  else if (opts.iterationPath)
    where.push(`[System.IterationPath] = ${wiqlString(opts.iterationPath)}`);
  const text = opts.text.trim();
  if (text.length > 0) {
    const title = `[System.Title] CONTAINS ${wiqlString(text)}`;
    where.push(
      /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 2147483647
        ? `([System.Id] = ${Number(text)} OR ${title})`
        : title,
    );
  }
  return `SELECT [System.Id] FROM WorkItems WHERE ${where.join(' AND ')} ORDER BY [System.ChangedDate] DESC`;
}

export const WRITE_DENIED =
  'The token cannot write work items (needs Work Items: Read & write)';

type Json = Record<string, unknown>;

/** Four read calls and three write calls (work item fields, comment, type field listing) against one Azure DevOps organization. The token provider is called per request so a re-entered PAT takes effect immediately. */
export class AdoClient {
  constructor(
    private readonly organizationUrl: string,
    private readonly token: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async verify(project: string): Promise<{ user: string }> {
    const data = await this.request<Json>(
      '/_apis/connectionData?api-version=7.1-preview',
    );
    const user =
      ((data.authenticatedUser as Json | undefined)?.providerDisplayName as
        | string
        | undefined) ?? 'unknown user';
    await this.request<Json>(
      `/_apis/projects/${encodeURIComponent(project)}?${API}`,
    );
    return { user };
  }

  async currentIteration(project: string): Promise<Iteration | null> {
    const data = await this.request<{
      value?: { name: string; path: string }[];
    }>(
      `/${encodeURIComponent(project)}/_apis/work/teamsettings/iterations?$timeframe=current&${API}`,
    );
    const first = (data.value ?? [])[0];
    return first ? { path: first.path, name: first.name } : null;
  }

  async searchWorkItems(opts: {
    project: string;
    scope: 'sprint' | 'mine';
    text: string;
    iterationPath: string | null;
  }): Promise<WorkItemSummary[]> {
    const query = buildWiql(opts);
    const result = await this.request<{ workItems?: { id: number }[] }>(
      `/${encodeURIComponent(opts.project)}/_apis/wit/wiql?${API}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      },
    );
    const ids = (result.workItems ?? []).slice(0, MAX_RESULTS).map((w) => w.id);
    if (ids.length === 0) return [];
    const batch = await this.request<{
      value?: ({ id: number; fields: Json; _links?: Json } | null)[];
    }>(
      `/_apis/wit/workitems?ids=${ids.join(',')}&fields=${FIELDS.join(',')}&errorPolicy=omit&${API}`,
    );
    const byId = new Map(
      (batch.value ?? []).flatMap((w) => (w ? [[w.id, w] as const] : [])),
    );
    return ids.flatMap((id) => {
      const w = byId.get(id);
      if (!w) return [];
      const f = w.fields;
      const assigned = f['System.AssignedTo'] as Json | string | undefined;
      const html = ((w._links as Json | undefined)?.html as Json | undefined)
        ?.href as string | undefined;
      return [
        {
          id: String(w.id),
          type: String(f['System.WorkItemType'] ?? ''),
          title: String(f['System.Title'] ?? ''),
          state: String(f['System.State'] ?? ''),
          areaPath: String(f['System.AreaPath'] ?? ''),
          iterationPath: String(f['System.IterationPath'] ?? ''),
          assignedTo:
            typeof assigned === 'string'
              ? assigned
              : ((assigned?.displayName as string | undefined) ?? null),
          url:
            html ??
            `${this.organizationUrl}/${encodeURIComponent(opts.project)}/_workitems/edit/${w.id}`,
        },
      ];
    });
  }

  async workItemTypeFields(
    project: string,
  ): Promise<{ type: string; fields: string[] }[]> {
    const data = await this.request<{
      value?: {
        name: string;
        isDisabled?: boolean;
        fields?: { referenceName: string }[];
      }[];
    }>(`/${encodeURIComponent(project)}/_apis/wit/workitemtypes?${API}`);
    return (data.value ?? [])
      .filter((t) => !t.isDisabled)
      .map((t) => ({
        type: t.name,
        fields: (t.fields ?? []).map((f) => f.referenceName),
      }));
  }

  async updateWorkItemFields(
    id: number,
    fields: Record<string, number>,
  ): Promise<void> {
    await this.request<Json>(
      `/_apis/wit/workitems/${id}?${API}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json-patch+json' },
        body: JSON.stringify(
          Object.entries(fields).map(([name, value]) => ({
            op: 'add',
            path: `/fields/${name}`,
            value,
          })),
        ),
      },
      { write: true },
    );
  }

  async addComment(
    project: string,
    id: number,
    markdown: string,
  ): Promise<{ id: number }> {
    const data = await this.request<{ id: number }>(
      `/${encodeURIComponent(project)}/_apis/wit/workItems/${id}/comments?format=markdown&api-version=7.1-preview.4`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: markdown }),
      },
      { write: true },
    );
    return { id: data.id };
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    opts: { write?: boolean; retried?: boolean } = {},
  ): Promise<T> {
    const url = `${this.organizationUrl}${path}`;
    const pat = await this.token();
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        redirect: 'manual',
        headers: {
          accept: 'application/json',
          ...init.headers,
          authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
        },
      });
    } catch (e) {
      throw new AdoError(
        'unreachable',
        path,
        `Could not reach ${this.organizationUrl}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (res.status === 429 && !opts.retried) {
      const header = Number(res.headers.get('retry-after') ?? '1');
      const wait = Math.min(10, Math.max(0, Number.isNaN(header) ? 1 : header));
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.request<T>(path, init, { ...opts, retried: true });
    }
    const redirected =
      (res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect';
    const html =
      res.ok && (res.headers.get('content-type') ?? '').startsWith('text/html');
    if (
      res.status === 401 ||
      res.status === 203 ||
      res.status === 403 ||
      redirected ||
      html
    ) {
      throw new AdoError(
        'unauthorized',
        path,
        opts.write && (res.status === 401 || res.status === 403)
          ? WRITE_DENIED
          : 'Azure DevOps rejected the token (check that it is valid and has Work Items read scope)',
        res.status,
      );
    }
    if (res.status === 404)
      throw new AdoError(
        'not-found',
        path,
        `Not found: ${path.split('?')[0]}`,
        404,
      );
    const raw = await res.text();
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    if (!res.ok)
      throw new AdoError(
        'http',
        path,
        `Azure DevOps returned ${res.status} for ${path.split('?')[0]}`,
        res.status,
      );
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AdoError(
        'http',
        path,
        `Azure DevOps returned an unreadable response for ${path.split('?')[0]}`,
        res.status,
      );
    }
  }
}
