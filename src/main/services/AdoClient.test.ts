import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startAdoServer, type AdoServer } from '../test-helpers/adoServer';
import {
  AdoClient,
  AdoError,
  buildWiql,
  CODE_READ_DENIED,
  CODE_WRITE_DENIED,
  WRITE_DENIED,
} from './AdoClient';

let server: AdoServer;
let client: AdoClient;
beforeEach(async () => {
  server = await startAdoServer();
  client = new AdoClient(
    `${server.url}/unreliablewitness`,
    async () => 'secret-pat',
  );
});
afterEach(() => server.close());

const authFor = (pat: string) =>
  `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
const BOM = String.fromCharCode(0xfeff);

describe('buildWiql', () => {
  it('scopes to the sprint and excludes closed states', () => {
    const q = buildWiql({
      scope: 'sprint',
      text: '',
      iterationPath: 'MIAC\\Sprint 1',
    });
    expect(q).toContain("[System.IterationPath] = 'MIAC\\Sprint 1'");
    expect(q).toContain(
      "[System.State] NOT IN ('Closed', 'Removed', 'Done', 'Resolved')",
    );
    expect(q).toContain('ORDER BY [System.ChangedDate] DESC');
    expect(q).not.toContain('@Me');
  });
  it('scopes to me', () => {
    expect(
      buildWiql({ scope: 'mine', text: '', iterationPath: null }),
    ).toContain('[System.AssignedTo] = @Me');
  });
  it('matches an all-digit text as id or title', () => {
    const q = buildWiql({ scope: 'mine', text: '48231', iterationPath: null });
    expect(q).toContain(
      "([System.Id] = 48231 OR [System.Title] CONTAINS '48231')",
    );
  });
  it('doubles single quotes in the text', () => {
    expect(
      buildWiql({ scope: 'mine', text: "O'Brien", iterationPath: null }),
    ).toContain("[System.Title] CONTAINS 'O''Brien'");
  });
});

describe('buildWiql id guard', () => {
  it('searches title only for digits beyond int32', () => {
    const q = buildWiql({
      scope: 'mine',
      text: '123456789012345678901',
      iterationPath: null,
    });
    expect(q).toContain("[System.Title] CONTAINS '123456789012345678901'");
    expect(q).not.toContain('[System.Id] =');
  });
});

describe('AdoClient.verify', () => {
  it('returns the user and sends basic auth with the pat', async () => {
    server.route('GET', '/unreliablewitness/_apis/connectionData', {
      body: { authenticatedUser: { providerDisplayName: 'Dries Hoebeke' } },
    });
    server.route('GET', '/unreliablewitness/_apis/projects/MIAC', {
      body: { id: 'p', name: 'MIAC' },
    });
    expect(await client.verify('MIAC')).toEqual({
      user: 'Dries Hoebeke',
      uniqueName: null,
    });
    expect(server.requests[0].auth).toBe(authFor('secret-pat'));
    expect(server.requests[0].path).toContain('api-version=7.1-preview');
  });
  it('verify returns the unique name', async () => {
    server.route('GET', '/unreliablewitness/_apis/connectionData', {
      body: {
        authenticatedUser: {
          providerDisplayName: 'Me',
          properties: { Account: { $value: 'me@x.com' } },
        },
      },
    });
    server.route('GET', '/unreliablewitness/_apis/projects/MIAC', {
      body: { id: 'p', name: 'MIAC' },
    });
    expect(await client.verify('MIAC')).toEqual({
      user: 'Me',
      uniqueName: 'me@x.com',
    });
  });
  it('maps 401 to unauthorized', async () => {
    server.route('GET', '/unreliablewitness/_apis/connectionData', {
      status: 401,
      body: { message: 'nope' },
    });
    const err = await client.verify('MIAC').catch((e) => e);
    expect(err).toBeInstanceOf(AdoError);
    expect(err.kind).toBe('unauthorized');
    expect(err.message).not.toContain('secret-pat');
  });
  it('maps 203 with an html sign-in page to unauthorized', async () => {
    server.route('GET', '/unreliablewitness/_apis/connectionData', {
      status: 203,
      headers: { 'content-type': 'text/html' },
      raw: `${BOM}<!DOCTYPE html><html><title>Sign in</title></html>`,
    });
    const err = await client.verify('MIAC').catch((e) => e);
    expect(err.kind).toBe('unauthorized');
  });
  it('maps 403 with an html sign-in page to unauthorized', async () => {
    server.route('GET', '/unreliablewitness/_apis/connectionData', {
      status: 403,
      headers: { 'content-type': 'text/html' },
      raw: '<!DOCTYPE html><html><title>Sign in</title></html>',
    });
    const err = await client.verify('MIAC').catch((e) => e);
    expect(err).toBeInstanceOf(AdoError);
    expect(err.kind).toBe('unauthorized');
    expect(err.message).not.toContain('secret-pat');
  });
  it('maps a missing project to not-found', async () => {
    server.route('GET', '/unreliablewitness/_apis/connectionData', {
      body: { authenticatedUser: { providerDisplayName: 'D' } },
    });
    server.route('GET', '/unreliablewitness/_apis/projects/Nope', {
      status: 404,
      body: { message: 'TF200016' },
    });
    const err = await client.verify('Nope').catch((e) => e);
    expect(err.kind).toBe('not-found');
    expect(err.path).toContain('/_apis/projects/Nope');
  });
  it('maps a connection failure to unreachable', async () => {
    const dead = new AdoClient('http://127.0.0.1:1/org', async () => 'x');
    const err = await dead.verify('P').catch((e) => e);
    expect(err).toBeInstanceOf(AdoError);
    expect(err.kind).toBe('unreachable');
  });
  it('maps a server that never answers to unreachable after the timeout', async () => {
    server.route('GET', '/unreliablewitness/_apis/connectionData', {
      hang: true,
    });
    const slow = new AdoClient(
      `${server.url}/unreliablewitness`,
      async () => 'x',
      fetch,
      { timeoutMs: 200 },
    );
    const err = await slow.verify('P').catch((e) => e);
    expect(err).toBeInstanceOf(AdoError);
    expect(err.kind).toBe('unreachable');
    expect(err.message).toBe('Azure DevOps did not answer within 0.2 s');
  });
  it('retries once on 429 after Retry-After', async () => {
    let calls = 0;
    server.route('GET', '/unreliablewitness/_apis/connectionData', () =>
      ++calls === 1
        ? { status: 429, headers: { 'retry-after': '0' }, body: {} }
        : { body: { authenticatedUser: { providerDisplayName: 'D' } } },
    );
    server.route('GET', '/unreliablewitness/_apis/projects/MIAC', {
      body: { name: 'MIAC' },
    });
    expect(await client.verify('MIAC')).toEqual({
      user: 'D',
      uniqueName: null,
    });
    expect(calls).toBe(2);
  });
  it('strips a BOM before parsing JSON', async () => {
    const json = (text: string) =>
      ({
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => text,
        type: 'basic',
      }) as unknown as Response;
    const fake = (async (url: string | URL | Request) =>
      String(url).includes('connectionData')
        ? json(BOM + '{"authenticatedUser":{"providerDisplayName":"D"}}')
        : json('{}')) as typeof fetch;
    const c = new AdoClient(
      'http://example.invalid/org',
      async () => 'x',
      fake,
    );
    expect(await c.verify('MIAC')).toEqual({ user: 'D', uniqueName: null });
  });
  it('maps a 302 redirect to unauthorized', async () => {
    server.route('GET', '/unreliablewitness/_apis/connectionData', {
      status: 302,
      headers: { location: '/signin' },
    });
    const err = await client.verify('MIAC').catch((e) => e);
    expect(err.kind).toBe('unauthorized');
  });
  it('maps a 200 text/html page to unauthorized', async () => {
    server.route('GET', '/unreliablewitness/_apis/connectionData', {
      headers: { 'content-type': 'text/html' },
      raw: '<html>Sign in</html>',
    });
    const err = await client.verify('MIAC').catch((e) => e);
    expect(err.kind).toBe('unauthorized');
  });
});

describe('AdoClient reads', () => {
  it('returns the current iteration or null', async () => {
    server.route(
      'GET',
      '/unreliablewitness/MIAC/_apis/work/teamsettings/iterations',
      {
        body: {
          value: [
            {
              id: 'it-1',
              name: 'Sprint 1',
              path: 'MIAC\\Sprint 1',
              attributes: {
                startDate: '2026-10-15T00:00:00Z',
                finishDate: '2026-10-28T00:00:00Z',
                timeFrame: 'current',
              },
            },
          ],
        },
      },
    );
    expect(await client.currentIteration('MIAC')).toEqual({
      id: 'it-1',
      path: 'MIAC\\Sprint 1',
      name: 'Sprint 1',
      startDate: '2026-10-15T00:00:00Z',
      finishDate: '2026-10-28T00:00:00Z',
    });
    expect(server.requests.at(-1)?.path).toContain('$timeframe=current');
    server.route(
      'GET',
      '/unreliablewitness/MIAC/_apis/work/teamsettings/iterations',
      { body: { value: [] } },
    );
    expect(await client.currentIteration('MIAC')).toBeNull();
  });
  it('encodes special characters in a project name', async () => {
    server.route(
      'GET',
      '/unreliablewitness/A%23B/_apis/work/teamsettings/iterations',
      { body: { value: [] } },
    );
    expect(await client.currentIteration('A#B')).toBeNull();
  });
  it('searches: wiql then batch get, mapping fields and url', async () => {
    server.route('POST', '/unreliablewitness/MIAC/_apis/wit/wiql', {
      body: { workItems: [{ id: 12 }, { id: 7 }] },
    });
    server.route('GET', '/unreliablewitness/_apis/wit/workitems', {
      body: {
        value: [
          {
            id: 12,
            fields: {
              'System.WorkItemType': 'Issue',
              'System.Title': 'Save address',
              'System.State': 'To Do',
              'System.AreaPath': 'MIAC',
              'System.IterationPath': 'MIAC\\Sprint 1',
              'System.AssignedTo': { displayName: 'Dries Hoebeke' },
            },
            _links: {
              html: {
                href: 'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/12',
              },
            },
          },
          {
            id: 7,
            fields: {
              'System.WorkItemType': 'Task',
              'System.Title': 'Tidy',
              'System.State': 'Doing',
              'System.AreaPath': 'MIAC',
              'System.IterationPath': 'MIAC\\Sprint 1',
            },
          },
        ],
      },
    });
    const items = await client.searchWorkItems({
      project: 'MIAC',
      scope: 'sprint',
      text: '',
      iterationPath: 'MIAC\\Sprint 1',
    });
    expect(items).toEqual([
      {
        id: '12',
        type: 'Issue',
        title: 'Save address',
        state: 'To Do',
        areaPath: 'MIAC',
        iterationPath: 'MIAC\\Sprint 1',
        assignedTo: 'Dries Hoebeke',
        url: 'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/12',
      },
      {
        id: '7',
        type: 'Task',
        title: 'Tidy',
        state: 'Doing',
        areaPath: 'MIAC',
        iterationPath: 'MIAC\\Sprint 1',
        assignedTo: null,
        url: `${server.url}/unreliablewitness/MIAC/_workitems/edit/7`,
      },
    ]);
    const wiql = server.requests.find((r) => r.method === 'POST');
    expect(JSON.parse(wiql!.body).query).toContain(
      "[System.IterationPath] = 'MIAC\\Sprint 1'",
    );
    const batch = server.requests.find((r) =>
      r.path.includes('/_apis/wit/workitems?'),
    );
    expect(batch!.path).toContain('ids=12,7');
    expect(batch!.path).toContain('System.AssignedTo');
  });
  it('omits unreadable ids from the batch instead of failing', async () => {
    server.route('POST', '/unreliablewitness/MIAC/_apis/wit/wiql', {
      body: { workItems: [{ id: 1 }, { id: 2 }] },
    });
    server.route('GET', '/unreliablewitness/_apis/wit/workitems', {
      body: { value: [null, { id: 2, fields: { 'System.Title': 'Ok' } }] },
    });
    const items = await client.searchWorkItems({
      project: 'MIAC',
      scope: 'mine',
      text: '',
      iterationPath: null,
    });
    expect(items.map((i) => i.id)).toEqual(['2']);
    const batch = server.requests.find((r) =>
      r.path.includes('/_apis/wit/workitems?'),
    );
    expect(batch!.path).toContain('errorPolicy=omit');
  });
  it('returns [] without a batch call when wiql finds nothing', async () => {
    server.route('POST', '/unreliablewitness/MIAC/_apis/wit/wiql', {
      body: { workItems: [] },
    });
    expect(
      await client.searchWorkItems({
        project: 'MIAC',
        scope: 'mine',
        text: '',
        iterationPath: null,
      }),
    ).toEqual([]);
    expect(
      server.requests.some((r) => r.path.includes('/_apis/wit/workitems?')),
    ).toBe(false);
  });
  it('caps the batch at 50 ids', async () => {
    server.route('POST', '/unreliablewitness/MIAC/_apis/wit/wiql', {
      body: {
        workItems: Array.from({ length: 80 }, (_, i) => ({ id: i + 1 })),
      },
    });
    server.route('GET', '/unreliablewitness/_apis/wit/workitems', (req) => ({
      body: { value: [], echoed: req.path },
    }));
    await client.searchWorkItems({
      project: 'MIAC',
      scope: 'mine',
      text: '',
      iterationPath: null,
    });
    const batch = server.requests.find((r) =>
      r.path.includes('/_apis/wit/workitems?'),
    );
    expect(batch!.path.match(/ids=([^&]+)/)![1].split(',')).toHaveLength(50);
  });
  it('surfaces a malformed body as an http error, not a crash', async () => {
    server.route(
      'GET',
      '/unreliablewitness/MIAC/_apis/work/teamsettings/iterations',
      { raw: 'not json' },
    );
    const err = await client.currentIteration('MIAC').catch((e) => e);
    expect(err).toBeInstanceOf(AdoError);
    expect(err.kind).toBe('http');
  });
});

const ITERATIONS = '/unreliablewitness/MIAC/_apis/work/teamsettings/iterations';
const wi = (id: number, fields: Record<string, unknown> = {}) => ({
  id,
  fields: {
    'System.WorkItemType': 'Task',
    'System.Title': `Item ${id}`,
    'System.State': 'To Do',
    ...fields,
  },
});

describe('AdoClient sprint', () => {
  const current = (attributes: Record<string, unknown> = {}) =>
    server.route('GET', `${ITERATIONS}?`, {
      body: {
        value: [
          { id: 'it-1', name: 'Sprint 1', path: 'MIAC\\Sprint 1', attributes },
        ],
      },
    });

  it('keeps null sprint dates as null', async () => {
    current({ startDate: null, finishDate: null, timeFrame: 'current' });
    expect(await client.currentIteration('MIAC')).toMatchObject({
      startDate: null,
      finishDate: null,
    });
  });
  it('reads the iteration work items as relations', async () => {
    server.route('GET', `${ITERATIONS}/it-1/workitems`, {
      body: {
        workItemRelations: [
          { rel: null, source: null, target: { id: 1 } },
          {
            rel: 'System.LinkTypes.Hierarchy-Forward',
            source: { id: 1 },
            target: { id: 5 },
          },
          { rel: null, source: null, target: null },
        ],
      },
    });
    expect(await client.iterationWorkItems('MIAC', 'it-1')).toEqual([
      { rel: null, source: null, target: { id: 1 } },
      {
        rel: 'System.LinkTypes.Hierarchy-Forward',
        source: { id: 1 },
        target: { id: 5 },
      },
    ]);
    expect(server.requests.at(-1)?.path).toBe(
      `${ITERATIONS}/it-1/workitems?api-version=7.1`,
    );
  });
  it('builds the sprint tree with remaining work, in backlog order', async () => {
    current();
    server.route('GET', `${ITERATIONS}/it-1/workitems`, {
      body: {
        workItemRelations: [
          { rel: null, source: null, target: { id: 2 } },
          { rel: null, source: null, target: { id: 1 } },
          {
            rel: 'System.LinkTypes.Hierarchy-Forward',
            source: { id: 1 },
            target: { id: 5 },
          },
        ],
      },
    });
    server.route('GET', '/unreliablewitness/_apis/wit/workitems', {
      body: {
        value: [
          wi(1, { 'System.WorkItemType': 'Issue' }),
          wi(5, { 'Microsoft.VSTS.Scheduling.RemainingWork': 3 }),
          wi(2),
        ],
      },
    });
    const sprint = await client.sprint('MIAC');
    expect(sprint.iteration?.name).toBe('Sprint 1');
    expect(
      sprint.rows.map((r) => [r.item.id, r.depth, r.item.remainingWork]),
    ).toEqual([
      ['2', 0, null],
      ['1', 0, null],
      ['5', 1, 3],
    ]);
    const batch = server.requests.find((r) =>
      r.path.includes('/_apis/wit/workitems?'),
    );
    expect(batch!.path).toContain('ids=2,1,5');
    expect(batch!.path).toContain('Microsoft.VSTS.Scheduling.RemainingWork');
    expect(batch!.path).toContain('errorPolicy=omit');
  });
  it('fetches the items in chunks of 200', async () => {
    current();
    server.route('GET', `${ITERATIONS}/it-1/workitems`, {
      body: {
        workItemRelations: Array.from({ length: 450 }, (_, i) => ({
          rel: null,
          source: null,
          target: { id: i + 1 },
        })),
      },
    });
    server.route('GET', '/unreliablewitness/_apis/wit/workitems', (req) => ({
      body: {
        value: req.path
          .match(/ids=([^&]+)/)![1]
          .split(',')
          .map((id) => wi(Number(id))),
      },
    }));
    const sprint = await client.sprint('MIAC');
    expect(sprint.rows).toHaveLength(450);
    expect(sprint.rows[449].item.id).toBe('450');
    const sizes = server.requests
      .filter((r) => r.path.includes('/_apis/wit/workitems?'))
      .map((r) => r.path.match(/ids=([^&]+)/)![1].split(',').length);
    expect(sizes).toEqual([200, 200, 50]);
  });
  it('returns no iteration and no rows without a current sprint', async () => {
    server.route('GET', `${ITERATIONS}?`, { body: { value: [] } });
    expect(await client.sprint('MIAC')).toEqual({ iteration: null, rows: [] });
    expect(server.requests).toHaveLength(1);
  });
  it('skips the batch call for an empty sprint', async () => {
    current();
    server.route('GET', `${ITERATIONS}/it-1/workitems`, {
      body: { workItemRelations: [] },
    });
    expect((await client.sprint('MIAC')).rows).toEqual([]);
    expect(
      server.requests.some((r) => r.path.includes('/_apis/wit/workitems?')),
    ).toBe(false);
  });
});

describe('AdoClient work item types', () => {
  it('returns colors, icon URLs and states, asking per type only when the list has none', async () => {
    server.route('GET', '/unreliablewitness/MIAC/_apis/wit/workitemtypes?', {
      body: {
        value: [
          {
            name: 'Task',
            color: 'A4880A',
            icon: { url: 'https://icons.example/icon_check_box?color=A4880A' },
            states: [
              { name: 'To Do', color: 'b2b2b2', category: 'Proposed' },
              { name: 'Done', color: '339933', category: 'Completed' },
            ],
          },
          { name: 'User Story', color: 'nonsense' },
          { name: 'Old', isDisabled: true },
        ],
      },
    });
    server.route(
      'GET',
      '/unreliablewitness/MIAC/_apis/wit/workitemtypes/User%20Story/states',
      {
        body: {
          value: [{ name: 'Active', color: '007acc', category: 'InProgress' }],
        },
      },
    );
    expect(await client.workItemTypes('MIAC')).toEqual([
      {
        name: 'Task',
        color: '#a4880a',
        iconUrl: 'https://icons.example/icon_check_box?color=A4880A',
        states: [
          { name: 'To Do', color: '#b2b2b2', category: 'Proposed' },
          { name: 'Done', color: '#339933', category: 'Completed' },
        ],
      },
      {
        name: 'User Story',
        color: null,
        iconUrl: null,
        states: [{ name: 'Active', color: '#007acc', category: 'InProgress' }],
      },
    ]);
  });
  it('keeps a type whose states cannot be read, with no states', async () => {
    server.route('GET', '/unreliablewitness/MIAC/_apis/wit/workitemtypes?', {
      body: { value: [{ name: 'Bug', color: 'CC293D' }] },
    });
    server.route(
      'GET',
      '/unreliablewitness/MIAC/_apis/wit/workitemtypes/Bug/states',
      { status: 500, body: {} },
    );
    expect(await client.workItemTypes('MIAC')).toEqual([
      { name: 'Bug', color: '#cc293d', iconUrl: null, states: [] },
    ]);
  });
});

describe('AdoClient.iconDataUrl', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  type Call = { url: string; auth: string | undefined; redirect?: string };
  const fakeFetch = (
    reply: (call: Call) => { status?: number; type?: string; body?: string },
  ) => {
    const calls: Call[] = [];
    const impl = (async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      const call = {
        url,
        auth: headers.authorization,
        redirect: init.redirect,
      };
      calls.push(call);
      const r = reply(call);
      return new Response(r.body ?? SVG, {
        status: r.status ?? 200,
        headers: { 'content-type': r.type ?? 'image/svg+xml; charset=utf-8' },
      });
    }) as unknown as typeof fetch;
    return { calls, impl };
  };
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`;

  it('fetches an icon on another host without the PAT', async () => {
    const f = fakeFetch(() => ({}));
    const c = new AdoClient(
      'https://dev.azure.com/unreliablewitness',
      async () => 'secret-pat',
      f.impl,
    );
    expect(
      await c.iconDataUrl(
        'https://tfsprodweu11.visualstudio.com/_apis/wit/workItemIcons/icon_check_box?color=A4880A&v=2',
      ),
    ).toBe(dataUrl);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].auth).toBeUndefined();
  });
  it('sends the PAT to the organization host, without following redirects', async () => {
    const f = fakeFetch(() => ({}));
    const c = new AdoClient(
      'https://dev.azure.com/unreliablewitness',
      async () => 'secret-pat',
      f.impl,
    );
    expect(
      await c.iconDataUrl(
        'https://dev.azure.com/unreliablewitness/_apis/wit/workItemIcons/x',
      ),
    ).toBe(dataUrl);
    expect(f.calls).toEqual([
      {
        url: 'https://dev.azure.com/unreliablewitness/_apis/wit/workItemIcons/x',
        auth: authFor('secret-pat'),
        redirect: 'manual',
      },
    ]);
  });
  it('falls back to no auth when the authenticated fetch fails', async () => {
    const f = fakeFetch((call) => (call.auth ? { status: 401 } : {}));
    const c = new AdoClient(
      'https://dev.azure.com/unreliablewitness',
      async () => 'secret-pat',
      f.impl,
    );
    expect(
      await c.iconDataUrl(
        'https://dev.azure.com/unreliablewitness/_apis/wit/workItemIcons/x',
      ),
    ).toBe(dataUrl);
    expect(f.calls.map((x) => Boolean(x.auth))).toEqual([true, false]);
  });
  it('sends the PAT only under the organization itself, not to another org on the same host', async () => {
    const f = fakeFetch(() => ({}));
    const c = new AdoClient(
      'https://dev.azure.com/unreliablewitness',
      async () => 'secret-pat',
      f.impl,
    );
    for (const u of [
      'https://dev.azure.com/someone-else/_apis/wit/workItemIcons/x',
      'https://dev.azure.com/unreliablewitness-evil/_apis/wit/workItemIcons/x',
      'https://dev.azure.com/_apis/wit/workItemIcons/x',
    ])
      expect(await c.iconDataUrl(u)).toBe(dataUrl);
    expect(f.calls.every((x) => x.auth === undefined)).toBe(true);
    const old = fakeFetch(() => ({}));
    const vs = new AdoClient(
      'https://unreliablewitness.visualstudio.com',
      async () => 'secret-pat',
      old.impl,
    );
    await vs.iconDataUrl(
      'https://unreliablewitness.visualstudio.com/_apis/wit/workItemIcons/x',
    );
    await vs.iconDataUrl(
      'https://other.visualstudio.com/_apis/wit/workItemIcons/x',
    );
    expect(old.calls.map((x) => Boolean(x.auth))).toEqual([true, false]);
  });
  it('accepts only SVG and PNG', async () => {
    const c = (type: string) =>
      new AdoClient(
        'https://dev.azure.com/unreliablewitness',
        async () => 'secret-pat',
        fakeFetch(() => ({ type })).impl,
      );
    expect(await c('image/png').iconDataUrl('https://i.example/i')).toBe(
      `data:image/png;base64,${Buffer.from(SVG).toString('base64')}`,
    );
    for (const type of ['image/gif', 'image/webp', 'image/svg'])
      expect(await c(type).iconDataUrl('https://i.example/i')).toBeNull();
  });
  it('stops reading an icon once it passes the size limit', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(64 * 1024);
    const impl = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(ctl) {
            pulled++;
            if (pulled > 1000) ctl.close();
            else ctl.enqueue(chunk);
          },
        }),
        { status: 200, headers: { 'content-type': 'image/svg+xml' } },
      )) as unknown as typeof fetch;
    const c = new AdoClient(
      'https://dev.azure.com/unreliablewitness',
      async () => 'secret-pat',
      impl,
    );
    expect(await c.iconDataUrl('https://i.example/i')).toBeNull();
    expect(pulled).toBeLessThan(20);
  });
  it('refuses an icon whose declared length is over the limit without reading it', async () => {
    let read = false;
    const impl = (async () =>
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(ctl) {
              read = true;
              ctl.close();
            },
          },
          { highWaterMark: 0 },
        ),
        {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': String(10 * 1024 * 1024),
          },
        },
      )) as unknown as typeof fetch;
    const c = new AdoClient(
      'https://dev.azure.com/unreliablewitness',
      async () => 'secret-pat',
      impl,
    );
    expect(await c.iconDataUrl('https://i.example/i')).toBeNull();
    expect(read).toBe(false);
  });
  it('returns null for a non-image, an error, plain http elsewhere or a bad URL', async () => {
    const c = (reply: Parameters<typeof fakeFetch>[0]) =>
      new AdoClient(
        'https://dev.azure.com/unreliablewitness',
        async () => 'secret-pat',
        fakeFetch(reply).impl,
      );
    expect(
      await c(() => ({ type: 'text/html', body: '<html>' })).iconDataUrl(
        'https://icons.example/i',
      ),
    ).toBeNull();
    expect(
      await c(() => ({ status: 404 })).iconDataUrl('https://icons.example/i'),
    ).toBeNull();
    expect(
      await c(() => ({})).iconDataUrl('http://icons.example/i'),
    ).toBeNull();
    expect(await c(() => ({})).iconDataUrl('not a url')).toBeNull();
  });
});

describe('AdoClient writes', () => {
  it('lists enabled work item types with their field reference names', async () => {
    server.route('GET', '/unreliablewitness/MIAC/_apis/wit/workitemtypes', {
      body: {
        value: [
          {
            name: 'Issue',
            fields: [
              { referenceName: 'System.Title' },
              { referenceName: 'Custom.AICost' },
            ],
          },
          { name: 'Old', isDisabled: true, fields: [] },
        ],
      },
    });
    expect(await client.workItemTypeFields('MIAC')).toEqual([
      { type: 'Issue', fields: ['System.Title', 'Custom.AICost'] },
    ]);
  });
  it('patches fields with a JSON Patch document', async () => {
    server.route('PATCH', '/unreliablewitness/_apis/wit/workitems/7', {
      body: { id: 7 },
    });
    await client.updateWorkItemFields(7, {
      'Custom.AICost': 23.85,
      'Custom.AITokens': 1200,
    });
    const req = server.requests.at(-1)!;
    expect(req.path).toBe(
      '/unreliablewitness/_apis/wit/workitems/7?api-version=7.1',
    );
    expect(JSON.parse(req.body)).toEqual([
      { op: 'add', path: '/fields/Custom.AICost', value: 23.85 },
      { op: 'add', path: '/fields/Custom.AITokens', value: 1200 },
    ]);
    expect(req.auth).toBe(authFor('secret-pat'));
  });
  it('adds a markdown comment and returns its id', async () => {
    server.route(
      'POST',
      '/unreliablewitness/MIAC/_apis/wit/workItems/7/comments',
      { body: { id: 991, text: 'x' } },
    );
    expect(await client.addComment('MIAC', 7, 'hello')).toEqual({ id: 991 });
    const req = server.requests.at(-1)!;
    expect(req.path).toBe(
      '/unreliablewitness/MIAC/_apis/wit/workItems/7/comments?format=markdown&api-version=7.1-preview.4',
    );
    expect(JSON.parse(req.body)).toEqual({ text: 'hello' });
  });
  it('explains a token without write scope', async () => {
    server.route('PATCH', '/unreliablewitness/_apis/wit/workitems/7', {
      status: 403,
      body: {},
    });
    await expect(
      client.updateWorkItemFields(7, { 'Custom.AICost': 1 }),
    ).rejects.toMatchObject({
      kind: 'unauthorized',
      message:
        'The token cannot write work items (needs Work Items: Read & write)',
    });
    server.route(
      'POST',
      '/unreliablewitness/MIAC/_apis/wit/workItems/7/comments',
      { status: 401, body: {} },
    );
    await expect(client.addComment('MIAC', 7, 'x')).rejects.toMatchObject({
      kind: 'unauthorized',
      message:
        'The token cannot write work items (needs Work Items: Read & write)',
    });
  });
});

describe('work item state and pull request calls', () => {
  const P = '/unreliablewitness/MIAC/_apis';

  it('reads type, state and assignee, preferring the unique name', async () => {
    server.route('GET', '/unreliablewitness/_apis/wit/workitems/7', {
      body: {
        fields: {
          'System.WorkItemType': 'Task',
          'System.State': 'To Do',
          'System.AssignedTo': { uniqueName: 'a@b.c', displayName: 'Ann' },
        },
      },
    });
    expect(await client.workItemForStart(7)).toEqual({
      type: 'Task',
      state: 'To Do',
      assignedTo: 'a@b.c',
    });
    expect(server.requests.at(-1)!.path).toBe(
      '/unreliablewitness/_apis/wit/workitems/7?fields=System.WorkItemType,System.State,System.AssignedTo&api-version=7.1',
    );
  });
  it('falls back to the display name, then to null', async () => {
    server.route('GET', '/unreliablewitness/_apis/wit/workitems/7', {
      body: {
        fields: {
          'System.WorkItemType': 'Task',
          'System.State': 'To Do',
          'System.AssignedTo': { displayName: 'Ann' },
        },
      },
    });
    expect((await client.workItemForStart(7)).assignedTo).toBe('Ann');
    server.route('GET', '/unreliablewitness/_apis/wit/workitems/7', {
      body: { fields: { 'System.WorkItemType': 'Task', 'System.State': 'x' } },
    });
    expect((await client.workItemForStart(7)).assignedTo).toBeNull();
  });
  it('lists the states of a type with their category', async () => {
    server.route('GET', `${P}/wit/workitemtypes/User%20Story/states`, {
      body: {
        value: [{ name: 'New', category: 'Proposed' }, { name: 'Odd' }],
      },
    });
    expect(await client.typeStates('MIAC', 'User Story')).toEqual([
      { name: 'New', category: 'Proposed' },
      { name: 'Odd', category: null },
    ]);
    expect(server.requests.at(-1)!.path).toBe(
      `${P}/wit/workitemtypes/User%20Story/states?api-version=7.1`,
    );
  });
  it('patches state and assignee, and skips an empty change', async () => {
    server.route('PATCH', '/unreliablewitness/_apis/wit/workitems/7', {
      body: { id: 7 },
    });
    await client.updateWorkItem(7, { state: 'Active', assignedTo: 'a@b.c' });
    const req = server.requests.at(-1)!;
    expect(req.path).toBe(
      '/unreliablewitness/_apis/wit/workitems/7?api-version=7.1',
    );
    expect(JSON.parse(req.body)).toEqual([
      { op: 'add', path: '/fields/System.State', value: 'Active' },
      { op: 'add', path: '/fields/System.AssignedTo', value: 'a@b.c' },
    ]);
    const count = server.requests.length;
    await client.updateWorkItem(7, {});
    expect(server.requests.length).toBe(count);
  });
  it('reports a write denial and ADO rule errors on update', async () => {
    server.route('PATCH', '/unreliablewitness/_apis/wit/workitems/7', {
      status: 403,
      body: {},
    });
    await expect(
      client.updateWorkItem(7, { state: 'Active' }),
    ).rejects.toMatchObject({ message: WRITE_DENIED });
    server.route('PATCH', '/unreliablewitness/_apis/wit/workitems/7', {
      status: 400,
      raw: '{"message":"TF401320: Rule Error for field State"}',
    });
    const e = await client
      .updateWorkItem(7, { state: 'Nope' })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AdoError);
    expect((e as AdoError).message).toContain(
      'TF401320: Rule Error for field State',
    );
  });
  it('resolves a repository id', async () => {
    server.route('GET', `${P}/git/repositories/my%20repo`, {
      body: { id: 'guid-1' },
    });
    expect(await client.repositoryId('MIAC', 'my repo')).toBe('guid-1');
    expect(server.requests.at(-1)!.path).toBe(
      `${P}/git/repositories/my%20repo?api-version=7.1`,
    );
  });
  it('finds the first active pull request or null', async () => {
    server.route('GET', `${P}/git/repositories/r1/pullrequests`, {
      body: {
        value: [{ pullRequestId: 5, status: 'active', isDraft: true }],
      },
    });
    expect(
      await client.findActivePullRequest('MIAC', 'r1', 'feature/1-x'),
    ).toEqual({ pullRequestId: 5, status: 'active', isDraft: true });
    expect(server.requests.at(-1)!.path).toBe(
      `${P}/git/repositories/r1/pullrequests?searchCriteria.sourceRefName=${encodeURIComponent('refs/heads/feature/1-x')}&searchCriteria.status=active&api-version=7.1`,
    );
    server.route('GET', `${P}/git/repositories/r1/pullrequests`, {
      body: { value: [] },
    });
    expect(await client.findActivePullRequest('MIAC', 'r1', 'b')).toBeNull();
  });
  it('creates a draft pull request linked to the work item', async () => {
    server.route('POST', `${P}/git/repositories/r1/pullrequests`, {
      body: { pullRequestId: 9, status: 'active', isDraft: true },
    });
    const pr = await client.createPullRequest('MIAC', 'r1', {
      source: 'feature/1-x',
      target: 'main',
      title: 'T',
      description: 'D',
      workItemId: 1,
    });
    expect(pr.pullRequestId).toBe(9);
    const req = server.requests.at(-1)!;
    expect(req.path).toBe(
      `${P}/git/repositories/r1/pullrequests?api-version=7.1`,
    );
    expect(JSON.parse(req.body)).toEqual({
      sourceRefName: 'refs/heads/feature/1-x',
      targetRefName: 'refs/heads/main',
      title: 'T',
      description: 'D',
      isDraft: true,
      workItemRefs: [{ id: '1' }],
    });
  });
  it('sends no work item refs without a work item, and names the Code scope on 403', async () => {
    server.route('POST', `${P}/git/repositories/r1/pullrequests`, {
      body: { pullRequestId: 9, status: 'active', isDraft: true },
    });
    const input = {
      source: 'a',
      target: 'main',
      title: 'T',
      description: 'D',
      workItemId: null,
    };
    await client.createPullRequest('MIAC', 'r1', input);
    expect(JSON.parse(server.requests.at(-1)!.body).workItemRefs).toEqual([]);
    server.route('POST', `${P}/git/repositories/r1/pullrequests`, {
      status: 403,
      body: {},
    });
    await expect(
      client.createPullRequest('MIAC', 'r1', input),
    ).rejects.toMatchObject({
      kind: 'unauthorized',
      message: CODE_WRITE_DENIED,
    });
  });
  it('reads a pull request', async () => {
    server.route('GET', `${P}/git/repositories/r1/pullrequests/9`, {
      body: { pullRequestId: 9, status: 'completed', isDraft: false },
    });
    expect(await client.pullRequest('MIAC', 'r1', 9)).toEqual({
      pullRequestId: 9,
      status: 'completed',
      isDraft: false,
    });
  });
  it('names the Code scope when a repository or pull request read is denied', async () => {
    const reads: [string, () => Promise<unknown>][] = [
      [`${P}/git/repositories/r1`, () => client.repositoryId('MIAC', 'r1')],
      [
        `${P}/git/repositories/r1/pullrequests`,
        () => client.findActivePullRequest('MIAC', 'r1', 'b'),
      ],
      [
        `${P}/git/repositories/r1/pullrequests/9`,
        () => client.pullRequest('MIAC', 'r1', 9),
      ],
    ];
    for (const status of [401, 403])
      for (const [route, call] of reads) {
        server.route('GET', route, { status, body: {} });
        await expect(call()).rejects.toMatchObject({
          kind: 'unauthorized',
          message: CODE_READ_DENIED,
        });
      }
    expect(CODE_READ_DENIED).toBe(
      'The token cannot read repositories or pull requests (needs Code: Read & write)',
    );
  });
  it('maps an unknown PR status to active and a missing isDraft to false', async () => {
    server.route('GET', `${P}/git/repositories/r1/pullrequests/9`, {
      body: { pullRequestId: 9, status: 'notSet' },
    });
    expect(await client.pullRequest('MIAC', 'r1', 9)).toEqual({
      pullRequestId: 9,
      status: 'active',
      isDraft: false,
    });
    server.route('GET', `${P}/git/repositories/r1/pullrequests`, {
      body: {
        value: [{ pullRequestId: 5, status: 'abandoned', isDraft: 'yes' }],
      },
    });
    expect(await client.findActivePullRequest('MIAC', 'r1', 'b')).toEqual({
      pullRequestId: 5,
      status: 'abandoned',
      isDraft: false,
    });
    server.route('POST', `${P}/git/repositories/r1/pullrequests`, {
      body: { pullRequestId: 11, status: 42, isDraft: true },
    });
    expect(
      await client.createPullRequest('MIAC', 'r1', {
        source: 'a',
        target: 'main',
        title: 'T',
        description: 'D',
        workItemId: null,
      }),
    ).toEqual({ pullRequestId: 11, status: 'active', isDraft: true });
  });
  it('rejects a pull request response without a numeric id', async () => {
    server.route('GET', `${P}/git/repositories/r1/pullrequests/9`, {
      body: { status: 'active' },
    });
    await expect(client.pullRequest('MIAC', 'r1', 9)).rejects.toThrow(
      /pull request id/,
    );
  });
});
