import { type ReviewRepo, viewedKey } from '../../shared/review';

/** A repo group folded or opened by hand, valid while the repo's files are what they were then. */
export type RepoFold = { how: 'open' | 'closed'; at: string };

/** The repo's files and their content: a hand-made fold lasts until this changes. */
export const repoSignature = (repo: ReviewRepo): string =>
  repo.files.map((f) => `${f.path}:${f.hash}`).join('\n');

export const viewedIn = (
  repo: ReviewRepo,
  viewed: Record<string, string>,
): number =>
  repo.files.filter(
    (f) => viewed[viewedKey(repo.workspaceId, f.path)] === f.hash,
  ).length;

/**
 * Whether the repo's group is folded: a fold made by hand while the files are unchanged, else folded
 * by itself once every file is viewed.
 */
export function isFolded(
  repo: ReviewRepo,
  viewed: Record<string, string>,
  fold: RepoFold | undefined,
): boolean {
  if (fold && fold.at === repoSignature(repo)) return fold.how === 'closed';
  return repo.files.length > 0 && viewedIn(repo, viewed) === repo.files.length;
}
