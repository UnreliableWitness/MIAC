import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../shared/usage';
import { migrateOnboarding } from './onboardingMigration';

const NOW = '2026-10-22T10:00:00.000Z';

describe('migrateOnboarding', () => {
  it('an install that already has repositories skips Get started and keeps its tabs', () => {
    const before = defaultSettings();
    const after = migrateOnboarding(before, 2, NOW);
    expect(after?.onboarding).toEqual({
      dismissedAt: NOW,
      agentsCheckedAt: NOW,
      tracker: null,
    });
    expect(after?.defaultTerminals).toEqual(before.defaultTerminals);
  });

  it('a fresh install is left alone', () => {
    expect(migrateOnboarding(defaultSettings(), 0, NOW)).toBeNull();
  });

  it('runs once: settings with a timestamp are left alone', () => {
    const s = defaultSettings();
    expect(
      migrateOnboarding(
        { ...s, onboarding: { ...s.onboarding, dismissedAt: 'earlier' } },
        3,
        NOW,
      ),
    ).toBeNull();
    expect(
      migrateOnboarding(
        { ...s, onboarding: { ...s.onboarding, agentsCheckedAt: 'earlier' } },
        3,
        NOW,
      ),
    ).toBeNull();
  });
});
