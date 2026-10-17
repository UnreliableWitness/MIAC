import {
  HOME_TIMEOUT_MS,
  HomeSnapshotSchema,
  type HomeConnection,
  type HomePr,
  type HomeSnapshot,
  type HomeSprint,
} from '../../shared/home';
import type { Connection, SprintIteration } from '../../shared/types';
import type { AdoClient } from '../services/AdoClient';
import { JsonFileStore } from '../usage/JsonFileStore';
import { toHomePr } from './homePr';

export type HomeClient = Pick<
  AdoClient,
  | 'me'
  | 'myTeams'
  | 'currentIteration'
  | 'assignedInIterations'
  | 'workItems'
  | 'activePullRequests'
>;

export type HomeDeps = {
  file: string;
  connections: () => Connection[];
  client: (connectionId: string) => HomeClient;
  /** Runs one connection's call so its status in Settings follows (handlers pass `withConnection`). */
  withConnection?: <T>(
    connectionId: string,
    run: () => Promise<T>,
  ) => Promise<T>;
  now?: () => Date;
  timeoutMs?: number;
  onBuilt?: (
    snapshot: HomeSnapshot,
    info: { connections: number; failed: number; durationMs: number },
  ) => void;
};

type Call = <T>(run: () => Promise<T>) => Promise<T>;

const message = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

const byCreated = (a: HomePr, b: HomePr) =>
  a.createdAt.localeCompare(b.createdAt);

/** Builds Home's cross-connection snapshot; one rebuild at a time, the last one cached on disk. */
export class HomeService {
  private readonly store: JsonFileStore<HomeSnapshot | null>;
  private loaded: Promise<unknown> | null = null;
  private running: Promise<HomeSnapshot> | null = null;

  constructor(private readonly d: HomeDeps) {
    this.store = new JsonFileStore<HomeSnapshot | null>(
      d.file,
      HomeSnapshotSchema.nullable(),
      () => null,
    );
  }

  private load(): Promise<unknown> {
    this.loaded ??= this.store.load().catch(() => undefined);
    return this.loaded;
  }

  async get(): Promise<HomeSnapshot | null> {
    await this.load();
    return this.store.value;
  }

  refresh(): Promise<HomeSnapshot> {
    this.running ??= this.build().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async build(): Promise<HomeSnapshot> {
    await this.load();
    const started = Date.now();
    const prev = new Map(
      (this.store.value?.connections ?? []).map((c) => [c.connectionId, c]),
    );
    const connections = await Promise.all(
      this.d
        .connections()
        .map((c) => this.connection(c, prev.get(c.id) ?? null)),
    );
    const snapshot: HomeSnapshot = {
      version: 1,
      builtAt: this.now().toISOString(),
      connections,
    };
    await this.store
      .update(() => snapshot)
      .catch((e: unknown) =>
        console.error('[home] could not save the snapshot', e),
      );
    this.d.onBuilt?.(snapshot, {
      connections: connections.length,
      failed: connections.filter((c) => c.status !== 'ok').length,
      durationMs: Date.now() - started,
    });
    return snapshot;
  }

  private now(): Date {
    return this.d.now?.() ?? new Date();
  }

  private connection(
    c: Connection,
    prev: HomeConnection | null,
  ): Promise<HomeConnection> {
    const ms = this.d.timeoutMs ?? HOME_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`Azure DevOps did not answer within ${ms / 1000} s`),
          ),
        ms,
      );
    });
    return Promise.race([this.fetch(c, prev), timeout])
      .catch((e: unknown) => this.failed(c, prev, message(e)))
      .finally(() => clearTimeout(timer));
  }

  private failed(
    c: Connection,
    prev: HomeConnection | null,
    error: string,
  ): HomeConnection {
    const base = { connectionId: c.id, name: c.name, project: c.project };
    return prev
      ? { ...prev, ...base, status: 'stale', error }
      : {
          ...base,
          status: 'error',
          error,
          fetchedAt: null,
          sprints: [],
          sprintsError: null,
          reviews: [],
          teamReviews: [],
          myPrs: [],
          prsError: null,
        };
  }

  private async fetch(
    c: Connection,
    prev: HomeConnection | null,
  ): Promise<HomeConnection> {
    const client = this.d.client(c.id);
    const call: Call = (run) =>
      this.d.withConnection ? this.d.withConnection(c.id, run) : run();
    const me = await call(() => client.me());
    const teams = await call(() => client.myTeams(c.project));
    const found = await Promise.all(
      teams.map((t) => call(() => client.currentIteration(c.project, t.name))),
    );
    const iterations = [
      ...new Map(
        found
          .filter((i): i is SprintIteration => i !== null)
          .map((i) => [i.path, i]),
      ).values(),
    ];
    const [sprints, prs] = await Promise.allSettled([
      this.sprints(c, client, call, iterations),
      this.prs(
        c,
        client,
        call,
        me,
        teams.map((t) => t.id),
      ),
    ]);
    return {
      connectionId: c.id,
      name: c.name,
      project: c.project,
      status: 'ok',
      error: null,
      fetchedAt: this.now().toISOString(),
      sprints:
        sprints.status === 'fulfilled' ? sprints.value : (prev?.sprints ?? []),
      sprintsError:
        sprints.status === 'rejected' ? message(sprints.reason) : null,
      reviews:
        prs.status === 'fulfilled' ? prs.value.reviews : (prev?.reviews ?? []),
      teamReviews:
        prs.status === 'fulfilled'
          ? prs.value.teamReviews
          : (prev?.teamReviews ?? []),
      myPrs: prs.status === 'fulfilled' ? prs.value.myPrs : (prev?.myPrs ?? []),
      prsError: prs.status === 'rejected' ? message(prs.reason) : null,
    };
  }

  private async sprints(
    c: Connection,
    client: HomeClient,
    call: Call,
    iterations: SprintIteration[],
  ): Promise<HomeSprint[]> {
    const ids = await call(() =>
      client.assignedInIterations(
        c.project,
        iterations.map((i) => i.path),
      ),
    );
    const items = ids.length
      ? await call(() => client.workItems(c.project, ids))
      : [];
    return iterations
      .map((i) => ({
        iterationId: i.id,
        name: i.name,
        path: i.path,
        startDate: i.startDate,
        finishDate: i.finishDate,
        items: items.filter((w) => w.iterationPath === i.path),
      }))
      .filter((s) => s.items.length > 0)
      .sort((a, b) => (a.finishDate ?? '9').localeCompare(b.finishDate ?? '9'));
  }

  private async prs(
    c: Connection,
    client: HomeClient,
    call: Call,
    me: string,
    teamIds: string[],
  ): Promise<{ reviews: HomePr[]; teamReviews: HomePr[]; myPrs: HomePr[] }> {
    const ctx = { organizationUrl: c.organizationUrl, project: c.project, me };
    const map = (raw: Awaited<ReturnType<HomeClient['activePullRequests']>>) =>
      raw.flatMap((r) => {
        const p = toHomePr(r, ctx);
        return p ? [p] : [];
      });
    const [named, mine, ...byTeam] = await Promise.all([
      call(() => client.activePullRequests(c.project, { reviewerId: me })).then(
        map,
      ),
      call(() => client.activePullRequests(c.project, { creatorId: me })).then(
        map,
      ),
      ...teamIds.map((id) =>
        call(() =>
          client.activePullRequests(c.project, { reviewerId: id }),
        ).then(map),
      ),
    ]);
    const team = new Map<number, HomePr>();
    for (const p of byTeam.flat())
      if (p.myVote === null && p.authorId !== me) team.set(p.id, p);
    return {
      reviews: named
        .filter((p) => p.myVote === 0 && p.authorId !== me)
        .sort(byCreated),
      teamReviews: [...team.values()].sort(byCreated),
      myPrs: mine.sort((a, b) => byCreated(b, a)),
    };
  }
}
