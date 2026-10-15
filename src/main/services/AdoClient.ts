import { buildSprintTree, type SprintRelation } from '../../shared/sprintTree';
import type {
  Sprint,
  SprintItem,
  SprintIteration,
  WorkItemStateMeta,
  WorkItemSummary,
  WorkItemTypeMeta,
} from '../../shared/types';

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
const REMAINING_WORK = 'Microsoft.VSTS.Scheduling.RemainingWork';
const MAX_RESULTS = 50;
/** The work items batch API takes at most 200 ids per call. */
const BATCH = 200;
/** Type icons are small SVGs; anything bigger is not an icon. */
const MAX_ICON_BYTES = 256 * 1024;
/** The only icon formats accepted; anything else could be interpolated into a data URL in odd ways. */
const ICON_TYPES = new Set(['image/svg+xml', 'image/png']);

/** ADO sends colors as `rrggbb` without the hash; null for anything else. */
export const hexColor = (c: unknown): string | null =>
  typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c)
    ? `#${c.replace('#', '').toLowerCase()}`
    : null;

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

/** Read calls and three write calls (work item fields, comment, type field listing) against one Azure DevOps organization. The token provider is called per request so a re-entered PAT takes effect immediately. */
export class AdoClient {
  constructor(
    private readonly organizationUrl: string,
    private readonly token: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly options: { timeoutMs?: number } = {},
  ) {}

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? 15000;
  }

  private unreachable(path: string, e: unknown): AdoError {
    const timedOut =
      e instanceof Error &&
      (e.name === 'TimeoutError' || e.name === 'AbortError');
    return new AdoError(
      'unreachable',
      path,
      timedOut
        ? `Azure DevOps did not answer within ${this.timeoutMs / 1000} s`
        : `Could not reach ${this.organizationUrl}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

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

  async currentIteration(project: string): Promise<SprintIteration | null> {
    const data = await this.request<{
      value?: {
        id: string;
        name: string;
        path: string;
        attributes?: { startDate?: string | null; finishDate?: string | null };
      }[];
    }>(
      `/${encodeURIComponent(project)}/_apis/work/teamsettings/iterations?$timeframe=current&${API}`,
    );
    const first = (data.value ?? [])[0];
    return first
      ? {
          id: first.id,
          path: first.path,
          name: first.name,
          startDate: first.attributes?.startDate ?? null,
          finishDate: first.attributes?.finishDate ?? null,
        }
      : null;
  }

  /**
   * The sprint backlog of the project's default team, in backlog order: top-level entries have no source, children
   * name their parent. Verified live (2026-10-15): after reordering through `iterations/{id}/workitemsorder`, this
   * API returns items by their new StackRank, not by id, so no client-side sort is needed.
   */
  async iterationWorkItems(
    project: string,
    iterationId: string,
  ): Promise<SprintRelation[]> {
    const data = await this.request<{ workItemRelations?: SprintRelation[] }>(
      `/${encodeURIComponent(project)}/_apis/work/teamsettings/iterations/${encodeURIComponent(iterationId)}/workitems?${API}`,
    );
    return (data.workItemRelations ?? []).filter(
      (r) => typeof r?.target?.id === 'number',
    );
  }

  /** The current sprint as grid rows, or no iteration when the project has no current sprint. */
  async sprint(project: string): Promise<Sprint> {
    const iteration = await this.currentIteration(project);
    if (!iteration) return { iteration: null, rows: [] };
    const relations = await this.iterationWorkItems(project, iteration.id);
    const ids = [...new Set(relations.map((r) => r.target.id))];
    const items = await this.workItems(project, ids);
    return { iteration, rows: buildSprintTree(relations, items) };
  }

  /** Work items by id with the picker's fields plus remaining work, in chunks of 200. Unreadable ids are left out. */
  async workItems(project: string, ids: number[]): Promise<SprintItem[]> {
    const out: SprintItem[] = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const batch = await this.request<{
        value?: ({ id: number; fields: Json; _links?: Json } | null)[];
      }>(
        `/_apis/wit/workitems?ids=${chunk.join(',')}&fields=${[...FIELDS, REMAINING_WORK].join(',')}&errorPolicy=omit&${API}`,
      );
      const byId = new Map(
        (batch.value ?? []).flatMap((w) => (w ? [[w.id, w] as const] : [])),
      );
      for (const id of chunk) {
        const w = byId.get(id);
        if (!w) continue;
        const remaining = w.fields[REMAINING_WORK];
        out.push({
          ...this.summary(project, w),
          remainingWork: typeof remaining === 'number' ? remaining : null,
        });
      }
    }
    return out;
  }

  private summary(
    project: string,
    w: { id: number; fields: Json; _links?: Json },
  ): WorkItemSummary {
    const f = w.fields;
    const assigned = f['System.AssignedTo'] as Json | string | undefined;
    const html = ((w._links as Json | undefined)?.html as Json | undefined)
      ?.href as string | undefined;
    return {
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
        `${this.organizationUrl}/${encodeURIComponent(project)}/_workitems/edit/${w.id}`,
    };
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
      return w ? [this.summary(opts.project, w)] : [];
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

  /** The enabled work item types with their color, icon URL and states (from the list, or per type when the list leaves them out). */
  async workItemTypes(
    project: string,
  ): Promise<(Omit<WorkItemTypeMeta, 'icon'> & { iconUrl: string | null })[]> {
    type RawState = { name?: string; color?: string; category?: string };
    const p = encodeURIComponent(project);
    const data = await this.request<{
      value?: {
        name: string;
        color?: string;
        isDisabled?: boolean;
        icon?: { url?: string };
        states?: RawState[];
      }[];
    }>(`/${p}/_apis/wit/workitemtypes?${API}`);
    const states = (raw: RawState[]): WorkItemStateMeta[] =>
      raw.flatMap((st) =>
        st.name
          ? [
              {
                name: st.name,
                color: hexColor(st.color),
                category: st.category ?? null,
              },
            ]
          : [],
      );
    return Promise.all(
      (data.value ?? [])
        .filter((t) => !t.isDisabled)
        .map(async (t) => ({
          name: t.name,
          color: hexColor(t.color),
          iconUrl: t.icon?.url ?? null,
          states: t.states
            ? states(t.states)
            : await this.request<{ value?: RawState[] }>(
                `/${p}/_apis/wit/workitemtypes/${encodeURIComponent(t.name)}/states?${API}`,
              )
                .then((r) => states(r.value ?? []))
                .catch(() => []),
        })),
    );
  }

  /**
   * Downloads a type icon (SVG or PNG, at most 256 KB) and returns it as a data URL, or null. The PAT goes only to
   * URLs under the organization itself (`dev.azure.com/<org>/...`, or the whole `<org>.visualstudio.com` host);
   * a refused or failed authenticated fetch is retried without it, as ADO serves the icons anonymously too.
   */
  async iconDataUrl(iconUrl: string): Promise<string | null> {
    let url: URL;
    try {
      url = new URL(iconUrl);
    } catch {
      return null;
    }
    const org = new URL(this.organizationUrl);
    const orgPath = org.pathname.replace(/\/+$/, '');
    const ownOrg =
      url.host === org.host &&
      url.protocol === org.protocol &&
      (orgPath === '' || url.pathname.startsWith(`${orgPath}/`));
    if (url.protocol !== 'https:' && !ownOrg) return null;
    const get = async (auth: boolean): Promise<string | null> => {
      const abort = new AbortController();
      try {
        const headers: Record<string, string> = {
          accept: 'image/svg+xml, image/png',
        };
        if (auth)
          headers.authorization = `Basic ${Buffer.from(`:${await this.token()}`).toString('base64')}`;
        const res = await this.fetchImpl(url.href, {
          signal: AbortSignal.any([
            abort.signal,
            AbortSignal.timeout(this.timeoutMs),
          ]),
          // Never carry the PAT along a redirect.
          redirect: auth ? 'manual' : 'follow',
          headers,
        });
        const type = (res.headers.get('content-type') ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        const declared = Number(res.headers.get('content-length') ?? 0);
        if (
          !res.ok ||
          !ICON_TYPES.has(type) ||
          !res.body ||
          declared > MAX_ICON_BYTES
        ) {
          abort.abort();
          return null;
        }
        const chunks: Uint8Array[] = [];
        let size = 0;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_ICON_BYTES) {
            abort.abort();
            await reader.cancel().catch(() => undefined);
            return null;
          }
          chunks.push(value);
        }
        if (size === 0) return null;
        return `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`;
      } catch {
        abort.abort();
        return null;
      }
    };
    return (ownOrg ? await get(true) : null) ?? get(false);
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
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'manual',
        headers: {
          accept: 'application/json',
          ...init.headers,
          authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
        },
      });
    } catch (e) {
      throw this.unreachable(path, e);
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
    let raw: string;
    try {
      raw = await res.text();
    } catch (e) {
      throw this.unreachable(path, e);
    }
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
