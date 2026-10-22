import type { AppSettings } from '../shared/usage';

/**
 * Runs once, on the first start of the version with the first-run page (fresh installs included), and marks
 * `onboarding.migrated` so it never runs again. Installs that already have repositories then skip the page and keep
 * their tabs (`agentsCheckedAt` stops the Agents step from ticking them again); without the marker a new user who
 * adds a repository before opening Agents would look like such an install at the next launch. Returns the settings
 * to save, or null when nothing changes.
 */
export function migrateOnboarding(
  settings: AppSettings,
  repoCount: number,
  now: string,
): AppSettings | null {
  const { dismissedAt, agentsCheckedAt, migrated } = settings.onboarding;
  if (migrated) return null;
  const upgrade =
    repoCount > 0 && dismissedAt === null && agentsCheckedAt === null;
  return {
    ...settings,
    onboarding: {
      ...settings.onboarding,
      ...(upgrade ? { dismissedAt: now, agentsCheckedAt: now } : {}),
      migrated: true,
    },
  };
}
