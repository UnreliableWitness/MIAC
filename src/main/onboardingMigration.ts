import type { AppSettings } from '../shared/usage';

/**
 * Installs that already have repositories when the first-run page ships skip it, and keep their tabs
 * (`agentsCheckedAt` stops the Agents step from ticking them again). A non-null `dismissedAt` is the marker
 * that this ran. Returns the settings to save, or null when nothing changes.
 */
export function migrateOnboarding(
  settings: AppSettings,
  repoCount: number,
  now: string,
): AppSettings | null {
  const { dismissedAt, agentsCheckedAt } = settings.onboarding;
  if (repoCount === 0 || dismissedAt !== null || agentsCheckedAt !== null)
    return null;
  return {
    ...settings,
    onboarding: {
      ...settings.onboarding,
      dismissedAt: now,
      agentsCheckedAt: now,
    },
  };
}
