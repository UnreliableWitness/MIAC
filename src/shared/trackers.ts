import { z } from 'zod';

export const TrackerProviderSchema = z.enum(['azure-devops', 'github']);
export type TrackerProvider = z.infer<typeof TrackerProviderSchema>;

/** The words the UI uses for a tracker's concepts. */
export function nouns(provider: TrackerProvider): {
  item: string;
  iteration: string;
  pullRequest: string;
} {
  return provider === 'github'
    ? { item: 'issue', iteration: 'iteration', pullRequest: 'pull request' }
    : { item: 'work item', iteration: 'sprint', pullRequest: 'pull request' };
}
