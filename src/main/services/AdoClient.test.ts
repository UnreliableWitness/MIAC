import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startAdoServer, type AdoServer } from '../test-helpers/adoServer';
import { AdoClient, AdoError, buildWiql } from './AdoClient';

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
    expect(await client.verify('MIAC')).toEqual({ user: 'Dries Hoebeke' });
    expect(server.requests[0].auth).toBe(authFor('secret-pat'));
    expect(server.requests[0].path).toContain('api-version=7.1-preview');
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
    expect(await client.verify('MIAC')).toEqual({ user: 'D' });
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
    expect(await c.verify('MIAC')).toEqual({ user: 'D' });
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
              name: 'Sprint 1',
              path: 'MIAC\\Sprint 1',
              attributes: { timeFrame: 'current' },
            },
          ],
        },
      },
    );
    expect(await client.currentIteration('MIAC')).toEqual({
      path: 'MIAC\\Sprint 1',
      name: 'Sprint 1',
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
