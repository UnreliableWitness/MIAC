/** Azure Repos remotes, PR availability and PR text. Pure: no I/O. */

import type { Connection } from '../../shared/types';
import { COST_LINE_PREFIX } from '../../shared/workItemUsage';
import { splitRemoteRef } from './GitClient';

export type AzureRepoRef = { org: string; project: string; repo: string };
export type PrAvailability = {
  available: boolean;
  reason: string | null;
  target: AzureRepoRef | null;
};

const PATTERNS = [
  /^https:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+?)(?:\.git)?\/?$/i,
  /^https:\/\/(?:[^@/]+@)?([^./@]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+?)(?:\.git)?\/?$/i,
  /^(?:ssh:\/\/)?git@ssh\.dev\.azure\.com[:/]v3\/([^/]+)\/([^/]+)\/([^/]+?)\/?$/i,
  /^(?:ssh:\/\/)?[^@/]+@vs-ssh\.visualstudio\.com[:/]v3\/([^/]+)\/([^/]+)\/([^/]+?)\/?$/i,
];

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function parseAzureReposRemote(url: string): AzureRepoRef | null {
  const trimmed = url.trim();
  for (const re of PATTERNS) {
    const m = re.exec(trimmed);
    if (m && m[3] !== '_git')
      return {
        org: decode(m[1]).toLowerCase(),
        project: decode(m[2]),
        repo: decode(m[3]),
      };
  }
  return null;
}

/** The organization name of a connection URL (`https://dev.azure.com/<org>` or `https://<org>.visualstudio.com`). */
export function organizationOf(orgUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(orgUrl);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === 'dev.azure.com')
    return u.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? null;
  if (host.endsWith('.visualstudio.com'))
    return host.slice(0, -'.visualstudio.com'.length);
  return null;
}

/** The connection for a remote: same organization as the Azure Repos URL, preferring the same project; null for other hosts. */
export function matchConnection<
  C extends Pick<Connection, 'organizationUrl' | 'project'>,
>(remoteUrl: string | null, connections: C[]): C | null {
  const ref = remoteUrl ? parseAzureReposRemote(remoteUrl) : null;
  if (!ref) return null;
  const inOrg = connections.filter(
    (c) => organizationOf(c.organizationUrl) === ref.org,
  );
  return (
    inOrg.find((c) => c.project.toLowerCase() === ref.project.toLowerCase()) ??
    inOrg[0] ??
    null
  );
}

export function prAvailability(input: {
  remoteUrl: string | null;
  connectionOrgUrl: string | null;
}): PrAvailability {
  const no = (reason: string): PrAvailability => ({
    available: false,
    reason,
    target: null,
  });
  if (!input.connectionOrgUrl)
    return no('this repo has no Azure DevOps connection');
  const target = input.remoteUrl
    ? parseAzureReposRemote(input.remoteUrl)
    : null;
  if (!target) return no('origin is not an Azure Repos URL');
  if (organizationOf(input.connectionOrgUrl) !== target.org)
    return no('origin is in another Azure DevOps organization');
  return { available: true, reason: null, target };
}

/** `origin/main` -> `main` when `origin` is a remote; anything else is already a branch name. */
export function targetBranch(baseRef: string, remotes: string[]): string {
  return splitRemoteRef(baseRef, remotes)?.branch ?? baseRef;
}

export function prTitle(task: {
  workItem: { id: string; title: string } | null;
  name: string;
}): string {
  return task.workItem
    ? `${task.workItem.id} ${task.workItem.title}`.trim()
    : task.name;
}

export function prWebUrl(
  orgUrl: string,
  project: string,
  repo: string,
  id: number,
): string {
  return `${orgUrl.replace(/\/+$/, '')}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${id}`;
}

export const PR_DESCRIPTION_MAX = 4000;

export type PrDescriptionInput = {
  /** e.g. "Bug 42: Fix it", or the task name for a blank task. */
  heading: string;
  commits: { sha: string; subject: string }[];
  /** All commits on the branch; may exceed `commits.length`. */
  commitCount: number;
  /** e.g. "AI cost for this task: €1.00 (Claude €1.00, Copilot €0.00)"; null leaves the cost out. */
  costLine: string | null;
  /** Set when the task spans several repos: the cost line is then the whole task's, and says so. */
  costScope?: { repos: number };
  /** Named in the description when the PR cannot link the work item (another organization). */
  workItemUrl?: string | null;
  /**
   * What changed and why, in Markdown (written at Finish, #111). Goes between the heading and the commits; the
   * commit list is shortened first to stay under the limit, then this text is cut.
   */
  summary?: string | null;
};

export function prDescription(input: PrDescriptionInput): string {
  const costLine =
    input.costLine &&
    input.costScope &&
    input.costLine.startsWith(COST_LINE_PREFIX)
      ? `AI cost (whole task, ${input.costScope.repos} repos): ${input.costLine.slice(COST_LINE_PREFIX.length)}`
      : input.costLine;
  const footer = costLine
    ? `${costLine} · recorded by Shellie`
    : 'Recorded by Shellie';
  const top = input.workItemUrl
    ? `${input.heading}\n\nWork item: ${input.workItemUrl}`
    : input.heading;
  const summary = input.summary?.trim() ?? '';
  const build = (n: number, text: string): string => {
    const head = text ? `${top}\n\n${text}` : top;
    if (input.commits.length === 0 && input.commitCount === 0)
      return `${head}\n\n${footer}`;
    const lines = input.commits
      .slice(0, n)
      .map((c) => `- ${c.sha} ${c.subject}`);
    const more = input.commitCount - n;
    if (more > 0) lines.push(`- …and ${more} more commits`);
    return `${head}\n\n## Commits\n${lines.join('\n')}\n\n${footer}`;
  };
  for (let n = input.commits.length; n >= 0; n--) {
    const text = build(n, summary);
    if (text.length <= PR_DESCRIPTION_MAX) return text;
  }
  if (summary) {
    // Even without any commit listed the summary is too long: cut it to what is left.
    const room = PR_DESCRIPTION_MAX - build(0, '…').length;
    if (room > 0) return build(0, `${summary.slice(0, room).trimEnd()}…`);
  }
  return `${top}\n\n${footer}`.slice(0, PR_DESCRIPTION_MAX);
}
