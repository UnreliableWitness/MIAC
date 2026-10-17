import type { HomePr } from '../../shared/home';
import type { RawHomePr } from '../services/AdoClient';
import { prWebUrl } from '../services/azureRepos';

/** An active PR as Home shows it, or null when ADO left out the id or repo. Votes of 5 and 10 count as approved. */
export function toHomePr(
  raw: RawHomePr,
  ctx: { organizationUrl: string; project: string; me: string },
): HomePr | null {
  const id = raw.pullRequestId;
  const repo = raw.repository?.name;
  if (typeof id !== 'number' || !repo) return null;
  const reviewers = raw.reviewers ?? [];
  const mine = reviewers.find((r) => r.id === ctx.me);
  const count = (test: (v: number) => boolean) =>
    reviewers.filter((r) => typeof r.vote === 'number' && test(r.vote)).length;
  return {
    id,
    repo,
    title: raw.title ?? '',
    author: raw.createdBy?.displayName ?? '',
    authorId: raw.createdBy?.id ?? '',
    createdAt: raw.creationDate ?? '',
    isDraft: raw.isDraft === true,
    conflicts: raw.mergeStatus === 'conflicts',
    myVote: mine ? (mine.vote ?? 0) : null,
    votes: {
      approved: count((v) => v >= 5),
      waiting: count((v) => v === -5),
      rejected: count((v) => v === -10),
    },
    url: prWebUrl(ctx.organizationUrl, ctx.project, repo, id),
  };
}
