import { useState } from 'react';
import type {
  HomeConnection,
  HomePr,
  HomeSnapshot,
} from '../../../shared/home';
import { api, tryInvoke } from '../../api';
import { connectionNote } from '../../homeView';
import { ago, dateTime } from '../../format';
import { useStore } from '../../store';
import { track } from '../../telemetry';
import { Band } from './Band';

type Row = { pr: HomePr; connection: HomeConnection };
type Kind = 'review' | 'team-review' | 'my-pr';

const VOTE: Record<string, string> = {
  '10': 'Approved',
  '5': 'Approved with suggestions',
  '-5': 'Waiting for author',
  '-10': 'Rejected',
};

function votesText(v: HomePr['votes']): string {
  const parts = [
    v.approved && `${v.approved} approved`,
    v.waiting && `${v.waiting} waiting`,
    v.rejected && `${v.rejected} rejected`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No votes yet';
}

function PrRow({ row, kind }: { row: Row; kind: Kind }) {
  const notify = useStore((s) => s.notify);
  const { pr, connection } = row;
  const stale = connection.status !== 'ok';
  const vote = pr.myVote ? VOTE[String(pr.myVote)] : undefined;
  return (
    <button
      type="button"
      className={stale ? 'home-pr is-stale-data' : 'home-pr'}
      aria-label={`!${pr.id} ${pr.title}, ${pr.repo}, ${pr.author}`}
      title={
        stale && connection.fetchedAt
          ? `Stale since ${dateTime(connection.fetchedAt)}`
          : undefined
      }
      onClick={() => {
        track('home.clicked', { band: kind });
        void tryInvoke(
          () => api().invoke('shell:openExternal', pr.url),
          notify,
        );
      }}
    >
      <span className="home-pr-title">
        !{pr.id} {pr.title}
      </span>
      {pr.isDraft && <span className="home-badge">Draft</span>}
      {pr.conflicts && <span className="home-badge is-red">Conflicts</span>}
      <span className="muted small">
        {pr.repo} · {kind === 'my-pr' ? votesText(pr.votes) : pr.author} ·{' '}
        {ago(pr.createdAt)}
        {vote && ` · ${vote}`}
      </span>
    </button>
  );
}

const rowsOf = (
  snapshot: HomeSnapshot | null,
  pick: (c: HomeConnection) => HomePr[],
): Row[] =>
  (snapshot?.connections ?? []).flatMap((connection) =>
    pick(connection).map((pr) => ({ pr, connection })),
  );

const oldest = (a: Row, b: Row) => a.pr.createdAt.localeCompare(b.pr.createdAt);
const key = (r: Row) => `${r.connection.connectionId}:${r.pr.id}`;

export function PrBand({ snapshot }: { snapshot: HomeSnapshot | null }) {
  const [teamOpen, setTeamOpen] = useState(false);
  const reviews = rowsOf(snapshot, (c) => c.reviews).sort(oldest);
  const team = rowsOf(snapshot, (c) => c.teamReviews).sort(oldest);
  const mine = rowsOf(snapshot, (c) => c.myPrs).sort((a, b) => oldest(b, a));
  const errors = (snapshot?.connections ?? [])
    .filter((c) => c.prsError)
    .map((c) => (
      <p key={c.connectionId} className="muted small">
        Couldn't load pull requests for {c.name}/{c.project}
      </p>
    ));
  const notes = (snapshot?.connections ?? []).flatMap((c) => {
    const note = connectionNote(c);
    return note
      ? [
          <p key={c.connectionId} className="muted small">
            {note}
          </p>,
        ]
      : [];
  });
  const allOk =
    notes.length === 0 &&
    !(snapshot?.connections ?? []).some((c) => c.prsError);
  return (
    <div className="home-split">
      <Band title="Reviews for me">
        {reviews.map((r) => (
          <PrRow key={key(r)} row={r} kind="review" />
        ))}
        {reviews.length === 0 && allOk && (
          <p className="muted">No reviews waiting.</p>
        )}
        {team.length > 0 && (
          <>
            <button
              type="button"
              className="home-toggle"
              aria-expanded={teamOpen}
              onClick={() => setTeamOpen(!teamOpen)}
            >
              Team requests ({team.length})
            </button>
            {teamOpen &&
              team.map((r) => (
                <PrRow key={key(r)} row={r} kind="team-review" />
              ))}
          </>
        )}
        {notes}
        {errors}
      </Band>
      <Band title="My pull requests">
        {mine.map((r) => (
          <PrRow key={key(r)} row={r} kind="my-pr" />
        ))}
        {mine.length === 0 && allOk && (
          <p className="muted">No open pull requests.</p>
        )}
        {notes}
        {errors}
      </Band>
    </div>
  );
}
